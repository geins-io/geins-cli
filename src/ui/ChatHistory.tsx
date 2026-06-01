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

/**
 * Renders the chat history inline (NOT via Ink's <Static>) so the entire UI is one
 * Ink-managed frame that repaints cleanly when the terminal is resized — <Static> output is
 * committed to scrollback and can never be repainted, which left broken fragments on resize.
 *
 * The trade-off: Ink glitches when its frame is taller than the viewport, so we cap the
 * visible history to roughly what fits the window. Older items scroll off the top and are no
 * longer shown (there's no native scrollback for inline content).
 */
export function ChatHistory({
  ready,
  welcomeComponent,
  queuedComponents,
  liveComponent,
}: ChatHistoryProps) {
  const { rows } = useWindowSize();

  const items = ready && welcomeComponent
    ? [welcomeComponent, ...queuedComponents]
    : queuedComponents;

  // Reserve rows for the input box (two separators + prompt + footer) plus a little slack,
  // and for the live component when one is showing. Cap by item count as a proxy for height
  // (most items are one line); a single very tall item can still exceed the viewport.
  const reserved = 8 + (liveComponent ? 3 : 0);
  const maxItems = Math.max(5, (rows ?? 24) - reserved);
  const visible = items.length > maxItems ? items.slice(-maxItems) : items;

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
