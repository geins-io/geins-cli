// Runtime helpers for re-invoking this CLI as a subprocess.
//
// The copilot agent loop (and the serve backend) run `geins <subcommand>` by
// spawning the CLI again. We must NOT rely on a `geins` on PATH: a compiled
// binary (`bun build --compile`) or the Tauri sidecar may not be installed
// anywhere on PATH. Instead we re-invoke THIS executable.

/** True when running as a `bun build --compile` single-file executable. */
export function isCompiled(): boolean {
  // In a standalone executable Bun.main lives in the embedded virtual fs.
  return Bun.main.includes('$bunfs') || Bun.main.includes('B:\\~BUN\\') || Bun.main.includes('~BUN');
}

/**
 * The argv prefix that re-invokes this CLI. Append subcommand args to it.
 * - compiled: `[<binary>]`           → child argv resolves to the embedded entry
 * - dev/link: `[bun, <bin.ts path>]` → child runs the same entry script
 */
export function selfInvocation(): string[] {
  return isCompiled() ? [process.execPath] : [process.execPath, Bun.main];
}
