use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Mutex, OnceLock};

use tauri::AppHandle;
use tauri::Manager;
use crate::settings::AppSettings;
use crate::store;

/// Global handle to the running app, set during setup. Used on macOS to
/// dispatch main-thread-only AppKit work from background threads.
pub static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Run a closure on the main thread and wait for its result. Re-entrant-safe:
/// if called from the main thread it runs inline instead of deadlocking.
#[cfg(target_os = "macos")]
pub fn on_main_sync<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    if std::thread::current().name() == Some("main") {
        return Some(f());
    }
    let app = APP_HANDLE.get()?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .ok()?;
    rx.recv().ok()
}

/// Shared runtime state, managed by Tauri.
pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub db: Mutex<rusqlite::Connection>,
    pub paused: AtomicBool,
    /// Foreground window (raw HWND as isize) that had focus before the panel opened.
    pub prev_hwnd: Mutex<Option<isize>>,
    /// Focused Windows child control captured before opening the panel.
    #[cfg(windows)]
    pub prev_focus_hwnd: Mutex<Option<isize>>,
    /// Set while we ourselves write to the clipboard (pasting an old item),
    /// so the listener doesn't re-capture what we just set.
    pub skip_capture: AtomicBool,
    /// Invalidates foreground watchers from earlier panel openings.
    pub panel_generation: AtomicU64,
    pub data_dir: PathBuf,
}

impl AppState {
    /// Delete unpinned clips older than the retention window and their image
    /// files. Idempotent: safe to call at startup, after every capture and
    /// whenever settings change; flipping retention_days back and forth
    /// cannot corrupt anything. Pinned clips always survive.
    pub fn prune_retention(&self) -> usize {
        let days = self.settings.lock().unwrap().retention_days;
        if days <= 0 {
            return 0;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let cutoff = now.saturating_sub(days.saturating_mul(86_400_000));
        match store::prune_expired(&self.db.lock().unwrap(), cutoff) {
            Ok(victims) => {
                for (_, img) in &victims {
                    if let Some(p) = img {
                        let _ = std::fs::remove_file(p);
                    }
                }
                victims.len()
            }
            Err(e) => {
                eprintln!("[paste] retention prune failed: {e}");
                0
            }
        }
    }

    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(data_dir.join("images"))?;
        std::fs::create_dir_all(data_dir.join("icons"))?;

        let db = store::open_db(&data_dir)?;
        let settings = crate::settings::load(&db);
        Ok(Self {
            // Resume the persisted pause state: an app that was paused when it
            // quit must come back paused, with the tray/toggle UI in sync.
            paused: AtomicBool::new(settings.paused),
            settings: Mutex::new(settings),
            db: Mutex::new(db),
            prev_hwnd: Mutex::new(None),
            #[cfg(windows)]
            prev_focus_hwnd: Mutex::new(None),
            skip_capture: AtomicBool::new(false),
            panel_generation: AtomicU64::new(0),
            data_dir,
        })
    }
}
