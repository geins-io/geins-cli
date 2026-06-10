import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Markdown } from './Markdown.tsx';

export interface ActivityEntry {
  kind: 'tool' | 'text';
  label: string;
  done: boolean;
  /** When the tool started running — drives the per-entry elapsed counter while live. */
  startedAt?: number;
}

interface CopilotActivityProps {
  providerLabel: string;
  entries: ActivityEntry[];
  isWorking: boolean;
  /** When the whole turn started — drives the header's total elapsed counter while live. */
  startedAt?: number;
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function CopilotActivity({ providerLabel, entries, isWorking, startedAt }: CopilotActivityProps) {
  // Tick once a second while live so the elapsed counters count — a moving clock is the
  // strongest "still alive" signal during a long tool call. Committed cards
  // (isWorking=false) land in <Static> scrollback and must not keep timers running.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isWorking) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [isWorking]);
  const now = Date.now();

  // Render what the model DID (tool calls, in order) first, then its answer. The text entry is
  // created as soon as the first prose chunk streams in, so without this split a later tool call
  // would render *below* the answer — folding the reply into the middle of the activity list.
  const tools = entries.filter((e) => e.kind === 'tool');
  const texts = entries.filter((e) => e.kind === 'text');
  // A tool with its own spinner is already showing motion — don't stack a second indicator on top.
  const toolRunning = tools.some((e) => !e.done);
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text dimColor>{`⏺ copilot`}</Text>
        {isWorking && startedAt !== undefined && (
          <Text dimColor>{`(${formatElapsed(now - startedAt)})`}</Text>
        )}
      </Box>
      {tools.map((entry, i) =>
        entry.done ? (
          <Box key={`tool-${i}`} paddingLeft={2} gap={1}>
            <Text color="green">✓</Text>
            <Text dimColor>{entry.label}</Text>
          </Box>
        ) : (
          <Box key={`tool-${i}`} paddingLeft={2} gap={1}>
            <Spinner type="dots" />
            <Text color="cyan">{entry.label}</Text>
            {entry.startedAt !== undefined && (
              <Text dimColor>{`(${formatElapsed(now - entry.startedAt)})`}</Text>
            )}
          </Box>
        ),
      )}
      {texts.map((entry, i) => (
        <Markdown key={`text-${i}`}>{entry.label}</Markdown>
      ))}
      {/* Keep a live indicator on screen the WHOLE time the agent is working — including after
          prose has streamed (it may still be using a native tool, thinking, or we're computing
          context usage before committing the card). Without this the turn looks frozen mid-work. */}
      {isWorking && !toolRunning && (
        <Box paddingLeft={2} gap={1}>
          <Spinner type="dots" />
          <Text dimColor>{texts.length === 0 ? 'Thinking…' : 'Working…'}</Text>
        </Box>
      )}
    </Box>
  );
}
