# TODO — credential security hardening

Deferred projects from the 2026-06-10 security audit of secret storage.
Context: login password is never stored ✓; session JWTs and API User credentials
(incl. the Management API **password**) live in plaintext 0600 files under
`~/.config/geins/`; the desktop sidecar token is passed via argv.

## 1. OS keychain for durable secrets (~half day)

Move the refresh token (`session.json`) and the per-profile
`managementApiPassword` / API keys (`credentials.json`) into the OS keychain;
keep non-secret context (account names, channel/market/locale, checkout
defaults) in the JSON files. Fixes plaintext exposure to backups/cloud-sync/grep
and adds OS-level access prompts.

- macOS: `Security.framework` via `bun:ffi` (`SecItemAdd`/`SecItemCopyMatching`,
  generic password class, service `io.geins.cli`). Same dlopen technique as
  `src/server/pty.ts`'s `setCloexec` — no new native deps. NOTE: prefer FFI over
  shelling to `security`(1): items created through the CLI tool are readable by
  any process via that same CLI, which forfeits the app-ACL benefit.
- Windows: Credential Manager (`advapi32` `CredWriteW`/`CredReadW` via FFI).
- Linux: `libsecret` if present, else fall back.
- Fallback: current plaintext file (headless/CI/containers), behind a config
  flag or auto-detect. Migration: on first run, move existing secrets into the
  keychain and rewrite the JSON without them.
- Touchpoints: `src/config/store.ts` (loadSession/saveSession,
  loadCredentialsStore/saveCredentialsStore are the only readers/writers).

## 2. Sidecar token via env instead of argv (quick)

`src-tauri/src/lib.rs` passes `--token <secret>` on the command line → visible
to every same-user process in `ps`, which is the exact attacker the token gates
against. Pass it as an env var (`GEINS_SERVE_TOKEN`, already read by
`parseServeArgs` in `src/server/serve.ts`) on the spawned command instead —
process env isn't readable cross-process on macOS without root.
Remember both spawn branches (dev `bun --watch` + prod sidecar).

## 3. Hygiene sweep (quick)

- [ ] `chmod 700 ~/.config/geins` (dir is 755 today — filenames visible to other
      users; enforce in `ensureDir()` in `src/config/store.ts`).
- [ ] Verify `geins apikey set` cannot receive the password as a CLI flag
      (shell history + argv leak); prompt-only.
- [ ] Redact `Authorization` / `X-ApiKey` headers in the `--out` request-log
      dumps (`src/output/sink.ts`).
- [ ] Audit copilot memory files for accidental secret capture.

## 4. Platform-level (not a CLI fix — raise with the API team)

The Management API password is a long-lived full-access credential. Scoped /
expiring API keys server-side would shrink the blast radius more than any local
storage scheme can.
