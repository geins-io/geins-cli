import React, { useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';

export interface SessionMeta {
  id: string;
  startedAt: number;
  entryCount: number;
  firstMessage: string;
}

interface SelectSessionProps {
  sessions: SessionMeta[];
  onSelect: (id: string) => void;
  onCancel: () => void;
}

function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SelectSession({ sessions, onSelect, onCancel }: SelectSessionProps) {
  const [selected, setSelected] = useState(0);
  const { rows } = useWindowSize();
  const now = Date.now();

  const maxVisible = Math.min(sessions.length, Math.max(5, rows - 10));
  let scrollStart = 0;
  if (sessions.length > maxVisible) {
    scrollStart = Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), sessions.length - maxVisible));
  }
  const visible = sessions.slice(scrollStart, scrollStart + maxVisible);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected(s => (s <= 0 ? sessions.length - 1 : s - 1));
      return;
    }
    if (key.downArrow) {
      setSelected(s => (s >= sessions.length - 1 ? 0 : s + 1));
      return;
    }
    if (key.return) {
      if (sessions.length > 0) onSelect(sessions[selected]!.id);
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>  Resume a session</Text>
      <Text dimColor>  {sessions.length} sessions · ↑↓ navigate · enter resume · esc cancel</Text>
      <Text> </Text>

      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        {visible.map((session, i) => {
          const globalIdx = scrollStart + i;
          const isSel = globalIdx === selected;
          return (
            <Box key={session.id} gap={1}>
              <Text color={isSel ? 'cyan' : undefined} bold={isSel}>
                {isSel ? '▸' : ' '}
              </Text>
              <Text color={isSel ? 'cyan' : undefined} dimColor={!isSel}>
                {relativeTime(session.startedAt, now).padEnd(8)}
              </Text>
              <Text color={isSel ? 'cyan' : undefined} bold={isSel}>
                {session.firstMessage}
              </Text>
              <Text dimColor>({session.entryCount})</Text>
            </Box>
          );
        })}
      </Box>

      {sessions.length > maxVisible ? (
        <Text dimColor>  {selected + 1}/{sessions.length}</Text>
      ) : null}
    </Box>
  );
}
