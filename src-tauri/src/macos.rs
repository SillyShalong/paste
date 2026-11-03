//! Minimal, dependency-free Objective-C interop for the macOS backend
//! (Apple Silicon). Gated behind `target_os = "macos"`.
//!
//! Everything goes through raw `objc_msgSend` extern declarations against
//! stable, decades-old AppKit selectors — no generated-framework crates, so
//! there is no version drift and nothing new to resolve from crates.io.
//!
//! Memory semantics: methods returning autoreleased objects are called
//! inside a per-operation autorelease pool (`with_pool`), and their results
//! are converted to plain Rust data (String / Vec<u8>) before the pool pops.
//! `alloc`/`init` pairs are handled with raw pointers; the one +1 we take
//! from `init` (NSBitmapImageRep) is explicitly released.

#![cfg(target_os = "macos")]

use std::ffi::{c_char, c_void, CStr, CString};
use std::ptr::null;
use std::slice::from_raw_parts;

// NSPasteboard UTI type strings (stable since 10.6).
pub const UTI_TEXT: &str = "public.utf8-plain-text";
pub const UTI_HTML: &str = "public.html";
pub const UTI_PNG: &str = "public.png";
pub const UTI_TIFF: &str = "public.tiff";

// kVK_Command / kVK_ANSI_V
const VK_COMMAND: u16 = 55;
const VK_V: u16 = 9;
// kCGHIDEventTap
const CG_HID_EVENT_TAP: u32 = 0;
// NSApplicationActivateIgnoringOtherApps = 1 << 1
const NS_APP_ACTIVATE_IGNORING_OTHER_APPS: usize = 1 << 1;
// NSBitmapImageFileTypePNG (NSPNGFileType)
const NS_BITMAP_FILE_TYPE_PNG: usize = 4;

extern "C" {
    fn objc_getClass(name: *const c_char) -> *const AnyObject;
    fn sel_registerName(name: *const c_char) -> *const c_void;
    fn objc_msgSend();
    fn objc_autoreleasePoolPush() -> *mut AnyObject;
    fn objc_autoreleasePoolPop(pool: *mut AnyObject);

    fn CGEventCreateKeyboardEvent(source: *const AnyObject, key: u16, down: bool) -> *mut AnyObject;
    fn CGEventPost(tap: u32, event: *const AnyObject);
    fn CFRelease(cf: *const AnyObject);

    fn AXIsProcessTrusted() -> u8;
    fn kill(pid: i32, sig: i32) -> i32;
}

/// Run a closure inside its own autorelease pool so AppKit temporaries are
/// freed promptly on our background threads.
fn with_pool<T>(f: impl FnOnce() -> T) -> T {
    let pool = unsafe { objc_autoreleasePoolPush() };
    let out = f();
    unsafe { objc_autoreleasePoolPop(pool) };
    out
}

// Plain-data stand-in for `id`. Only used as an opaque pointer.
#[repr(C)]
struct AnyObject {
    _priv: [u8; 0],
}

fn cls(name: &str) -> *const AnyObject {
    let c = CString::new(name).expect("interior NUL in class name");
    let p = unsafe { objc_getClass(c.as_ptr()) };
    if p.is_null() {
        panic!("objc class not found: {name}");
    }
    p
}

fn sel(name: &str) -> *const c_void {
    let c = CString::new(name).expect("interior NUL in selector");
    unsafe { sel_registerName(c.as_ptr()) }
}

/// objc_msgSend with 0 arguments past self/_cmd.
unsafe fn msg0<R>(receiver: *const AnyObject, selector: *const c_void) -> R {
    let f: unsafe extern "C" fn(*const AnyObject, *const c_void) -> R =
        std::mem::transmute(objc_msgSend as *const ());
    f(receiver, selector)
}

/// objc_msgSend with 1 argument past self/_cmd.
unsafe fn msg1<A, R>(receiver: *const AnyObject, selector: *const c_void, a: A) -> R {
    let f: unsafe extern "C" fn(*const AnyObject, *const c_void, A) -> R =
        std::mem::transmute(objc_msgSend as *const ());
    f(receiver, selector, a)
}

/// objc_msgSend with 2 arguments past self/_cmd.
unsafe fn msg2<A1, A2, R>(
    receiver: *const AnyObject,
    selector: *const c_void,
    a1: A1,
    a2: A2,
) -> R {
    let f: unsafe extern "C" fn(*const AnyObject, *const c_void, A1, A2) -> R =
        std::mem::transmute(objc_msgSend as *const ());
    f(receiver, selector, a1, a2)
}

unsafe fn ns_string(s: &str) -> *const AnyObject {
    let c = CString::new(s).expect("interior NUL in string");
    let obj: *const AnyObject = msg1(cls("NSString"), sel("stringWithUTF8String:"), c.as_ptr());
    if obj.is_null() {
        panic!("stringWithUTF8String returned nil");
    }
    obj
}

unsafe fn ns_to_string(obj: *const AnyObject) -> String {
    if obj.is_null() {
        return String::new();
    }
    let c: *const c_char = msg0(obj, sel("UTF8String"));
    if c.is_null() {
        return String::new();
    }
    CStr::from_ptr(c).to_string_lossy().into_owned()
}

