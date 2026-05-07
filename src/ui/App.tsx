import React, { useCallback, useMemo } from 'react';
import { Box, Text, useApp, useWindowSize } from 'ink';
import Spinner from 'ink-spinner';
import { ChatHistory } from './ChatHistory.tsx';
import { ChatInput } from './ChatInput.tsx';
import { Welcome } from './Welcome.tsx';
import { LoginFlow } from './LoginFlow.tsx';
import { SelectAccount } from './SelectAccount.tsx';
import { useAppState } from './hooks/useAppState.ts';
import { clearSession, parseJwtExp } from '../auth/session.ts';
import { saveSession } from '../config/store.ts';
import { loadSession } from '../auth/session.ts';
import { fetchUser, type AuthResponse } from '../auth/login.ts';
import { request } from '../api/client.ts';
import { getApiUrl } from '../config/env.ts';
import { formatError } from '../api/errors.ts';

const VERSION = '0.1.0';

export function App({ version = VERSION }: { version?: string }) {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  const appState = useAppState();

  const logText = useCallback((text: string) => {
    appState.addToChat(
      <Text key={`msg-${appState.getNextKey()}`}>{text}</Text>,
    );
  }, [appState.addToChat, appState.getNextKey]);

  const logSuccess = useCallback((text: string) => {
    appState.addToChat(
      <Text key={`msg-${appState.getNextKey()}`} color="green">{text}</Text>,
    );
  }, [appState.addToChat, appState.getNextKey]);

  const logError = useCallback((text: string) => {
    appState.addToChat(
      <Text key={`msg-${appState.getNextKey()}`} color="red">{text}</Text>,
    );
  }, [appState.addToChat, appState.getNextKey]);

  const logDim = useCallback((text: string) => {
    appState.addToChat(
      <Text key={`msg-${appState.getNextKey()}`} dimColor>{text}</Text>,
    );
  }, [appState.addToChat, appState.getNextKey]);

  const finalizeLogin = useCallback(async (auth: AuthResponse, accountKey: string) => {
    try {
      const user = await fetchUser(auth.accessToken);
      const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unknown';
      const accountName = auth.accounts?.find(a => a.accountKey === accountKey)?.displayName ?? '';

      await saveSession({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        accountKey,
        accountName,
        tokenExpires: parseJwtExp(auth.accessToken),
        user: {
          email: user.email ?? '',
          name,
          roles: user.roles ?? [],
        },
      });

      appState.updateStatus({
        user: user.email ?? '',
        account: accountKey,
        connected: true,
      });
      logSuccess(`  ✓ Logged in as ${user.email ?? name}`);
    } catch (err) {
      logError(`  ${formatError(err)}`);
    }
    appState.setActiveMode(null);
    appState.setPendingAuth(null);
    appState.setLiveComponent(null);
  }, [appState, logSuccess, logError]);

  const handleLoginComplete = useCallback(async (auth: AuthResponse) => {
    if (auth.accounts && auth.accounts.length > 1) {
      appState.setPendingAuth(auth);
      appState.setActiveMode('select-account');
      return;
    }
    await finalizeLogin(auth, auth.accounts?.[0]?.accountKey ?? '');
  }, [appState, finalizeLogin]);

  const handleAccountSelected = useCallback(async (accountKey: string) => {
    if (appState.pendingAuth) {
      await finalizeLogin(appState.pendingAuth, accountKey);
    }
  }, [appState.pendingAuth, finalizeLogin]);

  const handleLoginCancel = useCallback(() => {
    logDim('  Login cancelled.');
    appState.setActiveMode(null);
    appState.setLiveComponent(null);
  }, [appState, logDim]);

  const handleCommand = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const line = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    const parts = line.match(/(?:[^\s"]+|"[^"]*")/g) ?? [];
    if (parts.length === 0) return;

    const command = parts[0]!.toLowerCase();
    const args = parts.slice(1).map(a => a.replace(/^"|"$/g, ''));

    logDim(`  > ${trimmed}`);

    try {
      switch (command) {
        case 'help': {
          logText('');
          logText('  Commands');
          logText('');
          logText('  /help     Show available commands');
          logText('  /login    Authenticate with Geins');
          logText('  /logout   Clear credentials and exit');
          logText('  /whoami   Show current user');
          logText('  /api      Raw API request          /api GET /products');
          logText('  /ping     Check service health      /ping [service...]');
          logText('  /theme    Switch dark/light mode');
          logText('  /clear    Clear the screen');
          logText('  /exit     Exit the CLI');
          logText('');
          break;
        }

        case 'login':
          appState.setActiveMode('login');
          break;

        case 'logout':
          await clearSession();
          appState.updateStatus({ user: '', account: '', connected: false });
          logSuccess('  ✓ Logged out.');
          break;

        case 'whoami': {
          const session = await loadSession();
          if (!session) {
            logError('  Not logged in. Run /login first.');
            break;
          }
          logText(`  ${session.user.name} <${session.user.email}>`);
          if (session.accountKey) {
            const label = session.accountName
              ? `${session.accountName} (${session.accountKey})`
              : session.accountKey;
            logText(`  Account: ${label}`);
          }
          if (session.user.roles.length > 0) logText(`  Roles: ${session.user.roles.join(', ')}`);
          break;
        }

        case 'api': {
          const method = args[0]?.toUpperCase() ?? 'GET';
          const path = args[1];
          if (!path) {
            logText('  Usage: /api <METHOD> <path>');
            break;
          }
          const bodyIdx = args.indexOf('--body');
          let body: unknown;
          if (bodyIdx !== -1 && args[bodyIdx + 1]) {
            try { body = JSON.parse(args[bodyIdx + 1]!); } catch {
              logError('  Invalid JSON in --body');
              break;
            }
          }
          appState.setLiveComponent(
            <Box key="api-spinner" gap={1} paddingX={1}>
              <Spinner type="dots" />
              <Text dimColor>Requesting {method} {path}...</Text>
            </Box>,
          );
          const apiPath = path.startsWith('/') ? path : `/${path}`;
          const data = await request(apiPath, { method, body });
          appState.setLiveComponent(null);
          logText(`  ${JSON.stringify(data, null, 2)}`);
          break;
        }

        case 'ping': {
          const services = args.length > 0 ? args : ['auth', 'account', 'order', 'product'];
          appState.setLiveComponent(
            <Box key="ping-spinner" gap={1} paddingX={1}>
              <Spinner type="dots" />
              <Text dimColor>Pinging services...</Text>
            </Box>,
          );
          for (const svc of services) {
            const start = Date.now();
            try {
              const res = await fetch(`${getApiUrl()}/${svc}/ping`);
              const ms = Date.now() - start;
              if (res.ok) {
                logSuccess(`  ✓ ${svc} ${ms}ms`);
              } else {
                logError(`  ✗ ${svc} ${res.status} ${ms}ms`);
              }
            } catch {
              logError(`  ✗ ${svc} unreachable ${Date.now() - start}ms`);
            }
          }
          appState.setLiveComponent(null);
          break;
        }

        case 'theme': {
          const newTheme = await appState.toggleTheme();
          logSuccess(`  ✓ Switched to ${newTheme} mode`);
          break;
        }

        case 'clear':
          appState.setChatComponents([]);
          break;

        case 'exit':
        case 'quit':
          exit();
          break;

        default:
          logError(`  Unknown command: /${command}`);
          logDim('  Type /help for available commands');
      }
    } catch (err) {
      logError(`  ${formatError(err)}`);
    }
  }, [appState, logText, logDim, logSuccess, logError, exit]);

  const welcomeComponent = useMemo(
    () => (
      <Welcome
        version={version}
        user={appState.status.user || undefined}
        account={appState.status.account || undefined}
      />
    ),
    [version, appState.status.user, appState.status.account],
  );

  if (!appState.ready) {
    return (
      <Box padding={1}>
        <Spinner type="dots" />
        <Text dimColor> Starting...</Text>
      </Box>
    );
  }

  const isModal = appState.activeMode !== null;

  return (
    <Box flexDirection="column" height={rows}>
      <ChatHistory
        ready={appState.ready}
        welcomeComponent={welcomeComponent}
        queuedComponents={appState.chatComponents}
        liveComponent={appState.liveComponent}
      />

      {appState.activeMode === 'login' && (
        <LoginFlow
          onComplete={handleLoginComplete}
          onCancel={handleLoginCancel}
          onLog={(text) => logText(`  ${text}`)}
        />
      )}

      {appState.activeMode === 'select-account' && appState.pendingAuth?.accounts && (
        <SelectAccount
          accounts={appState.pendingAuth.accounts}
          onSelect={handleAccountSelected}
          onCancel={() => handleAccountSelected(appState.pendingAuth!.accounts![0]!.accountKey)}
        />
      )}

      {!isModal && (
        <ChatInput onSubmit={handleCommand} />
      )}
    </Box>
  );
}
