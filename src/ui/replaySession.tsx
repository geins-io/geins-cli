import React from 'react';
import { Text } from 'ink';
import { Markdown } from './Markdown.tsx';
import { describeEntry } from '../commands/sessions.ts';
import type { SessionEntry } from '../memory/types.ts';

/**
 * Turn persisted session entries into React nodes for the chat scrollback.
 * Mapping mirrors `describeEntry` so the TUI and headless transcript stay in sync.
 * Keys come from `getNextKey()` so they never collide with live chat components.
 */
export function renderTranscript(
  entries: SessionEntry[],
  getNextKey: () => number,
): React.ReactNode[] {
  return entries.map(entry => {
    const key = `replay-${getNextKey()}`;
    const { prefix, style } = describeEntry(entry);
    const text = `${prefix}${entry.content}`;
    switch (style) {
      case 'prompt':
        return <Text key={key} bold>{text}</Text>;
      case 'error':
        return <Text key={key} color="red">{`  ${text}`}</Text>;
      case 'dim':
        return <Text key={key} dimColor>{`  ${text}`}</Text>;
      case 'response':
      case 'output':
      default:
        return <Markdown key={key}>{entry.content}</Markdown>;
    }
  });
}
