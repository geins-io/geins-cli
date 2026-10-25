// OpenAI Codex via its CLI, on the user's own Codex/ChatGPT sign-in. One
// `codex exec --json` process per turn; later turns resume the same thread.
// Codex has no approval callback or clarifying-question tool, so in this
// harness it runs inside its workspace-write sandbox with no prompts.
import { SUMMARY_MAX, WORKSPACE } from '../context.ts';
import { listCodexModels } from '../../commands/copilot.ts';
import type { Harness, HarnessContext } from './types.ts';

interface CodexItem {
  id: string;
  type: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: { content?: { type?: string; text?: string }[] } | null;
  error?: { message?: string } | null;
  query?: string;
  changes?: { path?: string; kind?: string }[];
}

type CodexEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed' }
  | { type: 'turn.failed'; error?: { message?: string } }
  | { type: 'error'; message?: string }
  | { type: 'item.started' | 'item.updated' | 'item.completed'; item: CodexItem };

/**
 * Absolute path to `codex`. Resolved up front because spawning with a custom
 * `env` on Windows loses the PATH lookup (the copied env has `Path`, not
 * `PATH`), so a bare `codex` fails with ENOENT.
 */
export function codexBinary(): string {
  return Bun.which('codex') ?? 'codex';
}

/** Whether `codex` is installed and runs; not cached, so installing it needs no helper restart. */
export async function isCodexAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn([codexBinary(), '--version'], { stdout: 'ignore', stderr: 'ignore' });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

/** The panel's tool card for a Codex item, named like the Claude tools. */
function describeItem(item: CodexItem): { name: string; input: unknown } | undefined {
  switch (item.type) {
    case 'mcp_tool_call':
      return { name: `mcp__${item.server}__${item.tool}`, input: item.arguments ?? {} };
    case 'command_execution':
      return { name: 'Bash', input: { command: item.command } };
    case 'web_search':
      return { name: 'WebSearch', input: { query: item.query } };
    case 'file_change':
      return { name: 'Edit', input: { files: item.changes?.map((change) => change.path) } };
    default:
      return undefined;
  }
}

function itemSummary(item: CodexItem): { isError: boolean; summary: string } {
  if (item.type === 'mcp_tool_call') {
    const text = item.error?.message ?? item.result?.content?.map((part) => part.text ?? '').join(' ') ?? '';
    return { isError: item.status === 'failed' || !!item.error, summary: text.slice(0, SUMMARY_MAX) };
  }
  if (item.type === 'command_execution') {
    return {
      isError: item.status === 'failed' || (item.exit_code ?? 0) !== 0,
      summary: (item.aggregated_output ?? '').slice(0, SUMMARY_MAX),
    };
  }
  if (item.type === 'file_change') {
    return {
      isError: item.status === 'failed',
      summary: (item.changes ?? []).map((change) => `${change.kind ?? 'update'} ${change.path}`).join(', '),
    };
  }
  return { isError: item.status === 'failed', summary: '' };
}

