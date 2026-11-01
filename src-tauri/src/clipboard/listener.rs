//! Clipboard change listener: a hidden message-only window that receives
//! WM_CLIPBOARDUPDATE and runs the capture pipeline (dedupe → exclusions →
//! store → notify frontend). Event-driven, zero polling.

use std::sync::atomic::Ordering;
use std::sync::OnceLock;

use tauri::{AppHandle, Emitter, Manager};

use super::capture;
use super::ClipContent;
use crate::appinfo;
use crate::state::AppState;
use crate::store::{self, Clip, ClipKind};

const WM_CLIPBOARDUPDATE: u32 = 0x031D;

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn start(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::Builder::new()
        .name("clipboard-listener".into())
        .spawn(listener_thread)
        .expect("failed to spawn clipboard listener thread");
}

#[cfg(windows)]
fn listener_thread() {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::DataExchange::AddClipboardFormatListener;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, HWND_MESSAGE,
        MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WNDCLASSW,
    };

    unsafe extern "system" fn wndproc(
        hwnd: windows::Win32::Foundation::HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_CLIPBOARDUPDATE {
            on_clipboard_update();
            LRESULT(0)
        } else {
            unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
        }
    }

    let class_name = utf16("PasteClipboardListener");

    unsafe {
        let hmodule = GetModuleHandleW(PCWSTR::null()).expect("GetModuleHandleW failed");
        let hinstance: windows::Win32::Foundation::HINSTANCE = hmodule.into();
        let class = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            hInstance: hinstance,
            ..Default::default()
        };
        RegisterClassW(&class);

        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            PCWSTR(class_name.as_ptr()),
            PCWSTR(class_name.as_ptr()),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            None,
            hinstance,
            None,
        )
        .unwrap_or_else(|e| panic!("CreateWindowExW failed: {e}"));

        AddClipboardFormatListener(hwnd).unwrap_or_else(|e| {
            panic!("AddClipboardFormatListener failed: {e}")
        });

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
            let _ = DispatchMessageW(&msg);
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn listener_thread() {
    loop {
        std::thread::park();
    }
}

/// macOS: no public clipboard-change notification without private APIs, so
/// poll NSPasteboard.changeCount (documented thread-safe) — the standard
/// approach used by open-source clipboard managers (Maccy etc.).
#[cfg(target_os = "macos")]
fn listener_thread() {
    use crate::macos;

    let mut last = macos::change_count();
    loop {
        std::thread::sleep(std::time::Duration::from_millis(150));
        let now = macos::change_count();
        if now != last {
            last = now;
            on_clipboard_update();
        }
    }
}

#[cfg(windows)]
fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The capture pipeline. Runs on the listener thread whenever the clipboard
/// changes.
fn on_clipboard_update() {
    let app = match APP.get() {
        Some(a) => a,
        None => return,
    };
    let state = app.state::<AppState>();

    // Don't capture what we ourselves just wrote to the clipboard.
    if state.skip_capture.load(Ordering::SeqCst) {
        return;
    }

    let settings = state.settings.lock().unwrap().clone();
    if settings.paused || state.paused.load(Ordering::Relaxed) {
        return;
    }

    let content = match capture::read_clipboard() {
        Some(c) => c,
        None => return,
    };

    // Source app = whatever had focus when the copy happened.
    let source = appinfo::foreground_app(&state.data_dir.join("icons"));
    if let Some(src) = &source {
        let exe = std::path::Path::new(&src.exe_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if settings.excluded_apps.iter().any(|e| e.eq_ignore_ascii_case(&exe)) {
            return;
        }
    }

    let (kind, text, html, files_json, png) = match &content {
        ClipContent::Text { text, html } => (ClipKind::Text, Some(text.clone()), html.clone(), None, None),
        ClipContent::Link { text, html } => (ClipKind::Link, Some(text.clone()), html.clone(), None, None),
        ClipContent::Color { text } => (ClipKind::Color, Some(text.clone()), None, None, None),
        ClipContent::Image { png } => (ClipKind::Image, None, None, None, Some(png.clone())),
        ClipContent::Files { paths } => (
            ClipKind::File,
            None,
            None,
            Some(serde_json::to_string(paths).unwrap_or_default()),
            None,
        ),
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let source_name = source.as_ref().map(|s| s.name.clone()).unwrap_or_default();
    let source_path = source.as_ref().map(|s| s.exe_path.clone()).unwrap_or_default();
    let source_color = source.as_ref().map(|s| s.color.clone()).unwrap_or_default();
    let source_icon = if source_path.is_empty() {
        String::new()
    } else {
        appinfo::icon_path_for(&state.data_dir.join("icons"), &source_path)
            .to_string_lossy()
            .into_owned()
    };

    let db = state.db.lock().unwrap();

    // Dedupe: identical text content that already exists moves to the front;
    // a consecutive duplicate of any kind is ignored entirely. Text matching
    // ignores kind — the same string classified differently across captures
    // (e.g. a pasted-in color code) should not create duplicate entries.
    if let Some(t) = &text {
        if let Ok(Some(existing)) = store::find_text_clip(&db, t) {
            let _ = store::touch_clip(&db, existing.id, now);
            let mut moved = existing;
            moved.created_at = now;
            let _ = app.emit_to("panel", "clipboard:new", &moved);
            return;
        }
    }
    if let Ok(newest) = store::list_clips(&db, None, "", None, 1, 0) {
        if let Some(n) = newest.first() {
            if n.kind == kind && n.text == text && n.files == files_json {
                if kind == ClipKind::Image {
                    // compare bytes via stored file
                    if let (Some(a), Some(p)) = (&png, &n.image_path) {
                        if let Ok(old) = std::fs::read(p) {
                            if capture::hash_bytes(&old) == capture::hash_bytes(a) {
                                let _ = store::touch_clip(&db, n.id, now);
                                let mut moved = n.clone();
                                moved.created_at = now;
                                let _ = app.emit_to("panel", "clipboard:new", &moved);
                                return;
                            }
                        }
                    }
                } else {
                    let _ = store::touch_clip(&db, n.id, now);
                    let mut moved = n.clone();
                    moved.created_at = now;
                    let _ = app.emit_to("panel", "clipboard:new", &moved);
                    return;
                }
            }
        }
    }

    // Persist image files for image clips.
    let image_path: Option<String> = match &png {
        Some(bytes) => {
            let name = format!("{}-{}.png", capture::hash_bytes(bytes), now);
            let path = state.data_dir.join("images").join(name);
            if std::fs::write(&path, bytes).is_ok() {
                Some(path.to_string_lossy().into_owned())
            } else {
                None
            }
        }
        None => None,
    };

    let clip = Clip {
        id: 0,
        kind,
        text,
        html,
        image_path,
        files: files_json,
        source_name: source_name.clone(),
        source_path,
        source_color,
        source_icon,
        pinboard_id: None,
        created_at: now,
        paste_count: 0,
    };

    match store::insert_clip(&db, &clip) {
        Ok(id) => {
            let mut clip = clip;
            clip.id = id;
            // Enforce history size limit.
            if settings.max_clips > 0 {
                if let Ok(victims) = store::enforce_limit(&db, settings.max_clips) {
                    for (vid, img) in victims {
                        if let Some(p) = img {
                            let _ = std::fs::remove_file(p);
                        }
                        let _ = store::delete_clip(&db, vid);
                    }
                }
            }
            drop(db);
            let _ = app.emit_to("panel", "clipboard:new", &clip);
        }
        Err(e) => {
            eprintln!("insert_clip failed: {e}");
            drop(db);
        }
    }
}
