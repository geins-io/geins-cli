import React from 'react';
import { Box, Static } from 'ink';

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
  const staticItems = ready && welcomeComponent
    ? [welcomeComponent, ...queuedComponents]
    : queuedComponents;

  return (
    <>
      <Static items={staticItems}>
        {(component, index) => {
          const key =
            component &&
            typeof component === 'object' &&
            'key' in component &&
            component.key
              ? String(component.key)
              : `msg-${index}`;
          return <Box key={key} flexDirection="column">{component}</Box>;
        }}
      </Static>
      {liveComponent && (
        <Box flexDirection="column">{liveComponent}</Box>
      )}
    </>
  );
}
