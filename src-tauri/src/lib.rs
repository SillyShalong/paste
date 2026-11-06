pub mod appinfo;
pub mod clipboard;
pub mod commands;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod paste;
#[cfg(any(windows, test))]
mod panel_autohide;
#[cfg(any(windows, test))]
mod panel_geometry;
pub mod settings;
pub mod state;
pub mod store;

use std::sync::atomic::Ordering;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

use state::AppState;

/// Logical height of the panel strip (CSS px at 100% scale).
const PANEL_HEIGHT: f64 = 440.0;

/// Try to become the single app instance. The unnamed-ownership mutex is
/// intentionally leaked: the OS releases it when the process exits.
#[cfg(windows)]
fn acquire_single_instance_lock() -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;

    let name: Vec<u16> = "com.pasteclone.app.single-instance\0"
        .encode_utf16()
        .collect();
    unsafe {
        let _ = CreateMutexW(None, false, PCWSTR(name.as_ptr()));
        GetLastError() != ERROR_ALREADY_EXISTS
    }
}

/// Single instance for macOS: flock(2) on a lock file in the app's support
/// directory. A second concurrent instance would run a second clipboard
/// listener — two captures fighting over the store, double paste synthesis.
/// The fd is never closed on purpose: holding it open holds the lock, and
/// the OS releases both when the process exits.
#[cfg(target_os = "macos")]
fn acquire_single_instance_lock() -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    extern "C" {
        fn open(path: *const std::ffi::c_char, flags: i32, ...) -> i32;
        fn flock(fd: i32, operation: i32) -> i32;
        fn close(fd: i32) -> i32;
    }
    const O_RDWR: i32 = 0x0002;
    const O_CREAT: i32 = 0x0200;
    const LOCK_EX: i32 = 2;
    const LOCK_NB: i32 = 4;

    let Some(home) = std::env::var_os("HOME") else {
        return true; // nowhere to put the lock — don't block startup
    };
    let dir = std::path::PathBuf::from(home)
        .join("Library/Application Support/com.pasteclone.app");
    if std::fs::create_dir_all(&dir).is_err() {
        return true;
    }
    let path = dir.join("single-instance.lock");
    let Ok(cpath) = CString::new(path.as_os_str().as_bytes()) else {
        return true;
    };
    unsafe {
        let fd = open(cpath.as_ptr(), O_CREAT | O_RDWR, 0o644);
        if fd < 0 {
            return true; // can't even open the lock file — don't block startup
        }
        if flock(fd, LOCK_EX | LOCK_NB) != 0 {
            close(fd);
            return false;
        }
        true // fd deliberately left open: keeping it holds the lock
    }
}

/// Selectable tray icon variants (embedded at compile time).
const TRAY_ICON_SETS: &[(&str, &[u8])] = &[
    ("classic", include_bytes!("../icons/tray/classic.png")),
    ("emerald", include_bytes!("../icons/tray/emerald.png")),
    ("sunset", include_bytes!("../icons/tray/sunset.png")),
    ("ocean", include_bytes!("../icons/tray/ocean.png")),
    ("mono", include_bytes!("../icons/tray/mono.png")),
    ("pearl", include_bytes!("../icons/tray/pearl.png")),
];

/// Resolved UI language for native-side strings (tray menu).
#[derive(Clone, Copy, PartialEq)]
pub enum Lang {
    En,
    Zh,
}

fn tray_lang(app: &AppHandle) -> Lang {
    let pref = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .language
        .clone();
    let zh = match pref.as_str() {
        "zh" => true,
        "en" => false,
        _ => sys_locale::get_locale()
            .map(|l| l.to_lowercase().starts_with("zh"))
            .unwrap_or(false),
    };
    if zh { Lang::Zh } else { Lang::En }
}

fn labels_open(lang: Lang) -> &'static str {
    if lang == Lang::Zh { "打开 Paste" } else { "Open Paste" }
}
fn labels_pause(lang: Lang) -> &'static str {
    if lang == Lang::Zh { "暂停剪贴板历史" } else { "Pause clipboard history" }
}
fn labels_settings(lang: Lang) -> &'static str {
    if lang == Lang::Zh { "设置…" } else { "Settings…" }
}
fn labels_quit(lang: Lang) -> &'static str {
    if lang == Lang::Zh { "退出 Paste" } else { "Quit Paste" }
}

