// Helper for the COMPILED binary: embedded native files (pty.node, spawn-helper)
// live in the executable's virtual filesystem, but dlopen/exec need real paths on
// disk. This extracts them once to a version-keyed temp dir.
//
// Only the generated pty-assets module (see scripts/build-cli.ts) imports this;
// the dev resolver (src/server/pty-assets.ts) loads straight from node_modules.
import { mkdirSync, writeFileSync, chmodSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VERSION } from '../version.ts';

export interface PtyAssets {
  ptyPath: string;
  /** macOS only — node-pty's spawn-helper. Unused (and absent) on Linux. */
  helperPath: string;
}

export interface EmbeddedFile {
  /** Path returned by an `import ... with { type: 'file' }` of the asset. */
  asset: string;
  name: string;
  exec?: boolean;
}

export async function extractPtyAssets(files: EmbeddedFile[]): Promise<PtyAssets | null> {
  const dir = join(tmpdir(), `geins-pty-${VERSION}-${process.platform}-${process.arch}`);
  try {
    mkdirSync(dir, { recursive: true });
    for (const f of files) {
      const dest = join(dir, f.name);
      if (!existsSync(dest)) {
        const bytes = new Uint8Array(await Bun.file(f.asset).arrayBuffer());
        // Write-then-rename so a concurrent serve process never sees a partial file.
        const tmp = `${dest}.${process.pid}.tmp`;
        writeFileSync(tmp, bytes);
        renameSync(tmp, dest);
      }
      if (f.exec) chmodSync(dest, 0o755);
    }
    return { ptyPath: join(dir, 'pty.node'), helperPath: join(dir, 'spawn-helper') };
  } catch {
    return null;
  }
}
