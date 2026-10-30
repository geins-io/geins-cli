// Synapse desktop shell.
//
// On startup we spawn the `geins` CLI in serve mode (`geins serve --port 4317
// --port-fallback --token <secret>`), bound to localhost. The same backend hosts
// the Studio agent for paired Studio tabs. We read the actual port from its
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
//
// Tray app: the backend also hosts the Studio agent, so Synapse lives in the
// tray / menu bar. It never opens a window on its own: the tray icon (or launching
// the app again) opens it, closing only hides it, and Quit in the tray menu ends
// the app and the backend. It starts at login and handles `geins://` links:
//   geins://connect?site=<studio url>  pair that Studio site, once the user allows it
//   geins://start                     launching the app (and its agent) is the point
use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Url, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

/// Holds the running backend process (dev: bun --watch, prod: the sidecar)
/// so we can kill it when the app exits.
#[derive(Default)]
struct Sidecar(Mutex<Option<CommandChild>>);

/// The backend's port once it's up, and `geins://` links that arrived before that.
#[derive(Default)]
struct Backend {
    port: Mutex<Option<u16>>,
    pending_links: Mutex<Vec<Url>>,
}

/// The tray menu's status line.
struct TrayStatus(MenuItem<Wry>);

/// Parse the port out of the sidecar's readiness line: `GEINS_SERVE_READY port=52317 host=127.0.0.1`.
fn parse_ready_port(line: &str) -> Option<u16> {
    let token = line.split_whitespace().find(|t| t.starts_with("port="))?;
    token.trim_start_matches("port=").parse().ok()
}

