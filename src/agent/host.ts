// One Studio agent session per Studio tab connected to /agent. The host owns
// the tab protocol: the Studio session, the in-tab ui tools, approvals and
// questions, reset and provider switching. The agent itself runs in a harness
// (harness/claude.ts, harness/codex.ts).
//
// The agent reaches Studio data through Studio's own MCP endpoint (/api/mcp),
// but via a local proxy route (/studio-mcp/<secret>) so the tab's access token
// never enters the agent process, and a token refresh in the tab applies to
// the very next tool call without reconfiguring the session. The ui tools are
// likewise served at /ui-mcp/<secret> for harnesses that only speak MCP.
import { mkdir } from 'node:fs/promises';
import { WORKSPACE, SYSTEM_PROMPT, accountPrompt, describePage, type StudioCredentials } from './context.ts';
import { handleUiMcpRequest, type UiCall } from './ui-mcp.ts';
import { sonoraEnv, sonoraProfileForAccount } from './sonora.ts';
import { createClaudeHarness } from './harness/claude.ts';
import { createCodexHarness } from './harness/codex.ts';
import { availableProviders, signIn } from './providers.ts';
import type { Harness, HarnessContext } from './harness/types.ts';
import type {
  AgentClientMessage,
  AgentPermissionMode,
  AgentProvider,
  AgentQuestion,
  AgentServerMessage,
} from './protocol.ts';

export type { StudioCredentials } from './context.ts';

const UI_CALL_TIMEOUT_MS = 15_000;

/** secret → a live session's Studio credentials and tab bridge, for the local MCP routes. */
const agentSessions = new Map<
  string,
  { studioUrl: string; credentials: () => StudioCredentials | undefined; uiCall: UiCall }
>();

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void };

export interface AgentSession {
  handle(message: AgentClientMessage): void;
  close(): void;
}

