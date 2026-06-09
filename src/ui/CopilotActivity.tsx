import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Markdown } from './Markdown.tsx';

export interface ActivityEntry {
  kind: 'tool' | 'text';
  label: string;
  done: boolean;
}

interface CopilotActivityProps {
  providerLabel: string;
  entries: ActivityEntry[];
  isWorking: boolean;
}

export function CopilotActivity({ providerLabel, entries, isWorking }: CopilotActivityProps) {
  // Render what the model DID (tool calls, in order) first, then its answer. The text entry is
  // created as soon as the first prose chunk streams in, so without this split a later tool call
  // would render *below* the answer — folding the reply into the middle of the activity list.
  const tools = entries.filter((e) => e.kind === 'tool');
  const texts = entries.filter((e) => e.kind === 'text');
  // A tool with its own spinner is already showing motion — don't stack a second indicator on top.
  const toolRunning = tools.some((e) => !e.done);
  return (
    <Box flexDirection="column">
      <Text dimColor>{`⏺ copilot`}</Text>
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
