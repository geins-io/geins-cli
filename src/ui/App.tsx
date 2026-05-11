import React, { useCallback, useMemo } from 'react';
import { Box, Text, useApp } from 'ink';
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
import { Markdown } from './Markdown.tsx';
import { ThinkingIndicator } from './ThinkingIndicator.tsx';
import { getCopilotConfig, chatStream, getContextUsageAsync, clearConversationHistory, extractGeinsCommands, executeGeinsCommand, addToolResult, type StreamEvent } from '../commands/copilot.ts';
import { CopilotActivity, type ActivityEntry } from './CopilotActivity.tsx';
import {
  startSession,
  logEntry,
  endSession,
  trackWorkflow,
  searchSessions,
  loadKnowledge,
  clearKnowledge,
  clearHistory,
} from '../memory/index.ts';
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
import { getProduct } from '../commands/products.ts';

const VERSION = '0.1.0';

export function App({ version = VERSION }: { version?: string }) {
  const { exit } = useApp();
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

    logEntry({ type: 'command', content: trimmed });

    // Copilot mode: non-slash input goes to AI
    if (appState.copilotActive && !trimmed.startsWith('/')) {
      appState.addToChat(
        <Text key={`msg-${appState.getNextKey()}`} bold>{`❯ ${trimmed}`}</Text>,
      );
      const copilotCfg = await getCopilotConfig();
      const providerLabel = copilotCfg
        ? copilotCfg.model ? `${copilotCfg.command} · ${copilotCfg.model}` : copilotCfg.command
        : 'copilot';
      appState.setLiveComponent(
        <ThinkingIndicator key="copilot-thinking" />,
      );
      try {
        let streamBuffer = '';
        const activityLog: ActivityEntry[] = [];

        const renderActivity = () => {
          appState.setLiveComponent(
            <CopilotActivity
              key="copilot-activity"
              providerLabel={providerLabel}
              entries={[...activityLog]}
              isWorking={true}
            />,
          );
        };

        const handleEvent = (event: StreamEvent) => {
          if (event.kind === 'tool_start') {
            activityLog.push({ kind: 'tool', label: event.label ?? event.toolName ?? 'Working', done: false });
            renderActivity();
          } else if (event.kind === 'tool_end') {
            const last = [...activityLog].reverse().find(e => e.kind === 'tool' && !e.done);
            if (last) last.done = true;
            renderActivity();
          } else if (event.kind === 'text') {
            // text events update the final answer — handled by onChunk
          }
        };

        const rawBuffer = await chatStream(trimmed, (chunk) => {
          streamBuffer = chunk;
          const visible = streamBuffer.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trim();
          if (visible) {
            const textIdx = activityLog.findIndex(e => e.kind === 'text');
            if (textIdx >= 0) {
              activityLog[textIdx]!.label = visible;
            } else {
              activityLog.push({ kind: 'text', label: visible, done: true });
            }
            renderActivity();
          }
        }, handleEvent);
        appState.setLiveComponent(null);
        const hasThinking = /<think>[\s\S]*?<\/think>/.test(rawBuffer);
        const cleaned = rawBuffer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (hasThinking) {
          logDim('  ⟐ thinking collapsed');
        }
        const looksGarbled = /(<\|[a-z_]+\|>|<\|im_|<\|endoftext)/.test(cleaned);
        if (looksGarbled) {
          logError(`  The selected model doesn't support this task. Try a more capable model or switch provider with /copilot set.`);
        } else if (cleaned) {
          const finalEntries = activityLog.map(e => ({ ...e, done: true }));
          const ctx = await getContextUsageAsync();
          appState.addToChat(
            <CopilotActivity
              key={`msg-${appState.getNextKey()}`}
              providerLabel={`${providerLabel}  ·  context ${ctx.percent}%`}
              entries={finalEntries}
              isWorking={false}
            />,
          );

          const commands = extractGeinsCommands(cleaned);
          for (const cmd of commands) {
            logDim(`  ⟳ running: ${cmd}`);
            appState.setLiveComponent(
              <Box key="cmd-spinner" gap={1} paddingX={1}>
                <Spinner type="dots" />
                <Text dimColor>{cmd}</Text>
              </Box>,
            );
            const result = await executeGeinsCommand(cmd);
            appState.setLiveComponent(null);
            await addToolResult(cmd, result.output);
            if (result.output) {
              appState.addToChat(
                <Box key={`cmd-${appState.getNextKey()}`} flexDirection="column">
                  <Text dimColor>{`  ⟳ ${cmd}`}</Text>
                  <Markdown>{result.output}</Markdown>
                </Box>,
              );
            }
          }

          if (commands.length > 0) {
            const followupLog: ActivityEntry[] = [];

            const renderFollowup = () => {
              appState.setLiveComponent(
                <CopilotActivity
                  key="copilot-followup"
                  providerLabel={providerLabel}
                  entries={[...followupLog]}
                  isWorking={true}
                />,
              );
            };

            renderFollowup();

            const followupRaw = await chatStream(
              'Here are the command results. Summarize what you found and answer my original question.',
              (chunk) => {
                const visible = chunk.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trim();
                if (visible) {
                  const textIdx = followupLog.findIndex(e => e.kind === 'text');
                  if (textIdx >= 0) {
                    followupLog[textIdx]!.label = visible;
                  } else {
                    followupLog.push({ kind: 'text', label: visible, done: true });
                  }
                  renderFollowup();
                }
              },
              (event) => {
                if (event.kind === 'tool_start') {
                  followupLog.push({ kind: 'tool', label: event.label ?? event.toolName ?? 'Working', done: false });
                  renderFollowup();
                } else if (event.kind === 'tool_end') {
                  const last = [...followupLog].reverse().find(e => e.kind === 'tool' && !e.done);
                  if (last) last.done = true;
                  renderFollowup();
                }
              },
            );
            appState.setLiveComponent(null);
            const followupCleaned = followupRaw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            if (followupCleaned) {
              const finalFollowup = followupLog.map(e => ({ ...e, done: true }));
              const ctx2 = await getContextUsageAsync();
              appState.addToChat(
                <CopilotActivity
                  key={`msg-${appState.getNextKey()}`}
                  providerLabel={`${providerLabel}  ·  context ${ctx2.percent}%`}
                  entries={finalFollowup}
                  isWorking={false}
                />,
              );
            }
          }
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
          logText('  /product    Product commands        /product get <id>');
          logText('  /api        Raw API request         /api GET /products');
          logText('  /copilot    Toggle AI copilot mode  /copilot set');
          if (appState.copilotActive) {
            logText('  /new        New conversation         Clear copilot history');
          }
          logText('  /history    Search past sessions     /history <query>');
          logText('  /memory     View learned knowledge   /memory clear');
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
              trackWorkflow(id);
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
              trackWorkflow(id);
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
                      logText(`  ${v.key} = ${JSON.stringify(v.value)}${desc}`);
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
                  await saveVariable({ key: name, value: parsed, description: desc });
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

        case 'product': {
          const sub = args[0]?.toLowerCase() ?? '';
          switch (sub) {
            case 'get': {
              const id = args[1];
              if (!id) { logError('  Usage: /product get <id>'); break; }
              appState.setLiveComponent(
                <Box key="product-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>Fetching product {id}...</Text>
                </Box>,
              );
              const product = await getProduct(id);
              appState.setLiveComponent(null);
              const status = product.active ? '●' : '○';
              logText(`  ${status} ${product.name.trim()}  (${product._id})`);
              if (product.articleNumber) logText(`    Article: ${product.articleNumber}`);
              logText(`    Price: ${product.purchasePrice} ${product.purchasePriceCurrency}`);
              if (product.brand) logText(`    Brand: ${product.brand._id}`);
              logText(`    Category: ${product.mainCategoryId}`);
              break;
            }
            case 'help':
              logText('');
              logText('  /product get <id>    Show product details');
              logText('');
              break;
            default:
              if (!sub) {
                logDim('  Usage: /product <subcommand>');
              } else {
                logError(`  Unknown subcommand: ${sub}`);
              }
              logDim('  Type /product help for available commands');
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
            clearConversationHistory();
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

        case 'new':
          clearConversationHistory();
          clearHistory();
          appState.setChatComponents([]);
          logSuccess('  ✓ New conversation started');
          break;

        case 'history': {
          const query = args.join(' ');
          if (!query) {
            logText('  Usage: /history <search term>');
            break;
          }
          const results = await searchSessions(query);
          if (results.length === 0) {
            logDim('  No matches found');
            break;
          }
          for (const r of results) {
            logDim(`  Session ${r.sessionId}:`);
            for (const e of r.entries.slice(0, 5)) {
              const time = new Date(e.timestamp).toLocaleTimeString();
              logText(`    [${time}] ${e.type}: ${e.content.slice(0, 120)}`);
            }
            if (r.entries.length > 5) logDim(`    ... and ${r.entries.length - 5} more`);
          }
          break;
        }

        case 'memory': {
          const sub = args[0]?.toLowerCase();
          if (sub === 'clear') {
            await clearKnowledge();
            logSuccess('  ✓ Knowledge base cleared');
            break;
          }
          const kb = await loadKnowledge();
          if (kb.facts.length === 0 && Object.keys(kb.preferences).length === 0) {
            logDim('  No learned knowledge yet');
            break;
          }
          if (kb.facts.length > 0) {
            logText('  Learned facts:');
            for (const f of kb.facts) {
              const conf = Math.round(f.confidence * 100);
              logText(`    [${f.category}] ${f.content} (${conf}%)`);
            }
          }
          if (Object.keys(kb.preferences).length > 0) {
            logText('  Preferences:');
            for (const [k, v] of Object.entries(kb.preferences)) {
              logText(`    ${k}: ${v}`);
            }
          }
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
    <Box flexDirection="column">
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
            clearConversationHistory();
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
              clearConversationHistory();
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