fn tray_icon_image(name: &str) -> tauri::image::Image<'static> {
    let bytes = TRAY_ICON_SETS
        .iter()
        .find(|(id, _)| *id == name)
        .or_else(|| TRAY_ICON_SETS.first())
        .map(|(_, b)| *b)
        .expect("tray icon set is not empty");
    tauri::image::Image::from_bytes(bytes).expect("embedded tray icon must decode")
}

/// Swap the tray icon at runtime (settings changes).
pub fn apply_tray_icon(app: &AppHandle, name: &str) {
    if let Some(tray) = app.tray_by_id("tray") {
        let _ = tray.set_icon(Some(tray_icon_image(name)));

    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Single instance: on Windows a second concurrent launch would fight
    // over the WebView2 user-data folder and abort with 0x800700AA
    // ("resource in use") at startup; on macOS it would run a second
    // clipboard listener against the same store. Either way: exit early.
    #[cfg(any(windows, target_os = "macos"))]
    if !acquire_single_instance_lock() {
        eprintln!("[paste] another instance is already running; exiting");
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Released {
                        return;
                    }
                    on_shortcut(app, shortcut);
                })
                .build(),
        )
        .setup(|app| {
            // macOS is a menu-bar app: tray icon on top, no Dock icon.
            // The accessory activation policy must be set before the event
            // loop starts, which the setup hook is in time for.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let state = AppState::new(app.handle())?;
            app.manage(state);
            // Needed before the clipboard listener starts (macOS main-thread
            // dispatch for AppKit work).
            let _ = state::APP_HANDLE.set(app.handle().clone());

            #[cfg(target_os = "macos")]
            eprintln!(
                "[paste] startup: accessibility_trusted={}",
                crate::macos::ax_trusted()
            );

            build_tray(app.handle())?;
            clipboard::listener::start(app.handle().clone());

            apply_shortcuts(app.handle())?;

            // Create the panel here (not from config) so a transient WebView2
            // failure — 0x800700AA right after a runtime update — can be
            // retried; if the machine stays busy the app keeps running with
            // tray + history capture and the panel can be created lazily.
            // Same helper as the tray retry path so the autohide behavior is
            // registered no matter which path built the window.
            if let Err(e) = create_panel(app.handle()) {
                eprintln!(
                    "[paste] panel unavailable (machine WebView2 busy); tray and history keep running - use the tray icon to retry: {e}"
                );
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_initial,
            commands::list_tray_icons,
            commands::read_file_image,
            commands::list_clips,
            commands::paste_clip,
            commands::delete_clip,
            commands::toggle_pin,
            commands::clear_history,
            commands::get_settings,
            commands::set_settings,
            commands::set_pinboard,
            commands::create_pinboard,
            commands::rename_pinboard,
            commands::delete_pinboard,
            commands::recent_sources,
            commands::toggle_pause,
            commands::hide_panel,
            commands::open_settings,
            commands::paste_permission_granted,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Paste");
}

/// Focus the panel window reliably. Windows only lets the foreground
/// process call SetForegroundWindow, and the hotkey usually arrives while
/// another app owns the foreground — a plain set_focus() is then silently
/// ignored, the panel never holds focus, and clicking outside it does not
/// trigger the auto-hide-on-blur behavior. AttachThreadInput unlocks it
/// (same technique as the paste focus-restore).
#[cfg(windows)]
fn force_focus_panel(panel: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        INPUT_KEYBOARD, VK_MENU,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };
    let Some(hwnd) = panel.hwnd().ok().map(|h| h.0 as isize) else { return };
    unsafe {
        let hwnd = HWND(hwnd as *mut _);
        let target_thread = GetWindowThreadProcessId(hwnd, None);
        let current_thread = GetCurrentThreadId();
        let fg = GetForegroundWindow();
        let fg_thread = if fg.0.is_null() {
            0
        } else {
            GetWindowThreadProcessId(fg, None)
        };
        let attached_fg = if fg_thread != 0 && fg_thread != current_thread {
            AttachThreadInput(current_thread, fg_thread, true)
        } else {
            false.into()
        };
        let attached_target = if target_thread != 0 && target_thread != current_thread {
            AttachThreadInput(current_thread, target_thread, true)
        } else {
            false.into()
        };

        // While the input queues are attached, focus calls are allowed.
        // NOTE: SetForegroundWindow targets the top-level wrapper; the actual
        // keyboard focus must end on the WebView2 CHILD window (panel.set_focus
        // does that). Calling SetFocus on the wrapper here steals focus from
        // the child, the webview fires blur, and the panel instantly hides.
        let _ = SetForegroundWindow(hwnd);
        let _ = panel.set_focus();

        if attached_target.as_bool() {
            AttachThreadInput(current_thread, target_thread, false);
        }
        if attached_fg.as_bool() {
            AttachThreadInput(current_thread, fg_thread, false);
        }

        // Last resort: a stray Alt tap unlocks SetForegroundWindow when the
        // foreground lock is still refusing the hand-off.
        if GetForegroundWindow().0 != hwnd.0 {
            let mk = |flags: KEYBD_EVENT_FLAGS| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_MENU,
                        wScan: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            let _ = SendInput(
                &[mk(KEYBD_EVENT_FLAGS(0)), mk(KEYEVENTF_KEYUP)],
                std::mem::size_of::<INPUT>() as i32,
            );
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

/// Watchdog hiding the panel when it stops being the foreground window.
/// WebView2 blur events also occur during internal focus hand-offs, so on
/// Windows only sustained native foreground changes trigger auto-hide.
#[cfg(windows)]
fn spawn_panel_foreground_watcher(app: &AppHandle, panel: &tauri::WebviewWindow) {
    let Ok(panel_hwnd) = panel.hwnd().map(|h| h.0 as isize) else { return };
    let generation = app.state::<AppState>().panel_generation.load(Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        // Grace period while the focus hand-off settles.
        std::thread::sleep(std::time::Duration::from_millis(600));
        let mut guard = panel_autohide::ForegroundGuard::default();
        loop {
            if app.state::<AppState>().panel_generation.load(Ordering::SeqCst) != generation {
                return;
            }
            let Some(panel) = app.get_webview_window("panel") else { return };
            if !panel.is_visible().unwrap_or(false) {
                return;
            }
            // Compare ROOT OWNERS: the foreground window may legitimately be a
            // child of the panel (the WebView2 input window), which is not a
            // reason to close.
            let fg_root = unsafe {
                use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOTOWNER};
                let fg = GetForegroundWindow();
                if fg.0.is_null() {
                    0
                } else {
                    GetAncestor(fg, GA_ROOTOWNER).0 as isize
                }
            };
            if guard.should_hide((fg_root != 0).then_some(fg_root == panel_hwnd)) {
                // Serialize the hide with show_panel and recheck its generation:
                // an old watcher must never hide a newly reopened panel.
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if handle.state::<AppState>().panel_generation.load(Ordering::SeqCst) != generation {
                        return;
                    }
                    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOTOWNER};
                    let fg = unsafe { GetForegroundWindow() };
                    if !fg.0.is_null() && unsafe { GetAncestor(fg, GA_ROOTOWNER).0 as isize } != panel_hwnd {
                        if let Some(panel) = handle.get_webview_window("panel") {
                            let _ = panel.hide();
                        }
                    }
                });
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    });
}

#[cfg(not(any(windows, target_os = "macos")))]
fn spawn_panel_foreground_watcher(_app: &AppHandle, _panel: &tauri::WebviewWindow) {}

/// macOS watchdog: same guarantee as the Windows foreground watcher — when
/// the frontmost app is no longer ours, the panel hides, even if the blur
/// event never fired (clicks that take activation away without delivering a
/// usable focus hand-off to a borderless panel). NSWorkspace needs the main
/// thread; each poll is a cheap PID read via `frontmost_process_id`.
#[cfg(target_os = "macos")]
fn spawn_panel_foreground_watcher(app: &AppHandle, _panel: &tauri::WebviewWindow) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Grace period while the focus hand-off settles.
        std::thread::sleep(std::time::Duration::from_millis(400));
        let mine = std::process::id() as isize;
        loop {
            let Some(panel) = app.get_webview_window("panel") else { return };
            if !panel.is_visible().unwrap_or(false) {
                return;
            }
            let front = crate::state::on_main_sync(crate::macos::frontmost_process_id).flatten();
            if let Some(front) = front {
                if front != mine {
                    eprintln!("[paste] watchdog: frontmost pid {front} != {mine}; hiding panel");
                    let _ = panel.hide();
                    return;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    });
}

/// Windows forces focus through the input-queue attach so the blur watchdog
/// has something to work with; on macOS making the panel key is enough.
#[cfg(target_os = "macos")]
fn force_focus_panel(panel: &tauri::WebviewWindow) {
    let _ = panel.set_focus();
}

#[cfg(not(any(windows, target_os = "macos")))]
fn force_focus_panel(_panel: &tauri::WebviewWindow) {}

fn on_shortcut(app: &AppHandle, shortcut: &Shortcut) {
    let state = app.state::<AppState>();
    let main = parse_shortcut(&state.settings.lock().unwrap().hotkey);
    if let Some(main) = main {
        if *shortcut == main {
            toggle_panel(app);
            return;
        }
    }
    if state.settings.lock().unwrap().quick_paste {
        for i in 1..=9u8 {
            if *shortcut == digit_shortcut(i) {
                commands::quick_paste_index(app, i as i64);
                return;
            }
        }
    }
}

fn parse_shortcut(s: &str) -> Option<Shortcut> {
    Shortcut::try_from(s.to_lowercase().as_str()).ok()
}

fn digit_shortcut(i: u8) -> Shortcut {
    let code = match i {
        1 => Code::Digit1,
        2 => Code::Digit2,
        3 => Code::Digit3,
        4 => Code::Digit4,
        5 => Code::Digit5,
        6 => Code::Digit6,
        7 => Code::Digit7,
        8 => Code::Digit8,
        _ => Code::Digit9,
    };
    // Quick paste with Cmd on macOS, Ctrl elsewhere.
    #[cfg(target_os = "macos")]
    let modifier = Modifiers::SUPER;
    #[cfg(not(target_os = "macos"))]
    let modifier = Modifiers::CONTROL;
    Shortcut::new(Some(modifier), code)
}

/// (Re)register all global shortcuts according to current settings.
pub fn apply_shortcuts(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap();
    if let Some(sc) = parse_shortcut(&settings.hotkey) {
        gs.register(sc)?;
    }
    if settings.quick_paste {
        for i in 1..=9u8 {
            gs.register(digit_shortcut(i))?;
        }
    }
    Ok(())
}

/// Show/hide the main panel window.
/// Register the auto-hide-on-focus-loss behavior for the panel window.
fn register_panel_autohide(app: &AppHandle) {
    // WebView2 can report blur while focus moves between its child windows.
    // Windows uses the debounced native foreground watcher instead.
    #[cfg(windows)]
    let _ = app;
    #[cfg(not(windows))]
    {
        let handle = app.clone();
        if let Some(panel) = app.get_webview_window("panel") {
            panel.on_window_event(move |event| {
                if let WindowEvent::Focused(false) = event {
                    if let Some(w) = handle.get_webview_window("panel") {
                        let _ = w.hide();
                    }
                }
            });
        }
    }
}

/// Create the panel window with retries. Returns Err only after every
/// attempt failed — the caller decides whether that is fatal (startup)
/// or recoverable (lazy retry from the tray).
fn create_panel(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let mut built = None;
    let mut last_err = None;
    for attempt in 1..=5 {
        let builder = tauri::WebviewWindowBuilder::new(
            app,
            "panel",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Paste")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .visible(false)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false);

        // macOS: frosted glass via the native NSVisualEffectView material.
        // CSS backdrop-filter over a transparent WKWebView composes unreliably
        // — the transparency only kicks in after a delayed layer rebuild,
        // so the panel looked opaque for seconds after opening. The native
        // vibrancy material exists from window creation and is instant.
        #[cfg(target_os = "macos")]
        let builder = builder.effects(tauri::utils::config::WindowEffectsConfig {
            effects: vec![tauri::utils::WindowEffect::UnderWindowBackground],
            state: None,
            radius: None,
            color: None,
            interactive: false,
        });

        // Windows: with `transparent: true` the page is see-through, but the
        // WebView2 control's OWN default background stays white until the
        // page paints — it surfaces as white edges/corners around the
        // frosted panel, worst during hover and resize (the compositor
        // rebuilds translucent layers there). Pin the default background to
        // (0,0,0,0) so every unpainted pixel is transparent, not white.
        #[cfg(windows)]
        let builder = builder.background_color(tauri::utils::config::Color(0, 0, 0, 0));

        match builder.build() {
            Ok(w) => {
                #[cfg(windows)]
                strip_system_window_border(&w);
                built = Some(w);
                break;
            }
            Err(e) => {
                eprintln!("[paste] panel create attempt {}/5 failed: {}", attempt, e);
                last_err = Some(e);
                std::thread::sleep(std::time::Duration::from_secs(4));
            }
        }
    }
    match built {
        Some(w) => {
            register_panel_autohide(app);
            Ok(w)
        }
        None => Err(last_err.expect("at least one attempt")),
    }
}

/// Windows 11 draws a subtle DWM border (and rounding) on every top-level
/// window, even undecorated ones. On the dark translucent panel that system
/// border reads as a light/white edge — remove it with DWMWA_BORDER_COLOR =
/// DWMWA_COLOR_NONE. Needs no redraw; the setting persists for the window's
/// lifetime.
#[cfg(windows)]
fn strip_system_window_border(panel: &tauri::WebviewWindow) {
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR};
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    if let Ok(hwnd) = panel.hwnd() {
        let none: u32 = DWMWA_COLOR_NONE;
        let result = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                &none as *const u32 as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            )
        };
        if let Err(e) = result {
            eprintln!("[paste] DWM border strip failed: {e}");
        }
    }
}

