import { loadConfig, saveConfig, type CopilotConfig } from '../config/store.ts';
import { getOutputDir, getAccountOutputDir, ensureOutputDir } from '../output/sink.ts';
import { existsSync, statSync } from 'node:fs';
import { getActiveSignal } from '../api/abort.ts';
import { $ } from 'bun';
import {
  appendMessage,
  loadRecentMessages,
  clearHistory,
  loadContext,
  trackApiResponse,
  buildContextPromptSection,
  loadKnowledge,
  buildKnowledgePromptSection,
  loadManifestCache,
  buildManifestPromptSection,
  buildApiReferencePromptSection,
  addFact,
  extractMemoryBlocks,
} from '../memory/index.ts';

export interface CopilotOption {
  name: string;
  cli: string;
  testCmd: string[];
  supportsModels?: boolean;
  supportsStreamJson?: boolean;
  contextWindow: number;
  buildCmd: (model?: string) => string[];
  useStdin: boolean;
}

export interface StreamEvent {
  kind: 'tool_start' | 'tool_end' | 'text';
  toolName?: string;
  label?: string;
  text?: string;
}

export const COPILOT_OPTIONS: CopilotOption[] = [
  {
    name: 'Claude Code',
    cli: 'claude',
    testCmd: ['claude', '--version'],
    contextWindow: 200000,
    supportsStreamJson: true,
    useStdin: true,
    buildCmd: () => ['claude', '-p', '--output-format', 'stream-json', '--verbose'],
  },
  {
    name: 'OpenAI Codex',
    cli: 'codex',
    testCmd: ['codex', '--version'],
    contextWindow: 128000,
    useStdin: true,
    buildCmd: () => ['codex', 'exec', '--ephemeral', '--skip-git-repo-check', '-'],
  },
  {
    name: 'Google Gemini CLI',
    cli: 'gemini',
    testCmd: ['gemini', '--version'],
    contextWindow: 1000000,
    useStdin: true,
    buildCmd: () => ['gemini', '-p', ''],
  },
  {
    name: 'Ollama',
    cli: 'ollama',
    testCmd: ['ollama', '--version'],
    supportsModels: true,
    contextWindow: 8000,
    useStdin: true,
    buildCmd: (model) => ['ollama', 'run', model ?? 'llama3.2'],
  },
  {
    name: 'LM Studio',
    cli: 'lms',
    testCmd: ['lms', 'version'],
    contextWindow: 8000,
    useStdin: true,
    buildCmd: () => ['lms', 'chat'],
  },
];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function clearConversationHistory(): void {
  clearHistory();
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}