unsafe fn ns_data(bytes: &[u8]) -> *const AnyObject {
    msg2(
        cls("NSData"),
        sel("dataWithBytes:length:"),
        bytes.as_ptr(),
        bytes.len(),
    )
}

unsafe fn ns_data_bytes(obj: *const AnyObject) -> Vec<u8> {
    let len: usize = msg0(obj, sel("length"));
    let bytes: *const u8 = msg0(obj, sel("bytes"));
    if bytes.is_null() || len == 0 {
        return Vec::new();
    }
    from_raw_parts(bytes, len).to_vec()
}

/// Convert TIFF/PNG image data into PNG bytes via NSBitmapImageRep.
unsafe fn image_data_to_png(data: *const AnyObject) -> Option<Vec<u8>> {
    let alloc: *const AnyObject = msg0(cls("NSBitmapImageRep"), sel("alloc"));
    // initWithData consumes the alloc'd receiver (releases it on failure).
    let rep: *const AnyObject = msg1(alloc, sel("initWithData:"), data);
    if rep.is_null() {
        return None;
    }
    let png: *const AnyObject = msg2(
        rep,
        sel("representationUsingType:properties:"),
        NS_BITMAP_FILE_TYPE_PNG,
        null::<c_void>(),
    );
    let out = if png.is_null() { None } else { Some(ns_data_bytes(png)) };
    msg0::<()>(rep, sel("release")); // our +1 from init
    out
}

// ---------------------------------------------------------------------------
// NSPasteboard
// ---------------------------------------------------------------------------

/// NSPasteboard is documented thread-safe; safe to poll from any thread.
pub fn change_count() -> isize {
    with_pool(|| unsafe {
        let pb: *const AnyObject = msg0(cls("NSPasteboard"), sel("generalPasteboard"));
        msg0(pb, sel("changeCount"))
    })
}

fn pasteboard_string(paste_type: &str) -> Option<String> {
    with_pool(|| unsafe {
        let pb: *const AnyObject = msg0(cls("NSPasteboard"), sel("generalPasteboard"));
        let t = ns_string(paste_type);
        let s: *const AnyObject = msg1(pb, sel("stringForType:"), t);
        if s.is_null() {
            return None;
        }
        let text = ns_to_string(s);
        if text.is_empty() { None } else { Some(text) }
    })
}

pub fn read_text() -> Option<String> {
    pasteboard_string(UTI_TEXT)
}

pub fn read_html() -> Option<String> {
    pasteboard_string(UTI_HTML)
}

/// PNG bytes of the pasteboard image (public.png, or TIFF converted).
pub fn read_image_png() -> Option<Vec<u8>> {
    with_pool(|| unsafe {
        let pb: *const AnyObject = msg0(cls("NSPasteboard"), sel("generalPasteboard"));
        let d: *const AnyObject = msg1(pb, sel("dataForType:"), ns_string(UTI_PNG));
        if !d.is_null() {
            let bytes = ns_data_bytes(d);
            if !bytes.is_empty() {
                return Some(bytes);
            }
        }
        let t: *const AnyObject = msg1(pb, sel("dataForType:"), ns_string(UTI_TIFF));
        if !t.is_null() {
            return image_data_to_png(t);
        }
        None
    })
}

/// File paths of the pasteboard's file-URL flavor (Finder copies).
pub fn read_file_paths() -> Option<Vec<String>> {
    with_pool(|| unsafe {
        let pb: *const AnyObject = msg0(cls("NSPasteboard"), sel("generalPasteboard"));
        let classes: *const AnyObject = msg1(cls("NSArray"), sel("arrayWithObject:"), cls("NSURL"));
        let objs: *const AnyObject = msg2(
            pb,
            sel("readObjectsForClasses:options:"),
            classes,
            null::<c_void>(),
        );
        if objs.is_null() {
            return None;
        }
        let count: usize = msg0(objs, sel("count"));
        if count == 0 {
            return None;
        }
        let mut paths = Vec::new();
        for i in 0..count {
            let item: *const AnyObject = msg1(objs, sel("objectAtIndex:"), i);
            if item.is_null() {
                continue;
            }
            let path: *const AnyObject = msg0(item, sel("path"));
            if !path.is_null() {
                let s = ns_to_string(path);
                if !s.is_empty() {
                    paths.push(s);
                }
            }
        }
        if paths.is_empty() { None } else { Some(paths) }
    })
}

pub fn clear_contents() -> bool {
    with_pool(|| unsafe {
        let pb: *const AnyObject = msg0(cls("NSPasteboard"), sel("generalPasteboard"));
        msg0(pb, sel("clearContents"))
    })
}

pub fn write_string(text: &str, paste_type: &str) -> bool {
    with_pool(|| unsafe {
        let pb: *const AnyObject = msg0(cls("NSPasteboard"), sel("generalPasteboard"));
        msg2(
            pb,
            sel("setString:forType:"),
            ns_string(text),
            ns_string(paste_type),
        )
    })
}

