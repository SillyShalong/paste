//! Reading and classifying the Windows clipboard.

use sha2::{Digest, Sha256};

use super::ClipContent;

const CF_UNICODETEXT: u32 = 13;
const CF_DIB: u32 = 8;
const CF_HDROP: u32 = 15;

#[cfg(windows)]
pub fn read_clipboard() -> Option<ClipContent> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    // Opening the clipboard can transiently fail while another process holds
    // it; retry briefly.
    let mut opened = false;
    for _ in 0..10 {
        unsafe {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    if !opened {
        return None;
    }

    let result = unsafe {
        let mut out = None;

        // 1. Files (highest priority — Explorer copies carry text too)
        if let Ok(handle) = GetClipboardData(CF_HDROP) {
            let hglobal = windows::Win32::Foundation::HGLOBAL(handle.0);
            let ptr = GlobalLock(hglobal);
            if !ptr.is_null() {
                let size = GlobalSize(hglobal);
                let bytes = std::slice::from_raw_parts(ptr as *const u8, size);
                if let Some(paths) = parse_hdrop(bytes) {
                    if !paths.is_empty() {
                        out = Some(ClipContent::Files { paths });
                    }
                }
                GlobalUnlock(hglobal);
            }
        }

        // 2. Image
        if out.is_none() {
            if let Ok(handle) = GetClipboardData(CF_DIB) {
                let hglobal = windows::Win32::Foundation::HGLOBAL(handle.0);
                let ptr = GlobalLock(hglobal);
                if !ptr.is_null() {
                    let size = GlobalSize(hglobal);
                    let bytes = std::slice::from_raw_parts(ptr as *const u8, size);
                    if let Some(png) = dib_to_png(bytes) {
                        out = Some(ClipContent::Image { png });
                    }
                    GlobalUnlock(hglobal);
                }
            }
        }

        // 3. Text (possibly with HTML flavor)
        if out.is_none() {
            let text: Option<String> = GetClipboardData(CF_UNICODETEXT).ok().and_then(|h| {
                let hglobal = windows::Win32::Foundation::HGLOBAL(h.0);
                let ptr = GlobalLock(hglobal);
                if ptr.is_null() {
                    return None;
                }
                let size = GlobalSize(hglobal);
                let bytes = std::slice::from_raw_parts(ptr as *const u8, size);
                // UTF-16, null-terminated
                let u16s: Vec<u16> = bytes
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .take_while(|&u| u != 0)
                    .collect();
                GlobalUnlock(hglobal);
                Some(String::from_utf16_lossy(&u16s))
            });

            if let Some(text) = text {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    let html = read_html_format().map(|h| sanitize_html(&h));
                    out = Some(classify_text(trimmed.to_string(), html));
                }
            }
        }

        let _ = CloseClipboard();
        out
    };
    result
}

#[cfg(not(windows))]
pub fn read_clipboard() -> Option<ClipContent> {
    None
}

/// Classify a plain-text clipboard payload into Text / Link / Color.
pub fn classify_text(text: String, html: Option<String>) -> ClipContent {
    let t = text.trim();
    if is_url(t) {
        ClipContent::Link { text, html }
    } else if parse_color(t).is_some() {
        ClipContent::Color { text: t.to_string() }
    } else {
        ClipContent::Text { text, html }
    }
}

pub fn is_url(s: &str) -> bool {
    if s.contains('\n') || s.contains(' ') || s.len() < 4 || s.len() > 2048 {
        return false;
    }
    let lower = s.to_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("www.")
        || lower.starts_with("ftp://")
}

/// Parse "#rgb", "#rrggbb", "0xrrggbb", or "rgb(r, g, b)" into (r, g, b).
pub fn parse_color(s: &str) -> Option<(u8, u8, u8)> {
    let t = s.trim();
    let hex = t
        .strip_prefix('#')
        .or_else(|| t.strip_prefix("0x"))
        .or_else(|| t.strip_prefix("0X"))?;
    match hex.len() {
        3 => {
            let v: Vec<char> = hex.chars().collect();
            let r = u8::from_str_radix(&v[0].to_string().repeat(2), 16).ok()?;
            let g = u8::from_str_radix(&v[1].to_string().repeat(2), 16).ok()?;
            let b = u8::from_str_radix(&v[2].to_string().repeat(2), 16).ok()?;
            Some((r, g, b))
        }
        6 | 8 => {
            let h = &hex[..6];
            Some((
                u8::from_str_radix(&h[0..2], 16).ok()?,
                u8::from_str_radix(&h[2..4], 16).ok()?,
                u8::from_str_radix(&h[4..6], 16).ok()?,
            ))
        }
        _ => None,
    }
}

