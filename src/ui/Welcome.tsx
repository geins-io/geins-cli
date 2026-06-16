/** @jsxImportSource react */
import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { PROMPT, WORDMARK, type LogoVariant } from './logos';

// Horizontal (x-axis) gradient stops: cyan → blue → green, left → right.
const GRADIENT = ['#00e5ff', '#3b82f6', '#22c55e'];

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
  logo?: LogoVariant;
  prefix?: boolean;
  name?: string;
}

// Login states that warrant a visible prompt to (re-)authenticate.
const AUTH_NOTICE: Partial<Record<AuthState, string>> = {
  'logged-out': 'You are not logged in. Run /login to authenticate with Geins.',
  expired: 'Your session has expired. Run /login to re-authenticate.',
};

export function Welcome({ version, user, account, accountName, apiAccount, authState, logo = 'synapse', prefix = true, name = 'Synapse' }: WelcomeProps) {
  const { columns, rows: windowRows } = useWindowSize();

  // Degrade the banner by available height so the whole frame stays inside the viewport. A frame
  // taller than the window scrolls off the top, and on resize Ink can only erase what it can still
  // reach with the cursor — the rest is left behind as ghost borders / duplicated headers. Shed the
  // intro box, then the hints, then the logo as the window shrinks. Each tier's measured height must
  // clear `rows` with room for the input box, which shares the same Ink frame (~8 lines, matching the
  // reserve in ChatHistory): full banner ≈30 lines, +logo+hints ≈16, logo only ≈12.
  const h = windowRows ?? 24;

  // The banner is "❯_ SYNAPSE": the prompt flourish + the wordmark. Drop the prompt when the
  // pair overflows the terminal, and the whole logo when even the wordmark alone doesn't fit;
  // the outer Box adds paddingX={1} on each side (2 cols).
  const artWidth = (art: string[]) => Math.max(...art.map((l) => [...l].length));
  const showPrompt = prefix && artWidth(PROMPT) + artWidth(WORDMARK) <= columns - 2;
  // BRAND_LOGO=none hides the ASCII banner entirely, leaving just the text identity line (the name).
  const showLogo = logo !== 'none' && h >= 21 && artWidth(WORDMARK) <= columns - 2;
  const showHints = h >= 25;
  const showIntroBox = h >= 39;

  const rows = WORDMARK.map((line, i) => `${showPrompt ? PROMPT[i] : ''}${line}`);
  const width = Math.max(...rows.map((r) => [...r].length));

  const authNotice = authState ? AUTH_NOTICE[authState] : undefined;
  // The stored session still holds the last user/account even after the token is rejected,
  // so suppress that identity when not authenticated — it shouldn't read as "logged in".
  const loggedOut = authState === 'expired' || authState === 'logged-out';

  return (
    <Box flexDirection="column" paddingX={1}>
      {showLogo ? (
        <>
          <Text> </Text>
          {rows.map((row, i) => (
            <Text key={i}>
              {[...row].map((ch, col) => (
                <Text key={col} color={colorAt(col / (width - 1))}>{ch}</Text>
              ))}
            </Text>
          ))}
          <Text> </Text>
        </>
      ) : null}

      <Text> </Text>
      <Box flexDirection="column" paddingX={1}>
        <Box gap={1}>
          <Text color="cyan" bold>✻</Text>
          <Text bold>{name}</Text>
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
      {showIntroBox ? (
        <Box
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          marginTop={1}
          paddingX={1}
          paddingY={1}
        >
           <Text>👋 <Text> </Text>Hello World!</Text>
           <Text> </Text>
           <Text>Welcome to <Text bold color="cyan">{name}</Text> — Your gateway to agentic commerce at the speed of the command line.</Text>
           <Text> </Text>
          <Text>2026 is the year agents run the store. Synapse makes your catalog,</Text>
          <Text>orders, and workflows agent-ready — structured, scriptable, and live.</Text>
          <Text> </Text>
          <Text>Type a command, hand it to <Text color="magenta">copilot</Text>, or go fully headless with your favorite agent framework.</Text>
          <Text>Your commerce, on autopilot.</Text>

        </Box>
      ) : null}
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
      
      {showHints ? (
        <>
          <Box marginTop={1} flexDirection="column">
            <Text color="">ℹ Switch to <Text color="magenta">copilot</Text> mode with <Text color="magenta">/copilot</Text> or shift tab.</Text>
          </Box>

          <Box marginTop={1} >
            <Text dimColor>Type <Text color="cyan">/help</Text> for commands, <Text color="cyan">/exit</Text> to quit</Text>
          </Box>
        </>
      ) : null}
      <Text> </Text>
    </Box>
  );
}
