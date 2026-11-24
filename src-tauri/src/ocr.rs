//! OCR (text recognition) for image clips, backed by Windows.Media.Ocr —
//! offline, local, no bundled model. Recognized text is stored in
//! `clips.ocr_text` so image clips become searchable like text clips.
//!
//! Two background flows share one recognition routine:
//! - a worker thread that drains live captures queued by the clipboard
//!   listener (never on the listener thread itself — recognition can take
//!   hundreds of milliseconds);
//! - a backfill thread that, at startup or when the feature is re-enabled,
//!   walks history rows with `ocr_text IS NULL` (oldest first) in small
//!   batches so a large history warms up without hogging the CPU.
//!
//! Column contract (see store.rs): NULL = not recognized yet, '' = processed
//! but no text found (or recognition impossible). Every path through the
//! processing step ends with a non-NULL write, so the backfill queue always
//! drains and never reprocesses a broken row forever.

/// Payload of the `clipboard:ocr` panel event.
#[cfg(windows)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrDone {
    id: i64,
    ocr_text: String,
}

/// Payload of the `clipboard:ocr-progress` panel event: how many image clips
/// still await recognition, and whether OCR work is currently underway (the
/// flag lets the UI hide the indicator when the feature is disabled
/// mid-backfill even though NULL rows remain).
#[cfg(windows)]
#[derive(Clone, serde::Serialize)]
struct OcrProgress {
    pending: i64,
    active: bool,
}

/// CJK-ish characters for OCR spacing purposes: unified ideographs (plus
/// compatibility + ext-A), kana, Hangul, CJK punctuation and fullwidth
/// forms. Windows OCR treats each of these as its own "word" and joins
/// words with spaces.
fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3000..=0x30FF    // CJK symbols/punctuation, kana
        | 0x3040..=0x32FF  // hiragana, katakana, enclosed CJK
        | 0x3400..=0x4DBF  // ext A
        | 0x4E00..=0x9FFF  // unified ideographs
        | 0xAC00..=0xD7AF  // Hangul syllables
        | 0xF900..=0xFAFF  // compatibility ideographs
        | 0xFF00..=0xFFEF  // fullwidth forms
    )
}

/// Collapse whitespace between CJK characters. Windows OCR emits every
/// Chinese character as a separate word, so recognized text comes back as
/// "运 行 监 控 台" — substring search for "监控" would never match. Spaces
/// between latin words ("hello world") are preserved.
pub fn normalize_ocr_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_ws = String::new(); // whitespace run awaiting its fate
    let mut last_cjk = false;
    for c in text.chars() {
        if c.is_whitespace() {
            pending_ws.push(c);
            continue;
        }
        if last_cjk && is_cjk(c) {
            pending_ws.clear(); // the run sits between two CJK chars — drop it
        } else {
            out.push_str(&pending_ws);
        }
        pending_ws.clear();
        out.push(c);
        last_cjk = is_cjk(c);
    }
    out.push_str(&pending_ws); // keep trailing whitespace
    out
}

#[cfg(test)]
mod tests {
    use super::normalize_ocr_text;

    #[test]
    fn cjk_spaces_collapse_latin_spaces_survive() {
        assert_eq!(normalize_ocr_text("运 行 监 控 台"), "运行监控台");
        assert_eq!(normalize_ocr_text("问 题 已 修 复"), "问题已修复");
        assert_eq!(normalize_ocr_text("hello world"), "hello world");
        assert_eq!(normalize_ocr_text("监控台 v0.7.5 发布"), "监控台 v0.7.5 发布");
        assert_eq!(normalize_ocr_text("运行监控台 2025-11-24"), "运行监控台 2025-11-24");
        // Mixed: only the CJK-to-CJK gaps collapse.
        assert_eq!(normalize_ocr_text("版本 hello 世界"), "版本 hello 世界");
        // Whitespace runs and newlines between CJK collapse too.
        assert_eq!(normalize_ocr_text("监控  台\n\n记录"), "监控台记录");
        // Trailing whitespace is preserved.
        assert_eq!(normalize_ocr_text("监控台 "), "监控台 ");
        assert_eq!(normalize_ocr_text("监控 台 "), "监控台 ");
    }
}

