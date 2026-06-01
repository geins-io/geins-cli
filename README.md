# Geins CLI

CLI for Geins Commerce Backend. Built with Bun, Ink (React TUI), and TypeScript.

## Installation

### Prerequisites

- [Bun](https://bun.sh) v1.0+

### Install from source

```bash
git clone https://github.com/geins-io/geins-cli.git
cd geins-cli
bun install
bun link
```

The `geins` command is now available globally.

### Verify installation

```bash
geins --help
```

## Usage

### Interactive TUI

```bash
geins
```

### Web UI

```bash
geins --web
# or
bun run dev:web
```

Opens a web-based UI on port 3100.

### Direct CLI

```bash
geins whoami
geins workflow list
geins workflow get <id>
geins workflow run <id>
geins workflow manifest
```

Use `--json` for JSON output.

## Development

### How the `geins` command works

`bun link` creates a symlink chain that points the global `geins` command straight back at your local working copy:

```
~/.bun/bin/geins
  → ~/.bun/install/global/node_modules/@geins/cli/src/bin.ts
  → (symlink) <your clone of geins-cli>
```

Bun executes `src/bin.ts` (TypeScript) directly — there is **no build step**. This means:

- **Your edits are live instantly.** Save a file, run `geins ...` again, and it picks up the change.
- **It always reflects your current branch and working tree**, including uncommitted changes.
- `bun run dev` runs the exact same entry point (`src/bin.ts`) — it's equivalent to typing `geins` with no args.

So the normal loop is just: **edit → type `geins` → see the change.** No rebuild, no re-link.

### When you need to re-run setup

| Situation | Command |
|-----------|---------|
| Fresh clone / new machine | `bun install` then `bun link` (one-time) |
| Added/changed a dependency in `package.json` | `bun install` |
| Changed the `bin` field (command name or entry path) | `bun link` |

### Running the app

```bash
bun run dev          # interactive TUI (same as `geins`)
bun run dev:web      # web UI on port 3100
```

### Testing

```bash
bun test                       # run all tests in test/
bun test test/cli.test.ts      # run a single file
bunx tsc --noEmit              # typecheck
```

Tests live in `test/`. File-based modules (e.g. `src/memory/`) read and write under
`~/.config/geins/` — point `HOME`/`$TMPDIR` at a temp dir in tests to avoid clobbering
real local state.

## Copilot Mode

The CLI supports AI copilot integration with external LLM providers. In the TUI, toggle with `shift+tab` or `/copilot`.

Supported providers: Claude Code, OpenAI Codex, Google Gemini CLI, Ollama, LM Studio.

```bash
/copilot set         # select provider
/copilot             # toggle on/off
/new                 # clear conversation history
```

The copilot can execute `geins` commands autonomously and return real results.

### Recommended local models (via Ollama)

| Model | Size | Context | Command |
|-------|------|---------|---------|
| Qwen 3 8B | 8B | 32k | `ollama run qwen3:8b` |
| Qwen 2.5 Coder 14B | 14B | 128k | `ollama run qwen2.5-coder:14b` |
| DeepSeek R1 14B | 14B | 64k | `ollama run deepseek-r1:14b` |
| Phi-4-mini | 3.8B | 128k | `ollama run phi4-mini` |
