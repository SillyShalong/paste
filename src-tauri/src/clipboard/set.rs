//! Writing content back to the clipboard (used when pasting a history item
//! or copying it without pasting).

#[cfg(windows)]
use super::capture::png_to_dib;
use super::ClipContent;

#[cfg(windows)]
pub fn set_clipboard(content: &ClipContent) -> bool {
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    unsafe {
        if OpenClipboard(None).is_err() {
            return false;
        }
        let mut ok = true;

        macro_rules! place {
            ($format:expr, $bytes:expr) => {{
                let bytes: &[u8] = &$bytes;
                let hglobal = GlobalAlloc(GMEM_MOVEABLE, bytes.len() + 1)
                    .unwrap_or_else(|_| panic!("GlobalAlloc failed"));
                let ptr = GlobalLock(hglobal);
                if ptr.is_null() {
                    ok = false;
                } else {
                    std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len());
                    // null terminator for text formats
                    *(ptr as *mut u8).add(bytes.len()) = 0;
                    GlobalUnlock(hglobal);
                    if SetClipboardData($format, HANDLE(hglobal.0)).is_err() {
                        ok = false;
                    }
                }
            }};
        }

        if EmptyClipboard().is_err() {
            let _ = CloseClipboard();
            return false;
        }

        match content {
            ClipContent::Text { text, html } | ClipContent::Link { text, html } => {
                let u16s: Vec<u8> = text
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .flat_map(|u| u.to_le_bytes())
                    .collect();
                place!(13u32 /* CF_UNICODETEXT */, u16s);
                if let Some(html) = html {
                    let cf_html = register_html_format();
                    if cf_html != 0 {
                        place!(cf_html, build_cf_html(html));
                    }
                }
            }
            ClipContent::Color { text } => {
                let u16s: Vec<u8> = text
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .flat_map(|u| u.to_le_bytes())
                    .collect();
                place!(13u32, u16s);
            }
            ClipContent::Image { png } => {
                if let Some(dib) = png_to_dib(png) {
                    // DIB is binary: the +1 null byte from `place!` is harmless.
                    place!(8u32 /* CF_DIB */, dib);
                } else {
                    ok = false;
                }
            }
            ClipContent::Files { paths } => {
                let hdrop = build_hdrop(paths);
                place!(15u32 /* CF_HDROP */, hdrop);
            }
        }

        let _ = CloseClipboard();
        ok
    }
}

/// macOS (Apple Silicon): write via NSPasteboard (thread-safe).
#[cfg(target_os = "macos")]
pub fn set_clipboard(content: &ClipContent) -> bool {
    use crate::macos;

    if !macos::clear_contents() {
        return false;
    }
    match content {
        ClipContent::Text { text, html } | ClipContent::Link { text, html } => {
            if !macos::write_string(text, macos::UTI_TEXT) {
                return false;
            }
            if let Some(html) = html {
                if !macos::write_string(html, macos::UTI_HTML) {
                    return false;
                }
            }
            true
        }
        ClipContent::Color { text } => macos::write_string(text, macos::UTI_TEXT),
        ClipContent::Image { png } => macos::write_data(png, macos::UTI_PNG),
        ClipContent::Files { paths } => macos::write_files(paths),
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn set_clipboard(_content: &ClipContent) -> bool {
    false
}

/// Build a CF_HTML payload with a correct header for the given fragment.
pub(crate) fn build_cf_html(fragment: &str) -> Vec<u8> {
    let header_len = 105; // fixed header block length we emit below
    let open = "<html><body>\n<!--StartFragment-->";
    let close = "<!--EndFragment-->\n</body></html>";

    let start_html = header_len;
    // Fragment offsets must point at the actual fragment content, i.e.
    // AFTER the StartFragment marker (verified by the round-trip test).
    let start_fragment = start_html + open.len();
    let end_fragment = start_fragment + fragment.len();
    let end_html = end_fragment + close.len();

    let header = format!(
        "Version:0.9\r\nStartHTML:{start_html:09}\r\nEndHTML:{end_html:09}\r\n\
         StartFragment:{start_fragment:09}\r\nEndFragment:{end_fragment:09}\r\n"
    );
    // Pad the header to exactly header_len bytes with spaces so offsets hold.
    let mut out = header.into_bytes();
    if out.len() < header_len {
        out.resize(header_len, b' ');
    }
    out.extend_from_slice(open.as_bytes());
    out.extend_from_slice(fragment.as_bytes());
    out.extend_from_slice(close.as_bytes());
    out
}

fn build_hdrop(paths: &[String]) -> Vec<u8> {
    // DROPFILES { pFiles: u32, pt: POINT(2×i32), fNC: u32, fWide: u32 }
    let mut out = Vec::new();
    out.extend_from_slice(&20u32.to_le_bytes()); // offset of file list
    out.extend_from_slice(&0i32.to_le_bytes()); // pt.x
    out.extend_from_slice(&0i32.to_le_bytes()); // pt.y
    out.extend_from_slice(&0u32.to_le_bytes()); // fNC
    out.extend_from_slice(&1u32.to_le_bytes()); // fWide = true
    for p in paths {
        for unit in p.encode_utf16().chain(std::iter::once(0)) {
            out.extend_from_slice(&unit.to_le_bytes());
        }
    }
    out.extend_from_slice(&0u16.to_le_bytes()); // final double-null
    out
}

#[cfg(windows)]
fn register_html_format() -> u32 {
    use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
    use windows::core::PCWSTR;
    let name: Vec<u16> = "HTML Format\0".encode_utf16().collect();
    unsafe { RegisterClipboardFormatW(PCWSTR(name.as_ptr())) }
}
