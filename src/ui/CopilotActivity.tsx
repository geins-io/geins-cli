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
  return (
    <Box flexDirection="column">
      <Text dimColor>{`⏺ ${providerLabel}`}</Text>
      {entries.map((entry, i) => {
        if (entry.kind === 'text') {
          return <Markdown key={i}>{entry.label}</Markdown>;
        }
        if (entry.done) {
          return (
            <Box key={i} paddingLeft={2} gap={1}>
              <Text color="green">✓</Text>
              <Text dimColor>{entry.label}</Text>
            </Box>
          );
        }
        return (
          <Box key={i} paddingLeft={2} gap={1}>
            <Spinner type="dots" />
            <Text color="cyan">{entry.label}</Text>
          </Box>
        );
      })}
      {isWorking && !entries.some(e => e.kind === 'tool' && !e.done) && (
        <Box paddingLeft={2} gap={1}>
          <Spinner type="dots" />
          <Text dimColor>Thinking…</Text>
        </Box>
      )}
    </Box>
  );
}
