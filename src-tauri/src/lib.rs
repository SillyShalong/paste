pub mod appinfo;
pub mod clipboard;
pub mod commands;
pub mod paste;
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

/// Selectable tray icon variants (embedded at compile time).
const TRAY_ICON_SETS: &[(&str, &[u8])] = &[
    ("classic", include_bytes!("../icons/tray/classic.png")),
    ("emerald", include_bytes!("../icons/tray/emerald.png")),
    ("sunset", include_bytes!("../icons/tray/sunset.png")),
    ("ocean", include_bytes!("../icons/tray/ocean.png")),
    ("mono", include_bytes!("../icons/tray/mono.png")),
    ("pearl", include_bytes!("../icons/tray/pearl.png")),
];

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
            let state = AppState::new(app.handle())?;
            app.manage(state);

            build_tray(app.handle())?;
            clipboard::listener::start(app.handle().clone());

            apply_shortcuts(app.handle())?;

            // Create the panel here (not from config) so a transient WebView2
            // failure — 0x800700AA right after a runtime update — can be
            // retried; if the machine stays busy the app keeps running with
            // tray + history capture and the panel can be created lazily.
            let panel = {
                let mut built = None;
                for attempt in 1..=5 {
                    match tauri::WebviewWindowBuilder::new(
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
                    .shadow(false)
                    .build()
                    {
                        Ok(w) => {
                            built = Some(w);
                            break;
                        }
                        Err(e) => {
                            eprintln!(
                                "[paste] panel create attempt {}/5 failed: {}",
                                attempt, e
                            );
                            std::thread::sleep(std::time::Duration::from_secs(4));
                        }
                    }
                }
                match built {
                    Some(w) => w,
                    None => {
                        eprintln!(
                            "[paste] panel unavailable (machine WebView2 busy); tray and history keep running - use the tray icon to retry"
                        );
                        return Ok(());
                    }
                }
            };

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_initial,
            commands::list_tray_icons,
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
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };
    let _ = panel.set_focus();
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
        let _ = SetForegroundWindow(hwnd);
        if attached_target.as_bool() {
            AttachThreadInput(current_thread, target_thread, false);
        }
        if attached_fg.as_bool() {
            AttachThreadInput(current_thread, fg_thread, false);
        }
    }
}

#[cfg(not(windows))]
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
    Shortcut::new(Some(Modifiers::CONTROL), code)
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

/// Create the panel window with retries. Returns Err only after every
/// attempt failed — the caller decides whether that is fatal (startup)
/// or recoverable (lazy retry from the tray).
fn create_panel(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let mut built = None;
    let mut last_err = None;
    for attempt in 1..=5 {
        match tauri::WebviewWindowBuilder::new(
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
        .shadow(false)
        .build()
        {
            Ok(w) => {
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
    let state = app.state::<AppState>();
    let pos_pref = state.settings.lock().unwrap().panel_position.clone();

    // Capture the foreground window BEFORE the panel takes focus — its
    // monitor is where the user is working, so that's where the panel goes.
    paste::capture_foreground(app);
    let prev = *state.prev_hwnd.lock().unwrap();

    #[cfg(windows)]
    if let Some((mx, my, mw, mh)) = monitor_area_for(prev) {
        // Land on the target monitor first so scale_factor() reflects it,
        // then size and place the panel precisely.
        let _ = panel.set_position(tauri::PhysicalPosition::new(mx, my));
        let scale = panel.scale_factor().unwrap_or(1.0);
        let target_h = (PANEL_HEIGHT * scale).round() as i32;
        let margin = (12.0 * scale).round() as i32;
        let y = match pos_pref.as_str() {
            "top" => my + margin,
            "bottom" => my + mh - target_h - margin,
            _ => my + (mh - target_h) / 2,
        };
        let _ = panel.set_size(tauri::PhysicalSize::new(mw as u32, target_h as u32));
        let _ = panel.set_position(tauri::PhysicalPosition::new(mx, y));
    }
    #[cfg(not(windows))]
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
}

/// Physical monitor area (x, y, width, height) for the given window; falls
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
                mi.rcMonitor.left,
                mi.rcMonitor.top,
                mi.rcMonitor.right - mi.rcMonitor.left,
                mi.rcMonitor.bottom - mi.rcMonitor.top,
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

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let paused = app.state::<AppState>().paused.load(Ordering::Relaxed);
    let icon_name = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .tray_icon
        .clone();
    let open = MenuItem::with_id(app, "open", "Open Paste", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(
        app,
        "pause",
        "Pause clipboard history",
        true,
        paused,
        None::<&str>,
    )?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Paste", true, None::<&str>)?;
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
        let open = MenuItem::with_id(app, "open", "Open Paste", true, None::<&str>).unwrap();
        let pause = CheckMenuItem::with_id(
            app,
            "pause",
            "Pause clipboard history",
            true,
            paused,
            None::<&str>,
        )
        .unwrap();
        let settings_item =
            MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>).unwrap();
        let quit = MenuItem::with_id(app, "quit", "Quit Paste", true, None::<&str>).unwrap();
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
