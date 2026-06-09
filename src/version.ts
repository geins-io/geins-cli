// Single source of truth for the CLI version. Read from package.json so a
// version bump (or the release pipeline) only edits one file. Bun inlines this
// JSON import both in `bun run` and in `bun build --compile` output.
import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;
