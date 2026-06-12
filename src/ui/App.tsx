import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { VERSION } from '../version.ts';
import Spinner from 'ink-spinner';
import { ChatHistory } from './ChatHistory.tsx';
import { ChatInput } from './ChatInput.tsx';
import { Welcome } from './Welcome.tsx';
import { LoginFlow } from './LoginFlow.tsx';
import { ApiKeyFlow } from './ApiKeyFlow.tsx';
import { SelectApiKey } from './SelectApiKey.tsx';
import { VariantBuilder } from './VariantBuilder.tsx';
import { SelectAccount } from './SelectAccount.tsx';
import { Confirm } from './Confirm.tsx';
import { useAppState } from './hooks/useAppState.ts';
import { clearSession, parseJwtExp } from '../auth/session.ts';
import { readFileSync } from 'node:fs';
import { saveSession, addCredentials, loadCredentials, loadCredentialsStore, useCredentials, removeCredentials, clearCredentials, updateActiveCredentials, loadConfig, saveConfig, type ApiCredentials, type StoredCheckoutDefaults } from '../config/store.ts';
import { resetCredentialsCache } from '../api/live-client.ts';
import { setActiveSignal } from '../api/abort.ts';
import { setOutputDir, getOutputDir } from '../output/sink.ts';
import { setWorking } from '../output/title.ts';
import { loadSession } from '../auth/session.ts';
import { fetchUser, type AuthResponse } from '../auth/login.ts';
import { request, resetSessionCache } from '../api/client.ts';
import { getApiUrl, getLogo, getLogoPrefix, getName } from '../config/env.ts';
import { formatError } from '../api/errors.ts';
import { SelectCopilot } from './SelectCopilot.tsx';
import { Markdown } from './Markdown.tsx';
import { ThinkingIndicator } from './ThinkingIndicator.tsx';
import { getCopilotConfig, chatStream, getContextUsageAsync, clearConversationHistory, extractGeinsCommands, executeGeinsCommand, addToolResult, collectAttachedFiles, buildAttachmentSection, getMemoryEnabled, setMemoryEnabled, type StreamEvent } from '../commands/copilot.ts';
import { CopilotActivity, type ActivityEntry } from './CopilotActivity.tsx';
import {
  startSession,
  logEntry,
  endSession,
  trackWorkflow,
  trackWorkflowList,
  searchSessions,
  loadKnowledge,
  recordInteraction,
  addFact,
  setPreference,
  clearKnowledge,
  clearHistory,
  clearCommandContext,
  cacheManifest,
  applyMemoryAccount,
} from '../memory/index.ts';
import { exportMemory } from '../commands/memory.ts';
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
import {
  queryOrders,
  getOrder,
  countOrders,
  getOrderStatuses,
  createOrder,
  validateOrderCreation,
  setOrderStatus,
  updateOrder,
  cancelOrderRow,
  addOrderComment,
  setOrderTransaction,
  setPaymentPaid,
  deleteOrder,
  orderSummary,
  parseOrderListArgs,
  type OrderUpdate,
} from '../commands/orders.ts';
import {
  listCampaigns,
  getCampaignTypes,
  getCampaign,
  createCampaign,
  buildPromoCodeCampaign,
  campaignLabel,
  type CampaignWrite,
} from '../commands/campaigns.ts';
import { getProduct, queryProducts, parseProductListArgs, productName, getProductItems, productItemName, getVariantGroup, variantSummary, buildVariantGroupFromProducts, parseVariantCreateFlags, parseVariantGroupBody, listVariantLabels, addVariantLabel, renameVariantLabel, removeVariantLabel, getProductImages, addProductImage, addExistingProductImage, deleteProductImage, setProductImagePrimary, reorderProductImage, imageNameFromUrl, listRelationTypes, getRelationType, createRelationType, updateRelationType, deleteRelationType, queryBrands, getBrand, createBrand, updateBrand, deleteBrand, brandName, type BrandWrite, queryCategories, getCategory, createCategory, updateCategory, assignProductCategory, unassignProductCategory, categoryName, type CategoryWrite, getProductRelations, linkRelatedProducts, unlinkRelatedProducts, getProductParameters, getProductParameterValue, setProductParameterValue, removeProductParameterValue, getProductParameterDef, createProductParameter, updateProductParameter, getProductParameterGroup, createProductParameterGroup, updateProductParameterGroup, getPredefinedValue, createPredefinedValue, updatePredefinedValueNames, parameterValueSummary, type LocalizableContent, type BuildVariantGroupResult } from '../commands/products.ts';
import { listMarkets, listLanguages, listChannels, listLocales, marketName, listUserAccounts } from '../commands/account.ts';
import {
  resolveMerchantContext,
  searchProducts,
  getProduct as getMerchantProduct,
  listCategories as listMerchantCategories,
  listBrands as listMerchantBrands,
  createCart,
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  setCartPromoCode,
  buildCheckoutToken,
  parseCheckoutToken,
  productLine,
  cartLines,
  type ContextOverrides,
  type CheckoutTokenOptions,
  type CheckoutRedirects,
  type CheckoutBranding,
  type CustomerType,
} from '../commands/merchant.ts';

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

  const welcomeComponent = useMemo(
    () => (
      <Welcome
        version={version}
        user={appState.status.user || undefined}
        account={appState.status.account || undefined}
        accountName={appState.status.accountName || undefined}
        apiAccount={appState.status.apiAccount || undefined}
        authState={appState.status.authState}
        logo={getLogo()}
        prefix={getLogoPrefix()}
        name={getName()}
      />
    ),
    [version, appState.status.user, appState.status.account, appState.status.accountName, appState.status.apiAccount, appState.status.authState],
  );

  // /clear (and account switch, /new, memory clear) → the fresh-start UI: wipe the
  // screen + scrollback; the epoch bump remounts ChatHistory's <Static>, which
  // re-emits the welcome banner (its items[0]) onto the blank screen — exactly
  // like app launch.
  const clearToWelcome = appState.clearChat;

  const finalizeLogin = useCallback(async (auth: AuthResponse, accountKey: string) => {
    try {
      const user = await fetchUser(auth.accessToken);
      const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unknown';
      const accountName = auth.accounts?.find(a => a.accountKey === accountKey)?.displayName ?? '';

      const { apiKeysCleared } = await saveSession({
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

      // API keys belong to the user: a different user logging in dropped the old
      // profiles (saveSession), so flush the in-process cache and re-scope memory.
      if (apiKeysCleared) {
        resetCredentialsCache();
        await applyMemoryAccount();
      }

      appState.updateStatus({
        user: user.email ?? '',
        account: accountKey,
        accountName,
        connected: true,
        authState: 'logged-in',
        ...(apiKeysCleared ? { apiAccount: '' } : {}),
      });
      logSuccess(`  ✓ Logged in as ${user.email ?? name}`);
      if (apiKeysCleared) {
        logDim('  Stored API keys cleared — they belonged to the previous user. Use /apikey to add yours.');
      }
    } catch (err) {
      logError(`  ${formatError(err)}`);
    }
    appState.setActiveMode(null);
    appState.setPendingAuth(null);
    appState.setLiveComponent(null);
  }, [appState, logSuccess, logError, logDim]);

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

  // The account picker is shared with login. This ref flags that it was opened by /account use
  // (a switch while already logged in) so cancel keeps the current account instead of defaulting
  // to the first, and select rewrites only the account — no re-auth (the bearer token is
  // account-agnostic; x-account-key selects the account per request).
  const switchingAccountRef = useRef(false);

  // A pending yes/no prompt (rendered as a Confirm modal). Held in a ref since the payload is
  // a callback; setActiveMode('confirm') drives the render.
  const confirmRef = useRef<{ message: string; onYes: () => void | Promise<void> } | null>(null);

  const askConfirm = useCallback((message: string, onYes: () => void | Promise<void>) => {
    confirmRef.current = { message, onYes };
    appState.setActiveMode('confirm');
  }, [appState]);

  const handleConfirmYes = useCallback(async () => {
    const action = confirmRef.current?.onYes;
    confirmRef.current = null;
    appState.setActiveMode(null);
    if (action) await action();
  }, [appState]);

  const handleConfirmNo = useCallback(() => {
    confirmRef.current = null;
    appState.setActiveMode(null);
  }, [appState]);

  // After an account is selected, check for a matching live-API key profile. Profiles are keyed
  // by their Management API Key (e.g. "prod-labs"); the convention is the account name with a
  // "prod-" prefix. If the match isn't active, offer to switch to it; if there's no match, offer
  // to add a key for this account.
  const reconcileApiKey = useCallback(async (accountName: string) => {
    if (!accountName) return;
    const store = await loadCredentialsStore();
    const want = accountName.toLowerCase();
    const match = Object.keys(store.profiles).find(n => n.replace(/^prod-/i, '').toLowerCase() === want);
    if (match) {
      if (match === store.active) return; // already the active key — nothing to do
      askConfirm(`  API key '${match}' matches account '${accountName}'. Switch to it?`, async () => {
        await useCredentials(match);
        resetCredentialsCache();
        await applyMemoryAccount();
        appState.updateStatus({ apiAccount: match });
        logSuccess(`  ✓ Switched API key to '${match}'.`);
      });
    } else {
      askConfirm(`  No API key found for account '${accountName}'. Add one now?`, () => {
        appState.setActiveMode('apikey');
      });
    }
  }, [appState, askConfirm, logSuccess]);

  // Rewrite the stored session's account, drop the client's session cache so the next request
  // sends the new x-account-key. On a real change, rotate the memory session into the new
  // account's bucket and start on a clean screen with the welcome banner reflecting the new
  // identity (the banner is driven by status, which updateStatus refreshes).
  const applyAccountSwitch = useCallback(async (accountKey: string, accountName: string) => {
    const session = await loadSession();
    if (!session) { logError('  Not logged in. Run /login first.'); return; }
    const changed = session.accountKey !== accountKey;
    await saveSession({ ...session, accountKey, accountName });
    resetSessionCache();

    if (changed) {
      // Close the current session log in the old bucket, re-scope, then open a fresh one.
      await endSession();
      await applyMemoryAccount();
      await startSession(accountKey);
    } else {
      await applyMemoryAccount();
    }

    appState.updateStatus({ account: accountKey, accountName });

    if (changed) {
      clearToWelcome(); // fresh screen + welcome banner for the new account
    }
    logSuccess(`  ✓ Switched to ${accountName || accountKey}`);
    await reconcileApiKey(accountName);
  }, [appState, logSuccess, logError, reconcileApiKey, clearToWelcome]);

  const handleAccountSwitchSelected = useCallback(async (accountKey: string) => {
    switchingAccountRef.current = false;
    const accountName = appState.pendingAuth?.accounts?.find(a => a.accountKey === accountKey)?.displayName ?? '';
    appState.setActiveMode(null);
    appState.setPendingAuth(null);
    await applyAccountSwitch(accountKey, accountName);
  }, [appState, applyAccountSwitch]);

  const handleAccountSwitchCancel = useCallback(() => {
    switchingAccountRef.current = false;
    appState.setActiveMode(null);
    appState.setPendingAuth(null);
    logDim('  Account unchanged.');
  }, [appState, logDim]);

  const handleLoginCancel = useCallback(() => {
    logDim('  Login cancelled.');
    appState.setActiveMode(null);
    appState.setLiveComponent(null);
  }, [appState, logDim]);

  const handleApiKeyComplete = useCallback(async (credentials: ApiCredentials) => {
    const name = await addCredentials(credentials);
    resetCredentialsCache();
    await applyMemoryAccount();
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
    await applyMemoryAccount();
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

    // Copilot turns are logged as their own entry types so a session transcript reads as a
    // conversation (`geins resume <id>`), not a flat command list.
    const isCopilotTurn = appState.copilotActive && !trimmed.startsWith('/');
    logEntry({ type: isCopilotTurn ? 'copilot-prompt' : 'command', content: trimmed });

    // Mark the operation in flight and register its abort signal so Ctrl-C can cancel
    // in-flight API calls (via the ambient signal) and kill copilot/geins subprocesses.
    const controller = new AbortController();
    abortRef.current = controller;
    setActiveSignal(controller.signal);
    setBusy(true);
    try {

    // Copilot mode: non-slash input goes to AI
    if (appState.copilotActive && !trimmed.startsWith('/')) {
      // Flag the tab as busy while we wait on the copilot.
      setWorking(true);
      appState.addToChat(
        <Text key={`msg-${appState.getNextKey()}`} bold>{`❯ ${trimmed}`}</Text>,
      );
      // Show the working indicator immediately — BEFORE the async attachment/config prep below —
      // so there's no dead air between the user hitting enter and visible activity.
      appState.setLiveComponent(
        <ThinkingIndicator key="copilot-thinking" />,
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
      // Mutable: in auto mode the router picks a tier per ask, surfaced via a 'model'
      // stream event — the header updates from "· auto" to the actual tier (e.g. "· haiku").
      let providerLabel = copilotCfg
        ? copilotCfg.model ? `${copilotCfg.command} · ${copilotCfg.model}` : copilotCfg.command
        : 'copilot';
      try {
        let streamBuffer = '';
        const activityLog: ActivityEntry[] = [];
        // One clock for the whole user turn (initial stream + agentic follow-up rounds) —
        // the header timer must show total wall time, not reset per round.
        const turnStartedAt = Date.now();

        // Text shown for a model turn: drop <think> blocks and the ```bash``` command
        // blocks (those run and show as "⟳ <cmd>", so repeating them is just noise).
        const displayText = (s: string) =>
          s
            .replace(/<think>[\s\S]*?<\/think>/g, '')
            .replace(/<think>[\s\S]*$/, '')
            .replace(/```(?:bash|sh|shell)?[\s\S]*?```/g, '')
            .replace(/```(?:bash|sh|shell)?[\s\S]*$/, '')
            // [MEMORY]…[/MEMORY] tags are a side channel for the knowledge base, not prose —
            // strip them (and a trailing unterminated one mid-stream) so the user never sees them.
            .replace(/\[MEMORY\][\s\S]*?\[\/MEMORY\]/g, '')
            .replace(/\[MEMORY\][\s\S]*$/, '')
            .trim();

        const renderActivity = () => {
          appState.setLiveComponent(
            <CopilotActivity
              key="copilot-activity"
              providerLabel={providerLabel}
              entries={[...activityLog]}
              isWorking={true}
              startedAt={turnStartedAt}
            />,
          );
        };

        const handleEvent = (event: StreamEvent) => {
          if (event.kind === 'tool_start') {
            activityLog.push({ kind: 'tool', label: event.label ?? event.toolName ?? 'Working', done: false, startedAt: Date.now() });
            renderActivity();
          } else if (event.kind === 'tool_end') {
            // Results carry no tool id, so pair FIFO: the oldest still-running entry finishes
            // first. Parallel calls completing out of order can mismark a sibling — cosmetic.
            const first = activityLog.find(e => e.kind === 'tool' && !e.done);
            if (first) first.done = true;
            renderActivity();
          } else if (event.kind === 'model') {
            // Auto-routed tier for this ask — reflect it in the header.
            providerLabel = `${copilotCfg?.command ?? 'copilot'} · ${event.label}`;
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
        const hasThinking = /<think>[\s\S]*?<\/think>/.test(rawBuffer);
        const cleaned = rawBuffer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (hasThinking) {
          logDim('  ⟐ thinking collapsed');
        }
        const looksGarbled = /(<\|[a-z_]+\|>|<\|im_|<\|endoftext)/.test(cleaned);
        if (looksGarbled) {
          appState.setLiveComponent(null);
          logError(`  The selected model doesn't support this task. Try a more capable model or switch provider with /copilot set.`);
        } else if (cleaned) {
          const finalEntries = activityLog.map(e => ({ ...e, done: true }));
          // Keep the activity (with its spinner) on screen while we compute context usage — that
          // call rebuilds the prompt and can take a beat. Clearing it first leaves a blank,
          // frozen-looking gap. Only swap the live view for the committed card once we're ready.
          const ctx = await getContextUsageAsync();
          appState.setLiveComponent(null);
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
          // Track the latest prose answer so we can record the turn (prompt + summary) in memory.
          let lastAnswer = cleaned;
          for (let round = 0; round < MAX_ROUNDS; round++) {
            if (controller.signal.aborted) throw new Error('cancelled');
            const commands = extractGeinsCommands(pending);
            if (commands.length === 0) break;

            // Collect this round's results so the follow-up prompt is SELF-CONTAINED: with native
            // session resume the full history isn't replayed, so we can't say "the results are above"
            // and rely on it — we embed them in the prompt itself (works for replay CLIs too).
            const roundResults: string[] = [];
            for (const cmd of commands) {
              appState.setLiveComponent(
                <Box key="cmd-spinner" gap={1} paddingX={1}>
                  <Spinner type="dots" />
                  <Text dimColor>{cmd}</Text>
                </Box>,
              );
              const result = await executeGeinsCommand(cmd);
              if (controller.signal.aborted) throw new Error('cancelled');
              // Keep the command spinner up through the result save, then swap to the committed card —
              // no blank gap while addToolResult writes history.
              await addToolResult(cmd, result.output);
              const capped = result.output.length > 4000
                ? `${result.output.slice(0, 4000)}\n…[truncated; full result in the output folder]`
                : result.output;
              roundResults.push(`$ ${cmd}\n${capped}`);
              // Collapse long outputs to a one-line summary (the model still gets the
              // full result, and it's written to the output folder). Short ones show.
              const lines = result.output ? result.output.split('\n').length : 0;
              const collapse = result.output.length > 800 || lines > 12;
              appState.setLiveComponent(null);
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
                  startedAt={turnStartedAt}
                />,
              );
            };
            renderFollowup();

            const resultsBlock = roundResults.join('\n\n');
            const followupPrompt = lastRound
              ? `I ran the commands you asked for. Results:\n\n${resultsBlock}\n\nDo NOT output more commands now — give your final answer to my original question and summarize what you found.\n\nMy original question was: ${trimmed}`
              : `I ran the commands you asked for. Results:\n\n${resultsBlock}\n\nIf you need to run more commands, output them in a bash block. Otherwise, answer my original question and summarize what you found.\n\nMy original question was: ${trimmed}`;

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
                  followupLog.push({ kind: 'tool', label: event.label ?? event.toolName ?? 'Working', done: false, startedAt: Date.now() });
                  renderFollowup();
                } else if (event.kind === 'tool_end') {
                  // FIFO pairing — see handleEvent above.
                  const first = followupLog.find(e => e.kind === 'tool' && !e.done);
                  if (first) first.done = true;
                  renderFollowup();
                }
              },
              // Mid-task tool-result round: keep the tier the task was routed to —
              // don't re-route on tool output.
              { continuation: true },
            );
            // Keep bash blocks here — `pending` is scanned for the next round's commands.
            const followupCleaned = followupRaw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            // Only commit a visible card if there's prose/tool activity (a bash-only
            // round produces no display text and shouldn't leave an empty card).
            if (followupLog.length > 0) {
              const finalFollowup = followupLog.map(e => ({ ...e, done: true }));
              // Keep the working indicator up while context usage is computed (see note above),
              // then swap it for the committed card — avoids a blank gap mid-turn.
              const ctx2 = await getContextUsageAsync();
              appState.setLiveComponent(null);
              appState.addToChat(
                <CopilotActivity
                  key={`msg-${appState.getNextKey()}`}
                  providerLabel={`${providerLabel}  ·  context ${ctx2.percent}%`}
                  entries={finalFollowup}
                  isWorking={false}
                />,
              );
              lastAnswer = followupCleaned;
            } else {
              // Bash-only round (no prose/tools to show) — clear the indicator before the next round.
              appState.setLiveComponent(null);
            }
            pending = lastRound ? '' : followupCleaned;
          }
          // Persist the turn (original question + a one-line answer summary) for /memory,
          // and the full answer into the session transcript for `geins resume`.
          await recordInteraction(trimmed, lastAnswer);
          await logEntry({ type: 'copilot-response', content: lastAnswer });
        } else {
          // No assistant text and not garbled — still clear the working indicator so it doesn't linger.
          appState.setLiveComponent(null);
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

    // Generic "working" indicator so every command gives immediate feedback while it talks to the
    // API — without this, commands that don't set their own spinner (e.g. /account locales) sit
    // silent until output appears. Set before the switch; commands that show a more specific spinner
    // override it, synchronous commands clear it via the finally before React ever paints it (no
    // flash), and the outer finally guarantees it's gone once the command returns.
    appState.setLiveComponent(
      <Box key="cmd-working" gap={1} paddingX={1}>
        <Spinner type="dots" />
        <Text dimColor>{`Running ${trimmed}…`}</Text>
      </Box>,
    );

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
          logText('  /account    Account settings        /account use | markets | languages | locales');
          logText('  /apikey     Manage API accounts         /apikey list | add | use <name>');
          logText('  /workflow   Workflow commands       /workflow help');
          logText('  /product    Product commands        /product get <id> | list | items <id> | variants <id>');
          logText('  /order      Order commands          /order list | get <id> | statuses | status <id> <s>');
          logText('  /campaign   Campaign commands       /campaign list | types | get <id> | create --promocode <c> ...');
          logText('  /merchant   Storefront (Merchant API)  /merchant help');
          logText('  /api        Raw API request         /api GET /products');
          logText('  /output     Dump responses to folder   /output ./out | /output off');
          logText('  /copilot    Toggle AI copilot mode  /copilot provider');
          if (appState.copilotActive) {
            logText('  /new        New conversation         Clear copilot history');
          }
          logText('  /history    Search past sessions     /history <query>');
          logText('  /memory     View learned knowledge   /memory clear (start fresh)');
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
              await applyMemoryAccount();
              appState.updateStatus({ apiAccount: name });
              logSuccess(`  ✓ Switched to '${name}'.`);
            } else {
              logError(`  Unknown credentials profile: ${name}`);
            }
          } else if (action === 'remove') {
            const name = args[1];
            if (!name) { logError('  Usage: /apikey remove <name>'); break; }
            if (await removeCredentials(name)) {
              resetCredentialsCache();
              await applyMemoryAccount();
              const store = await loadCredentialsStore();
              appState.updateStatus({ apiAccount: store.active ?? '' });
              logSuccess(`  ✓ Removed '${name}'.`);
            } else {
              logError(`  Unknown credentials profile: ${name}`);
            }
          } else if (action === 'clear') {
            await clearCredentials();
            resetCredentialsCache();
            await applyMemoryAccount();
            appState.updateStatus({ apiAccount: '' });
            logSuccess('  ✓ All API credentials cleared.');
          } else {
            logError(`  Unknown subcommand: apikey ${action}`);
            logDim('  Subcommands: add, list, use <name>, remove <name>, clear');
          }
          break;
        }

        case 'logout':
          await clearSession();
          appState.updateStatus({ user: '', account: '', connected: false, authState: 'logged-out' });
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
          const credStore = await loadCredentialsStore();
          if (credStore.active) logText(`  API key: ${credStore.active}`);
          break;
        }

        case 'account': {
          const sub = args[0]?.toLowerCase();
          const vatPct = (rate?: number) => (rate != null ? `VAT ${+(rate * 100).toFixed(2)}%` : null);

          // Switch the active account — same picker as login. `/account use` opens the picker;
          // `/account use <name|key>` switches directly without it.
          if (sub === 'use' || sub === 'switch') {
            const session = await loadSession();
            if (!session) { logError('  Not logged in. Run /login first.'); break; }
            appState.setLiveComponent(
              <Box key="account-spinner" gap={1} paddingX={1}>
                <Spinner type="dots" />
                <Text dimColor>Loading accounts…</Text>
              </Box>,
            );
            let accounts;
            try {
              accounts = await listUserAccounts();
            } catch (err) {
              appState.setLiveComponent(null);
              logError(`  ${formatError(err)}`);
              break;
            }
            appState.setLiveComponent(null);
            if (accounts.length === 0) { logDim('  No accounts available.'); break; }

            // Direct switch when a name/key is given (no picker).
            const target = args[1];
            if (target) {
              const t = target.toLowerCase();
              const match = accounts.find(a => a.name.toLowerCase() === t || a.accountKey === target);
              if (!match) { logError(`  Unknown account: ${target}`); break; }
              await applyAccountSwitch(match.accountKey, match.name);
              break;
            }

            if (accounts.length === 1) { logDim(`  Only one account available (${accounts[0]!.name}).`); break; }

            // Open the shared login picker in switch mode.
            switchingAccountRef.current = true;
            appState.setPendingAuth({
              accessToken: session.accessToken,
              refreshToken: session.refreshToken,
              accounts: accounts.map(a => ({ accountKey: a.accountKey, displayName: a.name, roles: a.roles })),
            });
            appState.setActiveMode('select-account');
            break;
          }

          if (sub === 'list' || sub === 'accounts') {
            const session = await loadSession();
            let accounts;
            try {
              accounts = await listUserAccounts();
            } catch (err) {
              logError(`  ${formatError(err)}`);
              break;
            }
            if (accounts.length === 0) { logDim('  No accounts available.'); break; }
            for (const a of accounts) {
              const marker = a.accountKey === session?.accountKey ? '●' : '○';
              logText(`  ${marker} ${a.name}${a.roles.length ? `  ${a.roles.join(', ')}` : ''}`);
            }
            logDim(`  ${accounts.length} account${accounts.length === 1 ? '' : 's'} · ● = current · switch with /account use`);
            break;
          }

          if (sub === 'languages' || sub === 'language' || sub === 'langs') {
            const languages = await listLanguages();
            if (languages.length === 0) { logDim('  No languages.'); break; }
            for (const l of languages) logText(`  ${l.name} (${l._id})${l.active === false ? '  (inactive)' : ''}`);
            logDim(`  ${languages.length} language${languages.length === 1 ? '' : 's'}`);
            break;
          }

          if (sub === 'locales' || sub === 'locale') {
            const locales = await listLocales();
            if (locales.length === 0) { logDim('  No locales.'); break; }
            for (const l of locales) logText(`  ${l.tag}${l.languageName ? `  ${l.languageName}` : ''}${l.channel ? `  (${l.channel})` : ''}`);
            logDim(`  ${locales.length} locale${locales.length === 1 ? '' : 's'}`);
            break;
          }

          if (sub === 'markets' || sub === 'market') {
            const markets = await listMarkets();
            if (markets.length === 0) { logDim('  No markets.'); break; }
            for (const m of markets) {
              const bits = [m.currency?._id, vatPct(m.standardVatRate)].filter(Boolean).join(' · ');
              logText(`  ${marketName(m)}${bits ? `  (${bits})` : ''}${m.active === false ? '  (inactive)' : ''}`);
            }
            logDim(`  ${markets.length} market${markets.length === 1 ? '' : 's'}`);
            break;
          }

          // A subcommand was given but didn't match any branch above — don't silently
          // fall through to the overview.
          if (sub) {
            logError(`  Unknown subcommand: account ${sub}`);
            logDim('  Usage: /account [list | use | markets | languages | locales]');
            break;
          }

          // Default (no subcommand): a compact summary (counts only). The subcommands print
          // the full lists. Fetch channels + languages once and reuse for the locale count.
          const [markets, languages, channels] = await Promise.all([listMarkets(), listLanguages(), listChannels()]);
          const locales = await listLocales({ channels, languages });
          logText(`  Markets: ${markets.length} · Languages: ${languages.length} · Locales: ${locales.length}`);
          logDim('  /account list · /account use · /account markets · /account languages · /account locales');
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
                appState.addToChat(
                  <Text key={`msg-${appState.getNextKey()}`}>
                    {`  ${status} ${wf.name}  `}
                    <Text dimColor>{wf.id}</Text>
                  </Text>,
                );
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
                logText(`  ${status} ${productName(p)}  (${p.ProductId})${p.ArticleNumber ? `  ${p.ArticleNumber}` : ''}`.trimEnd());
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
              logText('    --brand <id> --category <id> --article <n> --sellable --in-stock --page <n> --include <fields>');
              logText('    --include (default Names): Names, ShortTexts, LongTexts, TechTexts, Items, Prices, Categories,');
              logText('      Parameters, Variants, Markets, Images, Feeds, Urls, ShippingFees, RelatedProducts, DiscountCampaigns, LowestPrice');
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

        case 'order': {
          const sub = args[0]?.toLowerCase() ?? 'list';
          const subArgs = args.slice(1);
          const spin = (label: string) => appState.setLiveComponent(
            <Box key="order-spinner" gap={1} paddingX={1}><Spinner type="dots" /><Text dimColor>{label}</Text></Box>,
          );
          const readBody = (a: string[]): unknown => {
            const bi = a.indexOf('--body');
            if (bi !== -1 && a[bi + 1]) return JSON.parse(a[bi + 1]!);
            throw new Error("Provide --body '<json>' (use the direct CLI `geins order ...` for --file/stdin).");
          };
          switch (sub) {
            case 'list':
            case 'query': {
              const { query, page } = parseOrderListArgs(subArgs);
              spin('Querying orders...');
              const result = await queryOrders(query, { page });
              appState.setLiveComponent(null);
              if (result.orders.length === 0) { logDim('  No orders found.'); break; }
              for (const o of result.orders) logText(`  ${orderSummary(o)}`);
              const pr = result.page;
              if (pr) {
                logDim(`  ${result.orders.length} shown · ${pr.RowCount ?? '?'} total · page ${pr.Page ?? 1}/${pr.PageCount ?? 1}`);
                if (pr.HasMoreRows) logDim(`  Next: /order list --page ${(pr.Page ?? 1) + 1} --batch ${pr.BatchId}`);
              }
              break;
            }
            case 'get': {
              const id = subArgs[0];
              if (!id) { logError('  Usage: /order get <idOrPublicId> [--include <fields>]'); break; }
              const incIdx = subArgs.indexOf('--include');
              const include = incIdx !== -1 ? subArgs[incIdx + 1] : undefined;
              spin(`Fetching order ${id}...`);
              const order = await getOrder(id, { include });
              appState.setLiveComponent(null);
              logText(`  ${orderSummary(order)}`);
              if (order.MarketName) logDim(`  Market: ${order.MarketName}`);
              const email = order.CustomerEmail ?? order.BillingAddress?.Email ?? order.ShippingAddress?.Email;
              if (email) logDim(`  Customer: ${email}`);
              for (const r of order.Rows ?? []) {
                const qty = r.Quantity != null ? `${r.Quantity}× ` : '';
                const price = r.PriceIncVat != null ? `  ${r.PriceIncVat} ${order.Currency ?? ''}`.trimEnd() : '';
                logText(`    ${qty}${r.Name ?? r.ArticleNumber ?? r.ProductId ?? '?'}${price}`);
              }
              break;
            }
            case 'count': {
              const email = subArgs[0];
              if (!email) { logError('  Usage: /order count <email>'); break; }
              spin(`Counting orders for ${email}...`);
              const n = await countOrders(email);
              appState.setLiveComponent(null);
              logText(`  ${n} order${n === 1 ? '' : 's'} for ${email}`);
              break;
            }
            case 'statuses': {
              spin('Loading statuses...');
              const statuses = await getOrderStatuses();
              appState.setLiveComponent(null);
              logText(`  ${JSON.stringify(statuses, null, 2)}`);
              break;
            }
            case 'create': {
              spin('Creating order...');
              try {
                const orderId = await createOrder(readBody(subArgs) as Parameters<typeof createOrder>[0]);
                appState.setLiveComponent(null);
                logSuccess(`  ✓ Created order ${orderId}`);
              } catch (err) { appState.setLiveComponent(null); throw err; }
              break;
            }
            case 'validate': {
              spin('Validating order...');
              try {
                const result = await validateOrderCreation(readBody(subArgs) as Parameters<typeof validateOrderCreation>[0]);
                appState.setLiveComponent(null);
                if (result.Success) logSuccess(`  ✓ Valid${result.Message ? `: ${result.Message}` : ''}`);
                else logError(`  ✗ Invalid${result.Message ? `: ${result.Message}` : ''}`);
              } catch (err) { appState.setLiveComponent(null); throw err; }
              break;
            }
            case 'status': {
              const id = subArgs[0]; const status = subArgs[1];
              if (!id || !status) { logError('  Usage: /order status <id> <status> [<txId> [<secondaryTxId>]]'); break; }
              await setOrderStatus(id, status, subArgs[2], subArgs[3]);
              logSuccess(`  ✓ Order ${id} status set to ${status}`);
              break;
            }
            case 'update': {
              const id = subArgs[0];
              if (!id) { logError('  Usage: /order update <id> [--external-id <s>] [--parcel <s>] [--external-status <n>] [--return-parcel <s>] | [--body \'<json>\']'); break; }
              const flag = (name: string) => { const i = subArgs.indexOf(name); return i !== -1 ? subArgs[i + 1] : undefined; };
              let changes: OrderUpdate;
              if (subArgs.includes('--body') || subArgs.includes('--file')) {
                changes = readBody(subArgs.slice(1)) as OrderUpdate;
              } else {
                const extStatus = flag('--external-status');
                changes = {
                  ExternalId: flag('--external-id'),
                  ParcelNumber: flag('--parcel'),
                  ReturnParcelNumber: flag('--return-parcel'),
                  ExternalOrderStatus: extStatus != null && !Number.isNaN(Number(extStatus)) ? Number(extStatus) : undefined,
                };
              }
              await updateOrder(id, changes);
              logSuccess(`  ✓ Updated order ${id}`);
              break;
            }
            case 'cancel-row': {
              const orderId = subArgs[0]; const orderRowId = subArgs[1];
              if (!orderId || !orderRowId) { logError('  Usage: /order cancel-row <orderId> <orderRowId>'); break; }
              await cancelOrderRow(orderId, orderRowId);
              logSuccess(`  ✓ Cancelled row ${orderRowId} on order ${orderId}`);
              break;
            }
            case 'comment': {
              const id = subArgs[0];
              const text = subArgs.slice(1).filter((a) => a !== '--system').join(' ');
              if (!id || !text) { logError('  Usage: /order comment <id> <text> [--system]'); break; }
              await addOrderComment(id, text, { system: subArgs.includes('--system') });
              logSuccess(`  ✓ Added comment to order ${id}`);
              break;
            }
            case 'transaction': {
              const id = subArgs[0]; const transactionId = subArgs[1];
              if (!id || !transactionId) { logError('  Usage: /order transaction <id> <transactionId>'); break; }
              await setOrderTransaction(id, transactionId);
              logSuccess(`  ✓ Set transaction ${transactionId} on order ${id}`);
              break;
            }
            case 'set-paid': {
              const paymentDetailId = subArgs[0];
              if (!paymentDetailId) { logError('  Usage: /order set-paid <paymentDetailId>'); break; }
              await setPaymentPaid(paymentDetailId);
              logSuccess(`  ✓ Marked payment ${paymentDetailId} as paid`);
              break;
            }
            case 'delete': {
              const id = subArgs[0];
              if (!id) { logError('  Usage: /order delete <id>'); break; }
              await deleteOrder(id);
              logSuccess(`  ✓ Deleted order ${id}`);
              break;
            }
            case 'help':
              logText('');
              logText('  /order list [filters]    Query orders');
              logText('  /order get <id>          Show one order (UUID → by public id)');
              logText('  /order count <email>     Orders for a customer');
              logText('  /order statuses          List status codes');
              logText('  /order create --body \'<json>\'   Place an order');
              logText('  /order status <id> <status>     Change status');
              logText('  /order update <id> [--external-id <s>] [--parcel <s>] ...');
              logText('  /order cancel-row <orderId> <rowId> | comment <id> <text> | delete <id>');
              logText('');
              break;
            default:
              logError(`  Unknown subcommand: order ${sub}`);
              logDim('  Type /order help for available commands');
          }
          break;
        }

        case 'campaign': {
          const sub = args[0]?.toLowerCase() ?? 'list';
          const subArgs = args.slice(1);
          const spin = (label: string) => appState.setLiveComponent(
            <Box key="campaign-spinner" gap={1} paddingX={1}><Spinner type="dots" /><Text dimColor>{label}</Text></Box>,
          );
          const cFlag = (name: string) => { const i = subArgs.indexOf(name); return i !== -1 ? subArgs[i + 1] : undefined; };
          const cNum = (name: string) => { const v = cFlag(name); const n = v != null ? Number(v) : NaN; return Number.isNaN(n) ? undefined : n; };
          const cCollect = (name: string) => subArgs.flatMap((a, i) => (subArgs[i - 1] === name ? [a] : []));
          const readBody = (a: string[]): unknown => {
            const bi = a.indexOf('--body');
            if (bi !== -1 && a[bi + 1]) return JSON.parse(a[bi + 1]!);
            throw new Error("Provide --body '<json>' (use the direct CLI `geins campaign ...` for --file/stdin).");
          };
          switch (sub) {
            case 'list': {
              spin('Loading campaigns...');
              const campaigns = await listCampaigns();
              appState.setLiveComponent(null);
              if (campaigns.length === 0) { logDim('  No campaigns.'); break; }
              for (const c of campaigns) {
                const code = c.PromoCode ? `[${c.PromoCode}] ` : '';
                const bits = [c.Type, c.CampaignBaseType, c.Status].filter(Boolean).join(' · ');
                logText(`  ${code}${c.Title ?? '(untitled)'}${bits ? `  — ${bits}` : ''}`);
              }
              break;
            }
            case 'types': {
              spin('Loading campaign types...');
              const types = await getCampaignTypes();
              appState.setLiveComponent(null);
              if (types.length === 0) { logDim('  No campaign types.'); break; }
              for (const t of types) logText(`  ${t.Id}  ${t.Name}`);
              break;
            }
            case 'get': {
              const id = subArgs[0];
              if (!id) { logError('  Usage: /campaign get <id>'); break; }
              spin(`Fetching campaign ${id}...`);
              const c = await getCampaign(id);
              appState.setLiveComponent(null);
              logText(`  ${campaignLabel(c)}`);
              logDim(`  ${[c.Status, `base=${c.CampaignBaseType}`, `type=${c.CampaignTypeId}`].filter(Boolean).join(' · ')}`);
              if (c.PromoCode) logDim(`  Code: ${c.PromoCode}`);
              if (c.PercentageValue != null) logDim(`  Discount: ${c.PercentageValue}%`);
              if (c.Amounts && Object.keys(c.Amounts).length) {
                logDim(`  Amounts: ${Object.entries(c.Amounts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
              }
              logDim(`  Enabled: ${c.Enabled ? 'yes' : 'no'}`);
              break;
            }
            case 'create': {
              const hasFlags = subArgs.includes('--promocode');
              let body: CampaignWrite;
              if (subArgs.includes('--body')) {
                body = readBody(subArgs) as CampaignWrite;
              } else if (hasFlags) {
                const promoCode = cFlag('--promocode');
                const marketId = cFlag('--market');
                if (!promoCode || !marketId) {
                  logError("  Usage: /campaign create --promocode <CODE> --market <id> (--percentage <n> | --amount <CUR>:<n>) [--title <t> --lang <c>] [--from <iso>] [--to <iso>] [--usage-limit <n>] [--once-per-customer]");
                  break;
                }
                const amounts: Record<string, number> = {};
                for (const pair of cCollect('--amount')) {
                  const ci = pair.indexOf(':');
                  const cur = ci === -1 ? pair : pair.slice(0, ci);
                  const val = ci === -1 ? NaN : Number(pair.slice(ci + 1));
                  if (cur && !Number.isNaN(val)) amounts[cur.toUpperCase()] = val;
                }
                const titleText = cFlag('--title');
                body = buildPromoCodeCampaign({
                  promoCode,
                  marketId,
                  percentage: cNum('--percentage'),
                  amounts: Object.keys(amounts).length ? amounts : undefined,
                  title: titleText ? [{ Language: cFlag('--lang') ?? 'en', Value: titleText }] : undefined,
                  validFrom: cFlag('--from'),
                  validTo: cFlag('--to'),
                  usageLimit: cNum('--usage-limit'),
                  oncePerCustomer: subArgs.includes('--once-per-customer') ? true : undefined,
                  priority: cNum('--priority'),
                  enabled: subArgs.includes('--disabled') ? false : subArgs.includes('--enabled') ? true : undefined,
                });
              } else {
                logError("  Usage: /campaign create --promocode <CODE> --market <id> (--percentage <n> | --amount <CUR>:<n>) [...]  |  --body '<json>'");
                break;
              }
              spin('Creating campaign...');
              try {
                const campaign = await createCampaign(body);
                appState.setLiveComponent(null);
                logSuccess(`  ✓ Created campaign ${campaignLabel(campaign)}`);
                if (campaign.PromoCode) logDim(`  Code: ${campaign.PromoCode}`);
              } catch (err) { appState.setLiveComponent(null); throw err; }
              break;
            }
            case 'help':
              logText('');
              logText('  /campaign list                  List campaigns');
              logText('  /campaign types                 Discount type ids (3=Percentage, 4=Fixed amount)');
              logText('  /campaign get <id>              Show one campaign');
              logText('  /campaign create --promocode <CODE> --market <id> --percentage <n>   Promocode campaign');
              logText("  /campaign create ... --amount <CUR>:<n>   Fixed-amount discount  |  --body '<json>'");
              logText('');
              break;
            default:
              logError(`  Unknown subcommand: campaign ${sub}`);
              logDim('  Type /campaign help for available commands');
          }
          break;
        }

        case 'merchant': {
          const sub = args[0]?.toLowerCase() ?? '';
          const subArgs = args.slice(1);
          const mFlag = (name: string): string | undefined => {
            const idx = args.indexOf(name);
            return idx !== -1 ? args[idx + 1] : undefined;
          };
          const mJsonFlag = (name: string): unknown => {
            const v = mFlag(name);
            if (v === undefined) return undefined;
            return JSON.parse(v.startsWith('@') ? readFileSync(v.slice(1), 'utf-8') : v);
          };
          const mIntList = (name: string): number[] | undefined => {
            const v = mFlag(name);
            return v ? v.split(',').map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)) : undefined;
          };
          const mRedirects = (): CheckoutRedirects | undefined => {
            const r: CheckoutRedirects = {};
            if (mFlag('--terms')) r.terms = mFlag('--terms');
            if (mFlag('--privacy')) r.privacy = mFlag('--privacy');
            if (mFlag('--success')) r.success = mFlag('--success');
            if (mFlag('--cancel')) r.cancel = mFlag('--cancel');
            if (mFlag('--continue')) r.continue = mFlag('--continue');
            return Object.keys(r).length ? r : undefined;
          };
          const mCustomerType = (): CustomerType | undefined => {
            const c = mFlag('--customer-type')?.toLowerCase();
            return c === 'organization' ? 'ORGANIZATION' : c === 'person' ? 'PERSON' : undefined;
          };
          const overrides: ContextOverrides = {
            channel: mFlag('--channel'),
            tld: mFlag('--tld'),
            market: mFlag('--market'),
            locale: mFlag('--locale'),
            accountName: mFlag('--store-account'),
            environment: mFlag('--environment') as ContextOverrides['environment'],
          };

          if (sub === '' || sub === 'help') {
            logText('');
            logText('  Merchant commands (Merchant API · GraphQL)');
            logText('');
            logText('  /merchant config [set ...]        Show/set storefront context (per api-key profile)');
            logText('  /merchant product search [text]   Search products for sale  [--category --brand --take]');
            logText('  /merchant product <id|term>       Product detail');
            logText('  /merchant categories | brands     Catalog for filtering by alias');
            logText('  /merchant cart create             Create a cart');
            logText('  /merchant cart get <id>           Show a cart');
            logText('  /merchant cart add <id> --sku <s> [--qty N]');
            logText('  /merchant cart update <id> --item <i> --qty N');
            logText('  /merchant cart remove <id> --item <i>');
            logText('  /merchant cart promo <id> <code>');
            logText('  /merchant token <cartId> [--url]  Checkout token (--url = full checkout link)');
            logText('      [--success/--cancel/--terms/--privacy <url>] [--payment <id>] [--branding <json>]');
            logText('');
            logDim('  Requires /apikey set + /merchant config set --channel <c> --tld <t> --market <m> --locale <l> --store-account <slug>');
            logDim('  Persist checkout defaults: /merchant config set --success <url> --terms <url> --default-payment <id> ...');
            logText('');
            break;
          }

          if (sub === 'config') {
            if (subArgs[0]?.toLowerCase() === 'set') {
              const ctxPatch = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
              const cur = await loadCredentials();
              const urls = mRedirects();
              const branding = mJsonFlag('--branding') as CheckoutBranding | undefined;
              const dp = mFlag('--default-payment');
              const ds = mFlag('--default-shipping');
              const ct = mCustomerType();
              const hasCheckout = !!(urls || branding || dp || ds || ct);
              let checkout: StoredCheckoutDefaults | undefined;
              if (hasCheckout) {
                checkout = { ...(cur?.checkout ?? {}) };
                if (urls) checkout.redirectUrls = { ...cur?.checkout?.redirectUrls, ...urls };
                if (branding) checkout.branding = branding as StoredCheckoutDefaults['branding'];
                if (dp) checkout.defaultPaymentId = Number(dp);
                if (ds) checkout.defaultShippingId = Number(ds);
                if (ct) checkout.customerType = ct;
              }
              const patch = { ...ctxPatch, ...(hasCheckout ? { checkout } : {}) };
              if (Object.keys(patch).length === 0) {
                logError('  Usage: /merchant config set [--channel <c>] [--tld <t>] [--market <m>] [--locale <l>] [--store-account <slug>] [--environment prod|qa|dev]');
                logDim('  checkout defaults: [--success/--cancel/--continue/--terms/--privacy <url>] [--default-payment <id>] [--default-shipping <id>] [--customer-type person|organization] [--branding <json>]');
                break;
              }
              const name = await updateActiveCredentials(patch);
              if (!name) { logError('  No active api-key profile. Run /apikey add first.'); break; }
              logSuccess(`  ✓ Merchant context saved on '${name}'.`);
            }
            const ctx = await resolveMerchantContext(overrides);
            logText(`  account-name: ${ctx.accountName ?? '(unset)'}`);
            logText(`  channel/tld:  ${ctx.channel ?? '(unset)'} / ${ctx.tld ?? '(unset)'}`);
            logText(`  market:       ${ctx.market ?? '(unset)'}`);
            logText(`  locale:       ${ctx.locale ?? '(unset)'}`);
            logText(`  environment:  ${ctx.environment}`);
            const cd = ctx.checkoutDefaults;
            if (cd && Object.keys(cd).length > 0) {
              logText('  checkout defaults:');
              if (cd.defaultPaymentId != null) logText(`    payment:  ${cd.defaultPaymentId}`);
              if (cd.defaultShippingId != null) logText(`    shipping: ${cd.defaultShippingId}`);
              if (cd.customerType) logText(`    customer: ${cd.customerType}`);
              for (const [k, v] of Object.entries(cd.redirectUrls ?? {})) logText(`    ${k}: ${v}`);
              if (cd.branding) logText(`    branding: ${JSON.stringify(cd.branding)}`);
            }
            break;
          }

          // `token parse` is pure offline decoding — no credentials/context needed.
          if (sub === 'token' && subArgs[0]?.toLowerCase() === 'parse') {
            if (!subArgs[1]) { logError('  Usage: /merchant token parse <token>'); break; }
            logText(`  ${JSON.stringify(parseCheckoutToken(subArgs[1]), null, 2)}`);
            break;
          }

          appState.setLiveComponent(
            <Box key="merchant-spinner" gap={1} paddingX={1}>
              <Spinner type="dots" />
              <Text dimColor>Querying Merchant API...</Text>
            </Box>,
          );
          try {
            const ctx = await resolveMerchantContext(overrides);
            switch (sub) {
              case 'product': {
                if (subArgs[0]?.toLowerCase() === 'search') {
                  const term = subArgs.slice(1).find((a) => !a.startsWith('--'));
                  const result = await searchProducts(
                    {
                      searchText: term,
                      categoryAlias: mFlag('--category'),
                      brandAlias: mFlag('--brand'),
                      take: mFlag('--take') ? Number(mFlag('--take')) : undefined,
                      skip: mFlag('--skip') ? Number(mFlag('--skip')) : undefined,
                    },
                    ctx,
                  );
                  appState.setLiveComponent(null);
                  for (const p of result.products ?? []) logText(`  ${productLine(p)}`);
                  if (result.count !== undefined) logDim(`  ${result.count} products`);
                } else {
                  const idOrTerm = subArgs[0];
                  if (!idOrTerm) { appState.setLiveComponent(null); logError('  Usage: /merchant product <id|term> | /merchant product search [text]'); break; }
                  const product = await getMerchantProduct(idOrTerm, ctx);
                  appState.setLiveComponent(null);
                  if (!product) { logDim('  No product found.'); break; }
                  logText(`  ${productLine(product)}`);
                  if (product.alias) logDim(`  ${product.alias}`);
                }
                break;
              }
              case 'categories':
              case 'category': {
                const cats = await listMerchantCategories();
                appState.setLiveComponent(null);
                for (const c of cats) logText(`  ${c.name ?? ''}${c.alias ? `  (${c.alias})` : ''}`);
                logDim(`  ${cats.length} categories`);
                break;
              }
              case 'brands':
              case 'brand': {
                const brands = await listMerchantBrands();
                appState.setLiveComponent(null);
                for (const b of brands) logText(`  ${b.name ?? ''}${b.alias ? `  (${b.alias})` : ''}`);
                logDim(`  ${brands.length} brands`);
                break;
              }
              case 'cart': {
                const action = subArgs[0]?.toLowerCase() ?? '';
                let cart;
                if (action === 'create') {
                  cart = await createCart(ctx);
                  appState.setLiveComponent(null);
                  logSuccess(`  ✓ Cart created`);
                  logText(`  ${cart.id}`);
                  break;
                } else if (action === 'get') {
                  if (!subArgs[1]) { appState.setLiveComponent(null); logError('  Usage: /merchant cart get <id>'); break; }
                  cart = await getCart(subArgs[1], ctx);
                } else if (action === 'add') {
                  const id = subArgs[1]; const sku = mFlag('--sku');
                  if (!id || !sku) { appState.setLiveComponent(null); logError('  Usage: /merchant cart add <id> --sku <skuId> [--qty N]'); break; }
                  cart = await addToCart(id, { skuId: Number(sku), quantity: mFlag('--qty') ? Number(mFlag('--qty')) : 1 }, ctx);
                } else if (action === 'update') {
                  const id = subArgs[1]; const item = mFlag('--item'); const qty = mFlag('--qty');
                  if (!id || !item || qty === undefined) { appState.setLiveComponent(null); logError('  Usage: /merchant cart update <id> --item <itemId> --qty <n>'); break; }
                  cart = await updateCartItem(id, { id: item, quantity: Number(qty) }, ctx);
                } else if (action === 'remove') {
                  const id = subArgs[1]; const item = mFlag('--item');
                  if (!id || !item) { appState.setLiveComponent(null); logError('  Usage: /merchant cart remove <id> --item <itemId>'); break; }
                  cart = await removeFromCart(id, item, ctx);
                } else if (action === 'promo') {
                  const id = subArgs[1]; const code = subArgs[2];
                  if (!id || !code) { appState.setLiveComponent(null); logError('  Usage: /merchant cart promo <id> <code>'); break; }
                  cart = await setCartPromoCode(id, code, ctx);
                } else {
                  appState.setLiveComponent(null);
                  logError('  Usage: /merchant cart [create | get <id> | add <id> --sku <s> | update <id> --item <i> --qty N | remove <id> --item <i> | promo <id> <code>]');
                  break;
                }
                appState.setLiveComponent(null);
                for (const line of cartLines(cart)) logText(`  ${line}`);
                break;
              }
              case 'token': {
                // `token parse` is handled earlier (offline, no context).
                appState.setLiveComponent(null);
                const cartId = subArgs[0];
                if (!cartId) { logError('  Usage: /merchant token <cartId> [--url] [--success <url>] [--payment <id>] ...'); break; }
                const opts: CheckoutTokenOptions = {
                  cartId,
                  selectedPaymentMethodId: mFlag('--payment') ? Number(mFlag('--payment')) : undefined,
                  selectedShippingMethodId: mFlag('--shipping') ? Number(mFlag('--shipping')) : undefined,
                  availablePaymentMethodIds: mIntList('--available-payments'),
                  availableShippingMethodIds: mIntList('--available-shipping'),
                  customerType: mCustomerType(),
                  isCartEditable: args.includes('--editable') ? true : undefined,
                  copyCart: args.includes('--no-copy') ? false : undefined,
                  redirectUrls: mRedirects(),
                  branding: mJsonFlag('--branding') as CheckoutBranding | undefined,
                  user: mJsonFlag('--user') as Record<string, unknown> | undefined,
                };
                const token = buildCheckoutToken(opts, ctx);
                logSuccess('  ✓ Checkout token');
                if (args.includes('--url')) logText(`  https://checkout.geins.services/${token}`);
                else logText(`  ${token}`);
                break;
              }
              default:
                appState.setLiveComponent(null);
                logError(`  Unknown subcommand: merchant ${sub}`);
                logDim('  Type /merchant help for available commands');
            }
          } catch (err) {
            appState.setLiveComponent(null);
            logError(`  ${formatError(err)}`);
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

        case 'provider': {
          // In copilot mode, /provider mirrors /copilot provider — open the provider picker.
          if (appState.copilotActive) {
            appState.setActiveMode('select-copilot');
            break;
          }
          logDim('  Copilot mode is not active. Run /copilot to enable it.');
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
          clearToWelcome();
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
            // Start fresh for the account the user is CURRENTLY on. Re-resolve the memory
            // bucket first so a mid-session `/apikey use` switch can't leave us pointed at a
            // stale account — clear must only ever wipe the active account's bucket.
            await applyMemoryAccount();
            clearConversationHistory();
            await clearHistory();
            await clearCommandContext();
            await clearKnowledge();
            clearToWelcome();
            const who = appState.status.accountName || appState.status.account || 'shared';
            logSuccess(`  ✓ Memory cleared for ${who} — starting fresh`);
            break;
          }
          if (sub === 'add') {
            const category = args[1]?.toLowerCase();
            const text = args.slice(2).join(' ').trim();
            const cats = ['project', 'workflow', 'api', 'preference', 'pattern'] as const;
            if (!category || !(cats as readonly string[]).includes(category) || !text) {
              logDim('  Usage: /memory add <project|workflow|api|preference|pattern> <fact>');
              break;
            }
            if (category === 'preference') await setPreference(text, 'true');
            else await addFact({ category: category as typeof cats[number], content: text, confidence: 0.8, source: 'cli' });
            logSuccess(`  ✓ Remembered (${category})`);
            break;
          }
          if (sub === 'export') {
            const file = await exportMemory(args[1] === '--json' ? 'json' : 'md');
            logSuccess(`  ✓ Exported memory to ${file}`);
            break;
          }
          if (sub === 'on' || sub === 'off') {
            await setMemoryEnabled(sub === 'on');
            logSuccess(`  ✓ Copilot memory ${sub === 'on' ? 'enabled' : 'disabled'}`);
            break;
          }
          if (sub === 'status') {
            logText(`  Copilot memory is ${(await getMemoryEnabled()) ? 'on' : 'off'}`);
            break;
          }
          const kb = await loadKnowledge();
          if (kb.entities.length === 0 && kb.patterns.length === 0 && Object.keys(kb.preferences).length === 0 && kb.interactions.length === 0) {
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
              logText(v === 'true' ? `    ${k}` : `    ${k}: ${v}`);
            }
          }
          if (kb.interactions.length > 0) {
            logText(`  Recent Q&A (${kb.interactions.length}):`);
            for (const i of kb.interactions.slice(0, 5)) {
              logText(`    Q: ${i.prompt}`);
              logDim(`    A: ${i.summary}`);
            }
          }
          break;
        }

        case 'clear':
          clearToWelcome(); // full reset: wiped screen + fresh welcome banner, like app start
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
      setWorking(false);
      setActiveSignal(undefined);
      abortRef.current = null;
      // Clear any lingering working/live indicator once the command (or copilot turn) is done.
      appState.setLiveComponent(null);
    }
  }, [appState, logText, logDim, logSuccess, logError, exit, clearToWelcome]);

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
        epoch={appState.historyEpoch}
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
          onSelect={switchingAccountRef.current ? handleAccountSwitchSelected : handleAccountSelected}
          onCancel={switchingAccountRef.current ? handleAccountSwitchCancel : () => handleAccountSelected(appState.pendingAuth!.accounts![0]!.accountKey)}
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

      {appState.activeMode === 'confirm' && confirmRef.current && (
        <Confirm
          message={confirmRef.current.message}
          onYes={handleConfirmYes}
          onNo={handleConfirmNo}
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
