/**
 * Per-ask model routing for the copilot's "auto" mode (Claude Code, Antigravity, and OpenAI Codex).
 *
 * These CLIs expose a tier ladder where cheap ≪ mid ≪ heavy in cost/latency, and most
 * copilot turns are simple lookups any tier handles. Routing is a pure heuristic on the
 * user's message — deterministic, zero latency, zero extra tokens — that picks the CHEAPEST
 * tier that is still sufficient. When in doubt it lands on the mid tier; the provider's own
 * fallback (e.g. Claude's `--fallback-model`, see copilot.ts) covers availability, not capability.
 *
 * The classification is provider-agnostic (`classifyAsk` → cheap | mid | heavy). Each provider
 * then maps the tier to a concrete model via its own fixed tier ladder: Claude's aliases
 * (`CLAUDE_TIER` / `routeClaudeModel`), Antigravity's model ids (`AGY_TIER` / `routeAgyModel`).
 *
 * Codex (ChatGPT-auth) has no codex-tuned model, so `routeCodexModel` stays on `gpt-5.5` and maps
 * the tier to a reasoning EFFORT instead — emitting the combined "<model>:<effort>" token codex
 * expects. Coding/heavy/file-driven asks are bumped to high effort.
 */

export type Tier = 'cheap' | 'mid' | 'heavy';

export type ClaudeModelAlias = 'haiku' | 'sonnet' | 'opus';

export interface ModelRoute {
  model: ClaudeModelAlias;
  /** Short human-readable reason — for the activity header and history metadata. */
  reason: string;
}

export interface AgyRoute {
  /** Concrete agy `--model` id from the fixed tier ladder (AGY_TIER). */
  model: string;
  reason: string;
}

// Long-horizon / heavy-reasoning work: building workflows, bulk catalog operations,
// open-ended analysis ("which products could be variants"). These run many steps and
// pay for themselves in fewer wrong turns on the big model.
const OPUS_SIGNALS: { re: RegExp; reason: string }[] = [
  { re: /\bworkflows?\b[^.]{0,60}\b(creat|build|make|set\s*up|automat|schedul|design)/i, reason: 'workflow build' },
  { re: /\b(creat|build|make|set\s*up|automat|schedul|design)\w*\b[^.]{0,60}\bworkflows?\b/i, reason: 'workflow build' },
  { re: /\b(bulk|batch|import|migrat\w*|backfill|sync(?:hroni[sz]e)?)\b/i, reason: 'bulk operation' },
  { re: /\b(analy[sz]e|audit|investigate|deduplicate|restructure|reorgani[sz]e|optimi[sz]e|clean\s*up)\b/i, reason: 'analysis' },
  { re: /\b(suggest|recommend|propose|figure\s+out|come\s+up\s+with)\b/i, reason: 'open-ended reasoning' },
  { re: /\bwhich\s+products?\s+(could|should)\b|\bgroup\b[^.]{0,40}\bvariants?\b/i, reason: 'open-ended reasoning' },
];

// Any mutating intent — keeps a turn off haiku (writes deserve the mid tier at minimum).
const WRITE_RE = /\b(creat\w*|updat\w*|delet\w*|remov\w*|set|add|upload|link|unlink|enable|disable|run|assign|chang\w*|renam\w*|fix\w*|apply|activat\w*|deactivat\w*|publish|mov\w*|writ\w*|generat\w*|export|convert)\b/i;

// Catalog-mutating verbs. Narrower than WRITE_RE on purpose: used to escalate
// file-driven batch jobs (match rows → update many products) and whole-catalog
// changes ("set vat on every product") — a plain "export all products" stays on sonnet.
const MUTATE_RE = /\b(updat\w*|creat\w*|import|delet\w*|set|apply|assign|fix\w*|chang\w*|renam\w*|link|upload|add|remov\w*|activat\w*|deactivat\w*|publish)\b/i;

// "all/every/each <catalog entity>" — only heavy when paired with a mutation.
const ALL_ENTITIES_RE = /\b(all|every|each)\b[^.]{0,40}\b(products?|orders?|categor\w*|brands?|images?|variants?|campaigns?)\b/i;

