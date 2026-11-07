use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::store;

/// App settings persisted in the `settings` key-value table.
///
/// Every field carries a `serde(default)` so a settings blob written by an
/// older/newer schema still loads instead of resetting everything.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Global shortcut that toggles the panel, e.g. "Ctrl+Shift+V".
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    /// Register Ctrl+1..9 global shortcuts for quick pasting.
    #[serde(default = "default_true")]
    pub quick_paste: bool,
    /// Max number of clips kept (0 = unlimited, Paste default).
    #[serde(default)]
    pub max_clips: i64,
    /// Delete unpinned clips older than this many days (0 = keep forever).
    /// Pinned clips always survive; pruning runs at startup, after every
    /// capture and whenever settings are saved — idempotent by cutoff, so
    /// flipping the value back and forth cannot corrupt anything.
    #[serde(default)]
    pub retention_days: i64,
    /// Search syntax: "plain" (substring, default), "wildcard" (* = any run,
    /// ? = one char) or "regex" (case-insensitive Rust regex).
    #[serde(default)]
    pub search_mode: String,
    /// Paste as plain text by default (Paste has this option).
    #[serde(default)]
    pub always_plain_text: bool,
    /// exe names (lowercase, no path) excluded from capture.
    #[serde(default = "default_excluded_apps")]
    pub excluded_apps: Vec<String>,
    /// When true, new copies are not recorded (tray pause switch).
    #[serde(default)]
    pub paused: bool,
    /// Launch at login.
    #[serde(default)]
    pub autostart: bool,
    /// Panel theme: "system" | "dark" | "light".
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Vertical placement of the panel on its screen: "center" | "top" | "bottom".
    #[serde(default)]
    pub panel_position: String,
    /// Mouse-wheel direction over the card strip: "default" (down = older,
    /// scroll right) or "natural" (down = newer, scroll left).
    #[serde(default)]
    pub wheel_direction: String,
    /// Tray icon variant id: classic | emerald | sunset | ocean | mono | pearl.
    #[serde(default)]
    pub tray_icon: String,
    /// UI language: "system" (follow OS) | "en" | "zh".
    #[serde(default)]
    pub language: String,
}

fn default_hotkey() -> String {
    "CmdOrCtrl+Shift+V".into()
}

fn default_true() -> bool {
    true
}

fn default_theme() -> String {
    "system".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            quick_paste: true,
            max_clips: 0,
            retention_days: 0,
            search_mode: "plain".into(),
            always_plain_text: false,
            excluded_apps: default_excluded_apps(),
            paused: false,
            autostart: false,
            theme: default_theme(),
            panel_position: "bottom".into(),
            wheel_direction: "default".into(),
            tray_icon: "classic".into(),
            language: "system".into(),
        }
    }
}

/// Password managers etc. that should never be captured by default.
/// Both Windows exe names and macOS binary names are listed — the listener
/// matches against the lowercased executable file name on either platform.
fn default_excluded_apps() -> Vec<String> {
    vec![
        "1password.exe",
        "bitwarden.exe",
        "keepass.exe",
        "keepassxc.exe",
        "dashlane.exe",
        "lastpass.exe",
        "enpass.exe",
        "protonpass.exe",
        "robat.exe",
        // macOS bundle executables (no extension).
        "1password",
        "bitwarden",
        "keepassxc",
        "dashlane",
        "lastpass",
        "enpass",
        "protonpass",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

pub fn load(db: &Connection) -> AppSettings {
    match store::get_setting(db, "settings") {
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => AppSettings::default(),
    }
}

pub fn save(db: &Connection, settings: &AppSettings) {
    if let Ok(json) = serde_json::to_string(settings) {
        store::set_setting(db, "settings", &json);
    }
}
