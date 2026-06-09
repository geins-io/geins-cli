// CLI self-update (OTA). Reads the same `latest.json` manifest published to
// GitHub Releases that the Tauri desktop updater consumes, downloads the binary
// for this platform, verifies its SHA-256, and atomically swaps it over the
// running executable.
//
// The manifest is Tauri-updater shaped (so the desktop app can read it too) with
// an extra `cli` section this command reads:
//
//   {
//     "version": "0.1.1",
//     "platforms": { ...tauri bundles... },
//     "cli": {
//       "darwin-aarch64": { "url": "https://.../geins-aarch64-apple-darwin", "sha256": "<hex>" },
//       "darwin-x86_64":  { ... },
//       "linux-x86_64":   { ... },
//       "windows-x86_64": { "url": "https://.../geins-x86_64-pc-windows-msvc.exe", "sha256": "<hex>" }
//     }
//   }
import { chmodSync, renameSync, unlinkSync } from 'node:fs';
import { isCompiled } from '../runtime.ts';
import { getUpdateManifestUrl } from '../config/env.ts';
import { VERSION } from '../version.ts';

interface CliAsset {
  url: string;
  sha256?: string;
}
interface UpdateManifest {
  version: string;
  notes?: string;
  cli?: Record<string, CliAsset>;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  asset?: CliAsset;
  platformKey: string;
}

/** Map this process's platform/arch to the manifest key, e.g. `darwin-aarch64`. */
export function platformKey(): string {
  const osMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap: Record<string, string> = { arm64: 'aarch64', x64: 'x86_64' };
  const os = osMap[process.platform] ?? process.platform;
  const arch = archMap[process.arch] ?? process.arch;
  return `${os}-${arch}`;
}

/** Compare two dotted semver-ish strings. Returns >0 if a>b, <0 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Fetch the manifest and report whether a newer build exists for this platform. */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const res = await fetch(getUpdateManifestUrl(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Failed to fetch update manifest (${res.status})`);
  const manifest = (await res.json()) as UpdateManifest;
  const key = platformKey();
  const asset = manifest.cli?.[key];
  return {
    current: VERSION,
    latest: manifest.version,
    available: compareVersions(manifest.version, VERSION) > 0,
    asset,
    platformKey: key,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex');
}

/**
 * Perform the update: download the new binary, verify, and swap it over the
 * current executable. Returns the version installed.
 */
export async function performUpdate(info: UpdateInfo): Promise<string> {
  if (!info.asset) {
    throw new Error(`No CLI build published for this platform (${info.platformKey}).`);
  }
  const target = process.execPath;

  const res = await fetch(info.asset.url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${info.asset.url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  if (info.asset.sha256) {
    const got = await sha256Hex(bytes);
    if (got.toLowerCase() !== info.asset.sha256.toLowerCase()) {
      throw new Error(`Checksum mismatch — refusing to install (expected ${info.asset.sha256}, got ${got}).`);
    }
  }

  // Write next to the target so the rename is atomic (same filesystem).
  const tmp = `${target}.new`;
  await Bun.write(tmp, bytes);
  chmodSync(tmp, 0o755);

  if (process.platform === 'win32') {
    // A running .exe can't be overwritten on Windows. Stage it and replace the
    // old one on the side; the user re-runs to pick up the new binary.
    const old = `${target}.old`;
    try { unlinkSync(old); } catch { /* ignore */ }
    renameSync(target, old);
    renameSync(tmp, target);
  } else {
    // On Unix the running process keeps the old inode; renaming over it is safe.
    renameSync(tmp, target);
  }

  return info.latest;
}

/** `geins update [--check]` */
export async function updateCommand(args: string[]): Promise<void> {
  const checkOnly = args.includes('--check');

  if (!isCompiled()) {
    console.error(
      'Self-update only applies to the compiled binary. This looks like a dev/`bun link` install — update via git.',
    );
    return;
  }

  const info = await checkForUpdate();
  if (!info.available) {
    console.log(`geins ${info.current} is up to date.`);
    return;
  }

  console.log(`Update available: ${info.current} → ${info.latest}`);
  if (checkOnly) {
    console.log('Run `geins update` to install.');
    return;
  }
  if (!info.asset) {
    console.error(`No CLI build for this platform (${info.platformKey}).`);
    process.exit(1);
  }

  console.log(`Downloading ${info.asset.url} …`);
  const installed = await performUpdate(info);
  console.log(`✓ Updated to ${installed}. Restart geins to use the new version.`);
}
