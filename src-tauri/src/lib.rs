// Geins desktop shell.
//
// On startup we spawn the bundled `geins` CLI as a sidecar in serve mode
// (`geins serve --port 0 --token <secret>`), bound to localhost. We read the
// OS-assigned port from its stdout (`GEINS_SERVE_READY port=<n>`), then point
// the webview at that local server. The web shell talks plain HTTP/WS to the
// sidecar (no Tauri IPC), so the desktop app is just the CLI behind a window.
use std::sync::Mutex;

use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

/// Holds the running sidecar so we can kill it when the window closes.
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

            let sidecar = app
                .shell()
                .sidecar("geins")?
                // --watch-parent: the sidecar self-exits if this app dies, so a
                // hard kill (SIGKILL/crash) that skips RunEvent::Exit can't leak it.
                .args(["serve", "--port", "0", "--token", &token, "--watch-parent"]);
            let (mut rx, child) = sidecar.spawn()?;
            app.state::<Sidecar>().0.lock().unwrap().replace(child);

            // OTA: check for a signed desktop update on launch. Non-blocking and
            // best-effort — any failure leaves the app running the current build.
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

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stdout(bytes) = event {
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
                }
            });

            Ok(())
        })
        // Closing the window should quit the app (single-window utility).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.app_handle().exit(0);
            }
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