/// Cap the stored text: a table-heavy screenshot can OCR into a very long
/// string; beyond this size it stops being useful for search and just
/// bloats the DB / IPC payloads.
#[cfg(windows)]
const MAX_OCR_CHARS: usize = 20_000;

#[cfg(windows)]
pub fn start(app: tauri::AppHandle) {
    imp::start(app);
}

/// Queue a freshly captured image clip for recognition. Drops silently when
/// OCR never started (non-Windows) — the listener only calls this on the
/// Windows capture path.
#[cfg(windows)]
pub fn enqueue(app: &tauri::AppHandle, id: i64, image_path: String) {
    imp::enqueue(app, id, image_path);
}

/// Re-run the history backfill if it is not already walking (e.g. when the
/// feature is turned back on in settings).
#[cfg(windows)]
pub fn kick_backfill(app: tauri::AppHandle) {
    imp::kick_backfill(app);
}

#[cfg(not(windows))]
pub fn start(_app: tauri::AppHandle) {}
#[cfg(not(windows))]
pub fn enqueue(_app: &tauri::AppHandle, _id: i64, _image_path: String) {}
#[cfg(not(windows))]
pub fn kick_backfill(_app: tauri::AppHandle) {}

#[cfg(windows)]
mod imp {
    use std::borrow::Cow;
    use std::io::Cursor;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::sync::OnceLock;

    use tauri::{AppHandle, Emitter, Manager};

    use super::{OcrDone, OcrProgress, MAX_OCR_CHARS};
    use crate::state::AppState;
    use crate::store;

    static SENDER: OnceLock<mpsc::Sender<(i64, String)>> = OnceLock::new();
    static BACKFILL_RUNNING: AtomicBool = AtomicBool::new(false);

    /// Current queue depth for the panel's progress indicator.
    pub(super) fn progress(app: &AppHandle) -> OcrProgress {
        let pending = {
            let state = app.state::<AppState>();
            let db = state.db.lock().unwrap();
            store::count_missing_ocr(&db)
        };
        OcrProgress { pending, active: true }
    }

    pub(super) fn emit_progress(app: &AppHandle) {
        let _ = app.emit_to("panel", "clipboard:ocr-progress", progress(app));
    }

    /// Tell the panel OCR work has stopped (feature disabled mid-backfill);
    /// `pending` may stay > 0 — those rows resume when it is re-enabled.
    pub(super) fn emit_stopped(app: &AppHandle) {
        let pending = {
            let state = app.state::<AppState>();
            let db = state.db.lock().unwrap();
            store::count_missing_ocr(&db)
        };
        let _ = app.emit_to(
            "panel",
            "clipboard:ocr-progress",
            OcrProgress { pending, active: false },
        );
    }

    /// Start the OCR worker and the history backfill (each once per process).
    pub(super) fn start(app: AppHandle) {
        let (tx, rx) = mpsc::channel::<(i64, String)>();
        if SENDER.set(tx).is_err() {
            return; // already started
        }
        let worker_app = app.clone();
        std::thread::Builder::new()
            .name("ocr-worker".into())
            .spawn(move || worker_loop(worker_app, rx))
            .expect("failed to spawn ocr worker");
        // Announce the initial queue depth (a panel opened before this
        // arrived asks ocr_status directly instead).
        emit_progress(&app);
        kick_backfill(app);
    }

    pub(super) fn enqueue(_app: &AppHandle, id: i64, image_path: String) {
        if let Some(tx) = SENDER.get() {
            let _ = tx.send((id, image_path));
        }
    }

    pub(super) fn kick_backfill(app: AppHandle) {
        if BACKFILL_RUNNING.swap(true, Ordering::SeqCst) {
            return;
        }
        std::thread::Builder::new()
            .name("ocr-backfill".into())
            .spawn(move || {
                backfill_loop(&app);
                BACKFILL_RUNNING.store(false, Ordering::SeqCst);
            })
            .expect("failed to spawn ocr backfill");
    }