const SYSTEM_CONTEXT = [
  'You are an autonomous CLI agent for Geins Commerce Backend.',
  'EVERYTHING the user asks is in the context of the Geins platform. There is no other context.',
  'When the user says "product", "order", "api", "create", "list", "run", "update",',
  '"send", "schedule", "trigger", "enable", "disable", or any other action — they mean via Geins.',
  'Never suggest external tools, scripts, cron jobs, or third-party services when Geins can do it.',
  'Workflows are just ONE Geins capability — do not reach for them unless the user explicitly asks',
  '(see WORKFLOWS below). Prefer the most direct command for the task.',
  '',
  'You DO NOT explain how to run commands — you RUN them by outputting them in ```bash code blocks.',
  'The system will automatically execute any geins command you output in a code block and return the result.',
  '',
  'Available commands:',
  '  geins whoami',
  '  geins workflow list',
  '  geins workflow get <id>',
  '  geins workflow create --body \'<json>\'',
  '  geins workflow update <id> --body \'<json>\'',
  '  geins workflow run <id> [--body \'<json>\']',
  '  geins workflow manifest',
  '  geins workflow logs <id>',
  '  geins workflow enable <id>',
  '  geins workflow disable <id>',
  '  geins workflow vars [list|get <name>|set <name> <value>]',
  '  geins product get <id> [--json]            — one product',
  '  geins product list [filters] [--json]      — query products (--brand --category --article --sellable --in-stock --page)',
  '  geins product items <id> [--json]          — a product\'s items (SKUs)',
  '  geins product variants <id> [--json]       — a product\'s variant group (sibling products + dimensions)',
  '  geins product variants labels [add <name>] — list/register variant dimension labels',
  '  geins product variants create [--name <n>] [--label <L>] [--product <id>:L=V,L=V] [--json]   — group existing products as variants',
  '  geins product images <id> [--json]         — list product images',
  '  geins product images add <id> <file|url> [--name <n>] [--primary] [--position <n>]   — upload an image (jpg/png/gif)',
  '  geins product images [delete|set-primary|reorder] <id> <imageName> [<pos>]   — manage images',
  '  geins product brands [list|get <id>|create --name <n> [--external-id <id>]|update <id>|delete <id>]   — brand registry',
  '  geins product categories [list|get <id>|create --name <code>:<text> [--parent <id>]|update <id>]   — category tree',
  '  geins product categories assign <productId> <categoryId>     — add a category to a product',
  '  geins product categories unassign <productId> <categoryId>   — remove a category from a product',
  '  geins product relation-types [list|add <name>|get <id>|update <id>|delete <id>]   — relation type registry',
  '  geins product relations <id> [--json]      — list a product\'s related products',
  '  geins product relations [link|unlink] <id> <relationTypeId> <relatedId...>   — relate/unrelate products',
  '  geins product help                         — full product command reference',
  '  geins order list [filters] [--json]        — query orders (--status --email --customer --market --page)',
  '  geins order get <idOrPublicId> [--json]    — one order (UUID → by public id)',
  '  geins order count <email>                  — order count for a customer',
  '  geins order statuses                       — list order status codes',
  '  geins order status <id> <status>           — change order status',
  '  geins order update <id> [--external-id <s>] [--parcel <s>] [--external-status <n>]   — partial update',
  '  geins order comment <id> <text> [--system] — add an order comment',
  '  geins order cancel-row <orderId> <orderRowId>   — cancel an order row',
  '  geins order create --body \'<json>\'        — place an order (Order body)',
  '  geins order help                           — full order command reference',
  '  geins management <METHOD> <path> [--body \'<json>\']',
  '  geins output [<dir> | status | off]',
  '',
  'FILE OUTPUT:',
  '- Your working directory IS the output folder shown below as "Output folder:". Write ALL files you',
  '  create there — a relative path like "products.csv" lands in it. Do not write files elsewhere.',
  '- That folder is either a fixed one set via `geins output <dir>`, or the directory geins was launched',
  '  from. geins command responses are also auto-dumped there as raw JSON.',
  '- geins only emits JSON. For derived formats (CSV, Markdown, a summary, a filtered subset), fetch with',
  '  the relevant geins command using --json, then USE YOUR OWN file tools (Bash, Write) to build the file.',
  '- Example (CSV of products): run `geins product list --json`, parse it, and Write "products.csv"',
  '  (a header row + one row per product) into the output folder.',
  '',
  'ATTACHED FILES — when the user drops/provides a local file path:',
  '- The message may start with an [ATTACHED FILES] section listing an absolute path + a short preview.',
  '  The user dropped a local file (CSV, JSON, spreadsheet export, plain text) — it is just DATA. Do',
  '  whatever the user asks with it; the operation is driven by their instruction, not by the file type.',
  '- ALWAYS read the FULL file from its absolute path with your file tools (Read/Bash) before acting —',
  '  the preview is only the first lines. Infer the columns/shape from the preview first.',
  '- If the user dropped a file with NO clear instruction (or an ambiguous one), do NOT guess: summarize',
  '  what the file contains (columns, row count, a sample) and ask what they want to do with it.',
  '- The intent can be anything. Common ones, as a guide (not a fixed menu):',
  '    · find / match — map rows to existing products by the strongest key available: article number',
  '      (`geins product list --article <n> --json`), id (`geins product get <id> --json`), then name/brand;',
  '      report matched vs unmatched rows.',
  '    · update — derive per-product changes from the file and apply via the right geins command',
  '      (`geins management PUT /API/Product/... --body \'<json>\'`, `geins product parameters set ...`, etc.).',
  '    · create / import — build new products/variants/relations/images from the rows.',
  '    · export / transform — produce a derived file (CSV, JSON, summary) in the output folder.',
  '    · compare / validate — diff the file against the catalog and report discrepancies.',
  '- Before any WRITE (update/create/delete/import), PROPOSE the changes first (show what will change) and',
  '  apply only AFTER the user confirms. Read-only tasks (find/export/compare) need no confirmation.',
  '- For large files, work in batches and summarize progress — do not paste the whole file back.',
  '',
  'WORKFLOWS — only when explicitly requested:',
  '- Do NOT create, update, or run workflows unless the user explicitly says "workflow" (or clearly asks',
  '  to automate/schedule something as a workflow). Editing products, querying data, managing images, etc.',
  '  must NOT spawn workflows as a side effect.',
  '- For one-off data tasks (get/fetch/show/list/export), use the direct commands (geins product ...,',
  '  geins management ...) — never wrap them in a workflow unless asked.',
  '',
  'INTENT MAPPING — map user intent to Geins operations:',
  '  "create a workflow" → geins workflow create',
  '  "send email / notify / alert as a workflow" → workflow with email action node',
  '  "every morning / schedule / cron as a workflow" → scheduled trigger workflow',
  '  "when X happens / on event as a workflow" → event trigger workflow',
  '  "get / fetch / show data" → direct geins command (geins product ..., geins management ...)',
  '  "list / show workflows" → geins workflow list',
  '  "which products could be variants / group these as variants" → run geins product list --json,',
  '    find candidate families (similar names/article numbers, same brand, differing by color/size) that',
  '    are NOT already grouped (verify with geins product variants <id>), then propose grouping them and,',
  '    if confirmed, geins product variants create (labels must be registered first via variants labels add).',
  '  "suggest relations / what should relate to X / find accessories|cross-sells|similar products" →',
  '    run geins product relation-types list (the available kinds, e.g. Accessories/CrossSell) and',
  '    geins product list --json, reason about which products go together (complements, accessories,',
  '    same family, frequently-bought-together), and PROPOSE the links — show product → relatedProduct',
  '    under a relation type. Only after the user confirms, apply with geins product relations link',
  '    <productId> <relationTypeId> <relatedId...>. If a suitable relation type does not exist, suggest',
  '    creating one with geins product relation-types add <name> first. Verify existing links with',
  '    geins product relations <id> before proposing duplicates.',
  '',
  'RULES:',
  '- ALWAYS output commands in ```bash blocks. Never tell the user to run them manually.',
  '- To create a workflow, output: geins workflow create --body \'<full JSON>\'',
  '- If you need information first (e.g. manifest, existing workflows), run those commands first.',
  '- ALWAYS fetch the manifest (geins workflow manifest) before creating a workflow — you need it to know available actions, triggers, and node types.',
  '- Global variables in workflows: {{vars.variableName}}',
  '- Keep responses concise. Act, don\'t explain.',
  '- Write any files you create into the output folder (your working directory) — see FILE OUTPUT.',
  '- If you learn something notable about this project, workflows, or user preferences, output it as: [MEMORY]category:fact[/MEMORY] where category is one of: project, workflow, api, preference, pattern.',
].join('\n');

