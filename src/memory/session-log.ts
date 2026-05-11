import { join } from 'node:path';
import type { SessionEntry, SessionIndex } from './types.ts';
import { PATHS, appendJsonl, readJsonl, readJsonSafe, writeJsonSafe, getFileSize, ensureMemoryDirs } from './store.ts';
import { unlink } from 'node:fs/promises';

const MAX_SESSIONS = 20;

let currentSessionId: string | null = null;
let currentSessionPath: string | null = null;
let entryCount = 0;

export async function startSession(account?: string): Promise<string> {
  await ensureMemoryDirs();
  currentSessionId = String(Date.now());
  currentSessionPath = join(PATHS.sessionsDir, `${currentSessionId}.jsonl`);
  entryCount = 0;

  const index = await loadIndex();
  index.sessions.push({
    id: currentSessionId,
    startedAt: Date.now(),
    entryCount: 0,
    account,
    sizeBytes: 0,
  });
  await writeJsonSafe(PATHS.sessionIndex, index);
  await pruneOldSessions(index);
  return currentSessionId;
}

export async function logEntry(entry: Omit<SessionEntry, 'timestamp'>): Promise<void> {
  if (!currentSessionPath) return;
  const record: SessionEntry = { ...entry, timestamp: Date.now() };
  await appendJsonl(currentSessionPath, record);
  entryCount++;
}

export async function endSession(): Promise<void> {
  if (!currentSessionId || !currentSessionPath) return;
  const index = await loadIndex();
  const entry = index.sessions.find(s => s.id === currentSessionId);
  if (entry) {
    entry.endedAt = Date.now();
    entry.entryCount = entryCount;
    entry.sizeBytes = await getFileSize(currentSessionPath);
    await writeJsonSafe(PATHS.sessionIndex, index);
  }
  currentSessionId = null;
  currentSessionPath = null;
}

export async function loadIndex(): Promise<SessionIndex> {
  return (await readJsonSafe<SessionIndex>(PATHS.sessionIndex)) ?? { sessions: [] };
}

export async function loadSessionEntries(sessionId: string): Promise<SessionEntry[]> {
  const path = join(PATHS.sessionsDir, `${sessionId}.jsonl`);
  return readJsonl<SessionEntry>(path);
}

export async function searchSessions(query: string): Promise<Array<{ sessionId: string; entries: SessionEntry[] }>> {
  const index = await loadIndex();
  const results: Array<{ sessionId: string; entries: SessionEntry[] }> = [];
  const q = query.toLowerCase();
  for (const s of index.sessions.slice(-10)) {
    const entries = await loadSessionEntries(s.id);
    const matches = entries.filter(e => e.content.toLowerCase().includes(q));
    if (matches.length > 0) results.push({ sessionId: s.id, entries: matches });
  }
  return results;
}

async function pruneOldSessions(index: SessionIndex): Promise<void> {
  if (index.sessions.length <= MAX_SESSIONS) return;
  const toRemove = index.sessions.splice(0, index.sessions.length - MAX_SESSIONS);
  for (const s of toRemove) {
    try {
      await unlink(join(PATHS.sessionsDir, `${s.id}.jsonl`));
    } catch { /* already gone */ }
  }
  await writeJsonSafe(PATHS.sessionIndex, index);
}
