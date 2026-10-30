// Ties the Sonora Management API plugin (sonora:mgmtapi skill) to the account
// open in Studio, so the agent's Sonora calls hit the same account as the UI.
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PLUGIN_CACHE = join(homedir(), '.claude', 'plugins', 'cache');

/** The newest installed copy of the plugin's profile script, if any. */
function findProfileScript(): string | undefined {
  const candidates: string[] = [];
  let marketplaces: string[] = [];
  try {
    marketplaces = readdirSync(PLUGIN_CACHE);
  } catch {
    return undefined;
  }
  for (const marketplace of marketplaces) {
    const pluginDir = join(PLUGIN_CACHE, marketplace, 'sonora');
    let versions: string[] = [];
    try {
      versions = readdirSync(pluginDir);
    } catch {
      continue;
    }
    for (const version of versions) {
      candidates.push(join(pluginDir, version, 'skills', 'mgmtapi', 'scripts', 'profile.js'));
    }
  }
  const existing = candidates.filter((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
  return existing.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** Configured profile names, via the plugin itself so every credential source counts. */
async function listProfiles(): Promise<string[]> {
  const script = findProfileScript();
  if (!script) return [];
  const env = { ...process.env };
  delete env['SONORA_MGMT_API_PROFILE'];
  const proc = Bun.spawn(['node', script, '--list'], { stdout: 'pipe', stderr: 'pipe', env });
  const output = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0] ?? '')
    .filter((name) => /^[A-Za-z0-9._-]+$/.test(name));
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The Sonora profile named like the Studio account ("Monitor" → `monitor`),
 * or undefined when none matches — then the plugin asks as it normally does.
 */
export async function sonoraProfileForAccount(accountName?: string): Promise<string | undefined> {
  if (!accountName) return undefined;
  const wanted = normalize(accountName);
  if (!wanted) return undefined;
  return (await listProfiles()).find((profile) => normalize(profile) === wanted);
}

/** Env for the agent process: pin the profile and skip the plugin's "which profile?" prompt. */
export function sonoraEnv(profile: string | undefined): Record<string, string> {
  return profile
    ? { SONORA_MGMT_API_PROFILE: profile, SONORA_MGMT_API_PROFILE_PROMPT: 'never' }
    : {};
}
