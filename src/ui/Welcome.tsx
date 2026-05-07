import React from 'react';
import { Box, Text } from 'ink';

const LOGO = [
  '██╗     ██╗████████╗██╗██╗   ██╗███╗   ███╗     ██████╗ ██████╗ ██████╗ ███████╗',
  '██║     ██║╚══██╔══╝██║██║   ██║████╗ ████║    ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██║     ██║   ██║   ██║██║   ██║██╔████╔██║    ██║     ██║   ██║██████╔╝█████╗  ',
  '██║     ██║   ██║   ██║██║   ██║██║╚██╔╝██║    ██║     ██║   ██║██╔══██╗██╔══╝  ',
  '███████╗██║   ██║   ██║╚██████╔╝██║ ╚═╝ ██║    ╚██████╗╚██████╔╝██║  ██║███████╗',
  '╚══════╝╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝     ╚═╝     ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝',
];

const COLORS = ['cyan', 'cyan', '#3b82f6', '#3b82f6', 'green', 'green'] as const;

interface WelcomeProps {
  version: string;
  user?: string;
  account?: string;
}

export function Welcome({ version, user, account }: WelcomeProps) {
  return (
    <Box flexDirection="column" paddingX={2}>
      <Text> </Text>
      {LOGO.map((line, i) => (
        <Text key={i} color={COLORS[i]}>{`  ${line}`}</Text>
      ))}
      <Text> </Text>
      <Box flexDirection="column" paddingX={2}>
        <Box gap={1}>
          <Text color="cyan" bold>✻</Text>
          <Text bold>Geins CLI</Text>
          <Text dimColor>v{version}</Text>
          {user ? (
            <>
              <Text dimColor>·</Text>
              <Text>{user}</Text>
            </>
          ) : null}
          {account ? (
            <>
              <Text dimColor>·</Text>
              <Text dimColor>{account}</Text>
            </>
          ) : null}
        </Box>
        <Text dimColor>  Type /help for commands, /exit to quit</Text>
      </Box>
      <Text> </Text>
    </Box>
  );
}
