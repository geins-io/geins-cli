import type { KnowledgeBase, KnowledgeBaseV1, EntityRecord, PatternRecord, KnowledgeFact } from './types.ts';
import { PATHS, readJsonSafe, writeJsonSafe } from './store.ts';

const MAX_ENTITIES = 100;
const MAX_PATTERNS = 30;
const MAX_EXAMPLES = 3;
const DECAY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function emptyKb(): KnowledgeBase {
  return { version: 2, entities: [], patterns: [], preferences: {}, updatedAt: Date.now() };
}

function migrateV1(v1: KnowledgeBaseV1): KnowledgeBase {
  const kb = emptyKb();
  kb.preferences = { ...v1.preferences };
  for (const fact of v1.facts) {
    if (fact.category === 'preference') {
      kb.preferences[fact.content] = 'true';
    } else {
      kb.patterns.push({
        id: fact.id,
        type: fact.category === 'workflow' ? 'workflow-pattern'
            : fact.category === 'api' ? 'api-pattern'
            : 'common-action',
        description: fact.content,
        confidence: fact.confidence,
        examples: [],
        createdAt: fact.createdAt,
        lastUsedAt: fact.lastUsedAt,
      });
    }
  }
  return kb;
}

export async function loadKnowledge(): Promise<KnowledgeBase> {
  const raw = await readJsonSafe<KnowledgeBase | KnowledgeBaseV1>(PATHS.knowledge);
  if (!raw) return emptyKb();
  if ((raw as KnowledgeBaseV1).version === 1) {
    const migrated = migrateV1(raw as KnowledgeBaseV1);
    await writeJsonSafe(PATHS.knowledge, migrated);
    return migrated;
  }
  return raw as KnowledgeBase;
}

async function saveKnowledge(kb: KnowledgeBase): Promise<void> {
  kb.updatedAt = Date.now();
  await writeJsonSafe(PATHS.knowledge, kb);
}

export async function trackEntity(input: Omit<EntityRecord, 'id' | 'lastSeenAt' | 'seenCount'>): Promise<void> {
  const kb = await loadKnowledge();
  const existing = kb.entities.find(e =>
    e.type === input.type && (
      (input.externalId && e.externalId === input.externalId) ||
      (!input.externalId && e.name === input.name)
    )
  );
  if (existing) {
    existing.name = input.name;
    existing.attributes = { ...existing.attributes, ...input.attributes };
    if (input.externalId) existing.externalId = input.externalId;
    existing.lastSeenAt = Date.now();
    existing.seenCount++;
  } else {
    kb.entities.push({
      ...input,
      id: crypto.randomUUID().slice(0, 8),
      lastSeenAt: Date.now(),
      seenCount: 1,
    });
  }
  kb.entities.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  if (kb.entities.length > MAX_ENTITIES) {
    kb.entities = kb.entities.slice(0, MAX_ENTITIES);
  }
  await saveKnowledge(kb);
}

