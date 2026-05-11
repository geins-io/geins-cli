import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises';

const MEMORY_DIR = join(homedir(), '.config', 'geins', 'memory');
const SESSIONS_DIR = join(MEMORY_DIR, 'sessions');

export const PATHS = {
  chatHistory: join(MEMORY_DIR, 'chat-history.jsonl'),
  commandContext: join(MEMORY_DIR, 'command-context.json'),
  sessionsDir: SESSIONS_DIR,
  sessionIndex: join(SESSIONS_DIR, 'index.json'),
  knowledge: join(MEMORY_DIR, 'knowledge.json'),
} as const;

export async function ensureMemoryDirs(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
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
