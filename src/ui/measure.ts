import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Markdown } from './Markdown.tsx';
import { CopilotActivity, type ActivityEntry } from './CopilotActivity.tsx';
import { Welcome } from './Welcome.tsx';
import { ThinkingIndicator } from './ThinkingIndicator.tsx';

/**
 * Pure-JS height estimation for the inline ChatHistory viewport cap.
 *
 * WHY NOT renderToString: the obvious way to get an exact height is Ink's `renderToString`, but it
 * spins up a second Ink reconciler that lays out on the SAME shared yoga-wasm module the live app
 * uses. Calling it at all while the app is running corrupts yoga's indirect-call table and hard-
 * crashes the process: `RuntimeError: Out of bounds call_indirect` deep in yoga, via
 * `render-to-string.js` → `resetAfterCommit`. This happens whether renderToString is called during
 * render OR from an effect — so the only safe option is to never call it. We estimate instead.
 *
 * The estimate is biased HIGH on purpose: per ChatHistory's contract, under-filling the viewport just
 * leaves blank space, while overflowing makes Ink flicker/scroll on every frame — so round against
 * overflow. estimateHeight() touches no yoga and is safe to call during render.
 */

function wrapCount(text: string, cols: number): number {
  const width = Math.max(1, cols);
  return text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil([...line].length / width)), 0);
}

// Flatten Fragments and nested arrays into a flat child list (siblings of the parent Box).
function flattenChildren(children: React.ReactNode): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const walk = (c: React.ReactNode) => {
    if (Array.isArray(c)) { c.forEach(walk); return; }
    if (React.isValidElement(c) && c.type === React.Fragment) {
      walk((c.props as { children?: React.ReactNode }).children);
      return;
    }
    out.push(c);
  };
  walk(children);
  return out;
}

// Everything inside a <Text> is inline (Ink flattens nested Text into one styled string), so gather
// all string content to compute its wrapped line count.
function inlineText(node: React.ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(inlineText).join('');
  if (React.isValidElement(node)) return inlineText((node.props as { children?: React.ReactNode }).children);
  return '';
}

// First defined numeric value wins (mirrors Ink's padding/margin shorthand resolution).
function firstNum(...vals: Array<number | undefined>): number {
  for (const v of vals) if (typeof v === 'number') return v;
  return 0;
}

function estimateCopilotActivityHeight(entries: ActivityEntry[], isWorking: boolean, cols: number): number {
  let h = 1; // "⏺ copilot" header
  const tools = entries.filter((e) => e.kind === 'tool');
  const texts = entries.filter((e) => e.kind === 'text');
  for (const t of tools) h += Math.max(1, wrapCount(t.label, cols));
  for (const t of texts) h += Math.ceil(wrapCount(t.label, cols) * 1.4) + 2; // Markdown adds blank lines
  if (isWorking && !tools.some((e) => !e.done)) h += 1; // Thinking…/Working… indicator
  return h;
}

// Welcome adapts its content to the window height via these same thresholds; mirror them so we
// reserve roughly what it renders (biased a hair high). Tiers from Welcome.tsx.
function welcomeHeight(): number {
  const rows = process.stdout.rows ?? 24;
  let h = 0;
  if (rows >= 21) h += 8;       // blank + 6 banner rows + blank
  h += 1;                       // blank spacer
  h += 1;                       // identity line
  if (rows >= 39) h += 13;      // intro box: margin + border + paddingY + ~8 content lines
  if (rows >= 25) h += 4;       // two hint lines, each with a top margin
  h += 1;                       // trailing blank
  return h + 1;                 // safety pad — bias toward over-reserving
}

/** Estimate a node's rendered height in rows. Pure — no yoga, safe to call during render. */
export function estimateHeight(node: React.ReactNode, cols: number): number {
  if (node === null || node === undefined || node === false || node === true) return 0;
  if (typeof node === 'string') return wrapCount(node, cols);
  if (typeof node === 'number') return wrapCount(String(node), cols);
  if (Array.isArray(node)) return node.reduce<number>((s, c) => s + estimateHeight(c, cols), 0);
  if (!React.isValidElement(node)) return 0;

  const type = node.type;
  const props = node.props as Record<string, unknown>;

  if (type === Text) return Math.max(1, wrapCount(inlineText(node), cols));
  if (type === Spinner || type === ThinkingIndicator) return 1;
  if (type === Welcome) return welcomeHeight();
  if (type === CopilotActivity) {
    return estimateCopilotActivityHeight(
      (props.entries as ActivityEntry[]) ?? [],
      (props.isWorking as boolean) ?? false,
      cols,
    );
  }
  if (type === Markdown) {
    // Markdown roughly preserves the source's line count; bias high for block spacing/borders.
    return Math.ceil(wrapCount(inlineText(props.children as React.ReactNode), cols) * 1.2) + 1;
  }
  if (type === React.Fragment) {
    return flattenChildren(props.children as React.ReactNode).reduce<number>((s, c) => s + estimateHeight(c, cols), 0);
  }
  if (type === Box) {
    const padLeft = firstNum(props.paddingLeft as number, props.paddingX as number, props.padding as number);
    const padRight = firstNum(props.paddingRight as number, props.paddingX as number, props.padding as number);
    const padTop = firstNum(props.paddingTop as number, props.paddingY as number, props.padding as number);
    const padBottom = firstNum(props.paddingBottom as number, props.paddingY as number, props.padding as number);
    const marginTop = firstNum(props.marginTop as number, props.marginY as number, props.margin as number);
    const marginBottom = firstNum(props.marginBottom as number, props.marginY as number, props.margin as number);
    const border = props.borderStyle ? 1 : 0;
    const gap = firstNum(props.gap as number);
    const innerCols = Math.max(1, cols - padLeft - padRight - border * 2);
    const kids = flattenChildren(props.children as React.ReactNode);
    const heights = kids.map((c) => estimateHeight(c, innerCols));
    const isColumn = typeof props.flexDirection === 'string' && (props.flexDirection as string).startsWith('column');
    let body: number;
    if (isColumn) {
      const nonZero = heights.filter((h) => h > 0).length;
      body = heights.reduce((s, h) => s + h, 0) + gap * Math.max(0, nonZero - 1);
    } else {
      body = heights.length ? Math.max(...heights) : 0; // row: tallest child
    }
    return marginTop + marginBottom + padTop + padBottom + border * 2 + body;
  }

  // Unknown custom component: descend into children if it has content, else assume a single line.
  const children = (props as { children?: React.ReactNode }).children;
  return children != null ? estimateHeight(children, cols) : 1;
}