export function startAgentSession(
  send: (message: AgentServerMessage) => void,
  {
    studioUrl,
    localBaseUrl,
    full,
    permissionMode: initialMode,
    provider: initialProvider,
    onProviderChange,
  }: {
    studioUrl: string;
    localBaseUrl: string;
    /**
     * Run with the user's own setup (Claude Code / Codex config, plugins, MCP
     * servers) and every built-in tool, Bash included. For the user's own machine.
     */
    full: boolean;
    /** Starting mode; the tab can switch it at any time. */
    permissionMode: AgentPermissionMode;
    provider: AgentProvider;
    /** Persist the user's pick for the next session. */
    onProviderChange?: (provider: AgentProvider) => void;
  },
): AgentSession {
  let permissionMode = initialMode;
  let provider = initialProvider;
  const secret = crypto.randomUUID();
  const pendingUi = new Map<string, Pending>();
  const pendingApprovals = new Map<string, (allow: boolean) => void>();
  const pendingQuestions = new Map<string, (answers?: Record<string, string>) => void>();
  let credentials: StudioCredentials | undefined;
  let harness: Harness | undefined;
  let starting: Promise<void> | undefined;
  // Bumped by every reset or provider switch: events from a replaced harness are dropped.
  let generation = 0;
  /** The user's model pick per provider; kept across resets. */
  const models: Partial<Record<AgentProvider, string>> = {};
  let closed = false;

  const uiCall: UiCall = (tool, toolInput) =>
    new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pendingUi.delete(id);
        reject(new Error('The Studio tab did not answer in time'));
      }, UI_CALL_TIMEOUT_MS);
      pendingUi.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      send({ type: 'ui_call', id, tool, input: toolInput });
    });

  agentSessions.set(secret, { studioUrl, credentials: () => credentials, uiCall });

  const requestApproval = (tool: string, input: unknown, signal: AbortSignal) =>
    new Promise<boolean>((resolve) => {
      const id = crypto.randomUUID();
      const decide = (allow: boolean) => {
        pendingApprovals.delete(id);
        resolve(allow);
      };
      pendingApprovals.set(id, decide);
      signal.addEventListener('abort', () => decide(false), { once: true });
      send({ type: 'approval_request', id, tool, input });
    });

  const requestAnswers = (questions: AgentQuestion[], signal: AbortSignal) =>
    new Promise<Record<string, string> | undefined>((resolve) => {
      const id = crypto.randomUUID();
      const answer = (answers?: Record<string, string>) => {
        pendingQuestions.delete(id);
        resolve(answers);
      };
      pendingQuestions.set(id, answer);
      signal.addEventListener('abort', () => answer(), { once: true });
      send({ type: 'question_request', id, questions });
    });

  async function announceProviders() {
    send({ type: 'providers', providers: await availableProviders(), current: provider });
  }

  /** Starts the harness once there is a Studio session to act as. */
  function ensureStarted() {
    if (starting || !credentials || closed) return;
    const gen = generation;
    starting = start(credentials, gen).catch((err) => {
      if (gen !== generation) return;
      // Forget the failed start so the next message tries again.
      harness?.close();
      harness = undefined;
      starting = undefined;
      send({ type: 'error', message: `Could not start the agent: ${(err as Error).message ?? err}` });
      send({ type: 'status', state: 'ready' });
    });
  }

  async function start(account: StudioCredentials, gen: number) {
    await mkdir(WORKSPACE, { recursive: true });
    // Switching account in Studio reloads the page, which opens a new session,
    // so pinning the Sonora profile once per session is enough.
    const sonoraProfile = full ? await sonoraProfileForAccount(account.accountName) : undefined;
    if (gen !== generation) return;
    const context: HarnessContext = {
      send: (message) => {
        if (gen !== generation) return;
        // Claude Code can leave auto mode on its own; the next session starts from what the tab shows.
        if (message.type === 'permission_mode') permissionMode = message.mode;
        send(message);
      },
      full,
      permissionMode,
      model: models[provider],
      instructions: `${SYSTEM_PROMPT}\n${accountPrompt(account, sonoraProfile, full)}`,
      env: sonoraEnv(sonoraProfile),
      mcp: {
        studioUrl: `${localBaseUrl}/studio-mcp/${secret}`,
        uiUrl: `${localBaseUrl}/ui-mcp/${secret}`,
      },
      uiCall,
      onEnded: () => {
        if (gen !== generation) return;
        harness = undefined;
        starting = undefined;
      },
      requestApproval,
      requestAnswers,
    };
    harness = provider === 'codex' ? createCodexHarness(context) : createClaudeHarness(context);
    try {
      const list = await harness.models();
      if (gen === generation) send({ type: 'models', ...list });
    } catch {
      // No model list: the tab just hides the picker.
    }
  }

  /** Ends the current harness; anything waiting on the tab is let go. */
  function stopSession() {
    generation++;
    for (const pending of pendingUi.values()) pending.reject(new Error('Conversation ended'));
    for (const decide of pendingApprovals.values()) decide(false);
    for (const answer of pendingQuestions.values()) answer();
    harness?.close();
    harness = undefined;
    starting = undefined;
  }

  function restart() {
    stopSession();
    send({ type: 'status', state: 'ready' });
    ensureStarted();
  }

  void announceProviders();

  return {
    handle(message) {
      switch (message.type) {
        case 'auth':
          credentials = {
            accessToken: message.accessToken,
            accountKey: message.accountKey,
            accountName: message.accountName,
          };
          ensureStarted();
          break;
        case 'user_message':
          if (!credentials) {
            send({ type: 'error', message: 'Sign in to Studio first — no session was received.' });
            send({ type: 'status', state: 'ready' });
            return;
          }
          ensureStarted();
          send({ type: 'status', state: 'busy' });
          // The harness may still be starting; queue behind it.
          void (async () => {
            const gen = generation;
            await starting;
            if (gen === generation) harness?.prompt(`${describePage(message.page)}\n${message.text}`);
          })();
          break;
        case 'interrupt':
          harness?.interrupt();
          break;
        case 'set_provider':
          void (async () => {
            // Fresh: the user may have just installed it.
            const target = (await availableProviders({ fresh: true })).find((info) => info.id === message.provider);
            if (!target?.available) {
              send({ type: 'error', message: `${target?.name ?? message.provider} isn't installed on this computer.` });
            } else if (target.id !== provider) {
              provider = target.id;
              onProviderChange?.(provider);
              restart();
            }
            await announceProviders();
          })();
          break;
        case 'sign_in':
          void (async () => {
            const signedIn = await signIn(message.provider);
            if (!signedIn) {
              send({ type: 'error', message: 'Sign-in was not completed. Try again from the panel.' });
            } else if (message.provider === provider) {
              // A harness started while signed out keeps failing; start over.
              restart();
            }
            await announceProviders();
          })();
          break;
        case 'set_model':
          void (async () => {
            try {
              await harness?.setModel(message.model);
              models[provider] = message.model;
            } catch (err) {
              send({ type: 'error', message: `Could not switch model: ${(err as Error).message ?? err}` });
            }
            send({ type: 'model', model: models[provider] ?? 'default' });
          })();
          break;
        case 'reset':
          restart();
          break;
        case 'permission_mode':
          void (async () => {
            try {
              await harness?.setPermissionMode(message.mode);
              permissionMode = message.mode;
            } catch (err) {
              send({ type: 'error', message: `Could not switch to ${message.mode} mode: ${(err as Error).message ?? err}` });
            }
            send({ type: 'permission_mode', mode: permissionMode });
          })();
          break;
        case 'ui_result': {
          const pending = pendingUi.get(message.id);
          pendingUi.delete(message.id);
          if (message.error) pending?.reject(new Error(message.error));
          else pending?.resolve(message.result);
          break;
        }
        case 'approval':
          pendingApprovals.get(message.id)?.(message.allow);
          break;
        case 'question_answer':
          pendingQuestions.get(message.id)?.(message.answers);
          break;
      }
    },
    close() {
      closed = true;
      agentSessions.delete(secret);
      stopSession();
    },
  };
}

/** Forward one MCP request from the agent to Studio with the tab's current session. */
export async function proxyStudioMcp(req: Request, secret: string): Promise<Response> {
  const entry = agentSessions.get(secret);
  const creds = entry?.credentials();
  if (!entry || !creds) return new Response('Unknown or signed-out agent session', { status: 401 });
  const headers = new Headers({
    'content-type': req.headers.get('content-type') ?? 'application/json',
    accept: req.headers.get('accept') ?? 'application/json, text/event-stream',
    authorization: `Bearer ${creds.accessToken}`,
    'x-account-key': creds.accountKey,
  });
  const protocolVersion = req.headers.get('mcp-protocol-version');
  if (protocolVersion) headers.set('mcp-protocol-version', protocolVersion);
  const upstream = await fetch(`${entry.studioUrl}/api/mcp`, {
    method: req.method,
    headers,
    body: req.method === 'POST' ? await req.text() : undefined,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

/** The tab's ui tools over MCP, for harnesses without an in-process server. */
export async function proxyUiMcp(req: Request, secret: string): Promise<Response> {
  const entry = agentSessions.get(secret);
  if (!entry) return new Response('Unknown agent session', { status: 401 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  return handleUiMcpRequest(req, entry.uiCall);
}
