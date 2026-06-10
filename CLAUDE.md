# Geins CLI

CLI + TUI for the Geins Commerce Backend. Built with Bun, Ink (React TUI), and TypeScript.
This file is for whoever **extends the CLI**. For *using* a command, run `geins <group> help`.

## Quick Start

```bash
bun install
bun run dev          # interactive TUI
bun run serve        # headless HTTP/WS backend (the desktop sidecar) — `geins serve --port 0 --token <t>`
bun run tauri:dev    # desktop app — DEV-FOLLOW: runs serve from source under `bun --watch`,
                     # so editing src/** hot-reloads the running desktop app (~1s)
bun link             # then `geins ...` runs this source directly
geins --help
```

## Project Structure

```
src/
  bin.ts              # entry point
  cli.ts              # direct CLI dispatcher (non-TTY) + TUI launcher
  version.ts          # ★ single version source (reads package.json) — don't hardcode versions
  runtime.ts          # selfInvocation(): re-invoke THIS binary for subcommands (compiled vs bun run)
  server/serve.ts     # `geins serve` — localhost HTTP/WS backend for the desktop shell
  server/web-shell.ts # the desktop web UI: fullscreen xterm.js running the REAL TUI via /tty
  server/pty.ts       # PTY spawn on node-pty's NATIVE binding (its JS layer breaks under Bun)
  server/pty-assets.ts # dev resolver for pty.node/spawn-helper (swapped at compile time)
  server/pty-extract.ts # compiled-binary path: extract embedded natives to disk for dlopen
  api/client.ts       # v2 gateway client — JWT (auto-refresh) + x-account-key
  api/live-client.ts  # live Management/Merchant client — Basic auth + X-ApiKey (api-key profiles)
  api/errors.ts       # error types and formatting
  auth/                # login/verify/refresh, JWT parsing
  config/store.ts      # ~/.config/geins/ session, config, api-key profiles
  config/env.ts        # API base URLs + getUpdateManifestUrl()
  commands/            # one file per command group — the API functions live here
    help-text.ts       # ★ single source of truth for command docs + copilot catalog + PITFALLS
    update.ts          # `geins update` — CLI self-update (OTA) from the GitHub Releases manifest
    products.ts order.ts campaigns.ts merchant.ts account.ts workflows.ts copilot.ts ...
  ui/                  # Ink TUI components
  output/              # terminal formatting (colors, banner, json)
src-tauri/            # Tauri v2 desktop wrapper (Rust) — spawns the CLI as a serve sidecar
scripts/
  build-cli.ts        # bun build --compile → standalone binary (stubs react-devtools-core)
  stage-sidecar.ts    # compile + place the binary as a Tauri sidecar (geins-<triple>)
.github/workflows/release.yml  # tag-driven build+sign+publish for CLI binaries AND desktop bundles
```

## Two API planes (don't conflate them)

| Plane | Base URL | Auth | Used by | Client |
|---|---|---|---|---|
| v2 gateway / orchestrator | `https://mgmtapi.geins.services/v2` | Bearer JWT + `x-account-key` | `workflow`, `account` | `api/client.ts` (`request()`) |
| Live Management API (REST) | `https://mgmtapi.geins.io` | Basic auth + `X-ApiKey` | `product`, `order`, `campaign` | `api/live-client.ts` (`mgmtRequest()`) |
| Merchant API (GraphQL) | (storefront) | `X-ApiKey` | `merchant` | `api/live-client.ts` (`merchantQuery()`) |

JWT session → `~/.config/geins/session.json`. API-key profiles (per account) → see `geins apikey`.

## Three faces, one binary

The same code ships as a terminal TUI, a CLI, and a Tauri **desktop app** — all from one
`bun build --compile` binary (`bun run build:cli`).

```
geins                 → Ink TUI (needs a TTY)
geins <cmd> [args]    → direct CLI
geins serve           → headless HTTP/WS backend on 127.0.0.1 (server/serve.ts)
geins update          → CLI self-update (OTA)

Desktop app (src-tauri/): Rust spawns `geins serve --port 0 --token <secret>`,
reads the port from stdout, and points the webview at that local server. The web
shell (server/web-shell.ts) talks plain HTTP/WS to the sidecar — NO Tauri IPC.

Desktop DEV-FOLLOW: in `tauri dev` the backend is `bun --watch src/bin.ts serve`
(source, not the compiled sidecar). Any src/** edit hot-restarts serve in place;
the fresh GEINS_SERVE_READY line re-navigates the webview → fresh TUI from the
latest source. The staged sidecar binary must still EXIST (tauri validates
externalBin), hence `stage:sidecar --if-missing`. Production uses the sidecar.

Desktop UI = the REAL terminal TUI: the web shell is a fullscreen xterm.js
connected to `serve`'s /tty WebSocket, which runs `geins` (no args → the Ink
TUI) inside a PTY (server/pty.ts). Same bytes, same renderer as a terminal.
On platforms without PTY support (Windows, for now) /health reports tty:false
and the shell falls back to its older HTML login + REPL.
```

