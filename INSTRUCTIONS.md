# geins-cli — Implementation Instructions

> A terminal-first CLI for Geins Commerce Backend. Inspired by Claude Code's UX patterns.
> Runtime: Bun. Language: TypeScript. Zero compile step.

---

## Architecture Overview

```
geins-cli/
├── src/
│   ├── bin.ts                  # Entry point (#!/usr/bin/env bun)
│   ├── cli.ts                  # Command router + REPL loop
│   ├── auth/
│   │   ├── login.ts            # Login flow (credentials + MFA)
│   │   ├── session.ts          # Token storage, refresh, expiry checks
│   │   └── keychain.ts         # OS keychain integration (optional)
│   ├── api/
│   │   ├── client.ts           # Authenticated HTTP client (auto-refresh)
│   │   └── errors.ts           # Error types + formatting
│   ├── commands/
│   │   ├── auth.ts             # login, logout, whoami, switch-account
│   │   ├── workflow.ts         # list, get, run, enable, disable, validate
│   │   ├── execution.ts        # list, get, cancel, pause, resume, replay
│   │   ├── quotation.ts        # list, get, send, accept, reject, etc.
│   │   ├── company.ts          # list, get, create, update, delete
│   │   ├── pricelist.ts        # list, get, copy, preview
│   │   ├── channel.ts          # list, get, schema push/pull
│   │   ├── user.ts             # list, get, create
│   │   ├── api.ts              # Raw API passthrough (like `gh api`)
│   │   └── ping.ts             # Service health checks
│   ├── output/
│   │   ├── format.ts           # Table, JSON, YAML formatters
│   │   ├── color.ts            # Terminal colors (respects NO_COLOR)
│   │   └── interactive.ts      # Prompts, spinners, progress
│   └── config/
│       ├── store.ts            # ~/.config/geins/config.json
│       └── env.ts              # Environment resolution
├── package.json
├── bunfig.toml
├── tsconfig.json
└── README.md
```

---

## Phase 1: Bootstrap + Auth

This is where to start. Everything else depends on a working authenticated client.

### Step 1: Project Setup

```bash
mkdir geins-cli && cd geins-cli
bun init -y
```

**package.json:**
```json
{
  "name": "@geins/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "geins": "./src/bin.ts"
  },
  "scripts": {
    "dev": "bun run src/bin.ts",
    "lint": "bunx biome check src/",
    "lint:fix": "bunx biome check --write src/",
    "test": "bun test"
  },
  "dependencies": {},
  "devDependencies": {
    "@biomejs/biome": "latest",
    "@types/bun": "latest"
  }
}
```

No framework dependencies for the CLI itself. Bun gives us:
- `fetch` (HTTP client)
- `Bun.stdin` / `Bun.stdout` (interactive I/O)
- `Bun.password` (secure input)
- `Bun.argv` (arg parsing)
- `node:readline` (REPL)

### Step 2: Config Store

**Location:** `~/.config/geins/config.json`

```typescript
// src/config/store.ts
interface GeinsConfig {
  apiUrl: string;                    // Default: https://mgmtapi.geins.services/v2
  defaultAccount?: string;           // accountKey for auto-select
  outputFormat: 'table' | 'json';    // Default: table (json when piped)
}
```

**Session file:** `~/.config/geins/session.json`

```typescript
interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accountKey: string;
  tokenExpires: number;        // Unix timestamp (seconds)
  user: {
    email: string;
    name: string;
    roles: string[];
  };
}
```

Detection for pipe vs interactive:
```typescript
const isInteractive = Bun.stdin.isTTY;
const defaultFormat = isInteractive ? 'table' : 'json';
```

This is critical for tool integration — when another tool pipes `geins`, it gets clean JSON automatically.

### Step 3: Auth Flow

**Geins Management API auth endpoints:**

| Action  | Method | Endpoint           | Body                                      |
|---------|--------|--------------------|--------------------------------------------|
| Login   | POST   | `/v2/auth`         | `{ username, password }`                   |
| MFA     | POST   | `/v2/auth/verify`  | `{ loginToken, mfaCode }`                  |
| Refresh | POST   | `/v2/auth/refresh` | `{ refreshToken }`                         |
| User    | GET    | `/v2/user/me`      | —                                          |

