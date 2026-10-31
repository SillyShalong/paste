use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use tauri::AppHandle;
use tauri::Manager;
use crate::appinfo::SourceApp;
use crate::settings::AppSettings;
use crate::store;

/// Shared runtime state, managed by Tauri.
pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub db: Mutex<rusqlite::Connection>,
    pub paused: AtomicBool,
    /// Foreground window (raw HWND as isize) that had focus before the panel opened.
    pub prev_hwnd: Mutex<Option<isize>>,
    /// Set while we ourselves write to the clipboard (pasting an old item),
    /// so the listener doesn't re-capture what we just set.
    pub skip_capture: AtomicBool,
    /// In-memory cache of per-exe icon/color info, keyed by exe path.
    pub icon_cache: Mutex<HashMap<String, SourceApp>>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(data_dir.join("images"))?;
        std::fs::create_dir_all(data_dir.join("icons"))?;

        let db = store::open_db(&data_dir)?;
        let settings = crate::settings::load(&db);
        Ok(Self {
            paused: AtomicBool::new(false),
            settings: Mutex::new(settings),
            db: Mutex::new(db),
            prev_hwnd: Mutex::new(None),
            skip_capture: AtomicBool::new(false),
            icon_cache: Mutex::new(HashMap::new()),
            data_dir,
        })
    }
}
