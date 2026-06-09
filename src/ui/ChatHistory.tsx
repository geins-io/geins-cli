import React from 'react';
import { Box, useWindowSize } from 'ink';
import { estimateHeight } from './measure.ts';

interface ChatHistoryProps {
  ready: boolean;
  welcomeComponent?: React.ReactNode;
  queuedComponents: React.ReactNode[];
  liveComponent?: React.ReactNode;
}

const keyFor = (component: React.ReactNode, index: number): string =>
  component && typeof component === 'object' && 'key' in component && component.key
    ? String(component.key)
    : `msg-${index}`;

// Rows the input box (two separators + prompt + footer) occupies below the history, plus a
// safety margin. We bias this HIGH on purpose: a frame that ends up a row or two short just
// leaves blank space, but a frame that's even one row too tall makes Ink repaint/scroll on
// every spinner tick — that's the "flickers while thinking" bug. Under-filling is free;
// overflowing is the failure mode, so round against it.
const INPUT_RESERVE = 9;

// Heights are ESTIMATED in pure JS (see measure.ts) — NOT measured via Ink's renderToString, which
// lays out on the shared yoga-wasm module and crashes the process ("Out of bounds call_indirect")
// whenever it runs while the live app is rendering. estimateHeight touches no yoga, so it's safe here.
function measureHeight(node: React.ReactNode, cols: number): number {
  return estimateHeight(node, cols);
}

/**
 * Renders the chat history inline (NOT via Ink's <Static>) so the entire UI is one
 * Ink-managed frame that repaints cleanly when the terminal is resized — <Static> output is
 * committed to scrollback and can never be repainted, which left broken fragments on resize.
 *
 * The trade-off: Ink glitches (flickers/scrolls) when its frame is taller than the viewport,
 * so we cap the visible history to what fits the window. Item heights are measured at mutation
 * time (see measure.ts) and only READ here via cachedHeight — measuring during render crashes
 * yoga. Older items scroll off the top and are no longer shown (no native scrollback inline).
 */
export function ChatHistory({
  ready,
  welcomeComponent,
  queuedComponents,
  liveComponent,
}: ChatHistoryProps) {
  const { rows, columns } = useWindowSize();
  const cols = columns ?? 80;

  const showWelcome = ready && !!welcomeComponent;
  const items = showWelcome
    ? [welcomeComponent, ...queuedComponents]
    : queuedComponents;

  const budget = Math.max(3, (rows ?? 24) - INPUT_RESERVE);

  // The live component is always shown and gets first claim on the budget. Walk the history
  // newest → oldest, keeping items until the remaining budget is spent. When there's no live
  // component we force-keep the newest item so the screen is never blank; when a live component
  // is on screen we drop everything that doesn't fit (the screen still isn't blank) to keep the
  // frame inside the viewport.
  let used = measureHeight(liveComponent, cols);
  let start = items.length;
  for (let i = items.length - 1; i >= 0; i--) {
    const h = measureHeight(items[i], cols);
    const isNewest = start === items.length;
    if (used + h > budget && !(isNewest && !liveComponent)) break;
    used += h;
    start = i;
  }
  const visible = items.slice(start);

  return (
    <Box flexDirection="column">
      {visible.map((component, index) => (
        <Box key={keyFor(component, index)} flexDirection="column">{component}</Box>
      ))}
      {liveComponent && (
        <Box flexDirection="column">{liveComponent}</Box>
      )}
    </Box>
  );
}