export async function addPattern(input: Omit<PatternRecord, 'id' | 'createdAt' | 'lastUsedAt'>): Promise<void> {
  const kb = await loadKnowledge();
  const existing = kb.patterns.find(p => p.type === input.type && p.description === input.description);
  if (existing) {
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    existing.lastUsedAt = Date.now();
    for (const ex of input.examples) {
      if (!existing.examples.includes(ex)) {
        existing.examples.push(ex);
        if (existing.examples.length > MAX_EXAMPLES) existing.examples.shift();
      }
    }
  } else {
    kb.patterns.push({
      ...input,
      id: crypto.randomUUID().slice(0, 8),
      examples: input.examples.slice(0, MAX_EXAMPLES),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
  }
  const now = Date.now();
  kb.patterns = kb.patterns
    .map(p => ({
      ...p,
      confidence: p.confidence * (1 - (now - p.lastUsedAt) / DECAY_INTERVAL_MS * 0.05),
    }))
    .filter(p => p.confidence > 0.1)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_PATTERNS);
  await saveKnowledge(kb);
}

// Legacy compat — routes to addPattern
export async function addFact(fact: Omit<KnowledgeFact, 'id' | 'createdAt' | 'lastUsedAt'>): Promise<void> {
  await addPattern({
    type: fact.category === 'workflow' ? 'workflow-pattern'
        : fact.category === 'api' ? 'api-pattern'
        : 'common-action',
    description: fact.content,
    confidence: fact.confidence,
    examples: [],
  });
}

export async function setPreference(key: string, value: string): Promise<void> {
  const kb = await loadKnowledge();
  kb.preferences[key] = value;
  await saveKnowledge(kb);
}

export async function clearKnowledge(): Promise<void> {
  await writeJsonSafe(PATHS.knowledge, emptyKb());
}

interface BuildOptions {
  contextWindow?: number;
  accountName?: string;
  accountKey?: string;
}

export function buildKnowledgePromptSection(kb: KnowledgeBase, options: BuildOptions = {}): string {
  const ctx = options.contextWindow ?? 200000;
  const entityLimit = ctx < 16000 ? 5 : ctx < 128000 ? 15 : 25;
  const patternLimit = ctx < 16000 ? 2 : ctx < 128000 ? 5 : 10;

  const parts: string[] = [];

  if (options.accountName || options.accountKey) {
    parts.push(`Account: ${options.accountName ?? ''} (${options.accountKey ?? ''})`.trim());
  }

  const workflows = kb.entities.filter(e => e.type === 'workflow').slice(0, entityLimit);
  if (workflows.length) {
    parts.push('');
    parts.push('Known workflows:');
    for (const w of workflows) {
      const attrs: string[] = [];
      if (w.attributes.type) attrs.push(w.attributes.type);
      if (w.attributes.cron) attrs.push(w.attributes.cron);
      if (w.attributes.enabled) attrs.push(w.attributes.enabled === 'true' ? 'enabled' : 'disabled');
      const detail = attrs.length ? ` (${attrs.join(', ')})` : '';
      const id = w.externalId ? ` — id: ${w.externalId}` : '';
      parts.push(`- "${w.name}"${detail}${id}`);
    }
  }

  const variables = kb.entities.filter(e => e.type === 'variable').slice(0, entityLimit);
  if (variables.length) {
    parts.push('');
    parts.push('Known variables:');
    parts.push(`- ${variables.map(v => v.name).join(', ')}`);
  }

  const products = kb.entities.filter(e => e.type === 'product').slice(0, Math.min(5, entityLimit));
  if (products.length) {
    parts.push('');
    parts.push('Known products:');
    for (const p of products) {
      const id = p.externalId ? ` (${p.externalId})` : '';
      parts.push(`- ${p.name}${id}`);
    }
  }

  const topPatterns = kb.patterns.filter(p => p.confidence > 0.3).slice(0, patternLimit);
  if (topPatterns.length) {
    parts.push('');
    parts.push('Patterns:');
    for (const p of topPatterns) {
      parts.push(`- ${p.description}`);
    }
  }

  const prefs = Object.entries(kb.preferences);
  if (prefs.length) {
    parts.push('');
    parts.push('Preferences:');
    for (const [k, v] of prefs) {
      parts.push(`- ${k}: ${v}`);
    }
  }

  if (parts.length === 0) return '';
  return '[Tenant Knowledge]\n' + parts.join('\n');
}

export function extractMemoryBlocks(text: string): Array<{ category: KnowledgeFact['category']; content: string }> {
  const blocks: Array<{ category: KnowledgeFact['category']; content: string }> = [];
  const regex = /\[MEMORY\]([\w]+):(.+?)\[\/MEMORY\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const category = match[1] as KnowledgeFact['category'];
    const content = match[2]!.trim();
    if (['project', 'workflow', 'api', 'preference', 'pattern'].includes(category)) {
      blocks.push({ category, content });
    }
  }
  return blocks;
}
