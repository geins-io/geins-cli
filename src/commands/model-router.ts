/**
 * Per-ask model routing for the Claude Code copilot ("auto" mode).
 *
 * Claude Code bills very differently per tier (haiku ≪ sonnet ≪ opus), and most copilot
 * turns are simple lookups any tier handles. Routing is a pure heuristic on the user's
 * message — deterministic, zero latency, zero extra tokens — that picks the CHEAPEST tier
 * that is still sufficient. When in doubt it lands on sonnet; `--fallback-model` (see
 * copilot.ts) covers availability, not capability.
 */

export type ClaudeModelAlias = 'haiku' | 'sonnet' | 'opus';

export interface ModelRoute {
  model: ClaudeModelAlias;
  /** Short human-readable reason — for the activity header and history metadata. */
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

/** Pick the cheapest sufficient Claude model alias for one user ask. */
export function routeClaudeModel(prompt: string): ModelRoute {
  const { text, hasAttachments } = splitAttachments(prompt);

  for (const sig of OPUS_SIGNALS) {
    if (sig.re.test(text)) return { model: 'opus', reason: sig.reason };
  }
  if (ALL_ENTITIES_RE.test(text) && MUTATE_RE.test(text)) {
    return { model: 'opus', reason: 'whole-catalog change' };
  }
  if (hasAttachments && MUTATE_RE.test(text)) {
    return { model: 'opus', reason: 'file-driven changes' };
  }
  if (text.length > 1200) return { model: 'opus', reason: 'long ask' };

  if (CHITCHAT_RE.test(text) && text.length <= 80) return { model: 'haiku', reason: 'chit-chat' };
  if (!hasAttachments && text.length <= 160 && READ_START_RE.test(text) && !WRITE_RE.test(text)) {
    return { model: 'haiku', reason: 'simple lookup' };
  }

  return { model: 'sonnet', reason: 'standard task' };
}
