import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { ChatHistory } from './ChatHistory.tsx';
import { ChatInput } from './ChatInput.tsx';
import { Welcome } from './Welcome.tsx';
import { LoginFlow } from './LoginFlow.tsx';
import { ApiKeyFlow } from './ApiKeyFlow.tsx';
import { SelectApiKey } from './SelectApiKey.tsx';
import { VariantBuilder } from './VariantBuilder.tsx';
import { SelectAccount } from './SelectAccount.tsx';
import { useAppState } from './hooks/useAppState.ts';
import { clearSession, parseJwtExp } from '../auth/session.ts';
import { saveSession, addCredentials, loadCredentialsStore, useCredentials, removeCredentials, clearCredentials, loadConfig, saveConfig, type ApiCredentials } from '../config/store.ts';
import { resetCredentialsCache } from '../api/live-client.ts';
import { setActiveSignal } from '../api/abort.ts';
import { setOutputDir, getOutputDir } from '../output/sink.ts';
import { loadSession } from '../auth/session.ts';
import { fetchUser, type AuthResponse } from '../auth/login.ts';
import { request } from '../api/client.ts';
import { getApiUrl } from '../config/env.ts';
import { formatError } from '../api/errors.ts';
import { SelectCopilot } from './SelectCopilot.tsx';
import { Markdown } from './Markdown.tsx';
import { ThinkingIndicator } from './ThinkingIndicator.tsx';
import { getCopilotConfig, chatStream, getContextUsageAsync, clearConversationHistory, extractGeinsCommands, executeGeinsCommand, addToolResult, collectAttachedFiles, buildAttachmentSection, type StreamEvent } from '../commands/copilot.ts';
import { CopilotActivity, type ActivityEntry } from './CopilotActivity.tsx';
import {
  startSession,
  logEntry,
  endSession,
  trackWorkflow,
  trackWorkflowList,
  searchSessions,
  loadKnowledge,
  clearKnowledge,
  clearHistory,
  cacheManifest,
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
import { getProduct, queryProducts, parseProductListArgs, productName, getProductItems, productItemName, getVariantGroup, variantSummary, buildVariantGroupFromProducts, parseVariantCreateFlags, parseVariantGroupBody, listVariantLabels, addVariantLabel, renameVariantLabel, removeVariantLabel, getProductImages, addProductImage, addExistingProductImage, deleteProductImage, setProductImagePrimary, reorderProductImage, imageNameFromUrl, listRelationTypes, getRelationType, createRelationType, updateRelationType, deleteRelationType, queryBrands, getBrand, createBrand, updateBrand, deleteBrand, brandName, type BrandWrite, queryCategories, getCategory, createCategory, updateCategory, assignProductCategory, unassignProductCategory, categoryName, type CategoryWrite, getProductRelations, linkRelatedProducts, unlinkRelatedProducts, getProductParameters, getProductParameterValue, setProductParameterValue, removeProductParameterValue, getProductParameterDef, createProductParameter, updateProductParameter, getProductParameterGroup, createProductParameterGroup, updateProductParameterGroup, getPredefinedValue, createPredefinedValue, updatePredefinedValueNames, parameterValueSummary, type LocalizableContent, type BuildVariantGroupResult } from '../commands/products.ts';
import { managementRequest, isHttpMethod, methods as managementMethods } from '../commands/management.ts';

const VERSION = '0.1.0';

/**
 * Split a slash-command line into tokens, honoring double/single quotes and backslash
 * escapes (and stripping them). This makes drag-and-dropped file paths — which terminals
 * insert with escaped spaces or quotes — arrive as a single argument.
 */
function tokenizeCommandLine(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i]!;
      else cur += ch;
    } else if (ch === '\\' && i + 1 < line.length) {
      cur += line[++i]!;
      started = true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) { tokens.push(cur); cur = ''; started = false; }
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) tokens.push(cur);
  return tokens;
}

