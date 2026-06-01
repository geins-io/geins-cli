import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from '../config/store.ts';

let cachedDir: string | null | undefined; // undefined = not yet resolved
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

/** The resolved output dir (override > GEINS_OUTPUT_DIR > config), or null if disabled. */
export async function getOutputDir(): Promise<string | null> {
  return resolveDir();
}

/** Resolve the output dir and create it if set. Returns the absolute path, or null if disabled. */
export async function ensureOutputDir(): Promise<string | null> {
  const dir = await resolveDir();
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
  data?: unknown;
  error?: string;
}

/**
 * Best-effort: write a response body to a timestamped JSON file and append a line
 * to requests.log. A no-op that never throws when no output dir is configured.
 * Returns the dump file path, or null.
 */
export async function recordResponse(record: ResponseRecord): Promise<string | null> {
  try {
    const dir = await resolveDir();
    if (!dir) return null;
    await mkdir(dir, { recursive: true });

    const seq = String(++counter).padStart(4, '0');
    let file: string | null = null;

    if (record.data !== undefined && !record.error) {
      file = join(dir, `${fileStamp()}_${seq}_${record.method}_${slug(record.path)}.json`);
      await writeFile(file, JSON.stringify(record.data, null, 2) + '\n');
    }

    const stamp = new Date().toISOString();
    const line = record.error
      ? `[${stamp}] ${record.method} ${record.path} → ${record.status} ERROR ${record.error.replace(/\s+/g, ' ').slice(0, 200)}`
      : `[${stamp}] ${record.method} ${record.path} → ${record.status}${file ? ` saved ${file.split('/').pop()}` : ''}`;
    await appendFile(join(dir, 'requests.log'), line + '\n');

    return file;
  } catch {
    // Never let logging break a request.
    return null;
  }
}