/// The `geins` CLI: from source in dev (follows src/** edits), the bundled sidecar in builds.
fn geins(app: &AppHandle, bun_args: &[&str]) -> Result<Command, tauri_plugin_shell::Error> {
    if tauri::is_dev() {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent directory");
        Ok(app
            .shell()
            .command("bun")
            .args(bun_args)
            .arg("src/bin.ts")
            .current_dir(repo_root))
    } else {
        app.shell().sidecar("geins")
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The `site` of a connect link as an origin: https anywhere, http only on this machine.
fn studio_origin(link: &Url) -> Option<String> {
    let (_, site) = link.query_pairs().find(|(key, _)| key == "site")?;
    let site = Url::parse(&site).ok()?;
    let local = matches!(site.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match site.scheme() {
        "https" => Some(site.origin().ascii_serialization()),
        "http" if local => Some(site.origin().ascii_serialization()),
        _ => None,
    }
}

fn handle_link(app: &AppHandle, link: Url) {
    let backend = app.state::<Backend>();
    // Hold the queue while reading the port: the ready handler takes it before
    // setting the port and draining, so no link lands after the drain.
    let port = {
        let mut pending = backend.pending_links.lock().unwrap();
        let port = *backend.port.lock().unwrap();
        match port {
            Some(port) => port,
            None => {
                pending.push(link);
                return;
            }
        }
    };
    if link.host_str() == Some("connect") {
        confirm_connect(app, &link, port);
    }
}

/// Any web page can open a `geins://` link, so pairing needs the user's yes.
fn confirm_connect(app: &AppHandle, link: &Url, port: u16) {
    let Some(origin) = studio_origin(link) else {
        app.dialog()
            .message("This link doesn't name a valid Studio site, so nothing was connected.")
            .title("Synapse")
            .show(|_| {});
        return;
    };
    let handle = app.clone();
    app.dialog()
        .message(format!(
            "Allow {origin} to use the Geins agent on this computer?\n\n\
             Only connect Studio sites you trust. A connected site can ask the agent \
             to work with your Studio data and the files in its workspace."
        ))
        .title("Connect Studio")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Connect".into(),
            "Cancel".into(),
        ))
        .show(move |allowed| {
            if allowed {
                connect_studio(&handle, origin, port);
            }
        });
}

/// `geins studio connect` allows the site and opens it with the pairing link;
/// GEINS_SERVE_PORT makes the link carry this backend's port.
fn connect_studio(app: &AppHandle, origin: String, port: u16) {
    let Ok(command) = geins(app, &[]) else {
        return;
    };
    let command = command
        .args(["studio", "connect", &origin])
        .env("GEINS_SERVE_PORT", port.to_string());
    tauri::async_runtime::spawn(async move {
        if let Err(err) = command.output().await {
            eprintln!("[synapse] studio connect failed: {err}");
        }
    });
}

/// Opens the Studio site paired most recently (`geins studio open`).
fn open_studio(app: &AppHandle) {
    let Ok(command) = geins(app, &[]) else {
        return;
    };
    let command = command.args(["studio", "open"]);
    tauri::async_runtime::spawn(async move {
        if let Err(err) = command.output().await {
            eprintln!("[synapse] studio open failed: {err}");
        }
    });
}

/// Start at login is on by default; after the first run the tray's check item decides.
fn enable_autostart_once(app: &tauri::App) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let marker = dir.join("autostart-initialized");
    if marker.exists() {
        return;
    }
    if app.autolaunch().enable().is_ok() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(marker, "");
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "Studio agent: starting…", false, None::<&str>)?;
    let studio = MenuItem::with_id(app, "studio", "Open Studio", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Synapse", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start at login",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Synapse", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &studio,
            &open,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(TrayStatus(status));

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Synapse")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "studio" => open_studio(app),
            "open" => show_main(app),
            "autostart" => {
                // The check item has already toggled itself.
                let launcher = app.autolaunch();
                let _ = if autostart.is_checked().unwrap_or(false) {
                    launcher.enable()
                } else {
                    launcher.disable()
                };
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First: a second launch hands its arguments (and any `geins://` link, via
        // the deep-link feature) to this instance and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if !argv.iter().any(|arg| arg.starts_with("geins://")) {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Sidecar::default())
        .manage(Backend::default())
        .setup(|app| {
            let handle = app.handle().clone();

            // Never in dev: the login item would launch the dev build.
            if !tauri::is_dev() {
                enable_autostart_once(app);
            }
            build_tray(app)?;

            // Installers register `geins://`; a dev build registers itself.
            #[cfg(any(windows, target_os = "linux"))]
            if tauri::is_dev() {
                let _ = app.deep_link().register_all();
            }
            let link_handle = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for link in event.urls() {
                    handle_link(&link_handle, link);
                }
            });
            // A `geins://` link that launched the app.
            for link in app.deep_link().get_current().ok().flatten().unwrap_or_default() {
                handle_link(&handle, link);
            }

            // Per-launch shared secret gating the local server.
            let token = uuid::Uuid::new_v4().simple().to_string();

            // --port 4317 --port-fallback: the fixed Studio agent port, so paired
            // Studio tabs find this backend; if it's taken, any free port (the
            // pairing link from `/studio connect` carries the actual one).
            // --watch-parent: the backend self-exits if this app dies, so a
            // hard kill (SIGKILL/crash) that skips RunEvent::Exit can't leak it.
            // No --exit-on-tty-end: the backend also serves Studio, so quitting
            // the TUI (ctrl-c, /exit) only ends the TUI; the window offers a
            // relaunch, and Quit in the tray is what ends the app.
            let serve_args = [
                "serve",
                "--port",
                "4317",
                "--port-fallback",
                "--token",
                &token,
                "--watch-parent",
            ];
            // Dev: `bun --watch` so the app follows src/** edits live. `process.exit`
            // inside serve still exits the whole watcher, so Terminated handling
            // works unchanged.
            let (mut rx, child) = geins(&handle, &["--watch", "--no-clear-screen"])?
                .args(serve_args)
                .spawn()?;
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
                                let backend = handle.state::<Backend>();
                                let pending: Vec<Url> = {
                                    let mut links = backend.pending_links.lock().unwrap();
                                    backend.port.lock().unwrap().replace(port);
                                    links.drain(..).collect()
                                };
                                for link in pending {
                                    handle_link(&handle, link);
                                }
                                let _ = handle
                                    .state::<TrayStatus>()
                                    .0
                                    .set_text(format!("Studio agent: running on port {port}"));

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
                        // The backend died: the window and the Studio agent are useless
                        // without it, so close the app.
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
            // Closing hides the window; the agent keeps running until Quit in the tray.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
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
        // Kill the sidecar on ANY exit path, not just Quit — otherwise a crash
        // leaves an orphaned `geins serve` process running.
        .run(|app_handle, event| match event {
            tauri::RunEvent::Exit => {
                if let Some(child) = app_handle.state::<Sidecar>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
            // Dock icon clicked while the window is hidden.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show_main(app_handle),
            _ => {}
        });
}
