#!/usr/bin/env bun
/**
 * Compiles the CLI and stages it as a Tauri sidecar binary.
 *
 * Tauri resolves an `externalBin` entry `binaries/geins` to a file named
 * `geins-<target-triple>` (plus `.exe` on Windows). This script builds the CLI
 * with `bun build --compile` and copies it to that location so `tauri dev` /
 * `tauri build` can find it.
 *
 * Usage:
 *   bun run scripts/stage-sidecar.ts                       # host triple
 *   bun run scripts/stage-sidecar.ts --triple x86_64-pc-windows-msvc --bun-target bun-windows-x64
 */
import { $ } from 'bun';
import { resolve } from 'node:path';
import { rename, mkdir } from 'node:fs/promises';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// Default to the host Rust target triple (what `tauri dev` expects).
const hostTriple = (await $`rustc -vV`.text())
  .split('\n')
  .find((l) => l.startsWith('host:'))!
  .replace('host:', '')
  .trim();

const triple = flag('triple') ?? hostTriple;
const bunTarget = flag('bun-target'); // optional cross-compile target for bun
const isWindows = triple.includes('windows');

const root = resolve(import.meta.dir, '..');
await mkdir(resolve(root, 'src-tauri/binaries'), { recursive: true });
const tmpOut = resolve(root, 'src-tauri/binaries/geins-staging');
const finalOut = resolve(root, `src-tauri/binaries/geins-${triple}${isWindows ? '.exe' : ''}`);

const buildArgs = ['run', 'scripts/build-cli.ts', '--outfile', tmpOut];
if (bunTarget) buildArgs.push('--target', bunTarget);

await $`bun ${buildArgs}`.cwd(root);
await rename(tmpOut + (isWindows ? '.exe' : ''), finalOut).catch(async () => {
  // build-cli writes exactly --outfile (no auto .exe), so handle both.
  await rename(tmpOut, finalOut);
});

console.log(`✓ staged sidecar → src-tauri/binaries/geins-${triple}${isWindows ? '.exe' : ''}`);