pub fn toggle_panel(app: &AppHandle) {
    match app.get_webview_window("panel") {
        Some(panel) => {
            if panel.is_visible().unwrap_or(false) {
                let _ = panel.hide();
            } else {
                show_panel(app, &panel);
            }
        }
        None => {
            // No panel yet (startup creation failed on a busy machine):
            // retry now that the user is explicitly asking for it.
            match create_panel(app) {
                Ok(panel) => show_panel(app, &panel),
                Err(e) => eprintln!("[paste] panel still unavailable: {}", e),
            }
        }
    }
}

pub fn show_panel(app: &AppHandle, panel: &tauri::WebviewWindow) {
    app.state::<AppState>().panel_generation.fetch_add(1, Ordering::SeqCst);
    let state = app.state::<AppState>();
    let pos_pref = state.settings.lock().unwrap().panel_position.clone();

    // Capture the foreground window BEFORE the panel takes focus — its
    // monitor is where the user is working, so that's where the panel goes.
    paste::capture_foreground(app);
    let prev = *state.prev_hwnd.lock().unwrap();
    // macOS placement keys off the cursor monitor instead of prev's window.
    #[cfg(not(windows))]
    let _ = prev;

    #[cfg(windows)]
    if let Some((mx, my, mw, mh)) = monitor_area_for(prev) {
        // Land on the target monitor first so scale_factor() reflects it,
        // then size and place the panel precisely.
        let _ = panel.set_position(tauri::PhysicalPosition::new(mx, my));
        let scale = panel.scale_factor().unwrap_or(1.0);
        let (x, y, width, height) = panel_geometry::panel_bounds((mx, my, mw, mh), scale, &pos_pref);
        let _ = panel.set_size(tauri::PhysicalSize::new(width, height));
        let _ = panel.set_position(tauri::PhysicalPosition::new(x, y));
    }
    #[cfg(target_os = "macos")]
    {
        // Land on the screen the user is working on: the monitor containing
        // the cursor when we can get it, else the primary monitor.
        let monitor = monitor_with_cursor(panel)
            .or_else(|| panel.primary_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let scale = monitor.scale_factor();
            let size = monitor.size();
            let pos = monitor.position();
            let target_h = (PANEL_HEIGHT * scale).round() as i32;
            let margin = (12.0 * scale).round() as i32;
            let y = match pos_pref.as_str() {
                "top" => pos.y + margin,
                "bottom" => pos.y + size.height as i32 - target_h - margin,
                _ => pos.y + (size.height as i32 - target_h) / 2,
            };
            let _ = panel.set_size(tauri::PhysicalSize::new(size.width, target_h as u32));
            let _ = panel.set_position(tauri::PhysicalPosition::new(pos.x, y));
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    if let Ok(Some(monitor)) = panel.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let pos = monitor.position();
        let target_h = (PANEL_HEIGHT * scale).round() as i32;
        let _ = panel.set_size(tauri::PhysicalSize::new(size.width, target_h as u32));
        let _ = panel.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
    }

    let _ = panel.show();
    force_focus_panel(panel);
    let _ = app.emit_to("panel", "panel:opened", ());
    spawn_panel_foreground_watcher(app, panel);
}

/// Physical work area (excluding the taskbar) for the given window; falls
/// back to the monitor under the cursor when the window is unknown.
#[cfg(windows)]
fn monitor_area_for(prev_hwnd: Option<isize>) -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::{HWND, POINT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO,
        MONITOR_DEFAULTTONEAREST,
    };
    unsafe {
        let hmon = match prev_hwnd {
            Some(v) if v != 0 => MonitorFromWindow(HWND(v as *mut _), MONITOR_DEFAULTTONEAREST),
            _ => {
                let mut pt = POINT::default();
                let _ = windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut pt);
                MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
            }
        };
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(hmon, &mut mi).as_bool() {
            Some((
                mi.rcWork.left,
                mi.rcWork.top,
                mi.rcWork.right - mi.rcWork.left,
                mi.rcWork.bottom - mi.rcWork.top,
            ))
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
fn monitor_area_for(_prev_hwnd: Option<isize>) -> Option<(i32, i32, i32, i32)> {
    None
}

/// The monitor currently containing the mouse cursor (macOS helper for
/// panel placement — the closest cross-platform stand-in for "the screen
/// the user is working on").
#[cfg(target_os = "macos")]
fn monitor_with_cursor(panel: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    let cursor = panel.cursor_position().ok()?;
    panel.available_monitors().ok()?.into_iter().find(|m| {
        let p = m.position();
        let s = m.size();
        let (x, y) = (p.x as f64, p.y as f64);
        let (w, h) = (s.width as f64, s.height as f64);
        cursor.x >= x && cursor.x < x + w && cursor.y >= y && cursor.y < y + h
    })
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let paused = app.state::<AppState>().paused.load(Ordering::Relaxed);
    let icon_name = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .tray_icon
        .clone();
    let lang = tray_lang(app);
        let open = MenuItem::with_id(app, "open", labels_open(lang), true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(
        app,
        "pause",
        labels_pause(lang),
        true,
        paused,
        None::<&str>,
    )?;
    let settings_item = MenuItem::with_id(app, "settings", labels_settings(lang), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", labels_quit(lang), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pause, &settings_item, &quit])?;

    TrayIconBuilder::with_id("tray")
        .icon(tray_icon_image(&icon_name))
        .tooltip("Paste")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => toggle_panel(app),
            "pause" => {
                commands::toggle_pause_cmd(app).ok();
            }
            "settings" => {
                // Spawn: the tray handler runs on the main thread, and
                // creating a webview here would deadlock it (same as the
                // sync-command variant of this bug).
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = open_settings_window(&handle);
                });
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
                toggle_panel(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Rebuild the tray menu so the "Pause" checkmark reflects current state.
pub fn refresh_tray(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("tray") {
        let paused = app.state::<AppState>().paused.load(Ordering::Relaxed);
        let lang = tray_lang(app);
        let open = MenuItem::with_id(app, "open", labels_open(lang), true, None::<&str>).unwrap();
        let pause = CheckMenuItem::with_id(
            app,
            "pause",
            labels_pause(lang),
            true,
            paused,
            None::<&str>,
        )
        .unwrap();
        let settings_item =
            MenuItem::with_id(app, "settings", labels_settings(lang), true, None::<&str>).unwrap();
        let quit = MenuItem::with_id(app, "quit", labels_quit(lang), true, None::<&str>).unwrap();
        let menu = Menu::with_items(app, &[&open, &pause, &settings_item, &quit]).unwrap();
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn open_settings_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window("settings") {
        win.show()?;
        win.set_focus()?;
        return Ok(());
    }
    WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html#/settings".into()),
    )
    .title("Paste Settings")
    .inner_size(780.0, 560.0)
    .resizable(true)
    .minimizable(false)
    .maximizable(false)
    .center()
    .build()?;
    Ok(())
}
