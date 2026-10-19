// Simple Task Timer
// Copyright (C) 2026 Islam Hassan
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The desktop app. The main window shows the add-on popup and the
// Preferences window shows the add-on Preferences page (desktop/web). This
// file gives them what Firefox gives the add-on:
//   - a JSON file for storage.local (load_state, storage_set), shared by
//     both windows: each change goes to all windows as "storage-changed"
//   - the menu-bar (tray) title in place of the toolbar badge
//   - the goal notification
//   - a global shortcut that shows or hides the main window from any app.
//     The page sets it (set_shortcut) from the Preferences; none at start.
//   - Google sign-in in the system browser (google_sign_in, see google.rs)
// The close button hides a window. Quit is in the tray menu (and Cmd+Q).
// Preferences is in the tray menu and in the app menu (Cmd+, or Ctrl+,).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod google;

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const TRAY: &str = "main";
const WINDOW: &str = "main";
const PREFS: &str = "prefs";

// One write at a time: the two windows can save at the same moment
struct StateLock(Mutex<()>);

fn state_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

fn read_text(path: &PathBuf) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// The saved data as JSON text, or None before the first save
#[tauri::command]
fn load_state(app: AppHandle) -> Result<Option<String>, String> {
    read_text(&state_file(&app)?)
}

// Sets some keys in the saved data, like storage.local.set. Writes a new
// file and then puts it in place, so a crash cannot leave half a file. Then
// sends the changes to all windows, with the label of the window that saved.
#[tauri::command]
fn storage_set(
    app: AppHandle,
    window: WebviewWindow,
    lock: State<StateLock>,
    items: Map<String, Value>,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let path = state_file(&app)?;
    let mut data: Map<String, Value> = match read_text(&path)? {
        Some(text) => serde_json::from_str(&text).map_err(|e| e.to_string())?,
        None => Map::new(),
    };
    let mut changes = Map::new();
    for (key, value) in items {
        let mut change = Map::new();
        if let Some(old) = data.get(&key) {
            change.insert("oldValue".into(), old.clone());
        }
        change.insert("newValue".into(), value.clone());
        changes.insert(key.clone(), Value::Object(change));
        data.insert(key, value);
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, Value::Object(data).to_string()).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    app.emit("storage-changed", json!({ "source": window.label(), "changes": changes }))
        .map_err(|e| e.to_string())
}

// Sets the global shortcut, for example "Control+Alt+W". An empty text
// removes it. The old shortcut stays when the new one cannot be used.
#[tauri::command]
fn set_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    let next = if accelerator.is_empty() {
        None
    } else {
        Some(accelerator.parse::<Shortcut>().map_err(|e| e.to_string())?)
    };
    shortcuts.unregister_all().map_err(|e| e.to_string())?;
    match next {
        Some(shortcut) => shortcuts.register(shortcut).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

// The text next to the tray icon (macOS). An empty text removes it.
#[tauri::command]
fn set_tray_title(app: AppHandle, title: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY) {
        let title = if title.is_empty() { None } else { Some(title) };
        tray.set_title(title).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

// Signs in with Google in the system browser and gives the Google ID token
#[tauri::command]
async fn google_sign_in(app: AppHandle, client_id: String, client_secret: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        google::sign_in(&client_id, &client_secret, |url| {
            // Debug builds only: with SIMPLE_TIMER_AUTH_URL_FILE set, write the
            // sign-in link to that file and open no browser (for tests)
            #[cfg(debug_assertions)]
            if let Ok(path) = std::env::var("SIMPLE_TIMER_AUTH_URL_FILE") {
                return std::fs::write(path, url).map_err(|e| e.to_string());
            }
            app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

// Shows the window and tells the page, which puts the cursor in the name field
fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("opened", ());
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let open = window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false);
        if open {
            let _ = window.hide();
        } else {
            show_window(app);
        }
    }
}

// Shows the Preferences window. The app makes it hidden at start
// (tauri.conf.json): a window made later from a menu stayed empty on macOS.
fn show_prefs(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(PREFS) {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

// The gear button of the main window
#[tauri::command]
fn open_prefs(app: AppHandle) -> Result<(), String> {
    show_prefs(&app).map_err(|e| e.to_string())
}

fn main() {
    let app = tauri::Builder::default()
        .manage(StateLock(Mutex::new(())))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            load_state,
            storage_set,
            set_shortcut,
            set_tray_title,
            notify,
            hide_window,
            open_prefs,
            google_sign_in
        ])
        .setup(|app| {
            // The standard app menu, with Preferences after "About"
            let app_menu = Menu::default(app.handle())?;
            if let Some(MenuItemKind::Submenu(first)) = app_menu.items()?.first() {
                let item = MenuItem::with_id(app, "prefs", "Preferences...", true, Some("CmdOrCtrl+,"))?;
                first.insert(&PredefinedMenuItem::separator(app)?, 1)?;
                first.insert(&item, 2)?;
            }
            app.set_menu(app_menu)?;
            app.on_menu_event(|app, event| {
                if event.id.as_ref() == "prefs" {
                    let _ = show_prefs(app);
                }
            });

            let show = MenuItem::with_id(app, "show", "Show Simple Task Timer", true, None::<&str>)?;
            let prefs = MenuItem::with_id(app, "prefs", "Preferences...", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &prefs, &quit])?;
            let mut tray = TrayIconBuilder::with_id(TRAY)
                .tooltip("Simple Task Timer")
                .menu(&menu)
                .show_menu_on_left_click(false)
                // "prefs" goes to the app menu handler above
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_window(app),
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
                        toggle_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The windows hide, so the timers of the main window keep running
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("could not start Simple Task Timer");

    app.run(|app, event| {
        // A click on the Dock icon shows the hidden window
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            show_window(app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
