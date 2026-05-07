import React from 'react';
import { Box } from 'ink';
import { ChatQueue } from './ChatQueue.tsx';

interface ChatHistoryProps {
  ready: boolean;
  welcomeComponent?: React.ReactNode;
  queuedComponents: React.ReactNode[];
  liveComponent?: React.ReactNode;
}

export function ChatHistory({
  ready,
  welcomeComponent,
  queuedComponents,
  liveComponent,
}: ChatHistoryProps) {
  return (
    <Box flexGrow={1} flexDirection="column" minHeight={0}>
      {ready && welcomeComponent}
      {ready && queuedComponents.length > 0 && (
        <ChatQueue queuedComponents={queuedComponents} />
      )}
      {liveComponent && (
        <Box flexDirection="column">{liveComponent}</Box>
      )}
    </Box>
  );
}