/// Extract the HTML fragment from the "HTML Format" clipboard flavor and
/// strip scripts/styles/event handlers. Returns sanitized HTML or None.
pub fn read_html_format() -> Option<String> {
    read_raw_html_format().map(|raw| {
        let fragment = extract_cf_html_fragment(&raw).unwrap_or(raw);
        sanitize_html(&fragment)
    })
}

#[cfg(windows)]
fn read_raw_html_format() -> Option<String> {
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW};
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::core::PCWSTR;

    let fmt_name: Vec<u16> = "HTML Format\0".encode_utf16().collect();
    let fmt = unsafe { RegisterClipboardFormatW(PCWSTR(fmt_name.as_ptr())) };
    if fmt == 0 {
        return None;
    }
    unsafe {
        if OpenClipboard(None).is_err() {
            return None;
        }
        let out = (|| {
            let handle = GetClipboardData(fmt).ok()?;
            let hglobal = windows::Win32::Foundation::HGLOBAL(handle.0);
            let ptr = GlobalLock(hglobal);
            if ptr.is_null() {
                return None;
            }
            let size = GlobalSize(hglobal);
            let bytes = std::slice::from_raw_parts(ptr as *const u8, size);
            GlobalUnlock(hglobal);
            Some(String::from_utf8_lossy(bytes).into_owned())
        })();
        let _ = CloseClipboard();
        out
    }
}

#[cfg(not(windows))]
fn read_raw_html_format() -> Option<String> {
    None
}

/// Parse the CF_HTML header and return the fragment between
/// <!--StartFragment--> and <!--EndFragment--> using byte offsets.
fn extract_cf_html_fragment(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let header = |name: &str| -> Option<usize> {
        let idx = raw.find(name)?;
        let rest = &raw[idx + name.len()..];
        let num: String = rest
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        num.parse::<usize>().ok()
    };
    let start = header("StartFragment:")?;
    let end = header("EndFragment:")?;
    if start >= end || end > bytes.len() {
        return None;
    }
    let slice = &raw[start..end];
    // Strip the markers themselves if present inside the slice.
    Some(slice
        .replace("<!--StartFragment-->", "")
        .replace("<!--EndFragment-->", "")
        .trim()
        .to_string())
}

/// Sanitize clipboard HTML: drop scripts/styles/event handlers, keep inline
/// formatting (including inline `style` so colors survive).
pub fn sanitize_html(html: &str) -> String {
    use ammonia::Builder;
    let mut b = Builder::default();
    b.generic_attributes(["style"].into());
    b.tags(
        [
            "a", "b", "i", "u", "s", "em", "strong", "span", "div", "p", "br", "ul", "ol", "li",
            "table", "tr", "td", "th", "tbody", "thead", "h1", "h2", "h3", "h4", "h5", "h6",
            "pre", "code", "blockquote", "font", "sub", "sup", "hr",
        ]
        .into(),
    );
    b.clean(html).to_string()
}

/// Parse a CF_HDROP (DROPFILES) payload into a list of file paths.
#[cfg(windows)]
fn parse_hdrop(bytes: &[u8]) -> Option<Vec<String>> {
    if bytes.len() < 20 {
        return None;
    }
    let p_files = u32::from_le_bytes(bytes[0..4].try_into().ok()?) as usize;
    let f_wide = u32::from_le_bytes(bytes[16..20].try_into().ok()?) != 0;
    if p_files >= bytes.len() {
        return None;
    }
    let data = &bytes[p_files..];
    let mut paths = Vec::new();
    if f_wide {
        let mut cur: Vec<u16> = Vec::new();
        let units: Vec<u16> = data
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        for u in units {
            if u == 0 {
                if cur.is_empty() {
                    break; // double-null = end
                }
                paths.push(String::from_utf16_lossy(&cur));
                cur.clear();
            } else {
                cur.push(u);
            }
        }
    } else {
        for chunk in data.split(|&b| b == 0) {
            if chunk.is_empty() {
                break;
            }
            paths.push(String::from_utf8_lossy(chunk).into_owned());
        }
    }
    Some(paths)
}