**Login flow:**

```
geins login
> Email: user@example.com
> Password: ••••••••
> MFA Code (if required): 123456
> Multiple accounts found:
>   1. Account Alpha (admin)
>   2. Account Beta (viewer)
> Select account [1]: 1
✓ Logged in as user@example.com (Account Alpha)
```

Implementation:

```typescript
// src/auth/login.ts

const API_URL = config.apiUrl; // https://mgmtapi.geins.services/v2

async function login(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) throw new AuthError(res.status, await res.text());
  return res.json();
}

async function verify(loginToken: string, mfaCode: string): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginToken, mfaCode }),
  });

  if (!res.ok) throw new AuthError(res.status, await res.text());
  return res.json();
}

async function refresh(refreshToken: string): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) throw new AuthError(res.status, await res.text());
  return res.json();
}
```

**Auth response shape (from Geins API):**
```typescript
interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  mfaRequired?: boolean;
  mfaMethod?: string;            // "email" | "authenticator"
  loginToken?: string;           // Present when mfaRequired=true
  accounts?: AuthAccounts[];     // Present when multiple accounts
}

interface AuthAccounts {
  accountKey: string;
  name: string;
  roles: string[];
}
```

### Step 4: Authenticated HTTP Client

```typescript
// src/api/client.ts

class GeinsClient {
  private session: StoredSession;

  async request<T>(path: string, options?: RequestOptions): Promise<T> {
    await this.ensureFreshToken();

    const res = await fetch(`${API_URL}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${this.session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 401) {
      await this.refreshToken();
      return this.request(path, options); // Retry once
    }

    if (!res.ok) throw new ApiError(res);
    return res.json();
  }

  private async ensureFreshToken() {
    const expiresAt = this.session.tokenExpires * 1000;
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() + fiveMinutes > expiresAt) {
      await this.refreshToken();
    }
  }

  private async refreshToken() {
    const auth = await refresh(this.session.refreshToken);
    this.session.accessToken = auth.accessToken;
    this.session.refreshToken = auth.refreshToken;
    // Parse JWT exp claim
    this.session.tokenExpires = parseJwtExp(auth.accessToken);
    await saveSession(this.session);
  }
}
```

**JWT parsing (no dependency needed):**
```typescript
function parseJwtExp(token: string): number {
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.exp; // Unix seconds
}
```

---

## Phase 2: Command Router + REPL

### Claude Code-inspired UX patterns

**Two modes:**

1. **Direct command** — `geins workflow list` (runs and exits)
2. **REPL mode** — `geins` (enters interactive session, like Claude Code)

```
$ geins
  geins v0.1.0 | user@example.com | Account Alpha

> workflow list
  ID          Name              Status    Last Run
  wf_abc123   Order Sync        active    2 min ago
  wf_def456   Price Update      paused    1 hour ago

> workflow run wf_abc123
  ✓ Execution started: exec_789
  ⠋ Running... (12s)
  ✓ Completed in 34s

> execution get exec_789 --json
  { "id": "exec_789", "status": "completed", ... }

> exit
```

### Command structure

```
geins <domain> <action> [id] [--flags]
```

Mirrors the pattern: `gh repo list`, `gh pr create`, `claude code`.

**Global flags:**
- `--json` — Force JSON output (default when piped)
- `--format <table|json|yaml>` — Output format
- `--account <key>` — Override account for this command
- `--api-url <url>` — Override API URL
- `--verbose` — Show request/response details
- `--no-color` — Disable colors (also respects `NO_COLOR` env)
- `--help` — Help for any command

### Tool-friendly output

For Claude Code / MCP / script integration:

```bash
# Piped = auto JSON
geins workflow list | jq '.[] | .name'

# Explicit JSON
geins workflow get wf_abc123 --json

# Exit codes
# 0 = success
# 1 = error
# 2 = auth required (token expired, not logged in)

