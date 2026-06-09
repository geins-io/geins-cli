import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from '../config/store.ts';
import { getMemoryAccount, resolveMemoryAccountKey } from '../memory/store.ts';

let cachedDir: string | null | undefined; // undefined = not yet resolved
let cachedAccountSeg: string | undefined; // disk-resolved fallback (cli/subprocess has no in-process account)
let counter = 0;

function expand(dir: string): string {
  let d = dir;
  if (d === '~' || d.startsWith('~/')) d = join(homedir(), d.slice(1));
  return isAbsolute(d) ? d : resolve(process.cwd(), d);
}

/**
 * Override the output dir for this process (e.g. the --out flag or GEINS_OUTPUT_DIR).
 * Pass null to explicitly disable; pass undefined to fall back to config again.
 */
export function setOutputDir(dir: string | null | undefined): void {
  cachedDir = dir === undefined ? undefined : dir === null ? null : expand(dir);
}

async function resolveDir(): Promise<string | null> {
  if (cachedDir !== undefined) return cachedDir;
  const env = process.env['GEINS_OUTPUT_DIR'];
  if (env) {
    cachedDir = expand(env);
  } else {
    const cfg = await loadConfig();
    cachedDir = cfg.outputDir ? expand(cfg.outputDir) : null;
  }
  return cachedDir;
}

/**
 * The base output dir (override > GEINS_OUTPUT_DIR > config), or null if disabled.
 * This is the UN-nested root — used for status display and as the GEINS_OUTPUT_DIR
 * handed to copilot subprocesses (they re-nest once, rather than double-nesting).
 */
export async function getOutputDir(): Promise<string | null> {
  return resolveDir();
}

/**
 * The per-account subfolder under the base, mirroring the memory layout
 * (`<base>/<composite-account-key>`, or `<base>/_shared` when no account is active).
 * Prefer the in-process account (reflects live /apikey switches in the TUI); fall back
 * to resolving from disk for the direct CLI / copilot subprocess which never applies it.
 */
async function accountSegment(): Promise<string> {
  const live = getMemoryAccount();
  if (live) return live;
  if (cachedAccountSeg === undefined) {
    cachedAccountSeg = (await resolveMemoryAccountKey()) ?? '_shared';
  }
  return cachedAccountSeg;
}

/** The account-nested write dir (`<base>/<account>`), or null if output is disabled. */
export async function getAccountOutputDir(): Promise<string | null> {
  const base = await resolveDir();
  return base ? join(base, await accountSegment()) : null;
}

/** Resolve the account-nested output dir and create it if set. Returns the absolute path, or null if disabled. */
export async function ensureOutputDir(): Promise<string | null> {
  const dir = await getAccountOutputDir();
  if (!dir) return null;
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // If creation fails, still return the path; the caller decides how to handle it.
  }
  return dir;
}

function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function slug(path: string): string {
  return (
    path
      .replace(/^\//, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'root'
  );
}

export interface ResponseRecord {
  method: string;
  path: string;
  status: number;
  /** URL query params sent with the request, if any. Rendered onto the logged path. */
  query?: Record<string, unknown>;
  /** Request body sent to the endpoint, if any (object, or a pre-stringified payload). */
  body?: unknown;
  data?: unknown;
  error?: string;
}

/** Render a query object as a `?a=1&b=2` string (skipping null/undefined); '' when empty. */
function queryString(query?: Record<string, unknown>): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

const MAX_BODY_LOG = 2000;

/** Compact a request body to a single line for the log, truncating very large payloads. */
function compactBody(body: unknown): string {
  if (body === undefined || body === null) return '';
  let s: string;
  if (typeof body === 'string') s = body;
  else {
    try { s = JSON.stringify(body); } catch { s = String(body); }
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > MAX_BODY_LOG ? `${s.slice(0, MAX_BODY_LOG)}… (${s.length} chars)` : s;
}

/**
 * Best-effort: write a response body to a timestamped JSON file and append a line
 * to requests.log. The log line records the full request — method, path, query params,
 * and the body sent — alongside the response status. A no-op that never throws when no
 * output dir is configured. Returns the dump file path, or null.
 */
export async function recordResponse(record: ResponseRecord): Promise<string | null> {
  try {
    const dir = await getAccountOutputDir();
    if (!dir) return null;
    await mkdir(dir, { recursive: true });

    const seq = String(++counter).padStart(4, '0');
    let file: string | null = null;

    if (record.data !== undefined && !record.error) {
      file = join(dir, `${fileStamp()}_${seq}_${record.method}_${slug(record.path)}.json`);
      await writeFile(file, JSON.stringify(record.data, null, 2) + '\n');
    }

    const stamp = new Date().toISOString();
    // Request half: METHOD path?query [body {...}] — describes what was sent.
    const bodyStr = compactBody(record.body);
    const reqPart = `${record.method} ${record.path}${queryString(record.query)}${bodyStr ? ` body ${bodyStr}` : ''}`;
    // Response half: → status (ERROR …) / saved file.
    const line = record.error
      ? `[${stamp}] ${reqPart} → ${record.status} ERROR ${record.error.replace(/\s+/g, ' ').slice(0, 200)}`
      : `[${stamp}] ${reqPart} → ${record.status}${file ? ` saved ${file.split('/').pop()}` : ''}`;
    await appendFile(join(dir, 'requests.log'), line + '\n');

    return file;
  } catch {
    // Never let logging break a request.
    return null;
  }
}
