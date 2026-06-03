import React from 'react';
import { Box, useWindowSize } from 'ink';

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

// The Welcome banner is many lines tall (logo + intro box + hints). It counts as a single
// item, so an item-count cap badly under-estimates the frame height and lets the banner push
// the frame past the viewport — which makes Ink repaint/scroll on every spinner tick (the
// "scrollbar flickers when thinking" bug). Budget by lines and give the banner its real height.
const WELCOME_LINES = 30;
const DEFAULT_ITEM_LINES = 1;

/**
 * Renders the chat history inline (NOT via Ink's <Static>) so the entire UI is one
 * Ink-managed frame that repaints cleanly when the terminal is resized — <Static> output is
 * committed to scrollback and can never be repainted, which left broken fragments on resize.
 *
 * The trade-off: Ink glitches (flickers/scrolls) when its frame is taller than the viewport,
 * so we cap the visible history to what fits the window, measured in estimated LINES rather
 * than item count. Older items scroll off the top and are no longer shown (there's no native
 * scrollback for inline content).
 */
export function ChatHistory({
  ready,
  welcomeComponent,
  queuedComponents,
  liveComponent,
}: ChatHistoryProps) {
  const { rows } = useWindowSize();

  const showWelcome = ready && !!welcomeComponent;
  const items = showWelcome
    ? [welcomeComponent, ...queuedComponents]
    : queuedComponents;

  // Reserve rows for the input box (two separators + prompt + footer) plus a little slack,
  // and for the live component when one is showing.
  const reserved = 8 + (liveComponent ? 3 : 0);
  const budget = Math.max(5, (rows ?? 24) - reserved);

  // Walk newest → oldest, keeping items until the line budget is spent. Always keep at least
  // one item so the screen is never blank. The tall Welcome banner (items[0]) is dropped as
  // soon as it would overflow, which keeps the live frame inside the viewport.
  const linesFor = (index: number) =>
    showWelcome && index === 0 ? WELCOME_LINES : DEFAULT_ITEM_LINES;

  let used = 0;
  let start = items.length;
  for (let i = items.length - 1; i >= 0; i--) {
    const h = linesFor(i);
    if (used + h > budget && start < items.length) break;
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
