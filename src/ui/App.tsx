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
import { SelectCopilot } from './SelectCopilot.tsx';
import { getCopilotConfig, chatStream } from '../commands/copilot.ts';
import {
  listWorkflows,
  getWorkflow,
  runWorkflow,
  testRunWorkflow,
  getLiveExecution,
  getExecutionLogs,
  getManifest,
  enableWorkflow,
  disableWorkflow,
  listVariables,
  getVariable,
  saveVariable,
} from '../commands/workflows.ts';

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

    // Copilot mode: non-slash input goes to AI
    if (appState.copilotActive && !trimmed.startsWith('/')) {
      logDim(`  you> ${trimmed}`);
      appState.setLiveComponent(
        <Box key="copilot-spinner" gap={1} paddingX={1}>
          <Spinner type="dots" />
          <Text dimColor>Thinking...</Text>
        </Box>,
      );
      try {
        let buffer = '';
        await chatStream(trimmed, (chunk) => {
          buffer += chunk;
          const visible = buffer.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trim();
          const indented = visible.split('\n').map(line => `  ${line}`).join('\n');
          appState.setLiveComponent(
            <Box key="copilot-stream" flexDirection="column" paddingX={1}>
              <Text>{indented || ' '}</Text>
            </Box>,
          );
        });
        appState.setLiveComponent(null);
        const hasThinking = /<think>[\s\S]*?<\/think>/.test(buffer);
        const cleaned = buffer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (hasThinking) {
          logDim('  ⟐ thinking collapsed');
        }
        if (cleaned) {
          const indented = cleaned.split('\n').map(line => `  ${line}`).join('\n');
          logText(indented);
        }
      } catch (err) {
        appState.setLiveComponent(null);
        logError(`  ${formatError(err)}`);
      }
      return;
    }

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
          logText('  /help       Show available commands');
          logText('  /login      Authenticate with Geins');
          logText('  /logout     Clear credentials and exit');
          logText('  /whoami     Show current user');
          logText('  /workflow   Workflow commands       /workflow help');
          logText('  /api        Raw API request         /api GET /products');
          logText('  /copilot    Toggle AI copilot mode  /copilot set');
          logText('  /theme      Switch dark/light mode');
          logText('  /clear      Clear the screen');
          logText('  /exit       Exit the CLI');
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

        case 'workflow': {
          const sub = args[0]?.toLowerCase() ?? 'list';
          switch (sub) {
            case 'list': {
              appState.setLiveComponent(
                <Box key="wf-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>Loading workflows...</Text>
                </Box>,
              );
              const data = await listWorkflows();
              appState.setLiveComponent(null);
              for (const wf of data.items) {
                const status = wf.enabled ? '●' : '○';
                logText(`  ${status} ${wf.name}`);
              }
              if (data.totalCount > 0) {
                logDim(`  ${data.totalCount} workflows`);
              }
              break;
            }
            case 'get': {
              const id = args[1];
              if (!id) { logError('  Usage: /workflow get <id>'); break; }
              appState.setLiveComponent(
                <Box key="wf-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>Loading workflow...</Text>
                </Box>,
              );
              const wfData = await getWorkflow(id);
              appState.setLiveComponent(null);
              logText(`  ${JSON.stringify(wfData, null, 2)}`);
              break;
            }
            case 'run': {
              const id = args[1];
              if (!id) { logError('  Usage: /workflow run <id> [--watch]'); break; }
              const watch = args.includes('--watch');
              let input: unknown;
              const bodyIdx = args.indexOf('--body');
              if (bodyIdx !== -1 && args[bodyIdx + 1]) {
                try { input = JSON.parse(args[bodyIdx + 1]!); } catch {
                  logError('  Invalid JSON in --body'); break;
                }
              }
              appState.setLiveComponent(
                <Box key="wf-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>{watch ? 'Starting test run...' : 'Executing workflow...'}</Text>
                </Box>,
              );
              const runResult = watch
                ? await testRunWorkflow(id, input)
                : await runWorkflow(id, input) as { ExecutionId?: string };
              const execId = (runResult as { ExecutionId?: string }).ExecutionId;
              if (!watch || !execId) {
                appState.setLiveComponent(null);
                logSuccess(`  ✓ Workflow triggered`);
                logText(`  ${JSON.stringify(runResult, null, 2)}`);
                break;
              }
              logSuccess(`  ✓ Test run started: ${execId}`);
              let lastSeq = -1;
              const poll = async () => {
                for (let i = 0; i < 120; i++) {
                  await Bun.sleep(2000);
                  try {
                    const live = await getLiveExecution(execId);
                    if (live.Seq !== lastSeq) {
                      lastSeq = live.Seq;
                      const nodeEntries = Object.entries(live.Nodes);
                      const nodeLines = nodeEntries.map(([nodeId, node]) => {
                        const icon = node.Status === 'completed' ? '✓'
                          : node.Status === 'failed' ? '✗'
                          : node.Status === 'running' ? '⟳'
                          : '·';
                        const dur = node.DurationMs ? ` ${node.DurationMs}ms` : '';
                        const name = node.Name || nodeId;
                        return `  ${icon} ${name}  ${node.Status}${dur}`;
                      });
                      appState.setLiveComponent(
                        <Box key="wf-live" flexDirection="column" paddingX={1}>
                          <Box gap={1}>
                            {!live.IsComplete && <Spinner type="dots" />}
                            <Text dimColor>
                              {live.Status} · {nodeEntries.length}/{live.TotalNodes} nodes
                            </Text>
                          </Box>
                          {nodeLines.map((line, idx) => (
                            <Text key={idx}>{line}</Text>
                          ))}
                        </Box>,
                      );
                    }
                    if (live.IsComplete) {
                      appState.setLiveComponent(null);
                      const statusColor = live.Status === 'completed' ? 'green' : 'red';
                      appState.addToChat(
                        <Text key={`run-done-${appState.getNextKey()}`} color={statusColor}>
                          {`  ${live.Status === 'completed' ? '✓' : '✗'} Finished: ${live.Status}`}
                        </Text>,
                      );
                      return;
                    }
                  } catch {
                    // ignore polling errors, retry
                  }
                }
                appState.setLiveComponent(null);
                logDim('  Polling timed out after 4 minutes');
              };
              poll();
              break;
            }
            case 'logs': {
              const id = args[1];
              if (!id) { logError('  Usage: /workflow logs <id>'); break; }
              appState.setLiveComponent(
                <Box key="wf-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>Loading logs...</Text>
                </Box>,
              );
              const logsData = await getExecutionLogs(id);
              appState.setLiveComponent(null);
              logText(`  ${JSON.stringify(logsData, null, 2)}`);
              break;
            }
            case 'manifest': {
              appState.setLiveComponent(
                <Box key="wf-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>Loading manifest...</Text>
                </Box>,
              );
              const manifest = await getManifest();
              appState.setLiveComponent(null);
              logText(`  ${JSON.stringify(manifest, null, 2)}`);
              break;
            }
            case 'enable': {
              const id = args[1];
              if (!id) { logError('  Usage: /workflow enable <id>'); break; }
              await enableWorkflow(id);
              logSuccess(`  ✓ Workflow enabled`);
              break;
            }
            case 'disable': {
              const id = args[1];
              if (!id) { logError('  Usage: /workflow disable <id>'); break; }
              await disableWorkflow(id);
              logSuccess(`  ✓ Workflow disabled`);
              break;
            }
            case 'vars': {
              const varsAction = args[1]?.toLowerCase() ?? 'list';
              switch (varsAction) {
                case 'list': {
                  appState.setLiveComponent(
                    <Box key="vars-spinner" gap={1} paddingX={1}>
                      <Spinner type="dots" />
                      <Text dimColor>Loading variables...</Text>
                    </Box>,
                  );
                  const vars = await listVariables();
                  appState.setLiveComponent(null);
                  if (!vars || (Array.isArray(vars) && vars.length === 0)) {
                    logDim('  No variables found');
                  } else {
                    for (const v of Array.isArray(vars) ? vars : [vars]) {
                      const desc = v.description ? ` — ${v.description}` : '';
                      logText(`  ${v.name} = ${JSON.stringify(v.value)}${desc}`);
                    }
                  }
                  break;
                }
                case 'get': {
                  const name = args[2];
                  if (!name) { logError('  Usage: /workflow vars get <name>'); break; }
                  appState.setLiveComponent(
                    <Box key="vars-spinner" gap={1} paddingX={1}>
                      <Spinner type="dots" />
                      <Text dimColor>Loading variable...</Text>
                    </Box>,
                  );
                  const varData = await getVariable(name);
                  appState.setLiveComponent(null);
                  logText(`  ${JSON.stringify(varData, null, 2)}`);
                  break;
                }
                case 'set': {
                  const name = args[2];
                  const value = args[3];
                  if (!name || value === undefined) {
                    logError('  Usage: /workflow vars set <name> <value> [description]');
                    break;
                  }
                  let parsed: unknown;
                  try { parsed = JSON.parse(value); } catch { parsed = value; }
                  const desc = args.slice(4).join(' ') || undefined;
                  await saveVariable({ name, value: parsed, description: desc });
                  logSuccess(`  ✓ Variable '${name}' saved`);
                  break;
                }
                default:
                  logError(`  Unknown vars action: ${varsAction}`);
                  logDim('  Usage: /workflow vars [list|get|set]');
              }
              break;
            }
            case 'help':
              logText('');
              logText('  Workflow commands');
              logText('');
              logText('  /workflow list            List all workflows');
              logText('  /workflow get <id>        Show workflow details');
              logText('  /workflow run <id>        Execute a workflow');
              logText('  /workflow logs <id>       Show execution logs');
              logText('  /workflow manifest        Show workflow schema');
              logText('  /workflow enable <id>     Enable trigger');
              logText('  /workflow disable <id>    Disable trigger');
              logText('  /workflow vars            List global variables');
              logText('  /workflow vars get <n>    Show a variable');
              logText('  /workflow vars set <n> <v>  Set a variable');
              logText('');
              break;
            default:
              logError(`  Unknown subcommand: ${sub}`);
              logDim('  Type /workflow help for available commands');
          }
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

        case 'provider': {
          appState.setActiveMode('select-copilot');
          break;
        }

        case 'copilot': {
          const sub = args[0]?.toLowerCase();
          if (sub === 'set') {
            appState.setActiveMode('select-copilot');
            break;
          }
          if (appState.copilotActive) {
            appState.setCopilotActive(false);
            logSuccess('  ✓ Copilot mode disabled');
            break;
          }
          const existing = await getCopilotConfig();
          if (existing) {
            appState.setCopilotActive(true);
            logSuccess(`  ✓ Copilot mode enabled (${existing.command})`);
          } else {
            appState.setActiveMode('select-copilot');
          }
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

      {appState.activeMode === 'select-copilot' && (
        <SelectCopilot
          onComplete={() => {
            appState.setActiveMode(null);
            appState.setCopilotActive(true);
          }}
          onCancel={() => {
            logDim('  Copilot setup cancelled.');
            appState.setActiveMode(null);
          }}
          onLog={(text) => logText(`  ${text}`)}
        />
      )}

      {!isModal && (
        <ChatInput
          onSubmit={handleCommand}
          copilotActive={appState.copilotActive}
          onToggleCopilot={async () => {
            if (appState.copilotActive) {
              appState.setCopilotActive(false);
            } else {
              const existing = await getCopilotConfig();
              if (existing) {
                appState.setCopilotActive(true);
              } else {
                appState.setActiveMode('select-copilot');
              }
            }
          }}
        />
      )}
    </Box>
  );
}
