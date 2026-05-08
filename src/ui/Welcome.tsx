import React from 'react';
import { Box, Text, useWindowSize } from 'ink';

const LOGO_FULL = [
  '██╗     ██╗████████╗██╗██╗   ██╗███╗   ███╗     ██████╗ ██████╗ ██████╗ ███████╗',
  '██║     ██║╚══██╔══╝██║██║   ██║████╗ ████║    ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██║     ██║   ██║   ██║██║   ██║██╔████╔██║    ██║     ██║   ██║██████╔╝█████╗  ',
  '██║     ██║   ██║   ██║██║   ██║██║╚██╔╝██║    ██║     ██║   ██║██╔══██╗██╔══╝  ',
  '███████╗██║   ██║   ██║╚██████╔╝██║ ╚═╝ ██║    ╚██████╗╚██████╔╝██║  ██║███████╗',
  '╚══════╝╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝     ╚═╝     ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝',
];

const LOGO_COMPACT = [
  '██╗      ██████╗ ██████╗ ██████╗ ███████╗',
  '██║     ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██║     ██║     ██║   ██║██████╔╝█████╗  ',
  '██║     ██║     ██║   ██║██╔══██╗██╔══╝  ',
  '███████╗╚██████╗╚██████╔╝██║  ██║███████╗',
  '╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝',
];

const COLORS = ['cyan', 'cyan', '#3b82f6', '#3b82f6', 'green', 'green'] as const;
const FULL_WIDTH = 86;

interface WelcomeProps {
  version: string;
  user?: string;
  account?: string;
}

export function Welcome({ version, user, account }: WelcomeProps) {
  const { columns } = useWindowSize();
  const logo = columns >= FULL_WIDTH ? LOGO_FULL : LOGO_COMPACT;

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text> </Text>
      {logo.map((line, i) => (
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