export function App({ version = VERSION }: { version?: string }) {
  const { exit } = useApp();
  const appState = useAppState();

  // Terminal resize: the whole UI (history + input) is one inline Ink frame (ChatHistory no
  // longer uses <Static>), so Ink repaints it cleanly at the new width. We do NOT clear the
  // screen ourselves — that's what corrupted the display before. See ChatHistory for the
  // viewport cap that keeps the inline frame from exceeding the window (which Ink mishandles).

  // While a modal is open the input box is hidden (it handles Ctrl-C itself), so
  // catch Ctrl-C here to let the user still quit out of a modal flow.
  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
  }, { isActive: appState.activeMode !== null });

  // An operation (command/copilot run) is in flight. `abortRef` holds its controller;
  // Ctrl-C aborts it, which cancels in-flight API calls (the ambient signal) and kills
  // any copilot/geins subprocess, returning the user to the input prompt.
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useInput((input, key) => {
    if (key.ctrl && input === 'c') abortRef.current?.abort();
  }, { isActive: busy });

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

  const handleApiKeyComplete = useCallback(async (credentials: ApiCredentials) => {
    const name = await addCredentials(credentials);
    resetCredentialsCache();
    appState.setActiveMode(null);
    logSuccess(`  ✓ Credentials '${name}' saved, validated, and activated.`);
  }, [appState, logSuccess]);

  const handleApiKeyCancel = useCallback(() => {
    logDim('  API credential setup cancelled.');
    appState.setActiveMode(null);
  }, [appState, logDim]);

  const handleApiKeySelect = useCallback(async (name: string) => {
    appState.setActiveMode(null);
    appState.setApiKeyPicker(null);
    await useCredentials(name);
    resetCredentialsCache();
    logSuccess(`  ✓ Switched to '${name}'.`);
  }, [appState, logSuccess]);

  const handleApiKeyPickerCancel = useCallback(() => {
    appState.setActiveMode(null);
    appState.setApiKeyPicker(null);
  }, [appState]);

  const renderVariantResult = useCallback((result: BuildVariantGroupResult) => {
    logText(`  Variant group ${result.groupId} (labels: ${result.labels.join(', ')})`);
    for (const p of result.products) {
      if (p.ok) logSuccess(`  ✓ ${p.id}`);
      else logError(`  ✗ ${p.id}  ${p.error ?? ''}`);
    }
    if (result.cleanedUp) logDim('  All products failed to attach — the empty group was removed.');
    logDim('  Note: the main product cannot be set via the Management API.');
  }, [logText, logSuccess, logError, logDim]);

  const handleVariantBuilderComplete = useCallback((result: BuildVariantGroupResult) => {
    appState.setActiveMode(null);
    renderVariantResult(result);
  }, [appState, renderVariantResult]);

  const handleVariantBuilderCancel = useCallback((message?: string) => {
    appState.setActiveMode(null);
    logDim(`  ${message ?? 'Variant builder cancelled.'}`);
  }, [appState, logDim]);

  const handleCommand = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    logEntry({ type: 'command', content: trimmed });

    // Mark the operation in flight and register its abort signal so Ctrl-C can cancel
    // in-flight API calls (via the ambient signal) and kill copilot/geins subprocesses.
    const controller = new AbortController();
    abortRef.current = controller;
    setActiveSignal(controller.signal);
    setBusy(true);
    try {

    // Copilot mode: non-slash input goes to AI
    if (appState.copilotActive && !trimmed.startsWith('/')) {
      appState.addToChat(
        <Text key={`msg-${appState.getNextKey()}`} bold>{`❯ ${trimmed}`}</Text>,
      );
      // A dropped file arrives as an absolute path in the message. Read a preview and
      // prepend it as context so the copilot can use the file to find/update products.
      const attachments = await collectAttachedFiles(trimmed);
      for (const f of attachments) {
        logDim(`  📎 ${f.path.split('/').pop()}  (${(f.bytes / 1024).toFixed(1)} KB)`);
      }
      const attachmentSection = buildAttachmentSection(attachments);
      const copilotMessage = attachmentSection ? `${attachmentSection}\n\n${trimmed}` : trimmed;
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

        // Text shown for a model turn: drop <think> blocks and the ```bash``` command
        // blocks (those run and show as "⟳ <cmd>", so repeating them is just noise).
        const displayText = (s: string) =>
          s
            .replace(/<think>[\s\S]*?<\/think>/g, '')
            .replace(/<think>[\s\S]*$/, '')
            .replace(/```(?:bash|sh|shell)?[\s\S]*?```/g, '')
            .replace(/```(?:bash|sh|shell)?[\s\S]*$/, '')
            .trim();

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

        const rawBuffer = await chatStream(copilotMessage, (chunk) => {
          streamBuffer = chunk;
          const visible = displayText(streamBuffer);
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

          // Agentic loop: run any commands the model emitted, feed the results back,
          // and let it continue — it may emit MORE commands (e.g. check labels, then
          // create). Repeat until a response has no commands or we hit the cap.
          const MAX_ROUNDS = 6;
          let pending = cleaned;
          for (let round = 0; round < MAX_ROUNDS; round++) {
            const commands = extractGeinsCommands(pending);
            if (commands.length === 0) break;

            for (const cmd of commands) {
              appState.setLiveComponent(
                <Box key="cmd-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>{cmd}</Text>
                </Box>,
              );
              const result = await executeGeinsCommand(cmd);
              appState.setLiveComponent(null);
              await addToolResult(cmd, result.output);
              // Collapse long outputs to a one-line summary (the model still gets the
              // full result, and it's written to the output folder). Short ones show.
              const lines = result.output ? result.output.split('\n').length : 0;
              const collapse = result.output.length > 800 || lines > 12;
              appState.addToChat(
                <Box key={`cmd-${appState.getNextKey()}`} flexDirection="column">
                  <Text dimColor>{`  ⟳ ${cmd}`}</Text>
                  {result.output
                    ? (collapse
                        ? <Text dimColor>{`     ⟐ ${lines} lines · ${result.output.length} chars (collapsed)`}</Text>
                        : <Markdown>{result.output}</Markdown>)
                    : null}
                </Box>,
              );
            }

            const lastRound = round === MAX_ROUNDS - 1;
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

            const followupPrompt = lastRound
              ? `The command results are above. Do NOT output more commands now — give your final answer to my original question and summarize what you found.\n\nMy original question was: ${trimmed}`
              : `The command results are above. If you need to run more commands, output them in a bash block. Otherwise, answer my original question and summarize what you found.\n\nMy original question was: ${trimmed}`;

            const followupRaw = await chatStream(
              followupPrompt,
              (chunk) => {
                const visible = displayText(chunk);
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
            // Keep bash blocks here — `pending` is scanned for the next round's commands.
            const followupCleaned = followupRaw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            // Only commit a visible card if there's prose/tool activity (a bash-only
            // round produces no display text and shouldn't leave an empty card).
            if (followupLog.length > 0) {
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
            pending = lastRound ? '' : followupCleaned;
          }
        }
      } catch (err) {
        appState.setLiveComponent(null);
        if (controller.signal.aborted) logDim('  ✕ Cancelled');
        else logError(`  ${formatError(err)}`);
      }
      return;
    }

    const line = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    const parts = tokenizeCommandLine(line);
    if (parts.length === 0) return;

    const command = parts[0]!.toLowerCase();
    const args = parts.slice(1);

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
          logText('  /apikey     Manage API accounts         /apikey list | add | use <name>');
          logText('  /workflow   Workflow commands       /workflow help');
          logText('  /product    Product commands        /product get <id> | list | items <id> | variants <id>');
          logText('  /api        Raw API request         /api GET /products');
          logText('  /management Management API           /management GET /API/Market/List');
          logText('  /output     Dump responses to folder   /output ./out | /output off');
          logText('  /copilot    Toggle AI copilot mode  /copilot provider');
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

        case 'apikey': {
          const action = args[0]?.toLowerCase() ?? '';
          if (action === 'add') {
            appState.setActiveMode('apikey');
          } else if (action === 'list' || action === 'status' || action === '') {
            const store = await loadCredentialsStore();
            const names = Object.keys(store.profiles);
            if (names.length === 0) {
              logDim('  No API credentials. Run /apikey add to add an account.');
            } else {
              for (const name of names) {
                const marker = name === store.active ? '●' : '○';
                logText(`  ${marker} ${name}  (user: ${store.profiles[name]!.username})`);
              }
              logDim('  ● = active. Add with /apikey add · switch with /apikey use <name>.');
            }
          } else if (action === 'use') {
            const name = args[1];
            if (!name) {
              const store = await loadCredentialsStore();
              const names = Object.keys(store.profiles);
              if (names.length === 0) {
                logDim('  No API credentials. Run /apikey add to add an account.');
              } else {
                appState.setApiKeyPicker({ names, active: store.active });
                appState.setActiveMode('select-apikey');
              }
              break;
            }
            if (await useCredentials(name)) {
              resetCredentialsCache();
              logSuccess(`  ✓ Switched to '${name}'.`);
            } else {
              logError(`  Unknown credentials profile: ${name}`);
            }
          } else if (action === 'remove') {
            const name = args[1];
            if (!name) { logError('  Usage: /apikey remove <name>'); break; }
            if (await removeCredentials(name)) {
              resetCredentialsCache();
              logSuccess(`  ✓ Removed '${name}'.`);
            } else {
              logError(`  Unknown credentials profile: ${name}`);
            }
          } else if (action === 'clear') {
            await clearCredentials();
            resetCredentialsCache();
            logSuccess('  ✓ All API credentials cleared.');
          } else {
            logError(`  Unknown subcommand: apikey ${action}`);
            logDim('  Subcommands: add, list, use <name>, remove <name>, clear');
          }
          break;
        }

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
              trackWorkflowList(data.items as unknown as Array<Record<string, unknown>>);
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
              trackWorkflow(id, wfData as Record<string, unknown>);
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
              cacheManifest(manifest);
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
              const status = product.Active ? '●' : '○';
              logText(`  ${status} ${productName(product)}  (${product.ProductId})`);
              if (product.ArticleNumber) logText(`    Article: ${product.ArticleNumber}`);
              if (product.PurchasePrice != null) logText(`    Price: ${product.PurchasePrice} ${product.PurchasePriceCurrency ?? ''}`.trimEnd());
              if (product.BrandName) logText(`    Brand: ${product.BrandName}`);
              if (product.MainCategoryId != null) logText(`    Category: ${product.MainCategoryId}`);
              break;
            }
            case 'list':
            case 'query': {
              const { query, page, include } = parseProductListArgs(args.slice(1));
              appState.setLiveComponent(
                <Box key="product-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>Querying products...</Text>
                </Box>,
              );
              const result = await queryProducts(query, { page: page ?? 1, include });
              appState.setLiveComponent(null);
              if (result.products.length === 0) { logDim('  No products found.'); break; }
              const CAP = 50;
              for (const p of result.products.slice(0, CAP)) {
                const status = p.Active ? '●' : '○';
                logText(`  ${status} ${productName(p)}  ${p.ArticleNumber ?? ''}`.trimEnd());
              }
              if (result.products.length > CAP) logDim(`  … and ${result.products.length - CAP} more on this page`);
              const pr = result.page;
              if (pr) {
                logDim(`  ${result.products.length} shown · ${pr.RowCount ?? '?'} total · page ${pr.Page ?? 1}/${pr.PageCount ?? 1}`);
                if (pr.HasMoreRows) logDim(`  Next: /product list --page ${(pr.Page ?? 1) + 1} --batch ${pr.BatchId}`);
              }
              break;
            }
            case 'items': {
              const id = args[1];
              if (!id) { logError('  Usage: /product items <productId>'); break; }
              appState.setLiveComponent(
                <Box key="product-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>Fetching items of {id}...</Text>
                </Box>,
              );
              const items = await getProductItems(id);
              appState.setLiveComponent(null);
              if (items.length === 0) { logDim('  No items.'); break; }
              for (const it of items) {
                const status = it.Active ? '●' : '○';
                const stock = it.Stock?.StockSellable ?? it.Stock?.Stock;
                const article = it.ArticleNumber ? `  ${it.ArticleNumber}` : '';
                const stockStr = stock != null ? `  stock ${stock}` : '';
                logText(`  ${status} ${productItemName(it)}${article}${stockStr}`);
              }
              logDim(`  ${items.length} item${items.length === 1 ? '' : 's'}`);
              break;
            }
            case 'variants': {
              const action = args[1]?.toLowerCase();

              // variants labels [list|add|remove|rename]
              if (action === 'labels') {
                const labelAction = args[2]?.toLowerCase();
                if (!labelAction || labelAction === 'list') {
                  const labels = await listVariantLabels();
                  if (labels.length === 0) logDim('  No variant labels registered.');
                  else logText(`  ${labels.join(', ')}`);
                } else if (labelAction === 'add' && args[3]) {
                  await addVariantLabel(args[3]);
                  logSuccess(`  ✓ Registered variant label: ${args[3]}`);
                } else if (labelAction === 'remove' && args[3]) {
                  await removeVariantLabel(args[3]);
                  logSuccess(`  ✓ Removed variant label: ${args[3]}`);
                } else if (labelAction === 'rename' && args[3] && args[4]) {
                  await renameVariantLabel(args[3], args[4]);
                  logSuccess(`  ✓ Renamed variant label: ${args[3]} → ${args[4]}`);
                } else {
                  logDim('  Usage: /product variants labels [list | add <name> | remove <name> | rename <old> <new>]');
                }
                break;
              }

              // variants create — interactive builder (no args) or flags/body
              if (action === 'create') {
                const rest = args.slice(2);
                if (rest.length === 0) {
                  appState.setActiveMode('variant-builder');
                  break;
                }
                const input = rest.includes('--body')
                  ? parseVariantGroupBody(JSON.parse(rest[rest.indexOf('--body') + 1] ?? '{}'))
                  : parseVariantCreateFlags(rest);
                appState.setLiveComponent(
                  <Box key="product-spinner" gap={1} paddingX={1}>
                    <Spinner type="dots" />
                    <Text dimColor>Creating variant group...</Text>
                  </Box>,
                );
                try {
                  const result = await buildVariantGroupFromProducts(input);
                  appState.setLiveComponent(null);
                  renderVariantResult(result);
                } catch (err) {
                  appState.setLiveComponent(null);
                  logError(`  ${formatError(err)}`);
                }
                break;
              }

              const id = args[1];
              if (!id) { logError('  Usage: /product variants <productId>'); break; }
              appState.setLiveComponent(
                <Box key="product-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>Fetching variant group of {id}...</Text>
                </Box>,
              );
              const group = await getVariantGroup(id);
              appState.setLiveComponent(null);
              if (!group) { logDim('  No variant group for this product.'); break; }
              logText(`  Variant group ${group.GroupId}${group.Name ? ` (${group.Name})` : ''}`);
              const members = group.Products ?? [];
              if (members.length > 0) {
                for (const p of members) {
                  const status = p.Active ? '●' : '○';
                  const main = p.ProductId === group.MainProductId ? ' ★' : '';
                  const dims = variantSummary(p);
                  logText(`  ${status} ${productName(p)}${main}${dims ? `  ${dims}` : ''}`);
                }
                logDim(`  ${members.length} product${members.length === 1 ? '' : 's'} in group`);
              } else if (group.ProductIds?.length) {
                logText(`  Products: ${group.ProductIds.join(', ')}`);
                if (group.MainProductId) logDim(`  Main product: ${group.MainProductId}`);
              }
              break;
            }
            case 'images': {
              const imgArgs = args.slice(1);
              const parseImgFlags = (a: string[]) => {
                let idType: 0 | 1 | 2 | 3 | undefined;
                let primary = false;
                let name: string | undefined;
                let position: number | undefined;
                for (let i = 0; i < a.length; i++) {
                  if (a[i] === '--idtype') { const n = Number(a[++i]); if (n >= 0 && n <= 3) idType = n as 0 | 1 | 2 | 3; }
                  else if (a[i] === '--primary') primary = true;
                  else if (a[i] === '--name') name = a[++i];
                  else if (a[i] === '--position') { const n = Number(a[++i]); if (!Number.isNaN(n)) position = n; }
                }
                return { idType, primary, name, position };
              };
              const imgAction = imgArgs[0]?.toLowerCase();
              const spin = (label: string) => appState.setLiveComponent(
                <Box key="product-spinner" gap={1} paddingX={1}><Spinner type="dots" /><Text dimColor>{label}</Text></Box>,
              );

              if (imgAction === 'add') {
                const id = imgArgs[1]; const source = imgArgs[2];
                if (!id || !source) { logError('  Usage: /product images add <productId> <file|url> [--name <n>] [--primary] [--position <n>]'); break; }
                const f = parseImgFlags(imgArgs.slice(3));
                spin(`Uploading image to ${id}...`);
                const r = await addProductImage(id, source, { idType: f.idType, name: f.name, primary: f.primary, position: f.position });
                appState.setLiveComponent(null);
                logSuccess(`  ✓ Uploaded ${r.imageName}${f.primary ? ' (primary)' : ''} to product ${id}`);
                break;
              }
              if (imgAction === 'add-existing' || imgAction === 'link') {
                const id = imgArgs[1]; const name = imgArgs[2];
                if (!id || !name) { logError('  Usage: /product images add-existing <productId> <imageName> [--idtype <0-3>]'); break; }
                const f = parseImgFlags(imgArgs.slice(3));
                spin(`Linking ${name} to ${id}...`);
                const r = await addExistingProductImage(id, name, { idType: f.idType });
                appState.setLiveComponent(null);
                logSuccess(`  ✓ Linked existing image ${r.FileName ?? name} to product ${id}`);
                break;
              }
              if (imgAction === 'delete' || imgAction === 'remove') {
                const id = imgArgs[1]; const name = imgArgs[2];
                if (!id || !name) { logError('  Usage: /product images delete <productId> <imageName>'); break; }
                const f = parseImgFlags(imgArgs.slice(3));
                spin(`Deleting ${name}...`);
                await deleteProductImage(id, name, { idType: f.idType });
                appState.setLiveComponent(null);
                logSuccess(`  ✓ Deleted image ${name} from product ${id}`);
                break;
              }
              if (imgAction === 'set-primary') {
                const id = imgArgs[1]; const name = imgArgs[2];
                if (!id || !name) { logError('  Usage: /product images set-primary <productId> <imageName>'); break; }
                const f = parseImgFlags(imgArgs.slice(3));
                spin(`Setting ${name} as primary...`);
                await setProductImagePrimary(id, name, { idType: f.idType });
                appState.setLiveComponent(null);
                logSuccess(`  ✓ Set ${name} as primary image for product ${id}`);
                break;
              }
              if (imgAction === 'reorder') {
                const id = imgArgs[1]; const name = imgArgs[2]; const pos = Number(imgArgs[3]);
                if (!id || !name || Number.isNaN(pos)) { logError('  Usage: /product images reorder <productId> <imageName> <position>'); break; }
                const f = parseImgFlags(imgArgs.slice(4));
                spin(`Reordering ${name}...`);
                await reorderProductImage(id, name, pos, { idType: f.idType });
                appState.setLiveComponent(null);
                logSuccess(`  ✓ Moved ${name} to position ${pos} for product ${id}`);
                break;
              }

              // list (default)
              const id = imgAction === 'list' ? imgArgs[1] : imgArgs[0];
              if (!id) { logError('  Usage: /product images <productId>'); break; }
              const f = parseImgFlags(imgAction === 'list' ? imgArgs.slice(2) : imgArgs.slice(1));
              spin(`Fetching images of ${id}...`);
              const images = await getProductImages(id, { idType: f.idType });
              appState.setLiveComponent(null);
              if (images.length === 0) { logDim('  No images.'); break; }
              const sorted = [...images].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));
              sorted.forEach((img, i) => {
                const primary = i === 0 ? ' ★' : '';
                logText(`  ${img.Order ?? i}${primary}  ${imageNameFromUrl(img.Url ?? '')}`);
              });
              logDim(`  ${images.length} image${images.length === 1 ? '' : 's'}`);
              break;
            }
            case 'relation-types': {
              const rtArgs = args.slice(1);
              const rtAction = rtArgs[0]?.toLowerCase();
              const orderOf = () => { const i = rtArgs.indexOf('--order'); return i !== -1 && rtArgs[i + 1] != null ? Number(rtArgs[i + 1]) : undefined; };
              const nameOf = () => { const i = rtArgs.indexOf('--name'); return i !== -1 ? rtArgs[i + 1] : undefined; };
              if (rtAction === 'add' || rtAction === 'create') {
                const name = rtArgs[1];
                if (!name) { logError('  Usage: /product relation-types add <name> [--order <n>]'); break; }
                const rt = await createRelationType({ Name: name, Order: orderOf() });
                logSuccess(`  ✓ Created relation type ${rt.Id}: ${rt.Name}`);
                break;
              }
              if (rtAction === 'update') {
                const id = Number(rtArgs[1]);
                if (Number.isNaN(id)) { logError('  Usage: /product relation-types update <id> [--name <n>] [--order <n>]'); break; }
                const rt = await updateRelationType(id, { Name: nameOf(), Order: orderOf() });
                logSuccess(`  ✓ Updated relation type ${rt.Id}: ${rt.Name}`);
                break;
              }
              if (rtAction === 'delete' || rtAction === 'remove') {
                const id = Number(rtArgs[1]);
                if (Number.isNaN(id)) { logError('  Usage: /product relation-types delete <id>'); break; }
                await deleteRelationType(id);
                logSuccess(`  ✓ Deleted relation type ${id}`);
                break;
              }
              if (rtAction === 'get') {
                const id = Number(rtArgs[1]);
                if (Number.isNaN(id)) { logError('  Usage: /product relation-types get <id>'); break; }
                const rt = await getRelationType(id);
                logText(`  ${rt.Id}  ${rt.Name}  (order ${rt.Order ?? 0})`);
                break;
              }
              const types = await listRelationTypes();
              if (types.length === 0) { logDim('  No relation types.'); break; }
              for (const t of types) logText(`  ${t.Id}  ${t.Name}  (order ${t.Order ?? 0})`);
              logDim(`  ${types.length} relation type${types.length === 1 ? '' : 's'}`);
              break;
            }
            case 'relations': {
              const relArgs = args.slice(1);
              const relAction = relArgs[0]?.toLowerCase();
              const idTypeOf = () => { const i = relArgs.indexOf('--idtype'); if (i !== -1 && relArgs[i + 1] != null) { const n = Number(relArgs[i + 1]); if (n >= 0 && n <= 3) return n as 0 | 1 | 2 | 3; } return undefined; };
              if (relAction === 'link' || relAction === 'unlink') {
                const productId = relArgs[1]; const relationTypeId = Number(relArgs[2]);
                const relatedIds = relArgs.slice(3).filter((a) => !a.startsWith('--'));
                if (!productId || Number.isNaN(relationTypeId) || relatedIds.length === 0) {
                  logError(`  Usage: /product relations ${relAction} <productId> <relationTypeId> <relatedId...>`); break;
                }
                if (relAction === 'link') await linkRelatedProducts(productId, relationTypeId, relatedIds, { idType: idTypeOf() });
                else await unlinkRelatedProducts(productId, relationTypeId, relatedIds, { idType: idTypeOf() });
                logSuccess(`  ✓ ${relAction === 'link' ? 'Linked' : 'Unlinked'} ${relatedIds.join(', ')} ${relAction === 'link' ? 'to' : 'from'} product ${productId} (relation type ${relationTypeId})`);
                break;
              }
              const id = relArgs[0];
              if (!id) { logError('  Usage: /product relations <productId> | link/unlink <id> <relationTypeId> <relatedId...>'); break; }
              const relations = await getProductRelations(id, { idType: idTypeOf() });
              if (relations.length === 0) { logDim('  No related products.'); break; }
              for (const r of relations) logText(`  ${r.RelatedProductId}  (relation type ${r.RelationTypeId ?? '?'})`);
              logDim(`  ${relations.length} related product${relations.length === 1 ? '' : 's'}`);
              break;
            }
            case 'brands':
            case 'brand': {
              const bArgs = args.slice(1);
              const action = bArgs[0]?.toLowerCase();
              const flagVal = (flag: string) => { const i = bArgs.indexOf(flag); return i !== -1 ? bArgs[i + 1] : undefined; };
              const parseDesc = (): LocalizableContent[] | undefined => {
                const parts = bArgs.flatMap((a, i) => (bArgs[i - 1] === '--desc' ? [a] : []));
                if (parts.length === 0) return undefined;
                return parts.map((p) => { const c = p.indexOf(':'); return { LanguageCode: c === -1 ? p : p.slice(0, c), Content: c === -1 ? '' : p.slice(c + 1) }; });
              };
              if (action === 'get') {
                const bid = Number(bArgs[1]);
                if (Number.isNaN(bid)) { logError('  Usage: /product brands get <id>'); break; }
                const brand = await getBrand(bid);
                logText(`  ${brand.BrandId}  ${brandName(brand)}${brand.ExternalId ? `  (ext: ${brand.ExternalId})` : ''}`);
                for (const d of brand.Descriptions ?? []) logDim(`    ${d.LanguageCode}: ${d.Content}`);
                break;
              }
              if (action === 'create' || action === 'add') {
                const name = flagVal('--name');
                if (!name) { logError('  Usage: /product brands create --name <n> [--external-id <id>] [--desc <code>:<text>]'); break; }
                const input: BrandWrite = { Name: name, ExternalId: flagVal('--external-id'), Descriptions: parseDesc() };
                const brand = await createBrand(input);
                logSuccess(`  ✓ Created brand ${brand.BrandId}: ${brandName(brand)}`);
                break;
              }
              if (action === 'update') {
                const bid = Number(bArgs[1]);
                if (Number.isNaN(bid)) { logError('  Usage: /product brands update <id> [--name <n>] [--external-id <id>] [--desc <code>:<text>]'); break; }
                const brand = await updateBrand(bid, { Name: flagVal('--name'), ExternalId: flagVal('--external-id'), Descriptions: parseDesc() });
                logSuccess(`  ✓ Updated brand ${brand.BrandId}: ${brandName(brand)}`);
                break;
              }
              if (action === 'delete' || action === 'remove') {
                const bid = Number(bArgs[1]);
                if (Number.isNaN(bid)) { logError('  Usage: /product brands delete <id>'); break; }
                await deleteBrand(bid);
                logSuccess(`  ✓ Deleted brand ${bid}`);
                break;
              }
              const brands = await queryBrands();
              if (brands.length === 0) { logDim('  No brands.'); break; }
              for (const b of brands) logText(`  ${b.BrandId}  ${brandName(b)}${b.ExternalId ? `  (ext: ${b.ExternalId})` : ''}`);
              logDim(`  ${brands.length} brand${brands.length === 1 ? '' : 's'}`);
              break;
            }
            case 'categories':
            case 'category': {
              const cArgs = args.slice(1);
              const action = cArgs[0]?.toLowerCase();
              const flagVal = (flag: string) => { const i = cArgs.indexOf(flag); return i !== -1 ? cArgs[i + 1] : undefined; };
              const numFlag = (flag: string) => { const v = flagVal(flag); const n = v != null ? Number(v) : NaN; return Number.isNaN(n) ? undefined : n; };
              const parseLoc = (flag: string): LocalizableContent[] | undefined => {
                const parts = cArgs.flatMap((a, i) => (cArgs[i - 1] === flag ? [a] : []));
                if (parts.length === 0) return undefined;
                return parts.map((p) => { const c = p.indexOf(':'); return c === -1 ? { LanguageCode: '', Content: p } : { LanguageCode: p.slice(0, c), Content: p.slice(c + 1) }; });
              };
              const idTypeFor = () => { const i = cArgs.indexOf('--idtype'); if (i !== -1 && cArgs[i + 1] != null) { const n = Number(cArgs[i + 1]); if (n >= 0 && n <= 3) return n as 0 | 1 | 2 | 3; } return undefined; };

              if (action === 'assign') {
                const productId = cArgs[1]; const categoryId = Number(cArgs[2]);
                if (!productId || Number.isNaN(categoryId)) { logError('  Usage: /product categories assign <productId> <categoryId> [--idtype <0-3>]'); break; }
                await assignProductCategory(productId, categoryId, { idType: idTypeFor() });
                logSuccess(`  ✓ Assigned category ${categoryId} to product ${productId}`);
                break;
              }
              if (action === 'unassign' || action === 'remove') {
                const productId = cArgs[1]; const categoryId = Number(cArgs[2]);
                if (!productId || Number.isNaN(categoryId)) { logError('  Usage: /product categories unassign <productId> <categoryId> [--idtype <0-3>]'); break; }
                const r = await unassignProductCategory(productId, categoryId, { idType: idTypeFor() });
                if (!r.wasAssigned) { logDim(`  Category ${categoryId} is not assigned to product ${productId}.`); break; }
                if (r.stillPresent) {
                  logError(`  Could not remove ${categoryId}: it's an ancestor of another assigned category (the API keeps ancestors).`);
                  logDim(`  Remove the more specific (leaf) category instead. Categories: ${r.remaining.join(', ')}`);
                  break;
                }
                logSuccess(`  ✓ Removed category ${categoryId} from product ${productId}`);
                logDim(`  Remaining: ${r.remaining.join(', ') || '(none)'}`);
                if (r.wasMain) logDim(`  Note: ${categoryId} was the main category; main is now ${r.newMain ?? '(none)'}.`);
                break;
              }
              if (action === 'get') {
                const cid = Number(cArgs[1]);
                if (Number.isNaN(cid)) { logError('  Usage: /product categories get <id>'); break; }
                const cat = await getCategory(cid);
                const flags = [cat.Hidden ? 'hidden' : null, cat.Active === false ? 'inactive' : null].filter(Boolean).join(', ');
                logText(`  ${cat.CategoryId}  ${categoryName(cat)}${cat.ParentCategoryId ? `  (parent ${cat.ParentCategoryId})` : ''}${flags ? `  [${flags}]` : ''}`);
                for (const n of cat.Names ?? []) logDim(`    name ${n.LanguageCode || '–'}: ${n.Content}`);
                break;
              }
              if (action === 'create' || action === 'add') {
                const names = parseLoc('--name');
                if (!names) { logError('  Usage: /product categories create --name <code>:<text> [--parent <id>] [--desc <code>:<text>] [--hidden] [--inactive]'); break; }
                const input: CategoryWrite = { Names: names, ParentCategoryId: numFlag('--parent'), Descriptions: parseLoc('--desc'), Hidden: cArgs.includes('--hidden') ? true : undefined, Active: cArgs.includes('--inactive') ? false : undefined };
                const cat = await createCategory(input);
                logSuccess(`  ✓ Created category ${cat.CategoryId}: ${categoryName(cat)}`);
                break;
              }
              if (action === 'update') {
                const cid = Number(cArgs[1]);
                if (Number.isNaN(cid)) { logError('  Usage: /product categories update <id> [--name <code>:<text>] [--parent <id>] [--desc <code>:<text>] [--hidden|--show] [--active|--inactive]'); break; }
                const changes: CategoryWrite = { Names: parseLoc('--name'), ParentCategoryId: numFlag('--parent'), Descriptions: parseLoc('--desc'), Hidden: cArgs.includes('--hidden') ? true : cArgs.includes('--show') ? false : undefined, Active: cArgs.includes('--active') ? true : cArgs.includes('--inactive') ? false : undefined };
                const cat = await updateCategory(cid, changes);
                logSuccess(`  ✓ Updated category ${cat.CategoryId}: ${categoryName(cat)}`);
                break;
              }
              const categories = await queryCategories();
              if (categories.length === 0) { logDim('  No categories.'); break; }
              for (const c of categories) {
                const flags = [c.Hidden ? 'hidden' : null, c.Active === false ? 'inactive' : null].filter(Boolean).join(', ');
                logText(`  ${c.CategoryId}  ${categoryName(c)}${c.ParentCategoryId ? `  (parent ${c.ParentCategoryId})` : ''}${flags ? `  [${flags}]` : ''}`);
              }
              logDim(`  ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`);
              break;
            }
            case 'parameters':
            case 'params': {
              const pArgs = args.slice(1);
              const pAction = pArgs[0]?.toLowerCase();
              const idTypeOf = () => { const i = pArgs.indexOf('--idtype'); if (i !== -1 && pArgs[i + 1] != null) { const n = Number(pArgs[i + 1]); if (n >= 0 && n <= 3) return n as 0 | 1 | 2 | 3; } return undefined; };
              const flagVal = (flag: string) => { const i = pArgs.indexOf(flag); return i !== -1 ? pArgs[i + 1] : undefined; };
              const numFlag = (flag: string) => { const v = flagVal(flag); const n = v != null ? Number(v) : NaN; return Number.isNaN(n) ? undefined : n; };
              const collect = (flag: string) => pArgs.flatMap((a, i) => (pArgs[i - 1] === flag ? [a] : []));
              const parseLocalized = (flag: string): LocalizableContent[] | undefined => {
                const parts = collect(flag);
                if (parts.length === 0) return undefined;
                return parts.map((p) => { const c = p.indexOf(':'); return { LanguageCode: c === -1 ? p : p.slice(0, c), Content: c === -1 ? '' : p.slice(c + 1) }; });
              };

              if (pAction === 'defs' || pAction === 'def') {
                const sub2 = pArgs[1]?.toLowerCase();
                if (sub2 === 'get') {
                  const pid = Number(pArgs[2]);
                  if (Number.isNaN(pid)) { logError('  Usage: /product parameters defs get <parameterId>'); break; }
                  const def = await getProductParameterDef(pid);
                  logText(`  ${def.ParameterId}  ${def.Name}  (type ${def.ParameterType ?? '?'}, group ${def.GroupName ?? def.GroupId ?? '?'})`);
                  for (const pv of def.PredefinedValues ?? []) logDim(`    · ${pv.PredefinedValueId}  ${pv.Name}`);
                  break;
                }
                if (sub2 === 'create' || sub2 === 'add') {
                  const name = flagVal('--name'); const group = numFlag('--group'); const type = numFlag('--type');
                  if (!name || group == null || type == null) { logError('  Usage: /product parameters defs create --name <n> --group <groupId> --type <1-7>'); break; }
                  const def = await createProductParameter({ Name: name, GroupId: group, ParameterType: type, LocalizedNames: parseLocalized('--lang') });
                  logSuccess(`  ✓ Created parameter ${def.ParameterId}: ${def.Name}`);
                  break;
                }
                if (sub2 === 'update') {
                  const pid = Number(pArgs[2]);
                  if (Number.isNaN(pid)) { logError('  Usage: /product parameters defs update <parameterId> [--name <n>] [--group <id>] [--type <1-7>]'); break; }
                  const def = await updateProductParameter(pid, { Name: flagVal('--name'), GroupId: numFlag('--group'), ParameterType: numFlag('--type'), LocalizedNames: parseLocalized('--lang') });
                  logSuccess(`  ✓ Updated parameter ${def.ParameterId}: ${def.Name}`);
                  break;
                }
                logError('  Usage: /product parameters defs [get <id> | create --name <n> --group <id> --type <1-7> | update <id> ...]');
                break;
              }

              if (pAction === 'groups' || pAction === 'group') {
                const sub2 = pArgs[1]?.toLowerCase();
                if (sub2 === 'get') {
                  const gid = Number(pArgs[2]);
                  if (Number.isNaN(gid)) { logError('  Usage: /product parameters groups get <groupId>'); break; }
                  const g = await getProductParameterGroup(gid);
                  logText(`  ${g.GroupId}  ${g.Name}  (order ${g.Order ?? 0})`);
                  if (g.ParameterIds?.length) logDim(`    parameters: ${g.ParameterIds.join(', ')}`);
                  break;
                }
                if (sub2 === 'create' || sub2 === 'add') {
                  const name = flagVal('--name');
                  if (!name) { logError('  Usage: /product parameters groups create --name <n> [--order <n>] [--param <id>...]'); break; }
                  const paramIds = collect('--param').map(Number).filter((n) => !Number.isNaN(n));
                  const g = await createProductParameterGroup({ Name: name, Order: numFlag('--order'), ParameterIds: paramIds.length ? paramIds : undefined, LocalizedNames: parseLocalized('--lang') });
                  logSuccess(`  ✓ Created parameter group ${g.GroupId}: ${g.Name}`);
                  break;
                }
                if (sub2 === 'update') {
                  const gid = Number(pArgs[2]);
                  if (Number.isNaN(gid)) { logError('  Usage: /product parameters groups update <groupId> [--name <n>] [--order <n>] [--param <id>...]'); break; }
                  const paramIds = collect('--param').map(Number).filter((n) => !Number.isNaN(n));
                  const g = await updateProductParameterGroup(gid, { Name: flagVal('--name'), Order: numFlag('--order'), ParameterIds: paramIds.length ? paramIds : undefined, LocalizedNames: parseLocalized('--lang') });
                  logSuccess(`  ✓ Updated parameter group ${g.GroupId}: ${g.Name}`);
                  break;
                }
                logError('  Usage: /product parameters groups [get <id> | create --name <n> [--order <n>] [--param <id>...] | update <id> ...]');
                break;
              }

              if (pAction === 'predefined' || pAction === 'predef') {
                const sub2 = pArgs[1]?.toLowerCase();
                if (sub2 === 'get') {
                  const vid = Number(pArgs[2]);
                  if (Number.isNaN(vid)) { logError('  Usage: /product parameters predefined get <predefinedValueId>'); break; }
                  const pv = await getPredefinedValue(vid);
                  logText(`  ${pv.PredefinedValueId}  ${pv.Name}  (parameter ${pv.ParameterId ?? '?'})`);
                  break;
                }
                if (sub2 === 'add' || sub2 === 'create') {
                  const param = numFlag('--param'); const name = flagVal('--name');
                  if (param == null || !name) { logError('  Usage: /product parameters predefined add --param <parameterId> --name <n>'); break; }
                  const pv = await createPredefinedValue({ ParameterId: param, Name: name, LocalizedNames: parseLocalized('--lang') });
                  logSuccess(`  ✓ Created predefined value ${pv.PredefinedValueId}: ${pv.Name}`);
                  break;
                }
                if (sub2 === 'rename' || sub2 === 'update') {
                  const vid = Number(pArgs[2]); const name = pArgs[3] ?? flagVal('--name');
                  if (Number.isNaN(vid) || !name) { logError('  Usage: /product parameters predefined rename <predefinedValueId> <name>'); break; }
                  const pv = await updatePredefinedValueNames(vid, name, parseLocalized('--lang'));
                  logSuccess(`  ✓ Renamed predefined value ${pv.PredefinedValueId} to ${pv.Name}`);
                  break;
                }
                logError('  Usage: /product parameters predefined [get <id> | add --param <pid> --name <n> | rename <id> <name>]');
                break;
              }

              if (pAction === 'set') {
                const id = pArgs[1]; const paramId = Number(pArgs[2]); const value = pArgs[3];
                if (!id || Number.isNaN(paramId) || value == null) { logError('  Usage: /product parameters set <productId> <parameterId> <value> [--desc <code>:<text>]'); break; }
                const v = await setProductParameterValue(id, paramId, value, { idType: idTypeOf(), localizedDescriptions: parseLocalized('--desc') });
                logSuccess(`  ✓ Set ${v.ParameterName ?? paramId}=${v.Value ?? value} on product ${id}`);
                break;
              }
              if (pAction === 'remove' || pAction === 'delete') {
                const id = pArgs[1]; const paramId = Number(pArgs[2]);
                if (!id || Number.isNaN(paramId)) { logError('  Usage: /product parameters remove <productId> <parameterId>'); break; }
                await removeProductParameterValue(id, paramId, { idType: idTypeOf() });
                logSuccess(`  ✓ Removed parameter ${paramId} from product ${id}`);
                break;
              }
              if (pAction === 'get') {
                const id = pArgs[1]; const paramId = Number(pArgs[2]);
                if (!id || Number.isNaN(paramId)) { logError('  Usage: /product parameters get <productId> <parameterId>'); break; }
                const v = await getProductParameterValue(id, paramId, { idType: idTypeOf() });
                logText(`  ${parameterValueSummary(v)}  (parameter ${v.ParameterId}, type ${v.ParameterType ?? '?'}, group ${v.GroupName ?? v.GroupId ?? '?'})`);
                break;
              }

              const id = pAction === 'list' ? pArgs[1] : pArgs[0];
              if (!id) { logError('  Usage: /product parameters <productId> | set/remove/get <id> <paramId> ... | defs|groups|predefined ...'); break; }
              const values = await getProductParameters(id, { idType: idTypeOf() });
              if (values.length === 0) { logDim('  No parameter values.'); break; }
              for (const v of values) logText(`  ${v.ParameterId}  ${parameterValueSummary(v)}${v.GroupName ? `  [${v.GroupName}]` : ''}`);
              logDim(`  ${values.length} parameter value${values.length === 1 ? '' : 's'}`);
              break;
            }
            case 'help':
              logText('');
              logText('  /product get <id>        Show product details');
              logText('  /product list            Query products (filters below)');
              logText('    --brand <id> --category <id> --article <n> --sellable --in-stock --page <n>');
              logText('  /product items <id>      List a product\'s items (SKUs)');
              logText('  /product variants <id>   Show the product\'s variant group (sibling products)');
              logText('  /product variants create        Build a group from existing products (interactive)');
              logText('  /product variants labels        Manage variant dimension labels (list/add/remove/rename)');
              logText('  /product images <id>     List images; add <id> <file|url> [--primary] | add-existing <id> <name> | delete | set-primary | reorder');
              logText('  /product brands          Manage brands (list/get/create/update/delete)');
              logText('  /product categories      Manage categories (list/get/create/update); assign/unassign <productId> <categoryId>');
              logText('  /product relation-types  Manage relation types (list/get/add/update/delete)');
              logText('  /product relations <id>  List relations; link/unlink <id> <relationTypeId> <relatedId...>');
              logText('  /product parameters <id> List values; set/remove/get <id> <paramId>; defs|groups|predefined ...');
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

        case 'management': {
          const sub = args[0] ?? '';
          const methodNames = Object.keys(managementMethods);

          if (!sub || sub.toLowerCase() === 'help') {
            logText('');
            logText("  /management <METHOD> <path> [--body '<json>']   Raw Management API call");
            if (methodNames.length > 0) {
              logText('');
              for (const name of methodNames) {
                const m = managementMethods[name]!;
                logText(`  /management ${name}${m.usage ? ` ${m.usage}` : ''}    ${m.description}`);
              }
            }
            logText('');
            break;
          }

          // Raw passthrough: /management GET /API/Market/List
          if (isHttpMethod(sub)) {
            const method = sub.toUpperCase();
            const path = args[1];
            if (!path) { logText('  Usage: /management <METHOD> <path>'); break; }
            const bodyIdx = args.indexOf('--body');
            let body: unknown;
            if (bodyIdx !== -1 && args[bodyIdx + 1]) {
              try { body = JSON.parse(args[bodyIdx + 1]!); } catch {
                logError('  Invalid JSON in --body');
                break;
              }
            }
            appState.setLiveComponent(
              <Box key="mgmt-spinner" gap={1} paddingX={1}>
                <Spinner type="dots" />
                <Text dimColor>Requesting {method} {path}...</Text>
              </Box>,
            );
            const data = await managementRequest(method, path, body);
            appState.setLiveComponent(null);
            logText(`  ${JSON.stringify(data, null, 2)}`);
            break;
          }

          // Named method
          const named = managementMethods[sub.toLowerCase()];
          if (!named) {
            logError(`  Unknown method: ${sub}`);
            logDim('  Type /management help for available methods');
            break;
          }
          appState.setLiveComponent(
            <Box key="mgmt-spinner" gap={1} paddingX={1}>
              <Spinner type="dots" />
              <Text dimColor>Calling {sub}...</Text>
            </Box>,
          );
          const data = await named.run(args.slice(1));
          appState.setLiveComponent(null);
          logText(`  ${JSON.stringify(data, null, 2)}`);
          break;
        }

        case 'output': {
          const sub = args[0];
          if (!sub || sub.toLowerCase() === 'status') {
            const dir = await getOutputDir();
            if (dir) logText(`  Output folder: ${dir}`); else logDim('  Output folder: disabled');
            break;
          }
          if (['off', 'clear', 'none', 'disable'].includes(sub.toLowerCase())) {
            const config = await loadConfig();
            delete config.outputDir;
            await saveConfig(config);
            setOutputDir(null);
            logSuccess('  ✓ Output folder disabled.');
            break;
          }
          const config = await loadConfig();
          config.outputDir = sub;
          await saveConfig(config);
          setOutputDir(sub);
          const resolved = await getOutputDir();
          logSuccess(`  ✓ Output folder set: ${resolved}`);
          break;
        }

        case 'copilot': {
          const sub = args[0]?.toLowerCase();
          if (sub === 'set' || sub === 'provider') {
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
            appState.setCopilotProvider(existing.model ? `${existing.command} · ${existing.model}` : existing.command);
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
          if (kb.entities.length === 0 && kb.patterns.length === 0 && Object.keys(kb.preferences).length === 0) {
            logDim('  No learned knowledge yet');
            break;
          }
          if (kb.entities.length > 0) {
            logText(`  Entities (${kb.entities.length}):`);
            for (const e of kb.entities.slice(0, 15)) {
              const attrs = Object.values(e.attributes).filter(Boolean).join(', ');
              const detail = attrs ? ` (${attrs})` : '';
              logText(`    [${e.type}] ${e.name}${detail}`);
            }
            if (kb.entities.length > 15) logDim(`    ... and ${kb.entities.length - 15} more`);
          }
          if (kb.patterns.length > 0) {
            logText(`  Patterns (${kb.patterns.length}):`);
            for (const p of kb.patterns.slice(0, 10)) {
              const conf = Math.round(p.confidence * 100);
              logText(`    [${p.type}] ${p.description} (${conf}%)`);
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
      appState.setLiveComponent(null);
      if (controller.signal.aborted) logDim('  ✕ Cancelled');
      else logError(`  ${formatError(err)}`);
    }

    } finally {
      setBusy(false);
      setActiveSignal(undefined);
      abortRef.current = null;
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

      {appState.activeMode === 'apikey' && (
        <ApiKeyFlow
          onComplete={handleApiKeyComplete}
          onCancel={handleApiKeyCancel}
        />
      )}

      {appState.activeMode === 'select-apikey' && appState.apiKeyPicker && (
        <SelectApiKey
          names={appState.apiKeyPicker.names}
          active={appState.apiKeyPicker.active}
          onSelect={handleApiKeySelect}
          onCancel={handleApiKeyPickerCancel}
        />
      )}

      {appState.activeMode === 'variant-builder' && (
        <VariantBuilder
          onComplete={handleVariantBuilderComplete}
          onCancel={handleVariantBuilderCancel}
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
          onComplete={async () => {
            appState.setActiveMode(null);
            clearConversationHistory();
            appState.setCopilotActive(true);
            const cfg = await getCopilotConfig();
            if (cfg) appState.setCopilotProvider(cfg.model ? `${cfg.command} · ${cfg.model}` : cfg.command);
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
          busy={busy}
          copilotActive={appState.copilotActive}
          copilotProvider={appState.copilotProvider}
          onToggleCopilot={async () => {
            if (appState.copilotActive) {
              appState.setCopilotActive(false);
              clearConversationHistory();
            } else {
              const existing = await getCopilotConfig();
              if (existing) {
                appState.setCopilotActive(true);
                appState.setCopilotProvider(existing.model ? `${existing.command} · ${existing.model}` : existing.command);
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
