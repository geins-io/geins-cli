# Geins CLI

CLI for Geins Commerce Backend. Built with Bun, Ink (React TUI), and TypeScript.

## Quick Start

```bash
bun install
bun run dev          # interactive TUI
bun run dev:web      # web-based UI on port 3100
geins --help         # direct CLI (requires `bun link` first)
```

## Project Structure

```
src/
  bin.ts              # entry point
  cli.ts              # direct CLI mode (non-TTY) + TUI launcher
  web.ts              # web UI server
  api/client.ts       # authenticated HTTP client (auto-refreshes JWT, sends x-account-key)
  api/errors.ts       # error types and formatting
  auth/login.ts       # auth endpoints (login, verify, refresh, fetchUser)
  auth/session.ts     # JWT parsing, expiry checks
  config/store.ts     # ~/.config/geins/ session + config persistence
  config/env.ts       # API base URL (GEINS_API_URL or https://mgmtapi.geins.services/v2)
  commands/            # command implementations
    workflows.ts       # workflow API functions
  ui/                  # Ink TUI components
  output/              # terminal formatting (colors, banner)
```

## API

- Base URL: `https://mgmtapi.geins.services/v2`
- Auth: Bearer JWT token + `x-account-key` header
- Session stored at: `~/.config/geins/session.json`
- Workflow endpoints: `/orchestrator/...`

## Creating Workflows via CLI

A fresh spawn can learn everything needed to create a workflow by running these commands:

### 1. Check auth
```bash
geins whoami
```

### 2. Learn the schema
```bash
# Get the full manifest — all node types, actions, expressions, triggers
geins workflow manifest > manifest.json
```

The manifest contains: NodeTypes, Providers, Actions, ExpressionFunctions, TriggerTypes, EventEntities, GraphConventions, WorkflowSettings.

### 3. Study existing workflows
```bash
# List all workflows
geins workflow list

# Get a specific workflow definition (full JSON)
geins workflow get <id>
```

### 4. Create a workflow
```bash
# From a file
geins workflow create --file workflow.json

# From stdin (piping)
cat workflow.json | geins workflow create

# Inline JSON
geins workflow create --body '{"name":"My Workflow","type":"onDemand","nodes":[],"connections":[]}'
```

### 5. Test and monitor
```bash
geins workflow run <id>                    # execute
geins workflow run <id> --body '{"key":"value"}'  # execute with input
geins workflow logs <id>                   # check execution logs
```

### 6. Manage
```bash
geins workflow enable <id>
geins workflow disable <id>
geins workflow update <id> --file updated.json
```

### Workflow JSON Structure

```json
{
  "name": "My Workflow",
  "description": "What it does",
  "type": "onDemand",
  "tags": ["tag1"],
  "nodes": [
    {
      "id": "unique-node-id",
      "type": "action",
      "name": "Node Name",
      "actionName": "provider.action",
      "input": { "key": "value or {{expression}}" }
    }
  ],
  "connections": [
    { "from": "TRIGGER", "to": "first-node-id" },
    { "from": "first-node-id", "to": "second-node-id" }
  ],
  "trigger": {},
  "settings": {}
}
```

Node types: `action`, `condition`, `iterator`, `paginator`, `delay`, `workflow`

Trigger types: `onDemand` (HTTP), `scheduled` (cron), `event` (Geins events)

Expressions: `{{input.property}}`, `{{output.nodeId.property}}`, `{{vars.variableName}}`

Run `geins workflow manifest` for the complete list of actions, expression functions, and configuration options.

## Conventions

- All API functions go in `src/commands/`
- `request()` from `src/api/client.ts` handles auth automatically
- Direct CLI subcommands use `geins <command> <subcommand> [args] [--flags]`
- TUI commands use `/command subcommand [args]`
- JSON output with `--json` flag in direct CLI mode
- Keep TUI output compact (no IDs by default)
