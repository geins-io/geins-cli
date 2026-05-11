import type { KnowledgeBase, KnowledgeFact } from './types.ts';
import { PATHS, readJsonSafe, writeJsonSafe } from './store.ts';

const MAX_FACTS = 50;
const DECAY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export async function loadKnowledge(): Promise<KnowledgeBase> {
  return (await readJsonSafe<KnowledgeBase>(PATHS.knowledge)) ?? {
    version: 1,
    facts: [],
    preferences: {},
    updatedAt: Date.now(),
  };
}

export async function addFact(fact: Omit<KnowledgeFact, 'id' | 'createdAt' | 'lastUsedAt'>): Promise<void> {
  const kb = await loadKnowledge();
  const existing = kb.facts.find(f => f.category === fact.category && f.content === fact.content);
  if (existing) {
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    existing.lastUsedAt = Date.now();
  } else {
    kb.facts.push({
      ...fact,
      id: crypto.randomUUID().slice(0, 8),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
  }
  kb.facts = kb.facts
    .map(f => ({
      ...f,
      confidence: f.confidence * (1 - (Date.now() - f.lastUsedAt) / DECAY_INTERVAL_MS * 0.05),
    }))
    .filter(f => f.confidence > 0.1)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_FACTS);
  kb.updatedAt = Date.now();
  await writeJsonSafe(PATHS.knowledge, kb);
}

export async function setPreference(key: string, value: string): Promise<void> {
  const kb = await loadKnowledge();
  kb.preferences[key] = value;
  kb.updatedAt = Date.now();
  await writeJsonSafe(PATHS.knowledge, kb);
}

export async function clearKnowledge(): Promise<void> {
  await writeJsonSafe(PATHS.knowledge, {
    version: 1,
    facts: [],
    preferences: {},
    updatedAt: Date.now(),
  });
}

export function buildKnowledgePromptSection(kb: KnowledgeBase): string {
  const parts: string[] = [];
  const topFacts = kb.facts.filter(f => f.confidence > 0.3).slice(0, 10);
  for (const f of topFacts) {
    parts.push(`- ${f.content}`);
  }
  const prefs = Object.entries(kb.preferences);
  if (prefs.length) {
    parts.push('User preferences:');
    for (const [k, v] of prefs) {
      parts.push(`- ${k}: ${v}`);
    }
  }
  if (parts.length === 0) return '';
  return '[Learned Context]\n' + parts.join('\n');
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
