import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';

const CONFIG_DIR = join(homedir(), '.config', 'geins');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const SESSION_PATH = join(CONFIG_DIR, 'session.json');
const CREDENTIALS_PATH = join(CONFIG_DIR, 'credentials.json');
const INPUT_HISTORY_PATH = join(CONFIG_DIR, 'input-history.json');
const MAX_INPUT_HISTORY = 200;

export interface CopilotConfig {
  cli: string;
  command: string;
  model?: string;
}

export interface GeinsConfig {
  apiUrl?: string;
  defaultAccount?: string;
  outputFormat?: 'table' | 'json';
  /** Folder where API responses and a request log are written. Unset = disabled. */
  outputDir?: string;
  theme?: 'dark' | 'light';
  copilot?: CopilotConfig;
  /** Whether the copilot uses persistent memory (recall + persist + prompt instructions). Default on. */
  memoryEnabled?: boolean;
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
/**
 * Default checkout settings baked into every checkout token (mirrors the SDK's
 * OMSSettings.checkoutUrls / defaultPaymentId / defaultShippingId). Stable per
 * storefront, so set once via `merchant config set`; per-token flags override.
 */
export interface StoredCheckoutDefaults {
  defaultPaymentId?: number;
  defaultShippingId?: number;
  customerType?: 'PERSON' | 'ORGANIZATION';
  /** { terms, privacy, success, cancel, continue } */
  redirectUrls?: { terms?: string; privacy?: string; success?: string; cancel?: string; continue?: string };
  /** { title, icon, logo, styles:{ logoSize, radius, background, ... } } */
  branding?: { title?: string; icon?: string; logo?: string; styles?: Record<string, string> };
}

export interface ApiCredentials {
  username: string;
  managementApiPassword: string;
  managementApiKey: string;
  merchantApiKey: string;
  /**
   * Merchant API (storefront) context, set via `merchant config set`. Optional —
   * the Merchant API has server defaults for many queries, but a usable checkout
   * token needs all of accountName/channel/tld/market/locale. Stored per-profile so
   * switching api-key accounts restores the right context automatically.
   */
  accountName?: string;
  channel?: string;
  tld?: string;
  market?: string;
  locale?: string;
  environment?: 'prod' | 'qa' | 'dev';
  /** Default checkout settings merged into checkout tokens (see StoredCheckoutDefaults). */
  checkout?: StoredCheckoutDefaults;
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

/** TUI up-arrow input recall, bucketed by mode (copilot prompts vs cli commands). */
export interface InputHistory {
  copilot: string[];
  command: string[];
}

function cleanList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

/** Load both input-history buckets (oldest → newest) for recall across sessions. */
export async function loadInputHistory(): Promise<InputHistory> {
  const data = await readJson<Partial<InputHistory>>(INPUT_HISTORY_PATH);
  return { copilot: cleanList(data?.copilot), command: cleanList(data?.command) };
}

export async function saveInputHistory(history: InputHistory): Promise<void> {
  await writeJson(INPUT_HISTORY_PATH, {
    copilot: history.copilot.slice(-MAX_INPUT_HISTORY),
    command: history.command.slice(-MAX_INPUT_HISTORY),
  });
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

/**
 * Merge a partial patch into the active profile (used by `merchant config set` to
 * persist storefront context onto the current api-key profile). Returns the active
 * profile name, or null if there is no active profile.
 */
export async function updateActiveCredentials(patch: Partial<ApiCredentials>): Promise<string | null> {
  const store = await loadCredentialsStore();
  if (!store.active || !store.profiles[store.active]) return null;
  store.profiles[store.active] = { ...store.profiles[store.active]!, ...patch };
  await saveCredentialsStore(store);
  return store.active;
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