function getMaxPromptTokens(option?: CopilotOption): number {
  const ctx = option?.contextWindow ?? 8000;
  return Math.floor(ctx * 0.75);
}

async function buildFullPrompt(userMessage: string, option?: CopilotOption): Promise<string> {
  const maxTokens = getMaxPromptTokens(option);
  const systemTokens = estimateTokens(SYSTEM_CONTEXT);
  const userMsgText = userMessage ? `User: ${userMessage}` : '';
  const userMsgTokens = estimateTokens(userMsgText);

  const [ctx, kb, manifestCache] = await Promise.all([loadContext(), loadKnowledge(), loadManifestCache()]);
  const contextSection = buildContextPromptSection(ctx);
  const knowledgeSection = buildKnowledgePromptSection(kb, {
    contextWindow: option?.contextWindow,
  });
  const manifestSection = buildManifestPromptSection(manifestCache);
  const contextTokens = estimateTokens(contextSection);
  const knowledgeTokens = estimateTokens(knowledgeSection);
  const manifestTokens = estimateTokens(manifestSection);

  const apiRefBudget = Math.min(4000, Math.floor(maxTokens * 0.15));
  const apiRefSection = buildApiReferencePromptSection(userMessage, apiRefBudget);
  const apiRefTokens = estimateTokens(apiRefSection);

  const historyBudget = maxTokens - systemTokens - userMsgTokens - contextTokens - knowledgeTokens - manifestTokens - apiRefTokens;
  const recentMessages = await loadRecentMessages(Math.max(0, historyBudget));
  const historyParts = recentMessages.map(
    msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
  );

  const outDir = await getOutputDir();
  // Show the account-nested folder (the copilot's actual cwd), not the un-nested base.
  const effectiveDir = (await getAccountOutputDir()) ?? process.cwd();
  const outputSection = outDir
    ? `Output folder: ${effectiveDir}`
    : `Output folder: ${effectiveDir} (the directory geins was launched from; set a fixed one with \`geins output <dir>\`)`;

  const parts = [SYSTEM_CONTEXT, outputSection];
  if (knowledgeSection) parts.push(knowledgeSection);
  if (manifestSection) parts.push(manifestSection);
  if (apiRefSection) parts.push(apiRefSection);
  if (contextSection) parts.push(contextSection);
  parts.push(...historyParts);
  if (userMsgText) parts.push(userMsgText);
  return parts.join('\n\n');
}

