// `geins memory` — inspect and hand-edit the copilot knowledge base for the active account.
// The copilot also calls `geins memory add ...` to persist what it learns (see copilot.ts),
// so this is both a user tool and an agent-writable memory sink.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadKnowledge, addFact, setPreference, clearKnowledge } from '../memory/index.ts';
import type { KnowledgeBase } from '../memory/types.ts';
import { outputJson } from '../output/format.ts';
import { ensureOutputDir } from '../output/sink.ts';

const CATEGORIES = ['project', 'workflow', 'api', 'preference', 'pattern'] as const;
type Category = (typeof CATEGORIES)[number];

function isCategory(s: string): s is Category {
  return (CATEGORIES as readonly string[]).includes(s);
}

/** `geins memory add <category> <fact...>` — persist a durable fact or preference. */
export async function memoryAdd(category: string, content: string): Promise<void> {
  if (!isCategory(category)) {
    console.error(`Unknown category '${category}'. Use one of: ${CATEGORIES.join(', ')}`);
    process.exit(1);
  }
  const fact = content.trim();
  if (!fact) {
    console.error('Usage: geins memory add <category> "<fact>"');
    process.exit(1);
  }
  if (category === 'preference') {
    await setPreference(fact, 'true');
  } else {
    await addFact({ category, content: fact, confidence: 0.8, source: 'cli' });
  }
  console.log(`✓ Remembered (${category}): ${fact}`);
}

/** Lines rendering the knowledge base for human output — shared shape with the TUI `/memory`. */
export function formatKnowledgeLines(kb: KnowledgeBase): string[] {
  const lines: string[] = [];
  if (kb.entities.length) {
    lines.push(`Entities (${kb.entities.length}):`);
    for (const e of kb.entities.slice(0, 20)) {
      const attrs = Object.values(e.attributes).filter(Boolean).join(', ');
      lines.push(`  [${e.type}] ${e.name}${attrs ? ` (${attrs})` : ''}${e.externalId ? ` — ${e.externalId}` : ''}`);
    }
  }
  if (kb.patterns.length) {
    lines.push(`Patterns (${kb.patterns.length}):`);
    for (const p of kb.patterns.slice(0, 15)) {
      lines.push(`  [${p.type}] ${p.description} (${Math.round(p.confidence * 100)}%)`);
    }
  }
  const prefs = Object.entries(kb.preferences);
  if (prefs.length) {
    lines.push('Preferences:');
    for (const [k, v] of prefs) lines.push(`  ${k}${v === 'true' ? '' : `: ${v}`}`);
  }
  if (kb.interactions.length) {
    lines.push(`Recent Q&A (${kb.interactions.length}):`);
    for (const i of kb.interactions.slice(0, 10)) {
      lines.push(`  Q: ${i.prompt}`);
      lines.push(`  A: ${i.summary}`);
    }
  }
  return lines;
}

/** `geins memory list [--json]` — show everything learned for this account. */
export async function memoryList(jsonMode: boolean): Promise<void> {
  const kb = await loadKnowledge();
  if (jsonMode) {
    outputJson(kb);
    return;
  }
  const lines = formatKnowledgeLines(kb);
  if (lines.length === 0) {
    console.log('No learned knowledge yet for this account.');
    return;
  }
  lines.forEach((l) => console.log(l));
}

/** `geins memory clear` — wipe the knowledge base for the active account. */
export async function memoryClear(): Promise<void> {
  await clearKnowledge();
  console.log('✓ Memory cleared for this account.');
}

/** Render the knowledge base as a portable Markdown snapshot. */
function renderMarkdown(kb: KnowledgeBase): string {
  const out: string[] = ['# Geins copilot memory', ''];
  if (kb.entities.length) {
    out.push(`## Entities (${kb.entities.length})`, '');
    for (const e of kb.entities) {
      const attrs = Object.values(e.attributes).filter(Boolean).join(', ');
      out.push(`- **${e.name}** \`${e.type}\`${attrs ? ` — ${attrs}` : ''}${e.externalId ? ` (id: ${e.externalId})` : ''}`);
    }
    out.push('');
  }
  if (kb.patterns.length) {
    out.push(`## Patterns (${kb.patterns.length})`, '');
    for (const p of kb.patterns) out.push(`- ${p.description} _(${p.type}, ${Math.round(p.confidence * 100)}%)_`);
    out.push('');
  }
  const prefs = Object.entries(kb.preferences);
  if (prefs.length) {
    out.push('## Preferences', '');
    for (const [k, v] of prefs) out.push(`- ${k}${v === 'true' ? '' : `: ${v}`}`);
    out.push('');
  }
  if (kb.interactions.length) {
    out.push(`## Recent Q&A (${kb.interactions.length})`, '');
    for (const i of kb.interactions) out.push(`- **Q:** ${i.prompt}`, `  **A:** ${i.summary}`);
    out.push('');
  }
  if (out.length === 2) out.push('_(empty)_', '');
  return out.join('\n');
}

/**
 * `geins memory export [--json]` — write a human-readable snapshot of this account's memory
 * INTO the output folder (the same account-nested dir the copilot writes to, or cwd if output
 * is disabled). The canonical store stays in ~/.config/geins/memory; this is a shareable copy.
 * Returns the file path written.
 */
export async function exportMemory(format: 'md' | 'json'): Promise<string> {
  const kb = await loadKnowledge();
  // No Date.now() restriction here — this is normal runtime code, not a workflow script.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = (await ensureOutputDir()) ?? process.cwd();
  const file = join(dir, `memory-${stamp}.${format}`);
  const content = format === 'json' ? JSON.stringify(kb, null, 2) + '\n' : renderMarkdown(kb);
  await writeFile(file, content);
  return file;
}