# Stderr for human messages, stdout for data
geins workflow list 2>/dev/null  # Clean data only
```

---

## Phase 3: Domain Commands

Implement in this order (each builds on the previous):

### 3a: `geins api` — Raw passthrough

```bash
geins api GET /products
geins api POST /auth/refresh --body '{"refreshToken": "..."}'
geins api GET /orders --query 'skip=0&take=10'
```

This is the escape hatch. Once this works, every API operation is available immediately. Build typed commands on top incrementally.

### 3b: `geins workflow` + `geins execution`

Highest value. Maps to the orchestrator repository:

```bash
geins workflow list
geins workflow get <id>
geins workflow validate <id>
geins workflow enable <id>
geins workflow disable <id>
geins workflow run <id> [--input '{}']

geins execution list [--workflow <id>] [--status failed]
geins execution get <id>
geins execution cancel <id>
geins execution replay <id>
geins execution logs <id> [--step <stepId>]
```

### 3c: `geins quotation`

```bash
geins quotation list [--status draft|sent|accepted]
geins quotation get <id>
geins quotation send <id>
geins quotation accept <id>
geins quotation reject <id> [--reason "..."]
```

### 3d: Remaining domains

- `geins company` — CRUD + VAT validation
- `geins pricelist` — CRUD + copy + preview
- `geins channel` — CRUD + schema operations
- `geins user` — CRUD
- `geins ping` — `geins ping auth`, `geins ping account`

---

## Phase 4: MCP Server Mode

This is what makes `geins-cli` usable by Claude Code and other AI tools natively.

```bash
geins mcp
```

Starts the CLI as an MCP (Model Context Protocol) server over stdio. Claude Code can then call Geins operations as tools.

**MCP tool examples:**
```json
{
  "name": "geins_workflow_list",
  "description": "List all workflows",
  "parameters": {}
}
{
  "name": "geins_workflow_run",
  "description": "Execute a workflow",
  "parameters": {
    "workflowId": { "type": "string" },
    "input": { "type": "object" }
  }
}
{
  "name": "geins_api",
  "description": "Raw API call to Geins Management API",
  "parameters": {
    "method": { "type": "string" },
    "path": { "type": "string" },
    "body": { "type": "object" }
  }
}
```

Claude Code config (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "geins": {
      "command": "geins",
      "args": ["mcp"]
    }
  }
}
```

---

## Implementation Checklist

### Phase 1 — Auth (start here)
- [ ] `bun init`, project structure, tsconfig, biome
- [ ] Config store (`~/.config/geins/`)
- [ ] Login flow (credentials → MFA → account select)
- [ ] Session persistence (read/write session.json)
- [ ] Token refresh + expiry detection
- [ ] Authenticated HTTP client with auto-refresh
- [ ] `geins login` command
- [ ] `geins logout` command
- [ ] `geins whoami` command
- [ ] `geins switch-account` command

### Phase 2 — Shell
- [ ] Arg parser (no deps — `Bun.argv` + simple router)
- [ ] REPL mode with readline
- [ ] Output formatting (table/json, pipe detection)
- [ ] Color system (respects `NO_COLOR`)
- [ ] Error formatting (human-friendly stderr)
- [ ] `--help` generation from command definitions
- [ ] `geins api` passthrough command

### Phase 3 — Domain Commands
- [ ] `geins workflow` (list, get, run, enable, disable, validate)
- [ ] `geins execution` (list, get, cancel, pause, resume, replay, logs)
- [ ] `geins quotation` (list, get, send, accept, reject, confirm)
- [ ] `geins company` (list, get, create, update, delete)
- [ ] `geins pricelist` (list, get, copy, preview)
- [ ] `geins channel` (list, get, schema push/pull)
- [ ] `geins user` (list, get, create)
- [ ] `geins ping` (service health)

### Phase 4 — MCP Integration
- [ ] MCP server mode (`geins mcp`)
- [ ] Tool definitions for all commands
- [ ] Claude Code settings integration
- [ ] Streaming support for execution logs

---

## Design Principles

1. **JSON-first for machines, tables for humans** — detect TTY, format accordingly
2. **No unnecessary dependencies** — Bun stdlib covers HTTP, I/O, crypto, testing
3. **Exit codes matter** — 0 success, 1 error, 2 auth needed (scripts depend on this)
4. **Stderr for messages, stdout for data** — `geins workflow list 2>/dev/null` gives clean output
5. **One command = one API call** — no magic, no hidden side effects
6. **Progressive disclosure** — `geins workflow list` is simple, `geins api GET /custom/endpoint` is the escape hatch