export async function testCli(option: CopilotOption): Promise<{ ok: boolean; version: string }> {
  try {
    const proc = Bun.spawn(option.testCmd, {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return { ok: true, version: output.trim().split('\n')[0] ?? '' };
    }
    return { ok: false, version: '' };
  } catch {
    return { ok: false, version: '' };
  }
}

export async function listOllamaModels(): Promise<string[]> {
  try {
    const proc = Bun.spawn(['ollama', 'list'], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return [];
    return output.trim().split('\n').slice(1)
      .map(line => line.split(/\s+/)[0]!)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function saveCopilotChoice(option: CopilotOption, model?: string): Promise<void> {
  const config = await loadConfig();
  config.copilot = { cli: option.cli, command: option.name, model };
  await saveConfig(config);
}

export async function getCopilotConfig(): Promise<CopilotConfig | null> {
  const config = await loadConfig();
  return config.copilot ?? null;
}

export function getCopilotOption(cli: string): CopilotOption | undefined {
  return COPILOT_OPTIONS.find(o => o.cli === cli);
}

export async function getContextUsageAsync(): Promise<{ used: number; total: number; percent: number }> {
  const config = await getCopilotConfig();
  const option = config ? getCopilotOption(config.cli) : undefined;
  const total = option?.contextWindow ?? 8000;
  const fullPrompt = await buildFullPrompt('', option);
  const used = estimateTokens(fullPrompt);
  const percent = Math.min(100, Math.round((used / total) * 100));
  return { used, total, percent };
}

function extractResultFromStreamJson(output: string): string {
  const lines = output.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]!);
      if (event.type === 'result' && typeof event.result === 'string') {
        return event.result;
      }
    } catch {}
  }
  let lastText = '';
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) lastText = block.text;
        }
      }
    } catch {}
  }
  return lastText;
}

/**
 * Run the copilot inside the configured output folder so any file it writes lands
 * there by default, and propagate the absolute output dir to geins subprocesses it
 * runs (so their dumps are written to the same place, not re-resolved relatively).
 */
async function copilotProcOptions(): Promise<{ cwd: string; env: Record<string, string | undefined> }> {
  // cwd is the account-nested dir so files the copilot writes itself land in the account
  // folder; GEINS_OUTPUT_DIR carries the UN-nested base so geins subprocesses re-nest once
  // (to the same place) rather than double-nesting under <base>/<account>/<account>.
  const baseDir = await getOutputDir();
  const accountDir = await ensureOutputDir();
  return {
    cwd: accountDir ?? process.cwd(),
    env: baseDir ? { ...process.env, GEINS_OUTPUT_DIR: baseDir } : { ...process.env },
  };
}

