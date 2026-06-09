#!/usr/bin/env bun
/**
 * Compiles the CLI into a single standalone binary via `bun build --compile`.
 *
 * Ink lazily imports `react-devtools-core` (only used when DEV=true). That dep
 * can't resolve inside the compiled binary, so a resolver plugin aliases it to
 * a no-op stub (scripts/stubs/react-devtools-core.ts).
 *
 * Usage:
 *   bun run scripts/build-cli.ts                       # host platform → dist/geins
 *   bun run scripts/build-cli.ts --target bun-linux-x64 --outfile dist/geins-linux-x64
 */
import { resolve } from 'node:path';

const STUB = resolve(import.meta.dir, 'stubs/react-devtools-core.ts');

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const outfile = flag('outfile') ?? 'dist/geins';
const target = flag('target'); // e.g. bun-darwin-arm64, bun-linux-x64, bun-windows-x64

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, '../src/bin.ts')],
  compile: target ? { outfile, target: target as any } : { outfile },
  plugins: [
    {
      name: 'stub-react-devtools',
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: STUB }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`✓ compiled ${outfile}${target ? ` (${target})` : ''}`);
