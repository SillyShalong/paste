use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::store;

/// App settings persisted in the `settings` key-value table.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Global shortcut that toggles the panel, e.g. "Ctrl+Shift+V".
    pub hotkey: String,
    /// Register Ctrl+1..9 global shortcuts for quick pasting.
    pub quick_paste: bool,
    /// Max number of clips kept (0 = unlimited, Paste default).
    pub max_clips: i64,
    /// Paste as plain text by default (Paste has this option).
    pub always_plain_text: bool,
    /// exe names (lowercase, no path) excluded from capture.
    pub excluded_apps: Vec<String>,
    /// When true, new copies are not recorded (tray pause switch).
    #[serde(default)]
    pub paused: bool,
    /// Launch at login.
    #[serde(default)]
    pub autostart: bool,
    /// Vertical placement of the panel on its screen: "center" | "top" | "bottom".
    #[serde(default)]
    pub panel_position: String,
    /// Mouse-wheel direction over the card strip: "default" (down = older,
    /// scroll right) or "natural" (down = newer, scroll left).
    #[serde(default)]
    pub wheel_direction: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hotkey: "CmdOrCtrl+Shift+V".into(),
            quick_paste: true,
            max_clips: 0,
            always_plain_text: false,
            excluded_apps: default_excluded_apps(),
            paused: false,
            autostart: false,
            panel_position: "center".into(),
            wheel_direction: "default".into(),
        }
    }
}

/// Password managers etc. that should never be captured by default.
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
