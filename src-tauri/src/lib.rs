// Synapse desktop shell.
//
// On startup we spawn the `geins` CLI in serve mode (`geins serve --port 0
// --token <secret>`), bound to localhost. We read the OS-assigned port from its
// stdout (`GEINS_SERVE_READY port=<n>`), then point the webview at that local
// server. The web shell talks plain HTTP/WS to the backend (no Tauri IPC), so
// the desktop app is just the CLI behind a window.
//
// Dev vs production backend:
//   dev   → `bun --watch src/bin.ts serve …` straight from the TypeScript
//           source. Editing src/** hot-restarts serve in place (same pid, same
//           stdout pipe); each restart prints a fresh GEINS_SERVE_READY line,
//           which re-navigates the webview below — the app follows terminal
//           development automatically.
//   build → the compiled sidecar binary bundled with the app.
use std::sync::Mutex;

use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

/// Holds the running backend process (dev: bun --watch, prod: the sidecar)
/// so we can kill it when the window closes.
#[derive(Default)]
struct Sidecar(Mutex<Option<CommandChild>>);

/// Parse the port out of the sidecar's readiness line: `GEINS_SERVE_READY port=52317 host=127.0.0.1`.
fn parse_ready_port(line: &str) -> Option<u16> {
    let token = line.split_whitespace().find(|t| t.starts_with("port="))?;
    token.trim_start_matches("port=").parse().ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Sidecar::default())
        .setup(|app| {
            let handle = app.handle().clone();
            // Per-launch shared secret gating the local server.
            let token = uuid::Uuid::new_v4().simple().to_string();

            // --watch-parent: the backend self-exits if this app dies, so a
            // hard kill (SIGKILL/crash) that skips RunEvent::Exit can't leak it.
            // --exit-on-tty-end: quitting the TUI (ctrl-c, /exit) exits the
            // backend, and we close the app when the backend dies (below).
            let serve_args = [
                "serve",
                "--port",
                "0",
                "--token",
                &token,
                "--watch-parent",
                "--exit-on-tty-end",
            ];
            let (mut rx, child) = if tauri::is_dev() {
                // Dev: run the backend from source so the app follows src/** edits
                // live. `process.exit` inside serve still exits the whole watcher,
                // so ctrl-c-quits and Terminated handling work unchanged.
                let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .expect("src-tauri has a parent directory");
                app.shell()
                    .command("bun")
                    .args(["--watch", "--no-clear-screen", "src/bin.ts"])
                    .args(serve_args)
                    .current_dir(repo_root)
                    .spawn()?
            } else {
                app.shell().sidecar("geins")?.args(serve_args).spawn()?
            };
            app.state::<Sidecar>().0.lock().unwrap().replace(child);

            // OTA: check for a signed desktop update on launch. Non-blocking and
            // best-effort — any failure leaves the app running the current build.
            // Never in dev: a published newer release would otherwise replace the
            // build under development and restart out of the session.
            if !tauri::is_dev() {
                let updater_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(updater) = updater_handle.updater() {
                        if let Ok(Some(update)) = updater.check().await {
                            if update
                                .download_and_install(|_received, _total| {}, || {})
                                .await
                                .is_ok()
                            {
                                updater_handle.restart();
                            }
                        }
                    }
                });
            }

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            let line = String::from_utf8_lossy(&bytes);
                            if let Some(port) = parse_ready_port(&line) {
                                let url = format!(
                                    "http://127.0.0.1:{port}/?token={token}&port={port}"
                                );
                                if let Some(window) = handle.get_webview_window("main") {
                                    // Full-page navigation to the local server; after this the
                                    // page origin IS the server, so its fetch/WS are same-origin.
                                    let _ = window.eval(&format!(
                                        "window.location.replace('{}')",
                                        url.replace('\'', "\\'")
                                    ));
                                }
                                // Let any listeners know we're up (debugging aid).
                                let _ = handle.emit("geins://ready", port);
                            }
                        }
                        // Surface backend stderr (bun --watch banners, syntax errors on
                        // save) in the `tauri dev` terminal so broken saves are visible.
                        CommandEvent::Stderr(bytes) => {
                            eprintln!("[serve] {}", String::from_utf8_lossy(&bytes).trim_end());
                        }
                        // The backend exited: either the user quit the TUI (clean exit via
                        // --exit-on-tty-end) or it died — either way the window is
                        // useless without it, so close the app.
                        CommandEvent::Terminated(_) => {
                            handle.exit(0);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the window should quit the app (single-window utility).
            tauri::WindowEvent::Destroyed => window.app_handle().exit(0),
            // File drag-and-drop: Tauri's native handler captures drops (the webview never
            // sees them, and HTML5 drops wouldn't carry real paths anyway). Hand the paths
            // to the shell via eval — same host→page channel as the initial navigation —
            // where they're typed into the TUI exactly like a terminal drop.
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                let list: Vec<String> = paths
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if let (Ok(json), Some(webview)) = (
                    serde_json::to_string(&list),
                    window.app_handle().get_webview_window("main"),
                ) {
                    let _ = webview.eval(&format!(
                        "window.__synapseDrop && window.__synapseDrop({json})"
                    ));
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // Kill the sidecar on ANY exit path, not just window close — otherwise a
        // crash or quit leaves an orphaned `geins serve` process running.
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(child) = app_handle.state::<Sidecar>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
