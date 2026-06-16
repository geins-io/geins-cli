import { loadConfig, saveConfig, type CopilotConfig } from '../config/store.ts';
import { getOutputDir, getAccountOutputDir, ensureOutputDir, recordCliFailure } from '../output/sink.ts';
import { existsSync, statSync } from 'node:fs';
import { getActiveSignal } from '../api/abort.ts';
import { buildCommandCatalog, PITFALLS } from './help-text.ts';
import { routeClaudeModel, routeAgyModel, routeCodexModel, AGY_MODELS, SMART_CANDIDATES, type SmartCandidates } from './model-router.ts';
import { selfInvocation } from '../runtime.ts';
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
  setPreference,
  extractMemoryBlocks,
  getMemoryAccount,
  resolveMemoryAccountKey,
} from '../memory/index.ts';

export interface CopilotOption {
  name: string;
  cli: string;
  testCmd: string[];
  supportsModels?: boolean;
  /** Static model choices for the picker (claude/agy tiers). When `probeModels` is set this is only
   *  the fallback used if the probe returns nothing. */
  models?: string[];
  /** Probe the installed CLI for its real models at picker-open (codex, ollama) instead of a static
   *  list — keeps the menu account-correct. Returns [] on any failure (→ falls back to `models`). */
  probeModels?: () => Promise<string[]>;
  /** Meta entries prepended to a probed list (codex: 'auto'/'auto-smart' routing sentinels, which
   *  aren't real model ids the probe returns). */
  metaModels?: string[];
  /** Optional second selection axis (codex: reasoning effort). When set, the picker asks for a
   *  `models` entry first, then one of these, and the saved model is the combined "<model>:<axis>"
   *  token — which `buildCmd` splits back apart. */
  effortChoices?: string[];
  supportsStreamJson?: boolean;
  /** The CLI keeps its own resumable session (e.g. `claude --resume <id>`), so we send only the
   *  new message each turn instead of replaying the whole system+history prompt. */
  supportsResume?: boolean;
  contextWindow: number;
  buildCmd: (model?: string) => string[];
  useStdin: boolean;
}

