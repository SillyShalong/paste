//! Source application detection: which app copied the content, its icon and
//! brand color. Windows uses Win32 APIs; macOS (Apple Silicon) uses
//! NSWorkspace via the hand-rolled bindings in `crate::macos`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Info about the app that owns the clipboard when a copy happened.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceApp {
    pub name: String,
    pub exe_path: String,
    /// Hex color like "#0f62fe" derived from the app icon.
    pub color: String,
}

/// Where the cached icon PNG for an app binary lives.
pub fn icon_path_for(icons_dir: &Path, exe_path: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(exe_path.to_lowercase().as_bytes());
    let hex = hex::encode(&hasher.finalize()[..8]);
    icons_dir.join(format!("{hex}.png"))
}

/// Pick the most saturated, reasonably bright color from a PNG's pixels —
/// approximates each app's brand color the same way Paste does.
pub fn dominant_color_from_png(png: &[u8]) -> Option<String> {
    let img = image::load_from_memory(png).ok()?;
    let rgba = img.to_rgba8();

    let mut best: (f32, (u8, u8, u8)) = (0.0, (110, 122, 137));
    let mut has_opaque = false;
    for px in rgba.pixels() {
        let (r, g, b, a) = (px[0] as f32, px[1] as f32, px[2] as f32, px[3] as f32);
        if a < 200.0 {
            continue;
        }
        has_opaque = true;
        let mx = r.max(g).max(b);
        let mn = r.min(g).min(b);
        let sat = if mx > 0.0 { (mx - mn) / mx } else { 0.0 };
        let bright = mx / 255.0;
        // Prefer saturated mid-bright colors; penalize very dark/very light.
        let score = sat * 2.0 + (0.6 - (bright - 0.55).abs()).max(0.0);
        if score > best.0 {
            best = (score, (r as u8, g as u8, b as u8));
        }
    }
    if !has_opaque {
        return None;
    }
    Some(format!("#{:02x}{:02x}{:02x}", best.1 .0, best.1 .1, best.1 .2))
}

/// Read (or lazily produce + cache) the icon PNG for an app and derive its
/// brand color. `produce` extracts/writes the icon PNG when the cache is
/// missing (Windows: ExtractIconExW; macOS: NSRunningApplication.icon bytes).
fn icon_color_cached(
    exe_path: &str,
    icons_dir: &Path,
    produce: impl FnOnce(&Path) -> Result<(), Box<dyn std::error::Error>>,
) -> String {
    let icon_path = icon_path_for(icons_dir, exe_path);
    let png = match std::fs::read(&icon_path) {
        Ok(png) => Some(png),
        Err(_) => {
            let _ = produce(&icon_path);
            std::fs::read(&icon_path).ok()
        }
    };
    png.and_then(|png| dominant_color_from_png(&png)).unwrap_or_else(|| "#6c7a89".into())
}

