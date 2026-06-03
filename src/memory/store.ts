import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, appendFile, stat, rename, access } from 'node:fs/promises';
import { loadSession, loadCredentialsStore } from '../config/store.ts';

const BASE_DIR = join(homedir(), '.config', 'geins', 'memory');
const SHARED_DIR = join(BASE_DIR, '_shared');

let currentAccountKey: string | undefined;
let migrationDone = false;

export function setMemoryAccount(key?: string): void {
  currentAccountKey = key;
  migrationDone = false;
}

export function getMemoryAccount(): string | undefined {
  return currentAccountKey;
}

/** Keep account-key segments filesystem-safe and free of the `__` composite separator. */
function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9.-]+/g, '-');
}

/**
 * The composite memory-account key: `{v2SessionAccountKey}__{activeApikeyProfile}`.
 * Either part is omitted when absent; returns `undefined` when neither exists (→ the
 * `_shared` bucket). Memory is keyed by this so chat history, command context, and
 * knowledge stay compartmentalized per account and never leak across an /apikey switch.
 */
export async function resolveMemoryAccountKey(): Promise<string | undefined> {
  const [session, creds] = await Promise.all([loadSession(), loadCredentialsStore()]);
  const parts = [session?.accountKey, creds.active]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map(sanitizeSegment);
  return parts.length ? parts.join('__') : undefined;
}

/** Resolve the composite key for the active session + apikey profile and apply it. */
export async function applyMemoryAccount(): Promise<string | undefined> {
  const key = await resolveMemoryAccountKey();
  setMemoryAccount(key);
  return key;
}

function getMemoryDir(): string {
  return currentAccountKey ? join(BASE_DIR, currentAccountKey) : SHARED_DIR;
}

function buildPaths(dir: string) {
  const sessionsDir = join(dir, 'sessions');
  return {
    chatHistory: join(dir, 'chat-history.jsonl'),
    commandContext: join(dir, 'command-context.json'),
    sessionsDir,
    sessionIndex: join(sessionsDir, 'index.json'),
    knowledge: join(dir, 'knowledge.json'),
    manifestCache: join(dir, 'manifest-cache.json'),
  };
}

export type MemoryPaths = ReturnType<typeof buildPaths>;

export function getPaths(): MemoryPaths {
  return buildPaths(getMemoryDir());
}

// Legacy compat — modules that import PATHS get a proxy that resolves dynamically
export const PATHS: MemoryPaths = new Proxy({} as MemoryPaths, {
  get(_target, prop: string) {
    return getPaths()[prop as keyof MemoryPaths];
  },
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function migrateLegacyFiles(): Promise<void> {
  if (migrationDone || !currentAccountKey) return;
  migrationDone = true;

  const targetDir = getMemoryDir();
  const targetKnowledge = join(targetDir, 'knowledge.json');

  if (await fileExists(targetKnowledge)) return;

  const legacyFiles = ['chat-history.jsonl', 'command-context.json', 'knowledge.json'];
  const legacySessionsDir = join(BASE_DIR, 'sessions');

  for (const file of legacyFiles) {
    const src = join(BASE_DIR, file);
    const dest = join(targetDir, file);
    if (await fileExists(src)) {
      try { await rename(src, dest); } catch { /* cross-device or permission — skip */ }
    }
  }

  const targetSessionsDir = join(targetDir, 'sessions');
  if (await fileExists(legacySessionsDir) && !(await fileExists(targetSessionsDir))) {
    try { await rename(legacySessionsDir, targetSessionsDir); } catch { /* skip */ }
  }
}

export async function ensureMemoryDirs(): Promise<void> {
  const paths = getPaths();
  await mkdir(paths.sessionsDir, { recursive: true });
  await migrateLegacyFiles();
}

export async function appendJsonl<T>(path: string, record: T): Promise<void> {
  await ensureMemoryDirs();
  await appendFile(path, JSON.stringify(record) + '\n', { mode: 0o600 });
}

export async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    const raw = await readFile(path, 'utf-8');
    return raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

export async function writeJsonl<T>(path: string, records: T[]): Promise<void> {
  await ensureMemoryDirs();
  const content = records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  await writeFile(path, content, { mode: 0o600 });
}

export async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonSafe<T>(path: string, data: T): Promise<void> {
  await ensureMemoryDirs();
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

export async function getFileSize(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return 0;
  }
}