    /// COM apartment init for this thread: WinRT activation
    /// (RoGetActivationFactory) needs an initialized apartment, and the
    /// blocking async `.get()` waits are happy on MTA.
    fn init_thread_com() {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        // S_FALSE (= already initialized) and RPC_E_CHANGED_MODE are both
        // fine to ignore.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    fn worker_loop(app: AppHandle, rx: mpsc::Receiver<(i64, String)>) {
        init_thread_com();
        while let Ok((id, path)) = rx.recv() {
            process_one(&app, id, &path);
            emit_progress(&app);
        }
    }

    fn backfill_loop(app: &AppHandle) {
        init_thread_com();
        // Let startup (panel creation, history load) settle first.
        std::thread::sleep(std::time::Duration::from_secs(2));
        loop {
            if !ocr_enabled(app) {
                emit_stopped(app);
                return; // flipping the toggle off stops an ongoing backfill
            }
            let batch = {
                let state = app.state::<AppState>();
                let db = state.db.lock().unwrap();
                match store::list_missing_ocr(&db, 8) {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("[paste] ocr backfill query failed: {e}");
                        return;
                    }
                }
            };
            if batch.is_empty() {
                emit_progress(app); // drained: pending now 0, indicator hides
                return;
            }
            for (id, path) in batch {
                process_one(app, id, &path);
                emit_progress(app);
                // Small inter-item pause keeps the backfill polite; live
                // captures go through the worker thread unaffected.
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
        }
    }

    fn ocr_enabled(app: &AppHandle) -> bool {
        app.state::<AppState>().settings.lock().unwrap().ocr_enabled
    }

    /// Recognize one clip image and persist the result. Every path through
    /// this function ends with a non-NULL `ocr_text` write so the row never
    /// stays in the backfill queue forever.
    fn process_one(app: &AppHandle, id: i64, path: &str) {
        let text = match std::fs::read(path) {
            Ok(png) => match recognize_png(&png) {
                Ok(text) => text,
                Err(e) => {
                    eprintln!("[paste] ocr failed for clip {id}: {e}");
                    String::new()
                }
            },
            // The image file is gone (retention pruning raced us, etc.).
            Err(_) => String::new(),
        };
        let mut text =
            super::normalize_ocr_text(&text.replace("\r\n", "\n"));
        if text.len() > MAX_OCR_CHARS {
            // Char-boundary-safe truncation.
            let mut end = MAX_OCR_CHARS;
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            text.truncate(end);
        }
        {
            let state = app.state::<AppState>();
            let db = state.db.lock().unwrap();
            if let Err(e) = store::set_ocr_text(&db, id, &text) {
                eprintln!("[paste] ocr store failed for clip {id}: {e}");
                return;
            }
        }
        // Refresh an open panel (search results, detail preview). A panel
        // opened later refetches from the DB anyway.
        let _ = app.emit_to("panel", "clipboard:ocr", OcrDone { id, ocr_text: text });
    }

    /// PNG bytes → recognized text. Bytes go into an in-memory stream, are
    /// decoded through WIC (BitmapDecoder) so pixel formats arrive exactly
    /// as the OCR engine expects, converted to Bgra8 (RecognizeAsync's
    /// requirement), and the result's lines are joined with \n.
    fn recognize_png(png: &[u8]) -> Result<String, Box<dyn std::error::Error>> {
        use windows::Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
        use windows::Media::Ocr::OcrEngine;
        use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

        let engine = match OcrEngine::TryCreateFromUserProfileLanguages() {
            Ok(engine) => engine,
            Err(_) => {
                // windows-rs maps the documented null-return of TryCreate*
                // to Err — no OCR-capable language pack for this user.
                eprintln!(
                    "[paste] ocr: no engine for the user's languages — install an \
                     OCR-capable language pack (Settings > Time & Language > Language)"
                );
                return Ok(String::new());
            }
        };

        // RecognizeAsync rejects bitmaps larger than MaxImageDimension; a
        // 4K screenshot exceeds it, so pre-scale to the engine's limit.
        let max_dim = OcrEngine::MaxImageDimension().unwrap_or(2048);
        let scaled = scaled_png(png, max_dim)?;

        let stream = InMemoryRandomAccessStream::new()?;
        {
            let writer = DataWriter::CreateDataWriter(&stream)?;
            writer.WriteBytes(&scaled)?;
            writer.StoreAsync()?.get()?;
            writer.FlushAsync()?.get()?;
            // The writer owns the stream and closes it on drop — detach so
            // the decoder below can still read it after this scope ends.
            writer.DetachStream()?;
        }
        let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
        let bitmap = decoder.GetSoftwareBitmapAsync()?.get()?;
        let bitmap = if bitmap.BitmapPixelFormat()? == BitmapPixelFormat::Bgra8 {
            bitmap
        } else {
            SoftwareBitmap::Convert(&bitmap, BitmapPixelFormat::Bgra8)?
        };

        let result = engine.RecognizeAsync(&bitmap)?.get()?;
        Ok(result.Text()?.to_string_lossy().replace("\r\n", "\n"))
    }

