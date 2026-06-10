import React from 'react';
import { Box, Static, useWindowSize } from 'ink';

interface ChatHistoryProps {
  ready: boolean;
  welcomeComponent?: React.ReactNode;
  queuedComponents: React.ReactNode[];
  liveComponent?: React.ReactNode;
  /** Bumped by /clear (appState.clearChat): remounts <Static> so it re-emits the fresh banner. */
  epoch?: number;
}

const keyFor = (component: React.ReactNode, index: number): string =>
  component && typeof component === 'object' && 'key' in component && component.key
    ? String(component.key)
    : `msg-${index}`;

/**
 * Renders committed chat history through Ink's <Static>: each item is written to the terminal's
 * scrollback buffer exactly once and never repainted, so the user can scroll back with the native
 * terminal (mouse/trackpad) — no in-app height cap, no per-frame layout, and crucially no
 * `renderToString` measurement (which crashes the shared yoga-wasm module; see git history).
 *
 * The known downside of <Static> is resize: lines already printed to scrollback don't reflow
 * cleanly when the terminal WIDTH changes, leaving ghost borders. We fix that by keying <Static>
 * on the column count — a width change remounts it, so every item re-renders and is re-emitted at
 * the new width. cli.ts clears the screen + scrollback on the same width change, so the buffer
 * rebuilds cleanly rather than duplicating the old-width copy.
 *
 * The live component (streaming copilot card, spinners) stays in the DYNAMIC region below Static —
 * it updates every frame and is committed into Static (via addToChat) once the turn finishes.
 */
export function ChatHistory({
  ready,
  welcomeComponent,
  queuedComponents,
  liveComponent,
  epoch = 0,
}: ChatHistoryProps) {
  const { columns } = useWindowSize();

  // The welcome banner is the first scrollback item (stable index 0 once `ready`, so Static's
  // index tracking isn't disturbed). queuedComponents follow in order.
  const items: Array<{ key: string; node: React.ReactNode }> = [];
  if (ready && welcomeComponent) items.push({ key: 'welcome', node: welcomeComponent });
  queuedComponents.forEach((component, index) => items.push({ key: keyFor(component, index), node: component }));

  return (
    <Box flexDirection="column">
      {/* Remount on width change (re-emit at new width; ink >= 7.0.5 required for
          remounts to re-emit at all) and on /clear's epoch bump (fresh banner). */}
      <Static key={`${columns}:${epoch}`} items={items}>
        {(item) => (
          <Box key={item.key} flexDirection="column">{item.node}</Box>
        )}
      </Static>
      {liveComponent && (
        <Box flexDirection="column">{liveComponent}</Box>
      )}
    </Box>
  );
}
