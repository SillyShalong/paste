pub mod appinfo;
pub mod clipboard;
pub mod commands;
#[cfg(target_os = "macos")]
pub mod macos;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Single instance: a second concurrent launch would fight over the
    // WebView2 user-data folder and abort with 0x800700AA ("resource in
    // use") at startup — and each crash leaves zombie browser processes
    // that keep the folder locked for every later launch.
    #[cfg(windows)]
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
            let state = AppState::new(app.handle())?;
            app.manage(state);
            // Needed before the clipboard listener starts (macOS main-thread
            // dispatch for AppKit work).
            let _ = state::APP_HANDLE.set(app.handle().clone());

            build_tray(app.handle())?;
            clipboard::listener::start(app.handle().clone());
            apply_shortcuts(app.handle())?;

            // Panel behavior: auto-hide when it loses focus (clicking elsewhere,
            // opening another app...), exactly like Paste on macOS.
            if let Some(panel) = app.get_webview_window("panel") {
                let handle = app.handle().clone();
                panel.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        if let Some(w) = handle.get_webview_window("panel") {
                            let _ = w.hide();
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_initial,
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
pub fn toggle_panel(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        if panel.is_visible().unwrap_or(false) {
            let _ = panel.hide();
        } else {
            show_panel(app, &panel);
        }
    }
}

pub fn show_panel(app: &AppHandle, panel: &tauri::WebviewWindow) {
    // Span the full width of the primary monitor, vertically centered —
    // the signature Paste layout.
    if let Ok(Some(monitor)) = panel.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let pos = monitor.position();
        let phys_w = size.width;
        let phys_h = size.height;
        let target_h = (PANEL_HEIGHT * scale).round() as i32;
        let _ = panel.set_size(tauri::PhysicalSize::new(phys_w, target_h as u32));
        let y = pos.y + (phys_h as i32 - target_h) / 2;
        let _ = panel.set_position(tauri::PhysicalPosition::new(pos.x, y));
    }
    paste::capture_foreground(app);
    let _ = panel.show();
    let _ = panel.set_focus();
    let _ = app.emit_to("panel", "panel:opened", ());
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let paused = app.state::<AppState>().paused.load(Ordering::Relaxed);
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
        .icon(app.default_window_icon().unwrap().clone())
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
