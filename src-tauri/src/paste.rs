//! Pasting a history item into the previously focused application:
//! restore focus → write clipboard → synthesize Ctrl+V / Cmd+V.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::clipboard::{self, ClipContent};
use crate::state::AppState;
use crate::store::{self, Clip, ClipKind};

/// Remember the foreground window so we can give focus back after the panel
/// opened. Must run BEFORE the panel takes focus.
pub fn capture_foreground(app: &AppHandle) {
    let hwnd = foreground_window();
    let state = app.state::<AppState>();
    *state.prev_hwnd.lock().unwrap() = hwnd;
    #[cfg(windows)]
    {
        *state.prev_focus_hwnd.lock().unwrap() = hwnd.and_then(focused_child_window);
    }
}

/// Paste a clip into the app that had focus before the panel opened.
/// Returns true if the paste keystroke was sent.
///
/// Ordering matters: focus must be restored to the target while our panel
/// still owns the foreground (Windows only allows the foreground process to
/// call SetForegroundWindow), then the panel hides, then the keystroke fires.
pub fn paste_clip(app: &AppHandle, clip: &Clip, plain_text: bool) -> bool {
    // If the image file is gone (or content unreadable), abort instead of
    // clobbering the user's clipboard with an empty string.
    let Some(content) = clip_to_content(clip, plain_text) else {
        eprintln!("[paste] clip id={} has no readable content; aborting", clip.id);
        return false;
    };
    let state = app.state::<AppState>();
    {
        // Ignore the clipboard-change event our own write triggers.
        let _guard = SkipCaptureGuard::new(&state.skip_capture);
        if !clipboard::set::set_clipboard(&content) {
            return false;
        }
    }
    let target = *state.prev_hwnd.lock().unwrap();
    // Windows tracks a raw HWND; macOS tracks a PID — same isize slot.
    #[cfg(windows)]
    let restore = target.is_some() && is_window(hwnd_from_isize(target.unwrap()));
    #[cfg(not(windows))]
    let restore = target.is_some() && is_window(target.unwrap());

    eprintln!(
        "[paste] paste_clip id={} kind={:?} set_ok=true restore={} target={:#x}",
        clip.id,
        clip.kind,
        restore,
        target.unwrap_or(0)
    );

    match store::increment_paste_count(&state.db.lock().unwrap(), clip.id) {
        Ok(_) => {}
        Err(e) => eprintln!("[paste] increment_paste_count failed: {e}"),
    }

    #[cfg(any(windows, target_os = "macos"))]
    if restore {
        #[cfg(windows)]
        restore_foreground(target.unwrap(), *state.prev_focus_hwnd.lock().unwrap());
        #[cfg(target_os = "macos")]
        restore_foreground(target.unwrap());
    }

    // Hide the panel only after focus has moved back to the target app.
    if let Some(panel) = app.get_webview_window("panel") {
        let _ = panel.hide();
    }
    // macOS app activation is asynchronous and can take a few hundred ms —
    // the synthesized keystroke must land after the target is actually key
    // again, or it goes to whatever still holds focus.
    #[cfg(target_os = "macos")]
    std::thread::sleep(Duration::from_millis(150));
    #[cfg(not(target_os = "macos"))]
    std::thread::sleep(Duration::from_millis(60));

    #[cfg(windows)]
    if !restore || foreground_window() != target {
        eprintln!("[paste] target is no longer foreground; paste cancelled");
        return false;
    }
    send_paste_to(false, None);
    true
}

