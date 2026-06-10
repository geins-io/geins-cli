import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdir, readFile, writeFile, appendFile, stat, rename, access } from 'node:fs/promises';
import { loadSession, loadCredentialsStore } from '../config/store.ts';

/**
 * The global Synapse memory folder — the single root every model backend and every account
 * reads from and writes to. This is what the `/memory` command refers to. Resolved LAZILY
 * (not captured at import time). `GEINS_SYNAPSE_DIR` overrides the default `~/.synapse` base
 * (legacy `GEINS_CONFIG_DIR` is still honored as a fallback) — used to relocate or sandbox
 * state, and the only reliable way to redirect it in tests: Bun's `os.homedir()` caches at
 * process start and ignores a runtime-mutated `process.env.HOME`, so a test must set
 * `GEINS_SYNAPSE_DIR` instead. Per-account subfolders live directly inside this root, named
 * `{accountName}_{apikeyProfile}` (e.g. `launch5_prod-launch5`); `_shared` holds account-less state.
 */
function baseDir(): string {
  return process.env.GEINS_SYNAPSE_DIR || process.env.GEINS_CONFIG_DIR || join(homedir(), '.synapse');
}
function sharedDir(): string {
  return join(baseDir(), '_shared');
}

let currentAccountKey: string | undefined;
let migrationDone = false;

export function setMemoryAccount(key?: string): void {
  currentAccountKey = key;
  migrationDone = false;
}

export function getMemoryAccount(): string | undefined {
  return currentAccountKey;
}

/** Keep account-key segments filesystem-safe and free of the `_` bucket separator. */
function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9.-]+/g, '-');
}

function joinSegments(parts: Array<string | undefined>, sep: string): string | undefined {
  const present = parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map(sanitizeSegment);
  return present.length ? present.join(sep) : undefined;
}

interface AccountKeyResolution {
  key?: string;
  /** The pre-2026-06 format `{v2AccountKey}__{profile}` — only used to rename old folders. */
  legacyKey?: string;
}

async function resolveAccountKeys(): Promise<AccountKeyResolution> {
  const [session, creds] = await Promise.all([loadSession(), loadCredentialsStore()]);
  const profileName = creds.active ?? undefined;
  // Human-readable account name: the active profile's own accountName (set via
  // `merchant config set --store-account`) wins; the v2 session's accountName is the fallback.
  const accountName =
    (profileName ? creds.profiles[profileName]?.accountName : undefined) || session?.accountName;
  return {
    key: joinSegments([accountName, profileName], '_'),
    legacyKey: joinSegments([session?.accountKey, profileName], '__'),
  };
}

/**
 * The memory-account key: `{accountName}_{activeApikeyProfile}` — e.g. `launch5_prod-launch5`.
 * Either part is omitted when absent; returns `undefined` when neither exists (→ the
 * `_shared` bucket). Memory is keyed by this so chat history, command context, and
 * knowledge stay compartmentalized per account and never leak across an /apikey switch.
 * Segments are sanitized to [A-Za-z0-9.-], so the single `_` separator stays unambiguous.
 */
export async function resolveMemoryAccountKey(): Promise<string | undefined> {
  return (await resolveAccountKeys()).key;
}

/**
 * Rename a legacy-format account folder (`{v2AccountKey}__{profile}`) under `base` to the
 * current `{accountName}_{profile}` name, unless the new one already exists. Applies to both
 * the Synapse memory root and the output dir, which mirror each other's per-account layout.
 */
export async function migrateLegacyAccountDir(base: string): Promise<void> {
  const { key, legacyKey } = await resolveAccountKeys();
  if (!key || !legacyKey || key === legacyKey) return;
  const oldDir = join(base, legacyKey);
  const newDir = join(base, key);
  if ((await fileExists(oldDir)) && !(await fileExists(newDir))) {
    try { await rename(oldDir, newDir); } catch { /* cross-device or permission — start fresh */ }
  }
}

/** Resolve the bucket key for the active session + apikey profile and apply it. */
export async function applyMemoryAccount(): Promise<string | undefined> {
  // Relocate a pre-Synapse store to ~/.synapse before anything reads from it — otherwise a
  // read-only command (memory list, copilot prompt build) would see the empty new root and
  // appear to have lost all memory until the first write triggered the move.
  await migrateSynapseRoot();
  // Same idea for the bucket itself: rename an old `{accountKey}__{profile}` folder to the
  // readable `{accountName}_{profile}` form before the first read.
  await migrateLegacyAccountDir(baseDir());
  const key = await resolveMemoryAccountKey();
  setMemoryAccount(key);
  return key;
}

function getMemoryDir(): string {
  return currentAccountKey ? join(baseDir(), currentAccountKey) : sharedDir();
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

let rootMigrationDone = false;

/**
 * One-time relocation of the pre-Synapse store. Earlier versions kept memory at
 * `~/.config/geins/memory`; everything now lives in the global `~/.synapse` folder. If the new
 * root doesn't exist yet but the old one does, move the whole tree across (account subfolders and
 * all). Only runs for the default location — an explicit `GEINS_SYNAPSE_DIR`/`GEINS_CONFIG_DIR`
 * override is assumed to manage its own directory.
 */
async function migrateSynapseRoot(): Promise<void> {
  if (rootMigrationDone) return;
  rootMigrationDone = true;
  if (process.env.GEINS_SYNAPSE_DIR || process.env.GEINS_CONFIG_DIR) return;

  const newRoot = baseDir();
  if (await fileExists(newRoot)) return;

  const oldRoot = join(homedir(), '.config', 'geins', 'memory');
  if (!(await fileExists(oldRoot))) return;

  try {
    await mkdir(dirname(newRoot), { recursive: true });
    await rename(oldRoot, newRoot);
  } catch { /* cross-device or permission — leave the old tree, a fresh root is created below */ }
}

async function migrateLegacyFiles(): Promise<void> {
  if (migrationDone || !currentAccountKey) return;
  migrationDone = true;

  const targetDir = getMemoryDir();
  const targetKnowledge = join(targetDir, 'knowledge.json');

  if (await fileExists(targetKnowledge)) return;

  const legacyFiles = ['chat-history.jsonl', 'command-context.json', 'knowledge.json'];
  const legacySessionsDir = join(baseDir(), 'sessions');

  for (const file of legacyFiles) {
    const src = join(baseDir(), file);
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
  await migrateSynapseRoot();
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