const READ_START_RE = /^(list|show|get|fetch|display|what|what's|whats|which|who|who's|whoami|how\s+many|how\s+much|count|find|search|check|status|is\s|are\s|do\s+we|does|when|where|why|tell\s+me|give\s+me)\b/i;

const CHITCHAT_RE = /^(hi|hey|hello|yo|sup|good\s+(morning|afternoon|evening)|thanks?|thank\s+you|ty|ok(ay)?|cool|nice|great|what\s+can\s+you\s+do|help)\b/i;

/**
 * Split off the [ATTACHED FILES] preview block (prepended by the TUI when the user drops
 * a file) so routing reacts to the user's own words, not the file preview's contents.
 */
function splitAttachments(prompt: string): { text: string; hasAttachments: boolean } {
  if (!prompt.startsWith('[ATTACHED FILES]')) return { text: prompt.trim(), hasAttachments: false };
  // The user's message is appended after the attachment block as the final paragraph.
  const tail = prompt.slice(prompt.lastIndexOf('\n\n') + 2).trim();
  return { text: tail, hasAttachments: true };
}

/**
 * Provider-agnostic difficulty classification for one user ask. `heavy` signals expensive
 * top-tier reasoning is worth it; `cheap` is a short lookup/chit-chat any tier handles; `mid`
 * is the default for everything in between. Both provider routers map this to a concrete model.
 */
export function classifyAsk(prompt: string): { tier: Tier; reason: string } {
  const { text, hasAttachments } = splitAttachments(prompt);

  for (const sig of OPUS_SIGNALS) {
    if (sig.re.test(text)) return { tier: 'heavy', reason: sig.reason };
  }
  if (ALL_ENTITIES_RE.test(text) && MUTATE_RE.test(text)) {
    return { tier: 'heavy', reason: 'whole-catalog change' };
  }
  if (hasAttachments && MUTATE_RE.test(text)) {
    return { tier: 'heavy', reason: 'file-driven changes' };
  }
  if (text.length > 1200) return { tier: 'heavy', reason: 'long ask' };

  if (CHITCHAT_RE.test(text) && text.length <= 80) return { tier: 'cheap', reason: 'chit-chat' };
  if (!hasAttachments && text.length <= 160 && READ_START_RE.test(text) && !WRITE_RE.test(text)) {
    return { tier: 'cheap', reason: 'simple lookup' };
  }

  return { tier: 'mid', reason: 'standard task' };
}

const CLAUDE_TIER: Record<Tier, ClaudeModelAlias> = { cheap: 'haiku', mid: 'sonnet', heavy: 'opus' };

/** Pick the cheapest sufficient Claude model alias for one user ask. */
export function routeClaudeModel(prompt: string): ModelRoute {
  const { tier, reason } = classifyAsk(prompt);
  return { model: CLAUDE_TIER[tier], reason };
}

/**
 * Every selectable Antigravity model, verbatim from `agy models` (these display strings ARE the
 * `--model` ids), ordered cheapest → most capable. Shown in the picker; any can be pinned. Keep
 * the `MODEL_HINTS` keys in SelectCopilot.tsx in sync with these strings.
 */
export const AGY_MODELS: string[] = [
  'Gemini 3.5 Flash (Low)',
  'Gemini 3.5 Flash (Medium)',
  'Gemini 3.5 Flash (High)',
  'Gemini 3.1 Pro (Low)',
  'Gemini 3.1 Pro (High)',
  'Claude Sonnet 4.6 (Thinking)',
  'Claude Opus 4.6 (Thinking)',
  'GPT-OSS 120B (Medium)',
];

/**
 * 'auto' tier ladder — the agy analogue of CLAUDE_TIER. Kept within the Gemini family so routed
 * cost/behaviour is predictable (the hosted Claude/GPT models stay available for manual pinning).
 * Each value MUST be a member of AGY_MODELS.
 */
const AGY_TIER: Record<Tier, string> = {
  cheap: 'Gemini 3.5 Flash (Low)',
  mid: 'Gemini 3.5 Flash (High)',
  heavy: 'Gemini 3.1 Pro (High)',
};