export async function chat(prompt: string): Promise<string> {
  const config = await getCopilotConfig();
  if (!config) throw new Error('No copilot configured. Run /copilot to set one up.');

  const option = getCopilotOption(config.cli);
  if (!option) throw new Error(`Unknown copilot CLI: ${config.cli}`);

  const isStreamJson = option.supportsStreamJson;
  await appendMessage({ role: 'user', content: prompt, provider: config.cli, model: config.model });
  // Always include conversation history: each copilot invocation is a stateless
  // one-shot spawn (e.g. `claude -p`), so prior turns and tool results only reach
  // the model if they're in the prompt. Omitting them broke multi-step flows where
  // a follow-up references "the command results" / "my original question".
  const fullPrompt = await buildFullPrompt(prompt, option);
  const cmd = option.buildCmd(config.model);

  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
    ...(await copilotProcOptions()),
  });

  proc.stdin.write(fullPrompt);
  proc.stdin.end();

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Copilot exited with code ${exitCode}: ${stderr.trim()}`);
  }

  const cleaned = isStreamJson ? extractResultFromStreamJson(output) : output.trim();
  await appendMessage({ role: 'assistant', content: cleaned, provider: config.cli, model: config.model });
  await processMemoryBlocks(cleaned);
  return cleaned;
}

interface RawStreamEvent {
  type: 'tool_use' | 'tool_result' | 'text';
  toolName?: string;
  toolInput?: Record<string, unknown>;
  text?: string;
}

function parseStreamJsonLine(line: string): RawStreamEvent | null {
  try {
    const event = JSON.parse(line);
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'tool_use') {
          return { type: 'tool_use', toolName: block.name, toolInput: block.input };
        }
        if (block.type === 'text' && block.text) {
          return { type: 'text', text: block.text };
        }
      }
    }
    if (event.type === 'user' && event.tool_use_result) {
      return { type: 'tool_result' };
    }
    if (event.type === 'result' && typeof event.result === 'string') {
      return { type: 'text', text: event.result };
    }
  } catch {}
  return null;
}

function shortenPath(p: string): string {
  const home = process.env.HOME ?? '';
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  const cwd = process.cwd();
  if (p.startsWith(cwd + '/')) return p.slice(cwd.length + 1);
  return p;
}

function formatToolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return `Read ${shortenPath(String(input.file_path ?? 'file'))}`;
    case 'Edit': return `Edit ${shortenPath(String(input.file_path ?? 'file'))}`;
    case 'Write': return `Write ${shortenPath(String(input.file_path ?? 'file'))}`;
    case 'Bash': {
      const cmd = typeof input.command === 'string' ? input.command : 'command';
      const desc = typeof input.description === 'string' ? input.description : null;
      return desc || cmd.slice(0, 100);
    }
    case 'Grep': return `Search for "${input.pattern ?? ''}"`;
    case 'Glob': return `Find files: ${input.pattern ?? ''}`;
    case 'WebSearch': return `Search web: ${input.query ?? ''}`;
    case 'WebFetch': return `Fetch ${input.url ?? ''}`;
    case 'TodoWrite': return 'Update tasks';
    case 'Agent': return `Spawn agent: ${input.description ?? input.subagent_type ?? ''}`;
    default: return name;
  }
}

/**
 * Kill a spawned process if the ambient operation is cancelled (Ctrl-C in the TUI).
 * The listener is one-shot and tied to the per-operation signal, which is dropped when
 * the operation ends, so there's nothing to clean up.
 */
function killOnAbort(proc: { kill: () => void }): void {
  const signal = getActiveSignal();
  if (!signal) return;
  const kill = () => { try { proc.kill(); } catch { /* already gone */ } };
  if (signal.aborted) kill();
  else signal.addEventListener('abort', kill, { once: true });
}

export async function chatStream(
  prompt: string,
  onChunk: (text: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<string> {
  const config = await getCopilotConfig();
  if (!config) throw new Error('No copilot configured. Run /copilot to set one up.');

  const option = getCopilotOption(config.cli);
  if (!option) throw new Error(`Unknown copilot CLI: ${config.cli}`);

  await appendMessage({ role: 'user', content: prompt, provider: config.cli, model: config.model });
  const isStreamJson = option.supportsStreamJson;
  // Always include conversation history: each copilot invocation is a stateless
  // one-shot spawn (e.g. `claude -p`), so prior turns and tool results only reach
  // the model if they're in the prompt. Omitting them broke multi-step flows where
  // a follow-up references "the command results" / "my original question".
  const fullPrompt = await buildFullPrompt(prompt, option);
  const cmd = option.buildCmd(config.model);

  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
    ...(await copilotProcOptions()),
  });
  killOnAbort(proc);

  proc.stdin.write(fullPrompt);
  proc.stdin.end();

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  if (isStreamJson) {
    let lineBuf = '';
    let lastText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuf += decoder.decode(value, { stream: true });
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const raw = parseStreamJsonLine(line);
        if (!raw) continue;
        if (raw.type === 'text' && raw.text) {
          lastText = raw.text;
          onChunk(raw.text);
          onEvent?.({ kind: 'text', text: raw.text });
        } else if (raw.type === 'tool_use' && raw.toolName) {
          const label = formatToolLabel(raw.toolName, raw.toolInput ?? {});
          onEvent?.({ kind: 'tool_start', toolName: raw.toolName, label });
        } else if (raw.type === 'tool_result') {
          onEvent?.({ kind: 'tool_end' });
        }
      }
    }
    if (lineBuf.trim()) {
      const raw = parseStreamJsonLine(lineBuf);
      if (raw?.type === 'text' && raw.text) {
        lastText = raw.text;
        onChunk(raw.text);
        onEvent?.({ kind: 'text', text: raw.text });
      }
    }
    buffer = lastText;
  } else {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      onChunk(chunk);
    }
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Copilot exited with code ${exitCode}: ${stderr.trim()}`);
  }

  const cleaned = buffer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  await appendMessage({ role: 'assistant', content: cleaned, provider: config.cli, model: config.model });
  await processMemoryBlocks(cleaned);
  return buffer;
}