    /// Re-encode the PNG scaled down to `max_dim` only when it exceeds the
    /// engine limit; otherwise returns the input untouched (no decode cost).
    fn scaled_png(png: &[u8], max_dim: u32) -> Result<Cow<'_, [u8]>, Box<dyn std::error::Error>> {
        let (w, h) = image::ImageReader::new(Cursor::new(png))
            .with_guessed_format()?
            .into_dimensions()?;
        if w <= max_dim && h <= max_dim {
            return Ok(Cow::Borrowed(png));
        }
        let img = image::load_from_memory(png)?;
        let scale = max_dim as f32 / (w.max(h) as f32);
        let nw = ((w as f32 * scale) as u32).max(1);
        let nh = ((h as f32 * scale) as u32).max(1);
        let resized = img.resize(nw, nh, image::imageops::FilterType::Triangle);
        let mut out = Cursor::new(Vec::new());
        resized.write_to(&mut out, image::ImageFormat::Png)?;
        Ok(Cow::Owned(out.into_inner()))
    }

    /// Manual end-to-end check of the whole WinRT OCR path (engine, WIC
    /// decode, Bgra8 conversion, RecognizeAsync). Ignored by default: it
    /// needs an installed OCR language pack and system fonts, neither of
    /// which minimal CI runners guarantee. Run with:
    ///   cargo test -- --ignored ocr_recognizes
    #[cfg(test)]
    #[test]
    #[ignore = "manual: needs an OCR language pack and fonts on the machine"]
    fn ocr_recognizes_text_png() {
        init_thread_com();

        // Render a PNG via System.Drawing (same scratch-dir fallback as
        // store::tests::scratch_dir).
        let base = {
            let primary = std::env::temp_dir().join("paste-ocr-probe");
            if std::fs::create_dir_all(&primary).is_ok() {
                primary
            } else {
                let fallback = std::env::current_dir()
                    .unwrap()
                    .join("target")
                    .join("test-tmp")
                    .join("paste-ocr-probe");
                std::fs::create_dir_all(&fallback).unwrap();
                fallback
            }
        };
        let png_path = base.join("probe.png");
        let ps_path = base.join("gen.ps1");
        std::fs::write(
            &ps_path,
            r#"
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 640, 200
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Consolas', 30)
$g.DrawString('Hello OCR 12345', $font, [System.Drawing.Brushes]::Black, 20, 60)
$g.Dispose()
$bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"#,
        )
        .unwrap();
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                ps_path.to_str().unwrap(),
                png_path.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "png generation failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );

        let png = std::fs::read(&png_path).unwrap();
        let text = recognize_png(&png).unwrap();
        eprintln!("ocr probe recognized: {text:?}");
        // Windows OCR often misreads thin glyphs of monospace fonts (l → 1),
        // so assert on tokens whose shapes are unambiguous instead of the
        // whole phrase.
        let lower = text.to_lowercase();
        assert!(
            lower.contains("ocr") && lower.contains("12345"),
            "expected 'OCR' and '12345' in OCR output, got: {text:?}"
        );
        std::fs::remove_dir_all(&base).ok();
    }
}