#[cfg(windows)]
mod imp {
    use super::*;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Shell::ExtractIconExW;
    use windows::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, GetForegroundWindow, GetIconInfo, GetWindowThreadProcessId, LoadIconW,
        HICON, ICONINFO, IDI_APPLICATION,
    };

    /// Return info about the currently focused application.
    pub fn foreground_app(icons_dir: &Path) -> Option<SourceApp> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }
            hwnd_app(hwnd, icons_dir)
        }
    }

    unsafe fn hwnd_app(hwnd: HWND, icons_dir: &Path) -> Option<SourceApp> {
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let exe_path = process_image_path(pid)?;
        let name = friendly_name(&exe_path);
        let color = icon_color_cached(&exe_path, icons_dir, |out| {
            extract_icon_png(&exe_path, out)
        });

        Some(SourceApp {
            name,
            exe_path,
            color,
        })
    }

    fn process_image_path(pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let res = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut len,
            );
            let _ = CloseHandle(handle);
            res.ok()?;
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    /// Stable, friendly display name: the exe file name without extension.
    fn friendly_name(exe_path: &str) -> String {
        Path::new(exe_path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| exe_path.to_string())
    }

    /// Extract the large icon of an exe and save it as a 64x64 PNG.
    fn extract_icon_png(exe_path: &str, out_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        unsafe {
            let wide: Vec<u16> = exe_path
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let mut icons = [HICON::default(); 1];
            let count = ExtractIconExW(
                PCWSTR(wide.as_ptr()),
                0,
                Some(icons.as_mut_ptr()),
                None,
                1,
            );
            let hicon = if count > 0 && !icons[0].is_invalid() {
                icons[0]
            } else {
                let hmodule = GetModuleHandleW(None)?;
                let hinstance: windows::Win32::Foundation::HINSTANCE = hmodule.into();
                LoadIconW(hinstance, IDI_APPLICATION).unwrap_or_default()
            };

            let png = hicon_to_png(hicon)?;
            if !hicon.is_invalid() {
                let _ = DestroyIcon(hicon);
            }

            std::fs::write(out_path, &png)?;
            Ok(())
        }
    }

    /// Render an HICON into a 64x64 RGBA buffer and encode as PNG.
    fn hicon_to_png(hicon: HICON) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        const SIZE: i32 = 64;
        unsafe {
            let mut info = ICONINFO::default();
            GetIconInfo(hicon, &mut info)?;

            let mut bmp = BITMAP::default();
            if GetObjectW(
                HGDIOBJ(info.hbmColor.0),
                std::mem::size_of::<BITMAP>() as i32,
                Some(&mut bmp as *mut _ as *mut _),
            ) == 0
            {
                return Err("GetObjectW failed".into());
            }
            let w = bmp.bmWidth;
            let h = bmp.bmHeight;
            if w <= 0 || h <= 0 {
                return Err("empty icon bitmap".into());
            }

            let hdc = GetDC(None);
            let mut bi = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0, // BI_RGB
                ..Default::default()
            };
            let mut buf = vec![0u8; (w * h * 4) as usize];
            GetDIBits(
                hdc,
                info.hbmColor,
                0,
                h as u32,
                Some(buf.as_mut_ptr() as *mut _),
                &mut bi as *mut BITMAPINFOHEADER as *mut BITMAPINFO,
                DIB_RGB_COLORS,
            );
            if !hdc.is_invalid() {
                ReleaseDC(None, hdc);
            }
            let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
            let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));

            // BGRA -> RGBA
            for px in buf.chunks_exact_mut(4) {
                px.swap(0, 2);
            }

            let img = image::RgbaImage::from_raw(w as u32, h as u32, buf)
                .ok_or("bad bitmap buffer")?;
            let resized = image::imageops::resize(
                &img,
                SIZE as u32,
                SIZE as u32,
                image::imageops::FilterType::Lanczos3,
            );
            let mut out = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(resized)
                .write_to(&mut out, image::ImageFormat::Png)?;
            Ok(out.into_inner())
        }
    }
}

#[cfg(windows)]
pub use imp::foreground_app;

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use crate::macos;
    use crate::state::on_main_sync;

    /// Info about the frontmost application. `foreground_app` is called on
    /// the clipboard-listener thread, so the AppKit work (NSWorkspace,
    /// NSImage are main-thread-only) is dispatched via `on_main_sync`.
    pub fn foreground_app(icons_dir: &Path) -> Option<SourceApp> {
        let info = on_main_sync(|| unsafe { macos::frontmost_app_info() })??;
        if info.exe_path.is_empty() {
            return Some(SourceApp {
                name: info.name,
                exe_path: String::new(),
                color: "#6c7a89".into(),
            });
        }
        let color = icon_color_cached(&info.exe_path, icons_dir, |out| {
            match info.icon_png.as_deref() {
                Some(bytes) => std::fs::write(out, bytes).map_err(Into::into),
                None => Err("app icon unavailable".into()),
            }
        });
        Some(SourceApp {
            name: info.name,
            exe_path: info.exe_path,
            color,
        })
    }
}

#[cfg(target_os = "macos")]
pub use imp::foreground_app;

#[cfg(not(any(windows, target_os = "macos")))]
mod imp {
    use super::*;
    pub fn foreground_app(_icons_dir: &Path) -> Option<SourceApp> {
        None
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub use imp::foreground_app;