// ── Dropped-file attachments ─────────────────────────────────────────────────
// When the user drops a file into the chat, its absolute path arrives in the
// message. We read a small preview and prepend it to the copilot prompt so the
// model immediately knows the file's shape (and the path to read it in full),
// which also lets non-agentic providers use it without a file tool.

const MAX_PREVIEW_BYTES = 8000;
const MAX_PREVIEW_LINES = 60;

export interface AttachedFile {
  path: string;
  bytes: number;
  preview: string;
  previewLines: number;
  truncated: boolean;
  binary: boolean;
}

/** Strip quotes/escapes, resolve file:// and ~, yielding a real filesystem path. */
function normalizeAttachmentPath(raw: string): string {
  let p = raw.trim().replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ');
  if (/^file:\/\//i.test(p)) {
    try { p = decodeURIComponent(new URL(p).pathname); } catch { /* leave as-is */ }
  } else if (p.startsWith('~/') && process.env.HOME) {
    p = process.env.HOME + p.slice(1);
  }
  return p;
}

/** Pull candidate local paths (quoted or bare absolute/`~` paths) out of a message. */
function extractPathCandidates(message: string): string[] {
  const out = new Set<string>();
  const quoted = /"([^"]+)"|'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(message)) !== null) {
    const v = m[1] ?? m[2] ?? '';
    if (/^(?:\/|~\/|file:\/\/)/.test(v)) out.add(v);
  }
  const bare = /(?:file:\/\/)?(?:~\/|\/)(?:\\ |[^\s'"])+/g;
  while ((m = bare.exec(message)) !== null) out.add(m[0]);
  return [...out];
}

/**
 * Find local files referenced in a copilot message and read a bounded preview of each.
 * Bogus matches (pasted URLs, non-existent paths, directories) are silently skipped —
 * only real, readable files are returned.
 */
export async function collectAttachedFiles(message: string): Promise<AttachedFile[]> {
  const files: AttachedFile[] = [];
  const seen = new Set<string>();
  for (const cand of extractPathCandidates(message)) {
    const path = normalizeAttachmentPath(cand);
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      if (!existsSync(path)) continue;
      const st = statSync(path);
      if (!st.isFile()) continue;
      // Read only the head so a huge file doesn't load into memory.
      const head = new Uint8Array(
        await Bun.file(path).slice(0, MAX_PREVIEW_BYTES + 1).arrayBuffer(),
      );
      const binary = head.subarray(0, Math.min(4096, head.length)).includes(0);
      let preview = '';
      let previewLines = 0;
      let truncated = st.size > head.length;
      if (!binary) {
        const text = new TextDecoder().decode(head.subarray(0, MAX_PREVIEW_BYTES));
        const lines = text.split('\n');
        const limited = lines.slice(0, MAX_PREVIEW_LINES);
        if (limited.length < lines.length) truncated = true;
        previewLines = limited.length;
        preview = limited.join('\n');
      }
      files.push({ path, bytes: st.size, preview, previewLines, truncated, binary });
    } catch {
      // Unreadable — skip.
    }
  }
  return files;
}

