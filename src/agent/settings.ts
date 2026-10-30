// Studio agent settings, shared by `geins serve`, `geins studio …` and the
// Synapse TUI's `/studio` command. Stored in the CLI config so Synapse and a
// plain terminal agree, and read per Studio connection so a change applies to
// the next agent session without restarting the helper.
import { randomBytes } from 'node:crypto';
import { loadConfig, saveConfig, type StudioAgentConfig } from '../config/store.ts';
import type { AgentPermissionMode, AgentProvider } from './protocol.ts';

export const DEFAULT_AGENT_PORT = 4317;
const DEFAULT_STUDIO_ORIGINS = ['http://localhost:3000'];

export interface AgentSettings {
  mode: 'standard' | 'full';
  permissionMode: AgentPermissionMode;
  provider: AgentProvider;
  studioOrigins: string[];
  /** The Studio site paired most recently, else the first allowed one. */
  lastOrigin: string;
}

export async function loadAgentSettings(): Promise<AgentSettings> {
  const stored = (await loadConfig()).studioAgent ?? {};
  const mode = stored.mode === 'full' ? 'full' : 'standard';
  const studioOrigins = stored.studioOrigins?.length ? stored.studioOrigins : DEFAULT_STUDIO_ORIGINS;
  return {
    mode,
    permissionMode: stored.permissionMode ?? (mode === 'full' ? 'auto' : 'default'),
    provider: stored.provider === 'codex' ? 'codex' : 'claude',
    studioOrigins,
    lastOrigin: stored.lastOrigin ?? studioOrigins[0]!,
  };
}

export async function updateAgentSettings(patch: Partial<StudioAgentConfig>): Promise<void> {
  const config = await loadConfig();
  await saveConfig({ ...config, studioAgent: { ...config.studioAgent, ...patch } });
}

/** The pairing secret, created on first use. Rotating it un-pairs every Studio tab. */
export async function pairingToken({ rotate = false } = {}): Promise<string> {
  const existing = (await loadConfig()).studioAgent?.pairingToken;
  if (existing && !rotate) return existing;
  const token = randomBytes(24).toString('base64url');
  await updateAgentSettings({ pairingToken: token });
  return token;
}

/** Origins allowed to open /agent: settings plus `GEINS_SERVE_ORIGINS`. */
export function allowedOrigins(settings: AgentSettings): string[] {
  const fromEnv = (process.env['GEINS_SERVE_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const valid = [...settings.studioOrigins, ...fromEnv].flatMap((origin) => {
    try {
      return [normalizeOrigin(origin)];
    } catch {
      return []; // e.g. a "null" saved before origins were checked
    }
  });
  return valid.length ? [...new Set(valid)] : DEFAULT_STUDIO_ORIGINS;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * `https://studio.example` / `https://studio.example/` → `https://studio.example`.
 * Throws for anything but https, or http on this computer: `file:`/`data:`
 * URLs have the origin "null", which sandboxed pages also send.
 */
export function normalizeOrigin(value: string): string {
  const url = new URL(value);
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (!allowed) throw new Error(`Not a Studio URL: ${value}`);
  return url.origin;
}

/**
 * Opening this link pairs a Studio tab: the token and port ride in the URL
 * fragment, which the browser never sends to Studio's server.
 */
export function pairingLink(studioOrigin: string, token: string, port: number): string {
  return `${normalizeOrigin(studioOrigin)}/#geins-agent=${token}:${port}`;
}

/** The port of the `geins serve` this process belongs to (Synapse's TUI), else the default. */
export function helperPort(): number {
  const port = Number(process.env['GEINS_SERVE_PORT']);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_AGENT_PORT;
}

export function openInBrowser(url: string): void {
  // rundll32 instead of `cmd /c start`: no shell, so nothing in the URL is parsed.
  const command =
    process.platform === 'win32'
      ? ['rundll32', 'url.dll,FileProtocolHandler', url]
      : process.platform === 'darwin'
        ? ['open', url]
        : ['xdg-open', url];
  Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' });
}
