import { describe, expect, test, beforeAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KnowledgeBase } from '../src/memory/types.ts'; // type-only: erased, never loads store.ts

// CRITICAL ISOLATION: redirect ALL memory state to a throwaway dir via GEINS_CONFIG_DIR. We can't
// use HOME — Bun's os.homedir() caches at process start and ignores a runtime-mutated process.env.HOME,
// so the store would still write to the real ~/.config/geins. store.ts reads GEINS_CONFIG_DIR lazily
// (per-operation), so setting it here, before any store call, fully isolates the suite.
const TMP_HOME = mkdtempSync(join(tmpdir(), 'geins-mem-'));
process.env.GEINS_CONFIG_DIR = TMP_HOME;

let mem: typeof import('../src/memory/knowledge.ts');
let cmd: typeof import('../src/memory/command-context.ts');

beforeAll(async () => {
  mem = await import('../src/memory/knowledge.ts');
  cmd = await import('../src/memory/command-context.ts');
});

function kb(overrides: Partial<KnowledgeBase>): KnowledgeBase {
  return { version: 2, entities: [], patterns: [], preferences: {}, interactions: [], updatedAt: 0, ...overrides };
}

describe('extractMemoryBlocks (the copilot [MEMORY] write path)', () => {
  test('parses a single valid block', () => {
    expect(mem.extractMemoryBlocks('Sure. [MEMORY]preference:keep output compact[/MEMORY] Done.'))
      .toEqual([{ category: 'preference', content: 'keep output compact' }]);
  });

  test('parses multiple blocks in one reply', () => {
    const blocks = mem.extractMemoryBlocks('[MEMORY]project:uses Bun[/MEMORY] and [MEMORY]api:VatId not Vat[/MEMORY]');
    expect(blocks.map(b => b.category)).toEqual(['project', 'api']);
    expect(blocks[1]!.content).toBe('VatId not Vat');
  });

  test('drops unknown categories', () => {
    expect(mem.extractMemoryBlocks('[MEMORY]bogus:nope[/MEMORY]')).toEqual([]);
  });

  test('returns nothing when there are no blocks', () => {
    expect(mem.extractMemoryBlocks('just a normal answer')).toEqual([]);
  });
});

describe('summarizeAnswer (prompt+answer memory)', () => {
  test('keeps the first sentence and strips code blocks', () => {
    expect(mem.summarizeAnswer('The product was created. ```bash\ngeins product get 1\n``` Then it had stock.'))
      .toBe('The product was created.');
  });

  test('strips [MEMORY] tags and think blocks', () => {
    const s = mem.summarizeAnswer('<think>noise</think>VatId 1 means 25% VAT here. [MEMORY]api:x[/MEMORY]');
    expect(s).toContain('VatId 1 means 25% VAT here');
    expect(s).not.toContain('MEMORY');
    expect(s).not.toContain('noise');
  });

  test('truncates very long answers with an ellipsis', () => {
    const s = mem.summarizeAnswer('x'.repeat(500));
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s.endsWith('…')).toBe(true);
  });

  test('returns empty string for code-only / empty answers', () => {
    expect(mem.summarizeAnswer('```bash\nls\n```')).toBe('');
  });
});

describe('buildKnowledgePromptSection (the read-back-into-prompt path)', () => {
  test('renders workflows, preferences and high-confidence patterns', () => {
    const section = mem.buildKnowledgePromptSection(kb({
      entities: [{
        id: 'a', type: 'workflow', name: 'Nightly sync', externalId: 'wf_1',
        attributes: { type: 'scheduled', cron: '0 2 * * *', enabled: 'true' },
        lastSeenAt: 2, seenCount: 3,
      }],
      patterns: [
        { id: 'p1', type: 'api-pattern', description: 'kept pattern', confidence: 0.9, examples: [], createdAt: 0, lastUsedAt: 0 },
        { id: 'p2', type: 'api-pattern', description: 'weak pattern', confidence: 0.2, examples: [], createdAt: 0, lastUsedAt: 0 },
      ],
      preferences: { tone: 'concise' },
    }));

    expect(section).toContain('[Tenant Knowledge]');
    expect(section).toContain('"Nightly sync"');
    expect(section).toContain('scheduled');
    expect(section).toContain('kept pattern');
    expect(section).not.toContain('weak pattern'); // confidence <= 0.3 is filtered out
    expect(section).toContain('tone: concise');
  });

  test('renders recent interactions', () => {
    const section = mem.buildKnowledgePromptSection(kb({
      interactions: [{ id: 'i1', prompt: 'how to set vat', summary: 'use VatId', createdAt: 1 }],
    }));
    expect(section).toContain('Recent Q&A');
    expect(section).toContain('how to set vat');
    expect(section).toContain('use VatId');
  });

  test('returns empty string for an empty knowledge base', () => {
    expect(mem.buildKnowledgePromptSection(kb({}))).toBe('');
  });
});