Key invariants when extending:
- **Never spawn a bare `geins`** for subcommands — use `selfInvocation()` from `src/runtime.ts`
  (a compiled binary / the sidecar isn't on PATH). This is how the copilot agent loop and
  `serve`'s `/command` re-invoke the CLI.
- **Never hardcode the version** — import `VERSION` from `src/version.ts` (reads package.json).
- `serve` is token-gated and localhost-only; it reuses existing headless functions
  (`chatStream`, `executeGeinsCommand`, the `auth/` login flow, `loadSession`) — don't duplicate logic.
- **node-pty under Bun**: only the native binding works (`server/pty.ts` does raw fd I/O);
  never use node-pty's JS API. It's in `trustedDependencies` (Linux builds it via node-gyp at
  install; the macOS prebuilds need their exec bit restored — the resolvers handle both).
  Compiled builds embed pty.node/spawn-helper per target via scripts/build-cli.ts.

### OTA updates (both faces, one manifest)

`.github/workflows/release.yml` (tag `v*`) builds + signs CLI binaries and Tauri bundles for all
platforms and publishes **one** `latest.json` to GitHub Releases:
- `platforms.<key>` (signed) → consumed by `tauri-plugin-updater` (checks on launch, in `src-tauri/src/lib.rs`).
- `cli.<key>` (`{url, sha256}`) → consumed by `geins update` (`src/commands/update.ts`).

Signing: a Tauri updater keypair lives in CI secrets (`TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`); the
public key is in `src-tauri/tauri.conf.json`. **Private keys never get committed** (`.secrets/` is gitignored).
Override the manifest URL for staging with `GEINS_UPDATE_URL`.

## Command surface

Groups: `whoami · account · product · order · campaign · merchant · workflow · apikey · output`.
`product` is the largest: get/list/create/update/delete, items, variants, images, text,
parameters, brands, categories, relations. Run `geins <group> help` for the authoritative list.

### Single source of truth for command docs

`src/commands/help-text.ts` owns **all** command documentation:
- `PRODUCT_HELP` / `ORDER_HELP` / … — the `geins <group> help` text.
- `COMMAND_GROUPS` + `buildCommandCatalog()` — the catalog injected into the **copilot** system prompt.
- `PITFALLS` — API gotchas injected into the copilot prompt.

The in-CLI copilot (`src/commands/copilot.ts`, shipped to end-users) does **not** hand-list commands —
it renders `buildCommandCatalog()` and tells the model to run `geins <group> help` to drill in. So:

> **When you add or change a command, update `help-text.ts` only.** Both `geins <group> help`
> and the copilot stay in sync automatically. Never re-list commands inside `copilot.ts`.

### Adding a command (the pattern)

1. Write the API function in `src/commands/<group>.ts` — call `request()` (v2) or `mgmtRequest()` (live).
2. Add the subcommand `case` to the dispatcher in `src/cli.ts`.
3. Document it in the matching `*_HELP` in `src/commands/help-text.ts` (and `COMMAND_GROUPS` if it's a new group).
4. `bunx tsc --noEmit` — note the pre-existing `cli.ts` `resume`/`auth.ts`/`repl.ts` errors are unrelated.

## API pitfalls (the full list lives in `help-text.ts` → `PITFALLS`)

These cause confusing 4xx/5xx — the copilot is told about them; you should know them too:

- **VAT** is written as `VatId` (int id, `1` = 25%), never the read-only `Vat` rate. `--vat-id`, or omit for the account default.
- **Brands** require an `ExternalId`; `createBrand()` auto-slugs the name if omitted (a raw POST without it 500s).
- `Brand/Query` & `Category/Query` return a **bare array**, not an `Envelope` — don't read `.Resource` off them.
- New **categories** are inactive by default; assignments read back empty until activated.
- **Main category** = first id in `CategoryIds` on write (`MainCategoryId` is read-only); use `categories set-main`.
- **Image upload**: PUT overwrites with the exact name; POST (`images add --add`) auto-suffixes — read `FileName` back.

## Workflows (one capability among many)

Workflows are the orchestrator automation engine — reach for them only when the task is automation
(scheduled jobs, event reactions, multi-step API orchestration), not for one-off reads/writes.

```bash
geins workflow manifest      # node types, actions, expressions, triggers, settings — read this first
geins workflow list          # existing workflows (reuse before building)
geins workflow get <id>      # full definition
geins workflow create --file workflow.json   # also: --body '<json>' or stdin
geins workflow run <id> [--body '<json>'] ; geins workflow logs <id>
geins workflow enable|disable|update <id> ...
```

Definition shape: `{ name, description, type, tags, nodes[], connections[], trigger, settings }`.
Node types: `action · condition · iterator · paginator · delay · workflow`.
Trigger types: `onDemand` (HTTP) · `scheduled` (cron) · `event` (Geins events).
Expressions: `{{input.x}}` · `{{output.nodeId.x}}` · `{{vars.name}}`.
`connections` use `{ "from": "TRIGGER"|nodeId, "to": nodeId }`. Run `geins workflow manifest` for specifics.

## Conventions

- All API functions go in `src/commands/`; auth is handled by the client (`request()` / `mgmtRequest()`).
- Direct CLI: `geins <command> <subcommand> [args] [--flags]`; TUI: `/command subcommand [args]`.
- `--json` for machine-readable output in direct CLI mode.
- Keep TUI output compact (no IDs by default); detailed output is for the direct CLI.
- The TUI `/product` is read-only (get/list/items/variants) — mutating product ops live in the direct CLI.