export interface StreamEvent {
  kind: 'tool_start' | 'tool_end' | 'text' | 'model';
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
    supportsResume: true,
    supportsModels: true,
    // 'auto' (default) routes each ask to the cheapest sufficient tier (instant regex); 'auto-smart'
    // has a cheap model pick the tier per ask instead — see model-router.ts / resolveTurnModel.
    models: ['auto', 'auto-smart', 'haiku', 'sonnet', 'opus'],
    useStdin: true,
    buildCmd: (model) => {
      const cmd = ['claude', '-p', '--output-format', 'stream-json', '--verbose'];
      if (model && model !== 'auto') {
        cmd.push('--model', model);
        // If the chosen tier is overloaded/unavailable, degrade to sonnet instead of failing the turn.
        if (model !== 'sonnet') cmd.push('--fallback-model', 'sonnet');
      }
      return cmd;
    },
  },
  {
    name: 'OpenAI Codex',
    cli: 'codex',
    testCmd: ['codex', '--version'],
    contextWindow: 128000,
    useStdin: true,
    supportsModels: true,
    // Two-axis pick: a model id (passed via `-m`) then a reasoning effort (passed via
    // `-c model_reasoning_effort=`). The saved choice is the combined "<model>:<effort>" token.
    // The model list is probed live from `codex debug models` (visibility:list) so it's exactly what
    // the signed-in account supports — a ChatGPT account shows the gpt-5.x family (no gpt-5-codex,
    // which needs API-key auth). The 'auto'/'auto-smart' routing sentinels are prepended via
    // metaModels; `models` below is only the fallback if the probe fails. Valid efforts: low/medium/high/xhigh.
    metaModels: ['auto', 'auto-smart'],
    probeModels: listCodexModels,
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
    effortChoices: ['low', 'medium', 'high', 'xhigh'],
    buildCmd: (model) => {
      const cmd = ['codex', 'exec', '--ephemeral', '--skip-git-repo-check'];
      if (model) {
        const [id, effort] = model.split(':');
        if (id) cmd.push('-m', id);
        if (effort) cmd.push('-c', `model_reasoning_effort=${effort}`);
      }
      cmd.push('-');
      return cmd;
    },
  },
  {
    name: 'Antigravity CLI',
    cli: 'agy',
    testCmd: ['agy', '--version'],
    contextWindow: 1000000,
    supportsModels: true,
    // Static model list, exactly like Claude: 'auto' per-ask routes to the cheapest sufficient
    // tier (instant regex), 'auto-smart' has a cheap model make that pick, or pin any model.
    // AGY_MODELS are the verbatim `agy models` ids.
    models: ['auto', 'auto-smart', ...AGY_MODELS],
    useStdin: true,
    // Headless "command mode" is `agy --print` (alias -p); the prompt arrives via stdin (we pipe
    // fullPrompt). `--model` pins the model (agy has no `-m` short alias); in auto mode
    // resolveTurnModel hands us the routed id, so the 'auto'/'auto-smart' sentinels never reach the flag.
    // See https://antigravity.google/docs/cli-using
    buildCmd: (model) => {
      const cmd = ['agy'];
      if (model && model !== 'auto' && model !== 'auto-smart') cmd.push('--model', model);
      cmd.push('-p', '');
      return cmd;
    },
  },
  {
    name: 'Ollama',
    cli: 'ollama',
    testCmd: ['ollama', '--version'],
    supportsModels: true,
    // No static list / no meta entries — the picker shows exactly the locally pulled models.
    probeModels: listOllamaModels,
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

/**
 * Native session id for resume-capable agent CLIs (claude). Held for the life of the
 * conversation so every turn continues the SAME agent session — tool results and prior context
 * live on the agent's side rather than being replayed into the prompt each turn. Cleared whenever
 * the conversation is reset (new chat, account switch), which restarts with a fresh session.
 */
let resumeSessionId: string | undefined;

/**
 * The Claude tier the current task was routed to (auto mode). Continuation turns —
 * tool results fed back mid-task by the agentic loop — reuse it instead of re-routing
 * on tool output (whose length/wording says nothing about the task's difficulty).
 * Cleared with the conversation.
 */
let routedModel: string | undefined;

/**
 * True once a real chat turn in this process has carried the SESSION START orientation
 * (run `geins help` first). Flipped by the chat paths — NOT inside buildFullPrompt — so
 * getContextUsageAsync's display-only prompt rebuild never consumes it. Rolling history
 * survives TUI restarts, so without this flag a restarted app would never re-orient.
 */
let sessionOriented = false;

export function clearConversationHistory(): void {
  resumeSessionId = undefined;
  routedModel = undefined;
  clearHistory();
}

/** The cheapest one-shot invocation of a provider, used to RUN the 'auto-smart' classification.
 *  Plain text out (no stream-json), prompt over stdin, no session/resume so it never pollutes the
 *  conversation. Returns null for providers without a smart menu. */
function smartClassifyCmd(cli: string): string[] | null {
  const cheapest = SMART_CANDIDATES[cli]?.models[0];
  if (!cheapest) return null;
  switch (cli) {
    case 'claude': return ['claude', '-p', '--model', cheapest];
    case 'codex': return ['codex', 'exec', '--ephemeral', '--skip-git-repo-check', '-m', cheapest, '-c', 'model_reasoning_effort=low', '-'];
    case 'agy': return ['agy', '--model', cheapest, '-p', ''];
    default: return null;
  }
}

/** The prompt handed to the cheap classifier: pick one on-menu model (+ effort) and reply JSON only. */
function buildSmartPrompt(cand: SmartCandidates, userPrompt: string): string {
  // Cap the ask so a huge dropped-file preview doesn't make the (cheap) classification slow/costly —
  // the opening lines carry more than enough signal to route.
  const ask = userPrompt.length > 4000 ? `${userPrompt.slice(0, 4000)}\n…[truncated]` : userPrompt;
  const effortLine = cand.efforts ? `\nAllowed "effort" values: ${cand.efforts.join(', ')}.` : '';
  const effortField = cand.efforts ? `, "effort": "<one of the allowed efforts>"` : '';
  return [
    'You are a fast model-routing classifier. Choose the best option for the request below.',
    `Allowed "model" values (cheapest → most capable): ${cand.models.join(', ')}.${effortLine}`,
    'Use the most capable / coding-oriented model for coding, scripting, debugging, multi-step data or catalog automation, and file processing.',
    'Use the cheapest model for simple lookups, counts, status checks, and chit-chat. Scale capability/effort to the difficulty of the task.',
    `Reply with ONLY a compact JSON object and nothing else: {"model": "<one of the allowed models>"${effortField}}.`,
    '',
    'Request:',
    ask,
  ].join('\n');
}

/** Parse + validate the classifier's reply against the menu. Off-menu / unparseable → null (the
 *  caller then falls back to the instant regex router). codex answers carry a separate effort axis
 *  that we fold back into the "<model>:<effort>" token. */
function parseSmartChoice(out: string, cand: SmartCandidates, cli: string): { model: string; reason: string } | null {
  const match = out.match(/\{[^{}]*\}/);
  if (!match) return null;
  let obj: { model?: unknown; effort?: unknown };
  try { obj = JSON.parse(match[0]); } catch { return null; }
  const model = typeof obj.model === 'string' ? obj.model : '';
  if (!cand.models.includes(model)) return null;
  if (cli === 'codex' && cand.efforts) {
    const effort = typeof obj.effort === 'string' && cand.efforts.includes(obj.effort) ? obj.effort : 'medium';
    return { model: `${model}:${effort}`, reason: 'smart' };
  }
  return { model, reason: 'smart' };
}

/** 'auto-smart': spawn the cheapest model to pick the model (+ effort) for this ask. Returns null on
 *  any failure (spawn error, non-zero exit, off-menu reply, cancel) so the caller falls back to regex. */
async function classifySmart(cli: string, prompt: string): Promise<{ model: string; reason: string } | null> {
  const cand = SMART_CANDIDATES[cli];
  const cmd = smartClassifyCmd(cli);
  if (!cand || !cmd) return null;
  try {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', stdin: 'pipe', ...(await copilotProcOptions()) });
    proc.stdin.write(buildSmartPrompt(cand, prompt));
    proc.stdin.end();
    const signal = getActiveSignal();
    const onAbort = () => { try { proc.kill(); } catch { /* already gone */ } };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const out = await new Response(proc.stdout).text();
    if (await proc.exited !== 0 || signal?.aborted) return null;
    return parseSmartChoice(out, cand, cli);
  } catch {
    return null;
  }
}

/**
 * Resolve the model for THIS turn. Claude Code, Antigravity, and Codex in auto mode route each user
 * ask: 'auto' uses the instant regex router (cheapest sufficient tier, zero latency); 'auto-smart'
 * spawns the provider's cheapest model to make the pick (smarter, one extra round-trip). A pinned
 * model always wins; non-routed providers keep their configured model. `routed` is set only when a
 * fresh decision was made (so the UI can surface it). Continuation turns (tool results fed back
 * mid-task) reuse the prior decision — tool output says nothing about the task's difficulty.
 */
async function resolveTurnModel(
  config: CopilotConfig,
  prompt: string,
  continuation = false,
): Promise<{ model?: string; routed?: { model: string; reason: string } }> {
  const routes = config.cli === 'claude' || config.cli === 'agy' || config.cli === 'codex';
  if (!routes) return { model: config.model };
  if (config.model && config.model !== 'auto' && config.model !== 'auto-smart') return { model: config.model };
  if (continuation && routedModel) return { model: routedModel };

  // Smart routing: let the cheap model pick. On any failure it returns null and we drop through
  // to the same regex routers 'auto' uses — so a flaky classifier never breaks a turn.
  if (config.model === 'auto-smart') {
    const smart = await classifySmart(config.cli, prompt);
    if (smart) {
      routedModel = smart.model;
      return { model: smart.model, routed: smart };
    }
  }

  if (config.cli === 'claude') {
    const route = routeClaudeModel(prompt);
    routedModel = route.model;
    return { model: route.model, routed: route };
  }
  if (config.cli === 'codex') {
    // codex auto picks the model family (coding → gpt-5-codex) AND the reasoning effort,
    // returning the combined "<model>:<effort>" token buildCmd splits apart.
    const route = routeCodexModel(prompt);
    routedModel = route.model;
    return { model: route.model, routed: route };
  }
  // agy: map the routed tier onto its fixed model ladder (AGY_TIER), just like Claude.
  const route = routeAgyModel(prompt);
  routedModel = route.model;
  return { model: route.model, routed: route };
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
  'HARD RULE — every interaction with Geins goes through a `geins` command. NO EXCEPTIONS:',
  '- To READ or CHANGE any Geins data (products, orders, campaigns, account, workflows, anything) you MUST',
  '  run a `geins ...` command. NEVER reach the Geins API any other way — no curl, wget, httpie, fetch, a',
  '  language HTTP client, or a hand-written URL/endpoint. The geins binary owns the auth and the correct routes.',
  '- Prefer the DEDICATED command (e.g. `geins product list`, `geins order get`, `geins campaign create`).',
  '  Only if no dedicated command fits, use the `geins api <METHOD> <path>` escape hatch — that is still a',
  '  geins command. Never substitute a raw HTTP call or invent an endpoint URL.',
  '- Do not guess at API paths from docs/URLs. If unsure which command to use, run `geins help` and',
  '  `geins <group> help` to find it — never improvise a request outside the geins CLI.',
  '- Your own tools (Read/Bash/Write) are ONLY for LOCAL data work — reading dropped files, parsing JSON you',
  '  already fetched with geins, building CSV/Markdown, running scripts over local data. They are NEVER a',
  '  channel to Geins itself.',
  '',
  buildCommandCatalog(),
  '',
  PITFALLS,
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
  '- IMAGES (png/jpg/webp/…): VIEW them with your Read tool — do not treat them as opaque binaries.',
  '  Read the absolute path and act on what you see. In particular:',
  '  · A screenshot of the Geins admin "API User" page (fields: Username, Management API Password,',
  '    Management API Key, Merchant API Key — the page warns the secrets are shown only once) means',
  '    "add this account as an apikey profile". Read the four values verbatim off the image and run',
  '    `geins apikey set --username <u> --mgmt-key <Management API Key> --mgmt-password <Management API',
  '    Password> --merchant-key <Merchant API Key>` — that one command validates and activates it.',
  '    Run `geins apikey help` if unsure of the flags. Do this WITHOUT asking for confirmation (the user',
  '    dropped the screenshot precisely to add it); after it saves, report the new active profile name.',
  '- The intent can be anything. Common ones, as a guide (not a fixed menu):',
  '    · find / match — map rows to existing products by the strongest key available: article number',
  '      (`geins product list --article <n> --json`), id (`geins product get <id> --json`), then name/brand;',
  '      report matched vs unmatched rows.',
  '    · update — derive per-product changes from the file and apply via the right geins command',
  '      (`geins product update ...`, `geins product parameters set ...`, etc.).',
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
  '  geins order ...) — never wrap them in a workflow unless asked.',
  '- REUSE BEFORE BUILD: when a task could already be handled by an existing workflow (send email, notify,',
  '  alert, report, sync, recurring/scheduled jobs, event reactions), FIRST run `geins workflow list` and',
  '  check for one whose name/description/tags match the task. If a matching workflow exists, USE it',
  '  (`geins workflow run <id>` with the needed --body) instead of building a new one or doing it manually —',
  '  confirm the match with `geins workflow get <id>` if unsure. Only fall back to creating a new workflow',
  '  (after the user confirms) when no existing one fits.',
  '',
  'INTENT MAPPING — map user intent to Geins operations:',
  '  "who am I / current user / which account / account key / am I logged in" → geins whoami',
  '    (the authenticated user + active account — the source of truth for user and account identity)',
  '  "add an api key / add account / connect this account" or a dropped "API User" screenshot →',
  '    geins apikey set --username <u> --mgmt-key <k> --mgmt-password <p> --merchant-key <k>',
  '  "create a workflow" → geins workflow create',
  '  "send email / notify / alert as a workflow" → workflow with email action node',
  '  "every morning / schedule / cron as a workflow" → scheduled trigger workflow',
  '  "when X happens / on event as a workflow" → event trigger workflow',
  '  "discount code / promo code / coupon / voucher" → geins campaign create --promocode ...',
  '    (run geins campaign types for the discount type id and geins account markets for the',
  '    market id first; --percentage for % off, --amount <CUR>:<n> for a fixed amount)',
  '  "get / fetch / show data" → direct geins command (geins product ..., geins order ...)',
  '  "list / show workflows" → geins workflow list',
  '  "which products could be variants / group these as variants" → run geins product list --all --json,',
  '    find candidate families (similar names/article numbers, same brand, differing by color/size) that',
  '    are NOT already grouped (verify with geins product variants <id>), then propose grouping them. When',
  '    confirmed, run `geins product variants help` for syntax and create each group with the SINGLE-LINE',
  '    FLAG form (NOT a multi-line JSON body): first register each label —',
  '    `geins product variants labels add <Dim>` — then',
  '    `geins product variants create --name "<grp>" --label <Dim> --product <id>:<Dim>=<Value> --product <id>:<Dim>=<Value>`.',
  '  "suggest relations / what should relate to X / find accessories|cross-sells|similar products" →',
  '    run geins product relation-types list (the available kinds, e.g. Accessories/CrossSell) and',
  '    geins product list --json, reason about which products go together (complements, accessories,',
  '    same family, frequently-bought-together), and PROPOSE the links — show product → relatedProduct',
  '    under a relation type. Only after the user confirms, apply with geins product relations link',
  '    <productId> <relationTypeId> <relatedId...>. If a suitable relation type does not exist, suggest',
  '    creating one with geins product relation-types add <name> first. Verify existing links with',
  '    geins product relations <id> before proposing duplicates.',
  '',
  'LONG-RUNNING / BACKGROUND WORK:',
  '- NEVER end your turn while a batch job or background process you started is still running. You are',
  '  a one-shot process: nothing of you survives the turn to "report back when it finishes" — any such',
  '  promise is impossible to keep. Stay in the turn instead: poll the job (its output file, its process)',
  '  and print a ONE-LINE progress update between polls (e.g. "assigned 230/531, 0 failures") so the user',
  '  sees live progress. Only give your final answer when the work is COMPLETE or genuinely blocked.',
  '- Prefer foreground batches that print progress as they run over fire-and-forget background processes.',
  '',
  'RULES:',
  '- HARD RULE (see top): reach Geins ONLY via `geins` commands — never curl/fetch/raw HTTP or a',
  '  hand-rolled URL. Use the dedicated command first; `geins api <METHOD> <path>` is the only escape hatch.',
  '- ALWAYS default to `--idtype 0` in any command unless the user explicitly asks for a different idtype.',
  '- ALWAYS output commands in ```bash blocks. Never tell the user to run them manually.',
  '- To create a workflow, output: geins workflow create --body \'<full JSON>\'',
  '- If you need information first (e.g. manifest, existing workflows), run those commands first.',
  '- ALWAYS fetch the manifest (geins workflow manifest) before creating a workflow — you need it to know available actions, triggers, and node types.',
  '- Global variables in workflows: {{vars.variableName}}',
  '- Keep responses concise. Act, don\'t explain.',
  '- Write any files you create into the output folder (your working directory) — see FILE OUTPUT.',
].join('\n');

// Appended to the system prompt only when memory is enabled (`geins memory on`, the default).
// When the user runs `geins memory off` these instructions are dropped, recalled knowledge is not
// injected, and the copilot's [MEMORY] tags are not persisted — see getMemoryEnabled().
const MEMORY_INSTRUCTIONS = [
  'MEMORY: this app keeps its persistent memory in the global Synapse folder at `~/.synapse` (overridable',
  'via $GEINS_SYNAPSE_DIR). That folder is THE single source of truth for everything you remember — it is',
  'shared across ALL model backends (Claude, Ollama, etc.) and per-account subfolders live inside it, named',
  '`<accountName>_<apikeyProfile>` (e.g. `launch5_prod-launch5`). Memory AND output files are scoped to',
  'that bucket — never read from or write into another account\'s bucket. It is',
  'the same store the `/memory` (geins memory) command reads and writes. ALWAYS treat it as your memory:',
  'rely on what has been recalled into this prompt from it, and persist anything new there. Do NOT invent a',
  'separate memory location (e.g. a backend\'s own ~/.claude store) — always read from and store to Synapse.',
  'When you learn something durable about this account — a project fact, an API quirk, a naming convention,',
  'or a user preference — persist it so future turns remember. Two equivalent ways:',
  '  • inline tag (preferred, one per line, kept out of the visible reply): [MEMORY]category:the fact[/MEMORY]',
  '  • or run: geins memory add <category> "the fact"',
  'category is one of: project, workflow, api, preference, pattern. Record proactively but only durable facts — not one-off values or chit-chat. Example: [MEMORY]preference:user wants compact output with no IDs[/MEMORY]',
  'PAST SESSIONS: full transcripts of previous sessions (commands, copilot prompts and answers) are also',
  'stored in this account\'s bucket. Do NOT read them unprompted — but when the user asks to recall or',
  'continue earlier work ("what did we do yesterday", "pick up where we left off"), run `geins resume`',
  'to list recent sessions, then `geins resume <id>` to read a transcript, and carry on from there.',
].join('\n');

function getMaxPromptTokens(option?: CopilotOption): number {
  const ctx = option?.contextWindow ?? 8000;
  return Math.floor(ctx * 0.75);
}

async function buildFullPrompt(userMessage: string, option?: CopilotOption): Promise<string> {
  const maxTokens = getMaxPromptTokens(option);
  const memoryOn = await getMemoryEnabled();
  // The active per-account bucket (`<accountName>_<apikeyProfile>`) — prefer the in-process
  // value (live /apikey switches in the TUI), fall back to disk for copilot subprocesses.
  const bucket = getMemoryAccount() ?? (await resolveMemoryAccountKey()) ?? '_shared';
  const bucketLine = `ACTIVE ACCOUNT BUCKET: \`${bucket}\` — this account's memory subfolder and output subfolder. Everything you remember or save for this account belongs there.`;
  const systemContext = memoryOn ? `${SYSTEM_CONTEXT}\n${MEMORY_INSTRUCTIONS}\n${bucketLine}` : SYSTEM_CONTEXT;
  const systemTokens = estimateTokens(systemContext);
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

  // First real turn of this process OR a fresh conversation: have the model orient itself on
  // the live command surface before acting. The embedded catalog is one line per group —
  // `geins help` plus the relevant `geins <group> help` is the full, current picture. Not
  // re-injected on later turns so the copilot doesn't re-run help every turn.
  const sessionStartSection = (recentMessages.length === 0 || !sessionOriented)
    ? [
        'SESSION START: this is the first turn of a new session. Begin by running `geins help` (in a',
        '```bash block) to load the full picture of geins capabilities, and `geins <group> help` for any',
        'group the task touches, BEFORE acting on the request — the catalog above is a summary, not the',
        'complete or necessarily current surface. Skip this only for pure chit-chat with no geins action.',
      ].join('\n')
    : '';

  const outDir = await getOutputDir();
  // Show the account-nested folder (the copilot's actual cwd), not the un-nested base.
  const effectiveDir = (await getAccountOutputDir()) ?? process.cwd();
  const outputSection = outDir
    ? `Output folder: ${effectiveDir}`
    : `Output folder: ${effectiveDir} (the directory geins was launched from; set a fixed one with \`geins output <dir>\`)`;

  const parts = [systemContext, outputSection];
  if (sessionStartSection) parts.push(sessionStartSection);
  if (memoryOn && knowledgeSection) parts.push(knowledgeSection);
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

/**
 * The codex models the signed-in account can actually use, via `codex debug models` (reads codex's
 * local cache — instant, no network). Filters to user-visible models (`visibility: "list"`, dropping
 * internal ones like codex-auto-review) and orders by codex's own `priority` (lower = more prominent,
 * so the flagship leads). Returns [] on any failure so the picker falls back to the static list.
 */
export async function listCodexModels(): Promise<string[]> {
  try {
    const proc = Bun.spawn(['codex', 'debug', 'models'], { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    if (await proc.exited !== 0) return [];
    const data = JSON.parse(out) as { models?: Array<{ slug?: unknown; visibility?: unknown; priority?: unknown }> };
    const list = Array.isArray(data.models) ? data.models : [];
    return list
      .filter(m => m.visibility === 'list' && typeof m.slug === 'string')
      .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
      .map(m => m.slug as string);
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

/** Whether the copilot uses persistent memory. Defaults to ON (only an explicit `false` disables it). */
export async function getMemoryEnabled(): Promise<boolean> {
  const config = await loadConfig();
  return config.memoryEnabled !== false;
}

/** Toggle copilot memory (`geins memory on|off`). */
export async function setMemoryEnabled(on: boolean): Promise<void> {
  const config = await loadConfig();
  config.memoryEnabled = on;
  await saveConfig(config);
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
  const turn = await resolveTurnModel(config, prompt);
  await appendMessage({ role: 'user', content: prompt, provider: config.cli, model: turn.model });
  // Always include conversation history: each copilot invocation is a stateless
  // one-shot spawn (e.g. `claude -p`), so prior turns and tool results only reach
  // the model if they're in the prompt. Omitting them broke multi-step flows where
  // a follow-up references "the command results" / "my original question".
  const fullPrompt = await buildFullPrompt(prompt, option);
  sessionOriented = true;
  const cmd = option.buildCmd(turn.model);

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
  await appendMessage({ role: 'assistant', content: cleaned, provider: config.cli, model: turn.model });
  await processMemoryBlocks(cleaned);
  return cleaned;
}

interface RawStreamEvent {
  type: 'tool_use' | 'tool_result' | 'text';
  toolName?: string;
  toolInput?: Record<string, unknown>;
  text?: string;
}

function parseStreamJsonLine(line: string): RawStreamEvent[] {
  try {
    const event = JSON.parse(line);
    if (event.type === 'assistant' && event.message?.content) {
      // An assistant message can carry several blocks (prose + one or more tool_use,
      // e.g. parallel tool calls) — emit them ALL, or spinner entries go missing.
      const events: RawStreamEvent[] = [];
      for (const block of event.message.content) {
        if (block.type === 'tool_use') {
          events.push({ type: 'tool_use', toolName: block.name, toolInput: block.input });
        } else if (block.type === 'text' && block.text) {
          events.push({ type: 'text', text: block.text });
        }
      }
      return events;
    }
    if (event.type === 'user' && event.tool_use_result) {
      // NOTE: tool_result events carry no tool_use id here, so the UI pairs each one with
      // the OLDEST still-running entry (FIFO). With parallel tool calls that finish out of
      // order, a ✓ can land on the wrong sibling — cosmetic only, all entries end done.
      return [{ type: 'tool_result' }];
    }
    if (event.type === 'result' && typeof event.result === 'string') {
      return [{ type: 'text', text: event.result }];
    }
  } catch {}
  return [];
}

function shortenPath(p: string): string {
  const home = process.env.HOME ?? '';
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  const cwd = process.cwd();
  if (p.startsWith(cwd + '/')) return p.slice(cwd.length + 1);
  // Agent scratch space (/private/tmp/claude-*/…, /var/folders/…) — the directory maze is
  // meaningless to the user; the file name is the whole signal.
  if (/^\/(?:private\/)?(?:tmp|var\/folders)\//.test(p)) return p.split('/').pop() ?? p;
  return p;
}

function formatToolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': {
      const p = String(input.file_path ?? 'file');
      // Polling a background task's output file is "checking progress", not "reading a file".
      if (/\/tasks\/[^/]+\.output$/.test(p)) return 'Check background task progress';
      return `Read ${shortenPath(p)}`;
    }
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
    // Harness-internal tools the agent uses around background work — name them by what
    // they mean to the user, not by their API identifiers.
    case 'ToolSearch': return 'Look up extra tools';
    case 'Monitor': return 'Wait for background task';
    case 'TaskOutput':
    case 'BashOutput': return 'Check background task output';
    case 'TaskCreate': return `Start background task${input.description ? `: ${input.description}` : ''}`;
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
  opts?: { continuation?: boolean },
): Promise<string> {
  const config = await getCopilotConfig();
  if (!config) throw new Error('No copilot configured. Run /copilot to set one up.');

  const option = getCopilotOption(config.cli);
  if (!option) throw new Error(`Unknown copilot CLI: ${config.cli}`);

  const turn = await resolveTurnModel(config, prompt, opts?.continuation);
  // Surface the routing decision so the UI can show which tier is handling the turn.
  if (turn.routed) onEvent?.({ kind: 'model', label: turn.routed.model });

  await appendMessage({ role: 'user', content: prompt, provider: config.cli, model: turn.model });
  const isStreamJson = option.supportsStreamJson;
  const canResume = !!option.supportsResume && isStreamJson;

  // One spawn+stream attempt. When `resumeId` is set, the agent CLI continues its own session
  // (prior turns and tool results stay on its side), so we send ONLY the new message. Otherwise
  // we replay the full system+history prompt — the only way stateless CLIs (e.g. `claude -p` with
  // no session, codex, agy, ollama) see prior context.
  const attempt = async (
    resumeId: string | undefined,
  ): Promise<{ buffer: string; sessionId?: string; exitCode: number; readStderr: () => Promise<string> }> => {
    const fullPrompt = resumeId ? prompt : await buildFullPrompt(prompt, option);
    if (!resumeId) sessionOriented = true;
    const cmd = option.buildCmd(turn.model);
    if (resumeId) cmd.push('--resume', resumeId);

    const proc = Bun.spawn(cmd, {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'pipe',
      ...(await copilotProcOptions()),
    });

    proc.stdin.write(fullPrompt);
    proc.stdin.end();

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sessionId: string | undefined;

    // The first stream-json line is the `init` system event carrying the session_id; grab it so a
    // resume-capable CLI can continue this exact session next turn.
    const captureSession = (line: string) => {
      if (sessionId) return;
      try {
        const ev = JSON.parse(line);
        if (typeof ev.session_id === 'string' && ev.session_id) sessionId = ev.session_id;
      } catch { /* not JSON / no session */ }
    };

    // Ctrl-C handling: cancel the reader so the read loop ends *immediately* — we can't rely
    // on the copilot CLI dying promptly on a kill signal, and a blocked reader.read() would
    // otherwise hang the whole turn. Then terminate the process.
    const signal = getActiveSignal();
    const onAbort = () => {
      reader.cancel().catch(() => { /* already closed */ });
      try { proc.kill(); } catch { /* already gone */ }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

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
          captureSession(line);
          for (const raw of parseStreamJsonLine(line)) {
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
      }
      if (lineBuf.trim()) {
        captureSession(lineBuf);
        for (const raw of parseStreamJsonLine(lineBuf)) {
          if (raw.type === 'text' && raw.text) {
            lastText = raw.text;
            onChunk(raw.text);
            onEvent?.({ kind: 'text', text: raw.text });
          }
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
    return { buffer, sessionId, exitCode, readStderr: () => new Response(proc.stderr).text() };
  };

  let res = await attempt(canResume ? resumeSessionId : undefined);
  // A resume can fail if the agent dropped/expired the session. Retry once fresh (full context,
  // no resume) so the turn still succeeds, then let the new session id be captured below. A failed
  // resume errors before emitting assistant content, so this does not duplicate visible output.
  if (res.exitCode !== 0 && !getActiveSignal()?.aborted && canResume && resumeSessionId) {
    resumeSessionId = undefined;
    res = await attempt(undefined);
  }

  // Cancelled by the user (Ctrl-C) — surface it as an abort, not a process-error.
  if (getActiveSignal()?.aborted) throw new Error('Copilot cancelled.');
  if (res.exitCode !== 0) {
    const stderr = await res.readStderr();
    throw new Error(`Copilot exited with code ${res.exitCode}: ${stderr.trim()}`);
  }

  // Remember the session so the next turn resumes it instead of replaying the whole prompt.
  if (canResume && res.sessionId) resumeSessionId = res.sessionId;

  const cleaned = res.buffer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  await appendMessage({ role: 'assistant', content: cleaned, provider: config.cli, model: turn.model });
  await processMemoryBlocks(cleaned);
  return res.buffer;
}

// ── Dropped-file attachments ─────────────────────────────────────────────────
// When the user drops a file into the chat, its absolute path arrives in the
// message. We read a small preview and prepend it to the copilot prompt so the
// model immediately knows the file's shape (and the path to read it in full),
// which also lets non-agentic providers use it without a file tool.

const MAX_PREVIEW_BYTES = 8000;
const MAX_PREVIEW_LINES = 60;
/** Viewable raster/vector image extensions — these get a "view it" hint, not "opaque binary". */
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp|heic|svg)$/i;

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
    if (IMAGE_EXT_RE.test(f.path)) {
      parts.push('[image — VIEW it with your Read tool at the path above, then act on what it shows]');
    } else if (f.binary) {
      parts.push('[binary file — read it with the appropriate tool]');
    } else {
      parts.push(`Preview (first ${f.previewLines} lines${f.truncated ? ', truncated — read the full file from the path above' : ''}):`, '```', f.preview, '```');
    }
  }
  return parts.join('\n');
}

/**
 * Does the string end while still inside an open quote? Mirrors tokenizeArgs's quote handling
 * (no escape processing) so the two agree on where a quoted argument ends. Used to detect a
 * `geins … --body '{` line whose quote only closes on a LATER line.
 */
function endsInsideQuote(s: string): boolean {
  let quote: '"' | "'" | null = null;
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
  }
  return quote !== null;
}

export function extractGeinsCommands(text: string): string[] {
  const commands: string[] = [];
  const codeBlockRegex = /```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lines = match[1]!.replace(/\s+$/, '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed.startsWith('geins ')) continue;
      // Reassemble a command that spans multiple lines — a quoted argument left open (e.g. a
      // multi-line `--body '{ … }'` JSON) or a trailing backslash continuation. Without this the
      // command is truncated at the first line and a JSON body breaks ("Expected '}'").
      let cmd = trimmed;
      while ((endsInsideQuote(cmd) || cmd.endsWith('\\')) && i + 1 < lines.length) {
        i++;
        cmd = (cmd.endsWith('\\') ? cmd.slice(0, -1) : cmd) + '\n' + lines[i]!;
      }
      commands.push(cmd);
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
  // Re-invoke THIS executable rather than a `geins` on PATH — a compiled binary
  // or the Tauri sidecar may not be installed on PATH. In a compiled build
  // execPath IS the binary; under `bun run`/`bun link` execPath is `bun`, so we
  // also pass the entry script (Bun.main).
  const proc = Bun.spawn([...selfInvocation(), ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  });
  killOnAbort(proc);
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  const output = (stdout || stderr).trim();
  // A non-zero exit means the command failed (bad args, or the API was unreachable —
  // "Unable to connect"). Record it in the output folder so failed runs leave a trace,
  // not just the successful API dumps. Skip cancellations (Ctrl-C kills the proc).
  if (exitCode !== 0 && !getActiveSignal()?.aborted) {
    await recordCliFailure(command, exitCode, output);
  }
  return { output, exitCode };
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
  if (!(await getMemoryEnabled())) return;
  const blocks = extractMemoryBlocks(text);
  for (const block of blocks) {
    // Preferences are key/value-ish; store them in the preferences map (mirrors the v1
    // migration) so they show under Preferences, not as a decaying pattern.
    if (block.category === 'preference') {
      await setPreference(block.content, 'true');
    } else {
      await addFact({
        category: block.category,
        content: block.content,
        confidence: 0.7,
        source: 'copilot',
      });
    }
  }
}