pub fn write_data(bytes: &[u8], paste_type: &str) -> bool {
    with_pool(|| unsafe {
        let pb: *const AnyObject = msg0(cls("NSPasteboard"), sel("generalPasteboard"));
        msg2(
            pb,
            sel("setData:forType:"),
            ns_data(bytes),
            ns_string(paste_type),
        )
    })
}

pub fn write_files(paths: &[String]) -> bool {
    with_pool(|| unsafe {
        let pb: *const AnyObject = msg0(cls("NSPasteboard"), sel("generalPasteboard"));
        let mut urls: Vec<*const AnyObject> = Vec::with_capacity(paths.len());
        for p in paths {
            let url: *const AnyObject =
                msg1(cls("NSURL"), sel("fileURLWithPath:"), ns_string(p));
            if !url.is_null() {
                urls.push(url);
            }
        }
        if urls.is_empty() {
            return false;
        }
        let arr: *const AnyObject = msg2(
            cls("NSArray"),
            sel("arrayWithObjects:count:"),
            urls.as_ptr(),
            urls.len(),
        );
        msg1(pb, sel("writeObjects:"), arr)
    })
}

// ---------------------------------------------------------------------------
// Frontmost application / activation
// ---------------------------------------------------------------------------

/// Info about the frontmost app. MUST be fetched on the main thread
/// (NSWorkspace / NSImage are not thread-safe) — go through
/// `state::on_main_sync`.
pub struct FrontmostInfo {
    pub pid: isize,
    pub name: String,
    pub exe_path: String,
    pub icon_png: Option<Vec<u8>>,
}

pub unsafe fn frontmost_app_info() -> Option<FrontmostInfo> {
    with_pool(|| unsafe {
        let ws: *const AnyObject = msg0(cls("NSWorkspace"), sel("sharedWorkspace"));
        let app: *const AnyObject = msg0(ws, sel("frontmostApplication"));
        if app.is_null() {
            return None;
        }
        let pid: i32 = msg0(app, sel("processIdentifier"));
        if pid == 0 {
            return None;
        }
        let name = {
            let n: *const AnyObject = msg0(app, sel("localizedName"));
            ns_to_string(n)
        };
        let exe_path = {
            let u: *const AnyObject = msg0(app, sel("executableURL"));
            if u.is_null() {
                String::new()
            } else {
                let p: *const AnyObject = msg0(u, sel("path"));
                ns_to_string(p)
            }
        };
        let icon_png = {
            let i: *const AnyObject = msg0(app, sel("icon"));
            if i.is_null() {
                None
            } else {
                let tiff: *const AnyObject = msg0(i, sel("TIFFRepresentation"));
                if tiff.is_null() {
                    None
                } else {
                    image_data_to_png(tiff)
                }
            }
        };
        Some(FrontmostInfo {
            pid: pid as isize,
            name,
            exe_path,
            icon_png,
        })
    })
}

/// PID of the frontmost app WITHOUT touching NSImage/icon data — the full
/// `frontmost_app_info` extracts and re-encodes the app icon (megabytes),
/// which is fine once per panel open but far too heavy for the 150 ms
/// foreground watchdog. Must run on the main thread (go through
/// `state::on_main_sync`); NSWorkspace itself is called inside a pool.
pub fn frontmost_process_id() -> Option<isize> {
    with_pool(|| unsafe {
        let ws: *const AnyObject = msg0(cls("NSWorkspace"), sel("sharedWorkspace"));
        let app: *const AnyObject = msg0(ws, sel("frontmostApplication"));
        if app.is_null() {
            return None;
        }
        let pid: i32 = msg0(app, sel("processIdentifier"));
        if pid == 0 {
            None
        } else {
            Some(pid as isize)
        }
    })
}

/// Activate the app owning `pid`. NSRunningApplication is thread-safe.
pub fn activate_pid(pid: isize) -> bool {
    with_pool(|| unsafe {
        let app: *const AnyObject = msg1(
            cls("NSRunningApplication"),
            sel("runningApplicationWithProcessIdentifier:"),
            pid as i32,
        );
        if app.is_null() {
            return false;
        }
        msg1(app, sel("activateWithOptions:"), NS_APP_ACTIVATE_IGNORING_OTHER_APPS)
    })
}

pub fn pid_alive(pid: isize) -> bool {
    unsafe { kill(pid as i32, 0) == 0 }
}

// ---------------------------------------------------------------------------
// Keyboard synthesis + Accessibility permission
// ---------------------------------------------------------------------------

unsafe fn post_key(key: u16, down: bool) -> bool {
    let ev = CGEventCreateKeyboardEvent(null(), key, down);
    if ev.is_null() {
        return false;
    }
    CGEventPost(CG_HID_EVENT_TAP, ev);
    CFRelease(ev);
    true
}

/// Synthesize Cmd+V into the system (requires Accessibility permission).
pub fn post_cmd_v() -> bool {
    unsafe {
        post_key(VK_COMMAND, true)
            && post_key(VK_V, true)
            && post_key(VK_V, false)
            && post_key(VK_COMMAND, false)
    }
}

/// Whether the app may post keyboard events (System Settings → Privacy &
/// Security → Accessibility).
pub fn ax_trusted() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}
