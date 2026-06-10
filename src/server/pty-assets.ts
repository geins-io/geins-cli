// DEV resolver for the node-pty native pieces (pty.node + macOS spawn-helper).
//
// When the CLI is compiled (`bun build --compile`), scripts/build-cli.ts swaps
// this module for a generated one that EMBEDS the same files and extracts them
// at runtime via pty-extract.ts. Keep the exported surface identical.
import { createRequire } from 'node:module';
import { chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type { PtyAssets } from './pty-extract.ts';
import type { PtyAssets } from './pty-extract.ts';

export async function resolvePtyAssets(): Promise<PtyAssets | null> {
  if (process.platform === 'win32') return null;
  let pkgDir: string;
  try {
    pkgDir = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  } catch {
    return null;
  }
  const candidates = [
    join(pkgDir, 'build', 'Release'), // node-gyp output (Linux — no shipped prebuild)
    join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`), // shipped (macOS)
  ];
  for (const dir of candidates) {
    const ptyPath = join(dir, 'pty.node');
    if (!existsSync(ptyPath)) continue;
    const helperPath = join(dir, 'spawn-helper');
    if (existsSync(helperPath)) {
      // bun install doesn't preserve the prebuild's exec bit; fork() needs it.
      try { chmodSync(helperPath, 0o755); } catch { /* read-only store — fork will fail loudly */ }
    }
    return { ptyPath, helperPath };
  }
  return null;
}
