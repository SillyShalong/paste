//! Bounded, in-memory display measurements. No clipboard contents are recorded.
use std::collections::VecDeque;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

static SAMPLES: Mutex<VecDeque<Value>> = Mutex::new(VecDeque::new());

#[derive(Deserialize, Serialize)]
pub struct LayoutSample {
    event: String,
    viewport: [f64; 5],
    panel: [f64; 4],
    footer: [f64; 4],
    backgrounds: [String; 2],
}

#[tauri::command]
pub fn record_panel_layout(window: tauri::WebviewWindow, sample: LayoutSample) -> Result<(), String> {
    if window.label() != "panel" || sample.event.len() > 64 || sample.backgrounds.iter().any(|s| s.len() > 80) {
        return Err("Invalid layout sample".into());
    }
    let mut value = json!({
        "page": sample,
        "innerSize": window.inner_size().ok(),
        "outerSize": window.outer_size().ok(),
        "innerPosition": window.inner_position().ok(),
        "scale": window.scale_factor().ok(),
    });
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
        use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW, GetWindowRect};
        unsafe extern "system" fn collect(hwnd: HWND, context: LPARAM) -> BOOL {
            let rows = &mut *(context.0 as *mut Vec<Value>);
            if rows.len() >= 64 { return false.into(); }
            let mut class = [0u16; 128];
            let count = GetClassNameW(hwnd, &mut class);
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_ok() {
                rows.push(json!({"class": String::from_utf16_lossy(&class[..count.max(0) as usize]),
                    "bounds": [rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top]}));
            }
            true.into()
        }
        let mut children: Vec<Value> = Vec::new();
        unsafe { let _ = EnumChildWindows(HWND(hwnd.0 as *mut _), Some(collect), LPARAM(&mut children as *mut _ as isize)); }
        value["nativeChildren"] = json!(children);
    }
    let mut samples = SAMPLES.lock().map_err(|_| "Layout storage unavailable")?;
    if samples.len() == 24 { samples.pop_front(); }
    samples.push_back(value);
    Ok(())
}

#[tauri::command]
pub fn get_panel_layout_report() -> Result<String, String> {
    let samples = SAMPLES.lock().map_err(|_| "Layout storage unavailable")?;
    serde_json::to_string_pretty(&json!({"version": env!("CARGO_PKG_VERSION"), "samples": &*samples}))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_report_serializes_only_display_measurements() {
        let sample: LayoutSample = serde_json::from_value(json!({
            "event": "pointer-leave", "viewport": [1920, 440, 1, 0, 0],
            "panel": [0, 0, 1920, 440], "footer": [200, 400, 1720, 40],
            "backgrounds": ["rgba(26,26,31,0.86)", "rgba(0,0,0,0.1)"],
            "clipboardText": "must not appear in the diagnostic report"
        })).unwrap();
        let report = serde_json::to_value(sample).unwrap();
        assert_eq!(report["footer"], json!([200.0, 400.0, 1720.0, 40.0]));
        assert!(report.get("clipboardText").is_none());
    }
}