/** Pick the cheapest sufficient Antigravity model for one user ask (auto mode). */
export function routeAgyModel(prompt: string): AgyRoute {
  const { tier, reason } = classifyAsk(prompt);
  return { model: AGY_TIER[tier], reason };
}

export interface CodexRoute {
  /** Combined "<model>:<effort>" token codex's buildCmd splits into `-m` + `model_reasoning_effort`. */
  model: string;
  reason: string;
}

/**
 * Coding intent in the user's own words: a request to write/inspect/debug code, scripts, or use a
 * named language — the cue to give the ask MORE reasoning effort. Deliberately keyed on programming
 * vocabulary (not Geins catalog verbs); a plain "list all products" is NOT coding even though the
 * agent might internally write a script to do it. Misses here just route by plain difficulty.
 */
const CODING_RE = /\b(code|coding|scripts?|programming|functions?|debug\w*|refactor\w*|regexe?s?|regex|parse[rs]?|parsing|algorithms?|snippets?|compile\w*|stack\s*traces?|tracebacks?|syntax|implement\w*|unit\s*tests?|typescript|javascript|python|bash|shell\s*script|golang|rust|kotlin)\b|\.(py|js|ts|tsx|jsx|sh|rb|go|rs|java|kt|swift|sql|css|html|json|ya?ml|toml)\b/i;

/** Per-tier reasoning effort for codex auto — the analogue of CLAUDE_TIER / AGY_TIER. All values
 *  are valid on ChatGPT-auth accounts (the config default is `medium`). */
const CODEX_EFFORT: Record<Tier, string> = { cheap: 'low', mid: 'medium', heavy: 'high' };

/**
 * Auto mode for OpenAI Codex. ChatGPT-auth Codex has NO codex-tuned model — `gpt-5-codex` requires
 * API-key auth and 400s on a ChatGPT account — so we stay on the general `gpt-5.5` and express
 * "this needs more thinking" as reasoning EFFORT rather than a different model. Returns the combined
 * "<model>:<effort>" token.
 *
 * Coding intent, the `heavy` tier (workflow builds, bulk ops, analysis, whole-catalog changes), and
 * file-driven tasks (a dropped file almost always means transform-this-data work) all get HIGH
 * effort; everything else scales with the difficulty tier. Plain lookups/chit-chat stay low.
 */
export function routeCodexModel(prompt: string): CodexRoute {
  const { text, hasAttachments } = splitAttachments(prompt);
  const { tier, reason } = classifyAsk(prompt);
  let effortTier: Tier = tier;
  let why = reason;
  if (CODING_RE.test(text)) { effortTier = 'heavy'; why = `coding · ${reason}`; }
  else if (tier === 'heavy') { effortTier = 'heavy'; }   // reason already names it ("workflow build", …)
  else if (hasAttachments) { effortTier = 'heavy'; why = `file task · ${reason}`; }
  return { model: `gpt-5.5:${CODEX_EFFORT[effortTier]}`, reason: why };
}

export interface SmartCandidates {
  /** Models the LLM classifier may choose among, cheapest → most capable. The first is also the
   *  model used to RUN the classification (the cheapest call). For codex these are the family ids. */
  models: string[];
  /** codex-only: reasoning efforts the classifier may pick (combined with the model as "<m>:<e>"). */
  efforts?: string[];
}

/**
 * "auto smart" routing: a cheap model reads each ask and picks the model (+ effort) per turn —
 * the LLM analogue of the regex routers above. This table is the menu of choices the classifier
 * is constrained to, per provider. `resolveTurnModel` (copilot.ts) spawns models[0] (the cheapest)
 * to make the pick, and falls back to the regex router if the call fails or returns something off-menu.
 */
export const SMART_CANDIDATES: Record<string, SmartCandidates> = {
  claude: { models: ['haiku', 'sonnet', 'opus'] },
  agy: { models: [AGY_TIER.cheap, AGY_TIER.mid, AGY_TIER.heavy] },
  // ChatGPT-auth Codex models only (no gpt-5-codex; valid efforts low/medium/high/xhigh, per
  // `codex debug models`). models[0] is the cheapest — also the model that RUNS the classification.
  codex: { models: ['gpt-5.4-mini', 'gpt-5.5'], efforts: ['low', 'medium', 'high', 'xhigh'] },
};