export function createCodexHarness(ctx: HarnessContext): Harness {
  const { send } = ctx;
  let model = ctx.model;
  let threadId: string | undefined;
  let current: ReturnType<typeof Bun.spawn> | undefined;
  let interrupted = false;
  let closed = false;
  const queue: string[] = [];

  function args(): string[] {
    // No quoted values: on Windows `codex` is a .cmd wrapper that re-parses
    // arguments. Unquoted -c values that aren't valid TOML are taken literally.
    const base = [
      '--json',
      '--skip-git-repo-check',
      '--cd',
      WORKSPACE,
      '--sandbox',
      'workspace-write',
      '-c',
      `mcp_servers.studio.url=${ctx.mcp.studioUrl}`,
      '-c',
      `mcp_servers.ui.url=${ctx.mcp.uiUrl}`,
    ];
    // Standard mode keeps the user's own Codex config (MCP servers, rules) out.
    if (!ctx.full) base.push('--ignore-user-config');
    if (model && model !== 'default') base.push('--model', model);
    // Options go before `resume`: the subcommand rejects --cd/--sandbox after it.
    const codex = codexBinary();
    return threadId
      ? [codex, 'exec', ...base, 'resume', threadId, '-']
      : [codex, 'exec', ...base, '-'];
  }

  async function runTurn(text: string) {
    try {
      await runTurnUnsafe(text);
    } catch (err) {
      current = undefined;
      if (closed) return;
      send({ type: 'turn_end', error: `Could not run Codex: ${(err as Error).message ?? err}` });
      send({ type: 'status', state: 'ready', sessionId: threadId });
    }
  }

  async function runTurnUnsafe(text: string) {
    interrupted = false;
    // Codex exec takes no system prompt; the first turn carries the guidance.
    const prompt = threadId ? text : `${ctx.instructions}\n\n${text}`;
    const proc = Bun.spawn(args(), {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...ctx.env },
    });
    current = proc;
    proc.stdin.write(prompt);
    proc.stdin.end();

    let finished = false;
    const stderr = new Response(proc.stderr).text();
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('{')) continue;
        let event: CodexEvent;
        try {
          event = JSON.parse(line) as CodexEvent;
        } catch {
          continue;
        }
        if (handle(event)) finished = true;
      }
    }
    const exitCode = await proc.exited;
    current = undefined;
    if (closed) return;
    if (!finished) {
      const detail = interrupted ? undefined : (await stderr).trim().split('\n').slice(-3).join(' ');
      send({ type: 'turn_end', error: interrupted ? undefined : detail || `codex exited with ${exitCode}` });
    }
    send({ type: 'status', state: 'ready', sessionId: threadId });
    const next = queue.shift();
    if (next !== undefined) void runTurn(next);
  }

  /** Forwards one event; true when it ended the turn. */
  function handle(event: CodexEvent): boolean {
    switch (event.type) {
      case 'thread.started':
        threadId = event.thread_id;
        return false;
      case 'item.started': {
        const tool = describeItem(event.item);
        if (tool) send({ type: 'tool_use', id: event.item.id, ...tool });
        return false;
      }
      case 'item.completed': {
        const { item } = event;
        if (item.type === 'agent_message' && item.text) {
          // Messages arrive whole; separate consecutive ones like paragraphs.
          send({ type: 'text', text: `${item.text}\n\n` });
          return false;
        }
        const tool = describeItem(item);
        if (!tool) return false;
        // Items that finish instantly (file changes) may skip item.started.
        if (item.type === 'file_change') send({ type: 'tool_use', id: item.id, ...tool });
        send({ type: 'tool_result', id: item.id, ...itemSummary(item) });
        return false;
      }
      case 'turn.completed':
        send({ type: 'turn_end' });
        return true;
      case 'turn.failed':
        send({ type: 'turn_end', error: event.error?.message ?? 'Codex turn failed' });
        return true;
      case 'error':
        send({ type: 'error', message: event.message ?? 'Codex error' });
        return false;
      default:
        return false;
    }
  }

  return {
    prompt(text) {
      if (current) queue.push(text);
      else void runTurn(text);
    },
    interrupt() {
      queue.length = 0;
      if (!current) return;
      interrupted = true;
      current.kill();
    },
    async models() {
      const slugs = await listCodexModels();
      return {
        models: [
          { value: 'default', displayName: 'Default', description: 'The model set in your Codex config' },
          ...slugs.map((slug) => ({ value: slug, displayName: slug })),
        ],
        current: model ?? 'default',
      };
    },
    async setModel(value) {
      model = value;
    },
    setPermissionMode() {
      return Promise.reject(new Error('Codex has no permission modes; it runs in its workspace sandbox.'));
    },
    close() {
      closed = true;
      queue.length = 0;
      current?.kill();
    },
  };
}
