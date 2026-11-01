//! Tauri IPC commands exposed to the React frontend.

use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::paste;
use crate::settings::{self, AppSettings};
use crate::state::AppState;
use crate::store::{self, Clip, ClipKind, Pinboard};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialData {
    pub settings: AppSettings,
    pub pinboards: Vec<Pinboard>,
    pub clips: Vec<Clip>,
    pub sources: Vec<SourceInfo>,
    pub paused: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub name: String,
    pub exe_path: String,
    pub color: String,
}

#[tauri::command]
pub fn get_initial(app: AppHandle) -> InitialData {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    let settings = state.settings.lock().unwrap().clone();
    let data = InitialData {
        settings,
        pinboards: store::list_pinboards(&db).unwrap_or_default(),
        // History view: unpinned clips only (mirrors live-update filtering).
        clips: store::list_clips(&db, Some(None), "", None, 100, 0).unwrap_or_default(),
        sources: store::distinct_sources(&db)
            .unwrap_or_default()
            .into_iter()
            .map(|(name, exe_path, color)| SourceInfo { name, exe_path, color })
            .collect(),
        paused: state.paused.load(Ordering::Relaxed),
    };
    data
}

#[tauri::command]
pub fn list_clips(
    app: AppHandle,
    // None = plain history (unpinned clips only); Some(id) = that pinboard.
    // (Tauri IPC can only express Option<i64> from JS, so the "everything"
    // mode of the store layer is intentionally not reachable here.)
    pinboard_id: Option<i64>,
    search: Option<String>,
    kind: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Vec<Clip> {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    store::list_clips(
        &db,
        Some(pinboard_id),
        search.as_deref().unwrap_or(""),
        kind.as_deref().and_then(ClipKind::from_str),
        limit.unwrap_or(100),
        offset.unwrap_or(0),
    )
    .unwrap_or_default()
}

#[tauri::command]
pub fn paste_clip(app: AppHandle, id: i64, plain: Option<bool>) -> bool {
    let state = app.state::<AppState>();
    let clip = {
        let db = state.db.lock().unwrap();
        store::get_clip(&db, id).ok().flatten()
    };
    let Some(clip) = clip else { return false };

    // The paste sequence contains sleeps (focus settle, skip-capture grace).
    // Run it off the main thread so the UI event loop never blocks; the bool
    // result only reports that the paste was dispatched.
    let plain = plain.unwrap_or(false);
    std::thread::Builder::new()
        .name("paste".into())
        .spawn(move || {
            paste::paste_clip(&app, &clip, plain);
        })
        .is_ok()
}

#[tauri::command]
pub fn delete_clip(app: AppHandle, id: i64) -> bool {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    // Clean up the image file belonging to the clip.
    if let Ok(Some(c)) = store::get_clip(&db, id) {
        if let Some(p) = &c.image_path {
            let _ = std::fs::remove_file(p);
        }
    }
    store::delete_clip(&db, id).is_ok()
}

#[tauri::command]
pub fn toggle_pin(app: AppHandle, id: i64, pinboard_id: Option<i64>) -> bool {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    store::set_pinboard(&db, id, pinboard_id).is_ok()
}

#[tauri::command]
pub fn clear_history(app: AppHandle) -> bool {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    match store::clear_history(&db) {
        Ok(image_paths) => {
            // Remove the PNG files of deleted clips (orphan cleanup).
            for p in image_paths.into_iter().flatten() {
                let _ = std::fs::remove_file(p);
            }
            true
        }
        Err(_) => false,
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppSettings {
    app.state::<AppState>().settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, new_settings: AppSettings) -> Result<(), String> {
    let state = app.state::<AppState>();
    let old_settings = state.settings.lock().unwrap().clone();

    // Apply shortcuts BEFORE persisting: if the new hotkey can't be
    // registered (e.g. taken by another app), restore the previous ones
    // instead of leaving the app with no working global shortcut.
    *state.settings.lock().unwrap() = new_settings.clone();
    if let Err(e) = crate::apply_shortcuts(&app) {
        *state.settings.lock().unwrap() = old_settings;
        let _ = crate::apply_shortcuts(&app);
        return Err(format!("could not register shortcut: {e}"));
    }

    settings::save(&state.db.lock().unwrap(), &new_settings);
    // Keep autostart in sync with the toggle.
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let _ = if new_settings.autostart {
        launcher.enable()
    } else {
        launcher.disable()
    };
    let _ = app.emit("settings:changed", &new_settings);
    Ok(())
}

#[tauri::command]
pub fn set_pinboard(app: AppHandle, id: i64, pinboard_id: Option<i64>) -> bool {
    toggle_pin(app, id, pinboard_id)
}

#[tauri::command]
pub fn create_pinboard(app: AppHandle, name: String) -> Option<Pinboard> {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    store::insert_pinboard(&db, &name).ok()
}

#[tauri::command]
pub fn rename_pinboard(app: AppHandle, id: i64, name: String) -> bool {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    store::rename_pinboard(&db, id, &name).is_ok()
}

#[tauri::command]
pub fn delete_pinboard(app: AppHandle, id: i64) -> bool {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    // Clips return to the plain history when their pinboard is deleted.
    let _ = store::set_pinboard_for_board(&db, id);
    store::delete_pinboard(&db, id).is_ok()
}

#[tauri::command]
pub fn recent_sources(app: AppHandle) -> Vec<SourceInfo> {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    store::distinct_sources(&db)
        .unwrap_or_default()
        .into_iter()
        .map(|(name, exe_path, color)| SourceInfo { name, exe_path, color })
        .collect()
}

/// Toggle the paused flag (tray menu + settings UI) and refresh the tray.
#[tauri::command]
pub fn toggle_pause(app: AppHandle) -> bool {
    toggle_pause_cmd(&app).unwrap_or(false)
}

pub fn toggle_pause_cmd(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let new_val = !state.paused.load(Ordering::Relaxed);
    state.paused.store(new_val, Ordering::Relaxed);
    let s = {
        let mut s = state.settings.lock().unwrap();
        s.paused = new_val;
        s.clone()
    };
    // Keep the settings and db lock scopes disjoint so lock order can
    // never invert against other code paths.
    settings::save(&state.db.lock().unwrap(), &s);
    crate::refresh_tray(app);
    let _ = app.emit("pause:changed", new_val);
    Ok(new_val)
}

#[tauri::command]
pub fn hide_panel(app: AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        let _ = panel.hide();
    }
}

/// Async on purpose: creating a webview window from a sync command runs on
/// the main thread, and WebView2 initialization then deadlocks the event
/// loop (window appears but the whole app freezes and can't be closed).
#[tauri::command]
pub async fn open_settings(app: AppHandle) {
    let _ = crate::open_settings_window(&app);
}

/// Internal (not an IPC command): paste the index-th most recent clip.
pub fn quick_paste_index(app: &AppHandle, index: i64) {
    paste::quick_paste_index(app, index);
}

/// Whether the OS lets us synthesize paste keystrokes. macOS gates Cmd+V
/// injection behind the Accessibility permission; other platforms: always.
#[tauri::command]
pub fn paste_permission_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::macos::ax_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}