/// Bring the target window back to the foreground. Windows only lets the
/// foreground process (or the process that received the last input) steal
/// focus, so we attach to the target thread's input queue first — the same
/// trick Ditto and other clipboard managers use.
#[cfg(windows)]
fn restore_foreground(target: isize, focus: Option<isize>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, INPUT_KEYBOARD, SetFocus, VK_MENU,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetForegroundWindow, GetWindowThreadProcessId, IsWindow,
        SetForegroundWindow, GA_ROOT,
    };

    let hwnd = HWND(target as *mut _);
    unsafe {
        let target_thread = GetWindowThreadProcessId(hwnd, None);
        let current_thread = GetCurrentThreadId();
        let fg = GetForegroundWindow();
        let fg_thread = if fg.0.is_null() {
            0
        } else {
            GetWindowThreadProcessId(fg, None)
        };
        // Attach to both the current foreground thread and the target so we
        // are allowed to move focus between them.
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

        let ok = SetForegroundWindow(hwnd).as_bool();
        if !ok {
            // Classic fallback: a stray Alt tap unlocks SetForegroundWindow.
            let mk = |flags: windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS| INPUT {
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
        // Restore only the previously focused child, and only if it still
        // belongs to the original foreground window. Never focus the wrapper.
        if let Some(focus) = focus {
            let child = HWND(focus as *mut _);
            if IsWindow(child).as_bool() && GetAncestor(child, GA_ROOT) == hwnd {
                let _ = SetFocus(child);
            }
        }

        if attached_target.as_bool() {
            AttachThreadInput(current_thread, target_thread, false);
        }
        if attached_fg.as_bool() {
            AttachThreadInput(current_thread, fg_thread, false);
        }

        let now_fg = GetForegroundWindow();
        eprintln!(
            "[paste] restore_foreground target={target:#x} first_try={ok} now_foreground={:#x}",
            now_fg.0 as usize
        );
        std::thread::sleep(Duration::from_millis(120));
    }
}

/// Bring the target app back to the foreground on macOS: activate the app
/// that owned `target` (a PID) before the panel opened.
#[cfg(target_os = "macos")]
fn restore_foreground(target: isize) {
    let ok = unsafe { crate::macos::activate_pid(target) };
    eprintln!("[paste] restore_foreground pid={target:#x} ok={ok}");
    std::thread::sleep(Duration::from_millis(120));
}

/// Quick paste from a global shortcut (panel not involved): target is the
/// currently focused window. The target HWND is captured synchronously on the
/// shortcut thread; the clipboard write + keystroke sequence (which sleeps)
/// runs off-thread so the UI never blocks.
pub fn quick_paste_index(app: &AppHandle, index: i64) {
    let state = app.state::<AppState>();
    let clips = {
        let db = state.db.lock().unwrap();
        // Mirror the History view: unpinned clips only.
        store::list_clips(&db, Some(None), "", None, index, 0).unwrap_or_default()
    };
    let Some(clip) = clips.get(index as usize - 1).cloned() else {
        return;
    };
    let target = foreground_window();
    let plain = state.settings.lock().unwrap().always_plain_text;
    let app = app.clone();
    std::thread::Builder::new()
        .name("quick-paste".into())
        .spawn(move || {
            let Some(content) = clip_to_content(&clip, plain) else {
                return;
            };
            let state = app.state::<AppState>();
            {
                let _guard = SkipCaptureGuard::new(&state.skip_capture);
                if !clipboard::set::set_clipboard(&content) {
                    return;
                }
            }
            let _ = store::increment_paste_count(&state.db.lock().unwrap(), clip.id);
            send_paste_to(true, target);
        })
        .ok();
}

/// Build the clipboard payload for a clip. Returns None when the content is
/// gone (e.g. the image file was deleted), so callers can abort cleanly.
/// Shared by paste (keystroke) and copy_clip (clipboard-only write).
pub(crate) fn clip_to_content(clip: &Clip, plain_text: bool) -> Option<ClipContent> {
    match clip.kind {
        ClipKind::Image => {
            let png = std::fs::read(clip.image_path.as_ref()?).ok()?;
            Some(ClipContent::Image { png })
        }
        ClipKind::File => {
            let paths: Vec<String> = clip
                .files
                .as_deref()
                .and_then(|f| serde_json::from_str(f).ok())
                .unwrap_or_default();
            Some(ClipContent::Files { paths })
        }
        ClipKind::Link => Some(ClipContent::Link {
            text: clip.text.clone().unwrap_or_default(),
            html: if plain_text { None } else { clip.html.clone() },
        }),
        ClipKind::Color => Some(ClipContent::Color {
            text: clip.text.clone().unwrap_or_default(),
        }),
        ClipKind::Text => Some(ClipContent::Text {
            text: clip.text.clone().unwrap_or_default(),
            html: if plain_text { None } else { clip.html.clone() },
        }),
    }
}

fn send_paste_to(restore: bool, target: Option<isize>) {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
            INPUT_KEYBOARD, VK_CONTROL, VK_V,
        };
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

        if restore {
            if let Some(hwnd) = target {
                unsafe {
                    let _ = SetForegroundWindow(HWND(hwnd as *mut _));
                }
                // Give the target app a beat to process the activation.
                std::thread::sleep(Duration::from_millis(120));
            }
        }

        #[cfg(windows)]
        unsafe {
            let fg = GetForegroundWindow();
            eprintln!("[paste] send_paste_to restore={restore} foreground_before_send={:#x}", fg.0 as usize);
        }

        let mk = |vk: u16, flags: KEYBD_EVENT_FLAGS| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        let inputs = [
            mk(VK_CONTROL.0, KEYBD_EVENT_FLAGS(0)),
            mk(VK_V.0, KEYBD_EVENT_FLAGS(0)),
            mk(VK_V.0, KEYEVENTF_KEYUP),
            mk(VK_CONTROL.0, KEYEVENTF_KEYUP),
        ];
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }
    #[cfg(target_os = "macos")]
    {
        use crate::macos;
        if restore {
            if let Some(pid) = target {
                unsafe {
                    macos::activate_pid(pid);
                }
                // Give the target app a beat to process the activation.
                std::thread::sleep(Duration::from_millis(120));
            }
        }
        let front = crate::state::on_main_sync(macos::frontmost_process_id).flatten();
        eprintln!(
            "[paste] sending Cmd+V: ax_trusted={} frontmost={front:?}",
            macos::ax_trusted()
        );
        unsafe {
            macos::post_cmd_v();
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (restore, target);
    }
}