/** Render an [ATTACHED FILES] prompt section (empty string when there are none). */
export function buildAttachmentSection(files: AttachedFile[]): string {
  if (files.length === 0) return '';
  const parts = ['[ATTACHED FILES]'];
  for (const f of files) {
    const kb = (f.bytes / 1024).toFixed(1);
    parts.push('', `File: ${f.path}  (${kb} KB)`);
    if (f.binary) {
      parts.push('[binary file — read it with the appropriate tool]');
    } else {
      parts.push(`Preview (first ${f.previewLines} lines${f.truncated ? ', truncated — read the full file from the path above' : ''}):`, '```', f.preview, '```');
    }
  }
  return parts.join('\n');
}

export function extractGeinsCommands(text: string): string[] {
  const commands: string[] = [];
  const codeBlockRegex = /```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lines = match[1]!.trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('geins ')) {
        commands.push(trimmed);
      }
    }
  }
  if (commands.length === 0) {
    const inlineRegex = /(?:^|\n)\s*(geins\s+\S[^\n]*)/g;
    while ((match = inlineRegex.exec(text)) !== null) {
      const cmd = match[1]!.trim();
      if (!cmd.includes('<') && !cmd.includes('>')) {
        commands.push(cmd);
      }
    }
  }
  return commands;
}

/**
 * Split a command line into argv, respecting single/double quotes and stripping them,
 * so `--body '{"a": 1}'` becomes one argument (`{"a": 1}`) instead of being split on
 * spaces with the quotes left literal. A naive whitespace split breaks JSON bodies.
 */
export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
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

export async function executeGeinsCommand(command: string): Promise<{ output: string; exitCode: number }> {
  const args = tokenizeArgs(command.replace(/^geins\s+/, ''));
  const proc = Bun.spawn(['geins', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  });
  killOnAbort(proc);
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { output: (stdout || stderr).trim(), exitCode };
}

/**
 * Max characters of a single command's output kept in the conversation history that
 * is re-sent to the model each turn. Huge dumps (e.g. `product list --json` for a full
 * catalog) would otherwise blow the token budget and evict the user's original question.
 * The full output is still shown in the TUI and written to the output folder.
 */
const MAX_TOOL_OUTPUT_CHARS = 20000;

export async function addToolResult(command: string, output: string): Promise<void> {
  let kept = output;
  if (output.length > MAX_TOOL_OUTPUT_CHARS) {
    const omitted = output.length - MAX_TOOL_OUTPUT_CHARS;
    kept =
      output.slice(0, MAX_TOOL_OUTPUT_CHARS) +
      `\n\n…[truncated ${omitted} of ${output.length} chars. The full result was written to the output folder — read it from your working directory if you need all of it.]`;
  }
  const content = `I ran \`${command}\` and got this output:\n\n${kept}`;
  await appendMessage({ role: 'user', content });
  await trackApiResponse(command, output);
}

async function processMemoryBlocks(text: string): Promise<void> {
  const blocks = extractMemoryBlocks(text);
  for (const block of blocks) {
    await addFact({
      category: block.category,
      content: block.content,
      confidence: 0.7,
      source: 'copilot',
    });
  }
}
