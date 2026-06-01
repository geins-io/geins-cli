import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';

const CONFIG_DIR = join(homedir(), '.config', 'geins');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const SESSION_PATH = join(CONFIG_DIR, 'session.json');
const CREDENTIALS_PATH = join(CONFIG_DIR, 'credentials.json');

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

/**
 * Geins API User credentials, as issued in Merchant Center (Settings → API Users).
 * One API user carries credentials for both live APIs:
 *   - Management API (REST): Basic Auth (username + managementApiPassword) + X-ApiKey (managementApiKey)
 *   - Merchant API (GraphQL): X-ApiKey (merchantApiKey)
 */
export interface ApiCredentials {
  username: string;
  managementApiPassword: string;
  managementApiKey: string;
  merchantApiKey: string;
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

/**
 * Multiple live-API credential profiles. The live APIs are single-account (unlike
 * the v2 session), so each profile is one account's API User. Profiles are keyed by
 * their Management API Key (e.g. "prod-elproman"), and one is active at a time.
 */
export interface CredentialsStore {
  active: string | null;
  profiles: Record<string, ApiCredentials>;
}

function isCredentialsStore(value: unknown): value is CredentialsStore {
  return typeof value === 'object' && value !== null && 'profiles' in value;
}

export async function loadCredentialsStore(): Promise<CredentialsStore> {
  const raw = await readJson<unknown>(CREDENTIALS_PATH);
  if (raw === null) {
    return { active: null, profiles: {} };
  }
  if (isCredentialsStore(raw)) {
    return raw;
  }
  // Migrate the legacy single-profile format (a bare ApiCredentials object).
  const legacy = raw as ApiCredentials;
  if (legacy.managementApiKey) {
    return { active: legacy.managementApiKey, profiles: { [legacy.managementApiKey]: legacy } };
  }
  return { active: null, profiles: {} };
}

async function saveCredentialsStore(store: CredentialsStore): Promise<void> {
  await writeJson(CREDENTIALS_PATH, store);
}

/** The credentials for the active profile, or null if none. */
export async function loadCredentials(): Promise<ApiCredentials | null> {
  const store = await loadCredentialsStore();
  return store.active ? (store.profiles[store.active] ?? null) : null;
}

/** The credentials for a specific profile by name, or null if unknown. */
export async function loadCredentialsByName(name: string): Promise<ApiCredentials | null> {
  const store = await loadCredentialsStore();
  return store.profiles[name] ?? null;
}

/** Add (or replace) a profile keyed by its Management API Key and make it active. Returns the profile name. */
export async function addCredentials(credentials: ApiCredentials): Promise<string> {
  const store = await loadCredentialsStore();
  const name = credentials.managementApiKey;
  store.profiles[name] = credentials;
  store.active = name;
  await saveCredentialsStore(store);
  return name;
}

/** Switch the active profile. Returns false if the name is unknown. */
export async function useCredentials(name: string): Promise<boolean> {
  const store = await loadCredentialsStore();
  if (!store.profiles[name]) return false;
  store.active = name;
  await saveCredentialsStore(store);
  return true;
}

/** Remove a single profile. If it was active, the active pointer moves to any remaining profile. */
export async function removeCredentials(name: string): Promise<boolean> {
  const store = await loadCredentialsStore();
  if (!store.profiles[name]) return false;
  delete store.profiles[name];
  if (store.active === name) {
    store.active = Object.keys(store.profiles)[0] ?? null;
  }
  await saveCredentialsStore(store);
  return true;
}

/** Remove all profiles. */
export async function clearCredentials(): Promise<void> {
  try {
    await unlink(CREDENTIALS_PATH);
  } catch {
    // Already gone
  }
}
