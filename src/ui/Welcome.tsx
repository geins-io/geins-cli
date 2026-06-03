import React from 'react';
import { Box, Text, useWindowSize } from 'ink';

const LOGO_FULL = [
'  ██████╗ ███████╗██╗███╗   ██╗███████╗',
' ██╔════╝ ██╔════╝██║████╗  ██║██╔════╝',
' ██║  ███╗█████╗  ██║██╔██╗ ██║███████╗',
' ██║   ██║██╔══╝  ██║██║╚██╗██║╚════██║',
' ╚██████╔╝███████╗██║██║ ╚████║███████║',
'  ╚═════╝ ╚══════╝╚═╝╚═╝  ╚═══╝╚══════╝',
];
const LOGO_COMPACT = [
'  ██████╗ ███████╗██╗███╗   ██╗███████╗',
' ██╔════╝ ██╔════╝██║████╗  ██║██╔════╝',
' ██║  ███╗█████╗  ██║██╔██╗ ██║███████╗',
' ██║   ██║██╔══╝  ██║██║╚██╗██║╚════██║',
' ╚██████╔╝███████╗██║██║ ╚████║███████║',
'  ╚═════╝ ╚══════╝╚═╝╚═╝  ╚═══╝╚══════╝',
  ];

const PROMPT = [
'██╗     ',
'╚██╗    ',
' ╚██╗   ',
' ██╔╝   ',
'██╔╝    ',
'╚═╝ ▁▁▁ ',
];

const SUFFIX = [
'    ███████╗██╗   ██╗███╗   ██╗ █████╗ ██████╗ ███████╗███████╗',
'   ██╔════╝╚██╗ ██╔╝████╗  ██║██╔══██╗██╔══██╗██╔════╝██╔════╝',
'   ███████╗ ╚████╔╝ ██╔██╗ ██║███████║██████╔╝███████╗█████╗  ',
'   ╚════██║  ╚██╔╝  ██║╚██╗██║██╔══██║██╔═══╝ ╚════██║██╔══╝  ',
'   ███████║   ██║   ██║ ╚████║██║  ██║██║     ███████║███████╗',
'    ╚══════╝   ╚═╝   ╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝     ╚══════╝╚══════╝',
];

// Horizontal (x-axis) gradient stops: cyan → blue → green, left → right.
const GRADIENT = ['#00e5ff', '#3b82f6', '#22c55e'];
const FULL_WIDTH = 86;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorAt(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (GRADIENT.length - 1);
  const i = Math.min(Math.floor(seg), GRADIENT.length - 2);
  const f = seg - i;
  const a = hexToRgb(GRADIENT[i]!);
  const b = hexToRgb(GRADIENT[i + 1]!);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * f);
  const r = mix(a[0], b[0]);
  const g = mix(a[1], b[1]);
  const bl = mix(a[2], b[2]);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

type AuthState = 'logged-in' | 'logged-out' | 'expired' | 'unverified' | 'checking';

interface WelcomeProps {
  version: string;
  user?: string;
  account?: string;
  accountName?: string;
  apiAccount?: string;
  authState?: AuthState;
}

// Login states that warrant a visible prompt to (re-)authenticate.
const AUTH_NOTICE: Partial<Record<AuthState, string>> = {
  'logged-out': 'You are not logged in. Run /login to authenticate with Geins.',
  expired: 'Your session has expired. Run /login to re-authenticate.',
};

export function Welcome({ version, user, account, accountName, apiAccount, authState }: WelcomeProps) {
  const { columns } = useWindowSize();
  const logo = columns >= FULL_WIDTH ? LOGO_FULL : LOGO_COMPACT;

  const rows = logo.map((line, i) => `${PROMPT[i]}${line}${SUFFIX[i]}`);
  const width = Math.max(...rows.map((r) => [...r].length));

  const authNotice = authState ? AUTH_NOTICE[authState] : undefined;
  // The stored session still holds the last user/account even after the token is rejected,
  // so suppress that identity when not authenticated — it shouldn't read as "logged in".
  const loggedOut = authState === 'expired' || authState === 'logged-out';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text> </Text>
      {rows.map((row, i) => (
        <Text key={i}>
          {[...row].map((ch, col) => (
            <Text key={col} color={colorAt(col / (width - 1))}>{ch}</Text>
          ))}
        </Text>
      ))}
      <Text> </Text>

      <Text> </Text>
      <Box flexDirection="column" paddingX={1}>
        <Box gap={1}>
          <Text color="cyan" bold>✻</Text>
          <Text bold>Geins CLI</Text>
          <Text dimColor>v{version}</Text>
          {user && !loggedOut ? (
            <>
              <Text dimColor>·</Text>
              <Text>{user}</Text>
            </>
          ) : null}
          {account && !loggedOut ? (
            <>
              <Text dimColor>·</Text>
              <Text dimColor>{accountName ? `${accountName} (${account})` : account}</Text>
            </>
          ) : null}
          {apiAccount ? (
            <>
              <Text dimColor>·</Text>
              <Text color="green">{apiAccount}</Text>
            </>
          ) : null}
        </Box>      
      </Box>
      <Box
        borderStyle="round"
        borderColor="cyan"
        flexDirection="column"        
        marginTop={1}
        paddingX={1}
        paddingY={1}
      >
        <Text>Welcome to <Text bold color="cyan">Geins Synapse</Text> — commerce at the speed of the command line.</Text>
        <Text> </Text>
        <Text>2026 is the year agents run the store. Synapse makes your catalog,</Text>
        <Text>orders, and workflows agent-ready — structured, scriptable, and live.</Text>
        <Text> </Text>
        <Text>Type a command, hand it to <Text color="magenta">copilot</Text>, or go fully headless with your favorite agent framework.</Text>
        <Text>Your commerce, on autopilot.</Text>

      </Box>
      {authNotice ? (
        <Box
          borderStyle="round"
          borderColor="yellow"
          marginTop={1}
          paddingX={1}
          gap={1}
        >
          <Text color="yellow">⚠</Text>
          <Text color="yellow">{authNotice}</Text>
        </Box>
      ) : null}
      
      <Box marginTop={1} flexDirection="column">
        <Text color="">ℹ Hello World! Welcome to Geins Synapse - Your Central Nervous System of Commerce.</Text>
        <Text color="">ℹ Switch to <Text color="magenta">copilot</Text> mode with <Text color="magenta">/copilot</Text> or shift tab.</Text>
      </Box>

      <Box marginTop={1} >
        <Text dimColor>Type <Text color="cyan">/help</Text> for commands, <Text color="cyan">/exit</Text> to quit</Text>
      </Box>
      <Text> </Text>
    </Box>
  );
}
