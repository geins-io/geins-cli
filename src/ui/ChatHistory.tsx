import React from 'react';
import { Box } from 'ink';

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
    <Box flexGrow={1} flexDirection="column" minHeight={0} overflow="hidden">
      {ready && welcomeComponent}
      {queuedComponents.map((component, index) => {
        const key =
          component &&
          typeof component === 'object' &&
          'key' in component &&
          component.key
            ? component.key
            : `msg-${index}`;
        return <Box key={key} flexDirection="column">{component}</Box>;
      })}
      {liveComponent && (
        <Box flexDirection="column">{liveComponent}</Box>
      )}
    </Box>
  );
}