/// Convert a CF_DIB payload to PNG bytes. Supports 24/32-bit uncompressed and
/// BITFIELDS 32-bit DIBs (what clipboard sources actually produce).
pub fn dib_to_png(dib: &[u8]) -> Option<Vec<u8>> {
    if dib.len() < 40 {
        return None;
    }
    let bi_size = u32::from_le_bytes(dib[0..4].try_into().ok()?) as usize;
    let width = i32::from_le_bytes(dib[4..8].try_into().ok()?);
    let height = i32::from_le_bytes(dib[8..12].try_into().ok()?);
    let planes = u16::from_le_bytes(dib[12..14].try_into().ok()?);
    let bit_count = u16::from_le_bytes(dib[14..16].try_into().ok()?);
    let compression = u32::from_le_bytes(dib[16..20].try_into().ok()?);
    if planes != 1 || width <= 0 || height == 0 {
        return None;
    }
    // BI_RGB = 0, BI_BITFIELDS = 3
    let ok = (compression == 0 && matches!(bit_count, 24 | 32))
        || (compression == 3 && bit_count == 32);
    if !ok {
        return None;
    }
    let flip = height > 0;
    let h = height.unsigned_abs() as usize;
    let w = width as usize;
    let header = bi_size.max(40);
    let pixel_start = header; // color table not used for 24/32bpp BI_RGB/BITFIELDS
    if pixel_start >= dib.len() {
        return None;
    }
    let stride = ((w * bit_count as usize + 31) / 32) * 4;
    let row_bytes = w * (bit_count as usize / 8);

    let mut rgba = vec![0u8; w * h * 4];
    for y in 0..h {
        let src_y = if flip { h - 1 - y } else { y };
        let row = dib
            .get(pixel_start + src_y * stride..)?
            .get(..row_bytes.min(stride))?;
        for x in 0..w {
            let (r, g, b, a) = match bit_count {
                24 => {
                    let o = x * 3;
                    if o + 2 >= row.len() {
                        continue;
                    }
                    (row[o + 2], row[o + 1], row[o], 255u8)
                }
                _ => {
                    let o = x * 4;
                    if o + 3 >= row.len() {
                        continue;
                    }
                    (row[o + 2], row[o + 1], row[o], row[o + 3])
                }
            };
            let dst = (y * w + x) * 4;
            rgba[dst] = r;
            rgba[dst + 1] = g;
            rgba[dst + 2] = b;
            rgba[dst + 3] = a;
        }
    }
    // 32bpp clipboard DIBs frequently carry 0 in the alpha byte; if the whole
    // image is fully transparent, treat it as opaque.
    if bit_count == 32 && rgba.chunks_exact(4).all(|px| px[3] == 0) {
        for px in rgba.chunks_exact_mut(4) {
            px[3] = 255;
        }
    }
    let img = image::RgbaImage::from_raw(w as u32, h as u32, rgba)?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .ok()?;
    Some(out.into_inner())
}

/// Convert PNG bytes back to a 32bpp bottom-up CF_DIB payload (for writing
/// images to the clipboard).
pub fn png_to_dib(png: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory(png).ok()?;
    let rgba = img.to_rgba8();
    let (w, h) = (rgba.width() as usize, rgba.height() as usize);
    let raw = rgba.as_raw();
    let stride = ((w * 32 + 31) / 32) * 4;
    let mut pixels = vec![0u8; stride * h];
    for y in 0..h {
        let src_y = h - 1 - y; // bottom-up
        for x in 0..w {
            let s = (src_y * w + x) * 4;
            let d = y * stride + x * 4;
            pixels[d] = raw[s + 2];
            pixels[d + 1] = raw[s + 1];
            pixels[d + 2] = raw[s];
            pixels[d + 3] = raw[s + 3];
        }
    }
    let mut out = Vec::with_capacity(40 + pixels.len());
    // BITMAPINFOHEADER
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(w as i32).to_le_bytes());
    out.extend_from_slice(&(h as i32).to_le_bytes()); // positive = bottom-up
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    out.extend_from_slice(&(pixels.len() as u32).to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes()); // x ppm
    out.extend_from_slice(&0i32.to_le_bytes()); // y ppm
    out.extend_from_slice(&0u32.to_le_bytes()); // clr used
    out.extend_from_slice(&0u32.to_le_bytes()); // clr important
    out.extend_from_slice(&pixels);
    Some(out)
}

pub fn hash_bytes(b: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b);
    hex::encode(&h.finalize()[..16])
}
