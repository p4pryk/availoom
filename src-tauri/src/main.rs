#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod claude;
mod codex;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Orientation {
    #[default]
    Horizontal,
    Vertical,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Preferences {
    orientation: Orientation,
    hidden_providers: Vec<String>,
    light: bool,
    follow_system: bool,
    setup_done: bool,
    low_usage_alerts: bool,
    pinned: bool,
    reduced_motion: bool,
}
struct Runtime {
    gate: tokio::sync::Mutex<()>,
    cancellation: tokio::sync::watch::Sender<u64>,
    prefs: Mutex<()>,
}
#[tauri::command]
fn discover_codex() -> Vec<String> {
    codex::discover()
}
#[tauri::command]
async fn read_codex(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
    path: String,
    consent: bool,
    expected_account: Option<String>,
) -> Result<codex::Reading, String> {
    if !consent {
        return Err("consent_required".into());
    }
    let _guard = state.gate.try_lock().map_err(|_| "busy")?;
    let mut cancel = state.cancellation.subscribe();
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "storage_error")?
        .join("runtime");
    std::fs::create_dir_all(&dir).map_err(|_| "storage_error")?;
    tokio::select! {
        result=codex::read(&path,&dir,expected_account.as_deref())=>result.map_err(str::to_owned),
        _=cancel.changed()=>Err("cancelled".into()),
    }
}
#[tauri::command]
fn disconnect_codex(state: tauri::State<'_, Runtime>) {
    state.cancellation.send_modify(|n| *n = n.wrapping_add(1));
}
#[tauri::command]
fn load_preferences(app: tauri::AppHandle) -> Preferences {
    app.path()
        .app_config_dir()
        .ok()
        .and_then(|p| std::fs::read(p.join("preferences.json")).ok())
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or_default()
}
#[tauri::command]
fn save_preferences(
    app: tauri::AppHandle,
    state: tauri::State<'_, Runtime>,
    preferences: Preferences,
) -> Result<(), String> {
    let _guard = state.prefs.lock().map_err(|_| "storage_error")?;
    let dir = app.path().app_config_dir().map_err(|_| "storage_error")?;
    std::fs::create_dir_all(&dir).map_err(|_| "storage_error")?;
    let bytes = serde_json::to_vec(&preferences).map_err(|_| "storage_error")?;
    let temp = dir.join("preferences.tmp");
    std::fs::write(&temp, bytes).map_err(|_| "storage_error")?;
    std::fs::rename(temp, dir.join("preferences.json")).map_err(|_| "storage_error")?;
    Ok(())
}
fn bounded_position(
    (x, y): (i32, i32),
    (w, h): (u32, u32),
    (left, top, width, height): (i32, i32, u32, u32),
) -> (i32, i32) {
    (
        x.clamp(left, left + (width.saturating_sub(w)) as i32),
        y.clamp(top, top + (height.saturating_sub(h)) as i32),
    )
}
fn fit_window_size(
    window: &tauri::WebviewWindow,
    requested: Option<tauri::PhysicalSize<u32>>,
) -> Result<(), String> {
    if let Some(m) = window
        .current_monitor()
        .map_err(|_| "window_error")?
        .or(window.primary_monitor().map_err(|_| "window_error")?)
    {
        let a = m.work_area();
        let size = match requested {
            Some(size) => size,
            None => window.outer_size().map_err(|_| "window_error")?,
        };
        let p = window.outer_position().map_err(|_| "window_error")?;
        let (x, y) = bounded_position(
            (p.x, p.y),
            (size.width, size.height),
            (a.position.x, a.position.y, a.size.width, a.size.height),
        );
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|_| "window_error")?;
    }
    Ok(())
}
fn fit_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    fit_window_size(window, None)
}
#[tauri::command]
fn fit_panel(window: tauri::WebviewWindow) -> Result<(), String> {
    fit_window(&window)
}
#[tauri::command]
fn resize_panel(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite()
        || !(210.0..=760.0).contains(&width)
        || !height.is_finite()
        || !(56.0..=780.0).contains(&height)
    {
        return Err("invalid_size".into());
    }
    let requested = tauri::LogicalSize::new(width, height);
    let physical = requested.to_physical::<u32>(window.scale_factor().map_err(|_| "window_error")?);
    // Native resize is queued; querying outer_size immediately returns the previous size.
    fit_window_size(&window, Some(physical))?;
    window
        .set_size(requested)
        .map_err(|_| "window_error".to_owned())
}
#[tauri::command]
fn move_strip(window: tauri::WebviewWindow, direction: String) -> Result<(), String> {
    if direction == "center" {
        window.center().map_err(|_| "window_error")?;
    } else {
        let (dx, dy) = match direction.as_str() {
            "left" => (-24, 0),
            "right" => (24, 0),
            "up" => (0, -24),
            "down" => (0, 24),
            _ => return Err("invalid_direction".into()),
        };
        let p = window.outer_position().map_err(|_| "window_error")?;
        window
            .set_position(tauri::PhysicalPosition::new(p.x + dx, p.y + dy))
            .map_err(|_| "window_error")?;
    }
    fit_window(&window)
}
#[tauri::command]
fn open_provider(app: tauri::AppHandle, provider: String) -> Result<(), String> {
    let url = match provider.as_str() {
        "Claude" => "https://claude.ai/settings/usage",
        "Gemini" => "https://gemini.google.com/usage",
        "Grok" => "https://grok.com/",
        "Codex" => "https://chatgpt.com/codex/settings/usage",
        _ => return Err("unknown_provider".into()),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "browser_error".into())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = fit_window(&w);
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(Runtime {
            gate: tokio::sync::Mutex::new(()),
            cancellation: tokio::sync::watch::channel(0).0,
            prefs: Mutex::new(()),
        })
        .invoke_handler(tauri::generate_handler![
            discover_codex,
            claude::inspect_claude,
            read_codex,
            disconnect_codex,
            load_preferences,
            save_preferences,
            resize_panel,
            fit_panel,
            move_strip,
            open_provider
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show Availoom", true, None::<&str>)?;
            let center = MenuItem::with_id(app, "center", "Center on screen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Availoom", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &center, &quit])?;
            let mut pixels = vec![0u8; 22 * 22 * 4];
            for y in 0..22 {
                for x in 0..22 {
                    let frame = ((x == 5 || x == 16) && (5..=16).contains(&y))
                        || ((y == 3 || y == 18) && (7..=14).contains(&x))
                        || ((x == 6 || x == 15) && (y == 4 || y == 17));
                    let fill = (8..=13).contains(&x) && (12..=15).contains(&y);
                    if frame || fill {
                        pixels[(y * 22 + x) * 4 + 3] = 255;
                    }
                }
            }
            TrayIconBuilder::new()
                .icon(tauri::image::Image::new_owned(pixels, 22, 22))
                .icon_as_template(true)
                .tooltip("Availoom · AI limits")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" | "center" => {
                        if let Some(w) = app.get_webview_window("main") {
                            if event.id.as_ref() == "center" {
                                let _ = w.center();
                            }
                            let _ = fit_window(&w);
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => (),
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Availoom could not start");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn panel_fits_negative_origin_monitor() {
        assert_eq!(
            bounded_position((-10, 900), (680, 600), (-1920, 24, 1920, 1056)),
            (-680, 480)
        );
    }
    #[test]
    fn oversized_panel_does_not_panic() {
        assert_eq!(
            bounded_position((90, 90), (900, 900), (0, 0, 640, 480)),
            (0, 0)
        );
    }
    #[test]
    fn preference_defaults_are_safe() {
        let p: Preferences = serde_json::from_str("{}").unwrap();
        assert!(p.hidden_providers.is_empty());
        assert!(!p.pinned);
        assert!(!p.light);
        assert_eq!(p.orientation, Orientation::Horizontal);
    }
}
