# Geins CLI

CLI + TUI for the Geins Commerce Backend. Built with Bun, Ink (React TUI), and TypeScript.
This file is for whoever **extends the CLI**. For *using* a command, run `geins <group> help`.

## Quick Start

```bash
bun install
bun run dev          # interactive TUI
bun run dev:web      # web-based UI on port 3100
bun link             # then `geins ...` runs this source directly
geins --help
```

## Project Structure

```
src/
  bin.ts              # entry point
  cli.ts              # direct CLI dispatcher (non-TTY) + TUI launcher
  web.ts              # web UI server
  api/client.ts       # v2 gateway client — JWT (auto-refresh) + x-account-key
  api/live-client.ts  # live Management/Merchant client — Basic auth + X-ApiKey (api-key profiles)
  api/errors.ts       # error types and formatting
  auth/                # login/verify/refresh, JWT parsing
  config/store.ts      # ~/.config/geins/ session, config, api-key profiles
  config/env.ts        # API base URLs
  commands/            # one file per command group — the API functions live here
    help-text.ts       # ★ single source of truth for command docs + copilot catalog + PITFALLS
    products.ts order.ts campaigns.ts merchant.ts account.ts workflows.ts copilot.ts ...
  ui/                  # Ink TUI components
  output/              # terminal formatting (colors, banner, json)
```

## Two API planes (don't conflate them)

| Plane | Base URL | Auth | Used by | Client |
|---|---|---|---|---|
| v2 gateway / orchestrator | `https://mgmtapi.geins.services/v2` | Bearer JWT + `x-account-key` | `workflow`, `account` | `api/client.ts` (`request()`) |
| Live Management API (REST) | `https://mgmtapi.geins.io` | Basic auth + `X-ApiKey` | `product`, `order`, `campaign` | `api/live-client.ts` (`mgmtRequest()`) |
| Merchant API (GraphQL) | (storefront) | `X-ApiKey` | `merchant` | `api/live-client.ts` (`merchantQuery()`) |

JWT session → `~/.config/geins/session.json`. API-key profiles (per account) → see `geins apikey`.

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
