import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';

const CONFIG_DIR = join(homedir(), '.config', 'geins');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const SESSION_PATH = join(CONFIG_DIR, 'session.json');

export interface CopilotConfig {
  cli: string;
  command: string;
  model?: string;
}

export interface GeinsConfig {
  apiUrl?: string;
  defaultAccount?: string;
  outputFormat?: 'table' | 'json';
  theme?: 'dark' | 'light';
  copilot?: CopilotConfig;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accountKey: string;
  accountName: string;
  tokenExpires: number;
  user: {
    email: string;
    name: string;
    roles: string[];
  };
}

async function ensureDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson<T>(path: string, data: T): Promise<void> {
  await ensureDir();
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

export async function loadConfig(): Promise<GeinsConfig> {
  return (await readJson<GeinsConfig>(CONFIG_PATH)) ?? {};
}

export async function saveConfig(config: GeinsConfig): Promise<void> {
  await writeJson(CONFIG_PATH, config);
}

export async function loadSession(): Promise<StoredSession | null> {
  return readJson<StoredSession>(SESSION_PATH);
}

export async function saveSession(session: StoredSession): Promise<void> {
  await writeJson(SESSION_PATH, session);
}

export async function clearSession(): Promise<void> {
  try {
    await unlink(SESSION_PATH);
  } catch {
    // Already gone
  }
}
