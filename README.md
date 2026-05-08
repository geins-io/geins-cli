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

```bash
bun run dev          # interactive TUI
bun run dev:web      # web UI on port 3100
```

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