describe('knowledge store round-trip (dedup + decay + persistence)', () => {
  test('addPattern persists and loadKnowledge reads it back', async () => {
    await mem.addPattern({ type: 'common-action', description: 'list before create', confidence: 0.5, examples: ['geins workflow list'] });
    const found = (await mem.loadKnowledge()).patterns.find(p => p.description === 'list before create');
    expect(found).toBeDefined();
    expect(found!.confidence).toBeGreaterThan(0);
  });

  test('re-adding the same pattern dedups and raises confidence', async () => {
    await mem.addPattern({ type: 'common-action', description: 'dedup me', confidence: 0.5, examples: [] });
    const before = (await mem.loadKnowledge()).patterns.find(p => p.description === 'dedup me')!.confidence;
    await mem.addPattern({ type: 'common-action', description: 'dedup me', confidence: 0.5, examples: [] });
    const matches = (await mem.loadKnowledge()).patterns.filter(p => p.description === 'dedup me');
    expect(matches.length).toBe(1);                          // not duplicated
    expect(matches[0]!.confidence).toBeGreaterThan(before);  // +0.1 on repeat
  });

  test('setPreference persists', async () => {
    await mem.setPreference('locale', 'sv-SE');
    expect((await mem.loadKnowledge()).preferences.locale).toBe('sv-SE');
  });

  test('extractMemoryBlocks output round-trips through addFact into the store', async () => {
    const blocks = mem.extractMemoryBlocks('[MEMORY]api:use mgmtRequest for live API[/MEMORY]');
    for (const b of blocks) await mem.addFact({ category: b.category, content: b.content, confidence: 0.7, source: 'test' });
    expect((await mem.loadKnowledge()).patterns.some(p => p.description === 'use mgmtRequest for live API')).toBe(true);
  });

  test('recordInteraction stores prompt + summarized answer, most-recent-first', async () => {
    await mem.recordInteraction('How do I set VAT?', 'Use VatId, not Vat. ```bash\ngeins product update 1 --vat-id 1\n```');
    const kb = await mem.loadKnowledge();
    expect(kb.interactions[0]!.prompt).toBe('How do I set VAT?');
    expect(kb.interactions[0]!.summary).toBe('Use VatId, not Vat.');
  });

  test('recordInteraction skips turns with no usable answer', async () => {
    const before = (await mem.loadKnowledge()).interactions.length;
    await mem.recordInteraction('just code', '```bash\nls\n```');
    expect((await mem.loadKnowledge()).interactions.length).toBe(before);
  });
});

describe('trackApiResponse entity extraction (deterministic, no LLM)', () => {
  test('extracts PascalCase Id/Name from an enveloped product list', async () => {
    await cmd.trackApiResponse('product list', JSON.stringify({ Items: [{ Id: 'P1', Name: 'Widget' }] }));
    expect((await mem.loadKnowledge()).entities.some(e => e.type === 'product' && e.externalId === 'P1' && e.name === 'Widget')).toBe(true);
  });

  test('extracts rows from a bare array (Brand/Query shape)', async () => {
    await cmd.trackApiResponse('product brands list', JSON.stringify([{ id: 'B1', name: 'Acme' }]));
    expect((await mem.loadKnowledge()).entities.some(e => e.externalId === 'B1' && e.name === 'Acme')).toBe(true);
  });

  test('ignores commands with no entity type mapping', async () => {
    const before = (await mem.loadKnowledge()).entities.length;
    await cmd.trackApiResponse('whoami', JSON.stringify([{ id: 'Z', name: 'nope' }]));
    expect((await mem.loadKnowledge()).entities.length).toBe(before);
  });
});