#[cfg(windows)]
fn focused_child_window(target: isize) -> Option<isize> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO};
    let hwnd = HWND(target as *mut _);
    unsafe {
        let thread = GetWindowThreadProcessId(hwnd, None);
        if thread == 0 { return None; }
        let mut info = GUITHREADINFO { cbSize: std::mem::size_of::<GUITHREADINFO>() as u32, ..Default::default() };
        if GetGUIThreadInfo(thread, &mut info).is_err() || info.hwndFocus.0.is_null() {
            None
        } else {
            Some(info.hwndFocus.0 as isize)
        }
    }
}

#[cfg(windows)]
fn hwnd_from_isize(v: isize) -> windows::Win32::Foundation::HWND {
    windows::Win32::Foundation::HWND(v as *mut _)
}

#[cfg(windows)]
fn foreground_window() -> Option<isize> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            None
        } else {
            Some(hwnd.0 as isize)
        }
    }
}

/// macOS: the frontmost app's PID. NSWorkspace is main-thread-only, so this
/// dispatches through `on_main_sync` (inline when already on the main
/// thread, e.g. when called from the global-shortcut handler). Uses the
/// lightweight PID-only probe — the full app info (icon extraction) is
/// fetched separately by the capture pipeline when a copy actually happens.
#[cfg(target_os = "macos")]
fn foreground_window() -> Option<isize> {
    crate::state::on_main_sync(crate::macos::frontmost_process_id).flatten()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn foreground_window() -> Option<isize> {
    None
}

#[cfg(windows)]
fn is_window(hwnd: windows::Win32::Foundation::HWND) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;
    unsafe { IsWindow(hwnd).as_bool() }
}

#[cfg(target_os = "macos")]
fn is_window(pid: isize) -> bool {
    crate::macos::pid_alive(pid)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn is_window(_: isize) -> bool {
    false
}

/// Guard so the listener ignores our own clipboard writes during paste.
pub struct SkipCaptureGuard<'a>(&'a std::sync::atomic::AtomicBool);

impl<'a> SkipCaptureGuard<'a> {
    pub fn new(flag: &'a std::sync::atomic::AtomicBool) -> Self {
        flag.store(true, Ordering::SeqCst);
        Self(flag)
    }
}

impl Drop for SkipCaptureGuard<'_> {
    fn drop(&mut self) {
        std::thread::sleep(Duration::from_millis(80));
        self.0.store(false, Ordering::SeqCst);
    }
}
