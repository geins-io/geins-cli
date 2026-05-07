import { memo, Fragment } from 'react';
import { Box, Static } from 'ink';

interface ChatQueueProps {
  queuedComponents?: React.ReactNode[];
}

export const ChatQueue = memo(function ChatQueue({
  queuedComponents = [],
}: ChatQueueProps) {
  return (
    <Box flexDirection="column">
      <Static items={queuedComponents}>
        {(component, index) => {
          const key =
            component &&
            typeof component === 'object' &&
            'key' in component &&
            component.key
              ? component.key
              : `static-${index}`;
          return <Fragment key={key}>{component}</Fragment>;
        }}
      </Static>
    </Box>
  );
});
