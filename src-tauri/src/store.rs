use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

/// What kind of content a clip holds. Serialized as a string in the DB
/// and over IPC ("text" | "link" | "image" | "file" | "color").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipKind {
    Text,
    Link,
    Image,
    File,
    Color,
}

impl ClipKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ClipKind::Text => "text",
            ClipKind::Link => "link",
            ClipKind::Image => "image",
            ClipKind::File => "file",
            ClipKind::Color => "color",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "text" => ClipKind::Text,
            "link" => ClipKind::Link,
            "image" => ClipKind::Image,
            "file" => ClipKind::File,
            "color" => ClipKind::Color,
            _ => return None,
        })
    }
}

/// One clipboard entry. Mirrors the `clips` table row; sent to the frontend over IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: i64,
    pub kind: ClipKind,
    /// Plain text content (for text/link/color) or null.
    pub text: Option<String>,
    /// Sanitized HTML for rich-text clips, null otherwise.
    pub html: Option<String>,
    /// Absolute path to a PNG for image clips, null otherwise.
    pub image_path: Option<String>,
    /// JSON array of file paths for file clips, null otherwise.
    pub files: Option<String>,
    /// Text recognized in the image by OCR. NULL = not recognized yet
    /// (or no engine available); an empty string = recognized, no text
    /// found. Non-image clips are always null.
    pub ocr_text: Option<String>,
    /// Display name of the source application.
    pub source_name: String,
    /// exe path of the source application (used to look up the icon).
    pub source_path: String,
    /// Hex color (#rrggbb) representing the source app brand color.
    pub source_color: String,
    /// Absolute path of the cached source-app icon PNG.
    #[serde(default)]
    pub source_icon: String,
    /// id of the Pinboard this clip is pinned to, or NULL for plain history.
    pub pinboard_id: Option<i64>,
    /// Creation timestamp (unix epoch seconds).
    pub created_at: i64,
    /// Usage counter (incremented on each paste) — future sorting aid.
    pub paste_count: i64,
}

/// A user-created Pinboard ("collection" in Paste terms).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pinboard {
    pub id: i64,
    pub name: String,
    pub position: i64,
    pub created_at: i64,
}

/// Register the REGEXP scalar function used by regex search mode. The
/// compiled regex is cached per connection thread and re-compiled only when
/// the pattern changes; an invalid pattern matches nothing (never errors).
fn register_regexp_function(conn: &Connection) -> rusqlite::Result<()> {
    use regex::Regex;
    use std::cell::RefCell;

    conn.create_scalar_function(
        "regexp",
        2,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8
            | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        move |ctx: &rusqlite::functions::Context| {
            // Compiled-regex cache keyed by pattern (regex clone is cheap);
            // an invalid pattern matches nothing instead of erroring.
            thread_local! {
                static CACHE: RefCell<Option<(String, Regex)>> = const { RefCell::new(None) };
            }
            let pattern: String = ctx.get(0)?;
            // NULL operands happen for image clips (no text / no OCR text
            // yet) — they simply never match instead of erroring the query.
            let text: Option<String> = ctx.get(1)?;
            CACHE.with(|cache| {
                let mut slot = cache.borrow_mut();
                let matches = match slot.as_ref() {
                    Some((cached, re)) if cached == &pattern => {
                        text.as_deref().map(|t| re.is_match(t)).unwrap_or(false)
                    }
                    _ => match Regex::new(&format!("(?i){pattern}")) {
                        Ok(re) => {
                            let hit = text
                                .as_deref()
                                .map(|t| re.is_match(t))
                                .unwrap_or(false);
                            *slot = Some((pattern, re));
                            return Ok(hit);
                        }
                        Err(_) => false,
                    },
                };
                Ok(matches)
            })
        },
    )
}

pub fn open_db(data_dir: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(data_dir.join("paste.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    register_regexp_function(&conn)?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS clips (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            kind          TEXT NOT NULL,
            text          TEXT,
            html          TEXT,
            image_path    TEXT,
            files         TEXT,
            ocr_text      TEXT,
            source_name   TEXT NOT NULL DEFAULT '',
            source_path   TEXT NOT NULL DEFAULT '',
            source_color  TEXT NOT NULL DEFAULT '',
            source_icon   TEXT NOT NULL DEFAULT '',
            pinboard_id   INTEGER,
            created_at    INTEGER NOT NULL,
            paste_count   INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clips_pinboard ON clips(pinboard_id);

        CREATE TABLE IF NOT EXISTS pinboards (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            position   INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )?;
    // Migration for databases created before source_icon existed.
    let has_icon: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('clips') WHERE name = 'source_icon'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|v| v > 0)
        .unwrap_or(false);
    if !has_icon {
        conn.execute_batch("ALTER TABLE clips ADD COLUMN source_icon TEXT NOT NULL DEFAULT '';")?;
    }
    // Migration for databases created before ocr_text existed (newer DBs get
    // the column from CREATE TABLE above). NULL = pending OCR.
    let has_ocr: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('clips') WHERE name = 'ocr_text'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|v| v > 0)
        .unwrap_or(false);
    if !has_ocr {
        conn.execute_batch("ALTER TABLE clips ADD COLUMN ocr_text TEXT;")?;
    }
    Ok(conn)
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    let mut stmt = conn
        .prepare_cached("SELECT value FROM settings WHERE key = ?1")
        .ok()?;
    stmt.query_row(params![key], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    );
}

// ---------------------------------------------------------------------------
// clips
// ---------------------------------------------------------------------------

fn row_to_clip(row: &Row) -> rusqlite::Result<Clip> {
    let kind_str: String = row.get("kind")?;
    Ok(Clip {
        id: row.get("id")?,
        kind: ClipKind::from_str(&kind_str).unwrap_or(ClipKind::Text),
        text: row.get("text")?,
        html: row.get("html")?,
        image_path: row.get("image_path")?,
        files: row.get("files")?,
        ocr_text: row.get("ocr_text")?,
        source_name: row.get("source_name")?,
        source_path: row.get("source_path")?,
        source_color: row.get("source_color")?,
        source_icon: row.get("source_icon")?,
        pinboard_id: row.get("pinboard_id")?,
        created_at: row.get("created_at")?,
        paste_count: row.get("paste_count")?,
    })
}

const CLIP_COLS: &str =
    "id, kind, text, html, image_path, files, ocr_text, source_name, source_path, source_color, \
     source_icon, pinboard_id, created_at, paste_count";

/// List clips, newest first. `pinboard_id`: Some(Some(id)) = clips of that
/// pinboard; Some(None) = unpinned history; None = everything. When `search`
/// is set, text clips match on `text` and image clips additionally match on
/// their `ocr_text` (both columns, same pattern).
/// Translate a user wildcard pattern into a LIKE pattern: `*` matches any
/// run, `?` one character, everything else (including % _ \) is literal.
fn wildcard_to_like(pattern: &str) -> String {
    let mut out = String::with_capacity(pattern.len() + 8);
    for ch in pattern.chars() {
        match ch {
            '*' => out.push('%'),
            '?' => out.push('_'),
            '%' | '_' | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

pub fn list_clips(
    conn: &Connection,
    pinboard_id: Option<Option<i64>>,
    search: &str,
    search_mode: &str,
    kind: Option<ClipKind>,
    limit: i64,
    offset: i64,
) -> rusqlite::Result<Vec<Clip>> {
    let mut sql = format!("SELECT {CLIP_COLS} FROM clips WHERE 1=1");
    let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    match pinboard_id {
        Some(Some(id)) => {
            sql.push_str(" AND pinboard_id = ?");
            args.push(Box::new(id));
        }
        Some(None) => {
            sql.push_str(" AND pinboard_id IS NULL");
        }
        None => {}
    }
    if !search.is_empty() {
        match search_mode {
            "wildcard" => {
                // * = any run, ? = one char; everything else literal.
                // Image clips also match against their OCR'd text.
                let pattern = format!("%{}%", wildcard_to_like(search));
                sql.push_str(
                    " AND (text LIKE ? ESCAPE '\\' OR ocr_text LIKE ? ESCAPE '\\')",
                );
                args.push(Box::new(pattern.clone()));
                args.push(Box::new(pattern));
            }
            "regex" => {
                // REGEXP is a registered scalar function (open_db); an
                // invalid pattern simply matches nothing.
                sql.push_str(" AND (text REGEXP ? OR ocr_text REGEXP ?)");
                let pattern = Box::new(format!("(?i){search}"));
                args.push(pattern.clone());
                args.push(pattern);
            }
            _ => {
                // Escape LIKE wildcards so "100%" or "a_b" match literally.
                let escaped = search
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_");
                sql.push_str(
                    " AND (text LIKE '%' || ? || '%' ESCAPE '\\' \
                     OR ocr_text LIKE '%' || ? || '%' ESCAPE '\\')",
                );
                args.push(Box::new(escaped.clone()));
                args.push(Box::new(escaped));
            }
        }
    }
    if let Some(k) = kind {
        sql.push_str(" AND kind = ?");
        args.push(Box::new(k.as_str().to_string()));
    }
    sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?");
    args.push(Box::new(limit));
    args.push(Box::new(offset));

    let mut stmt = conn.prepare(&sql)?;
    let refs: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let rows = stmt.query_map(refs.as_slice(), row_to_clip)?;
    rows.collect()
}

/// Find the most recent clip whose content matches `text` (plain text clips only).
pub fn find_text_clip(conn: &Connection, text: &str) -> rusqlite::Result<Option<Clip>> {
    let sql = format!(
        "SELECT {CLIP_COLS} FROM clips WHERE kind IN ('text','link','color') AND text = ?1 \
         ORDER BY created_at DESC, id DESC LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_row(params![text], row_to_clip)
        .optional()
}

/// Fetch a single clip by id, whatever its pinboard state.
pub fn get_clip(conn: &Connection, id: i64) -> rusqlite::Result<Option<Clip>> {
    let sql = format!("SELECT {CLIP_COLS} FROM clips WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_row(params![id], row_to_clip).optional()
}

/// Move a clip to the front of the history by updating its timestamp.
pub fn touch_clip(conn: &Connection, id: i64, now: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE clips SET created_at = ?2 WHERE id = ?1",
        params![id, now],
    )
}

pub fn insert_clip(conn: &Connection, clip: &Clip) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO clips (kind, text, html, image_path, files, ocr_text, source_name, \
         source_path, source_color, source_icon, pinboard_id, created_at, paste_count)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,0)",
        params![
            clip.kind.as_str(),
            clip.text,
            clip.html,
            clip.image_path,
            clip.files,
            clip.ocr_text,
            clip.source_name,
            clip.source_path,
            clip.source_color,
            clip.source_icon,
            clip.pinboard_id,
            clip.created_at,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_clip(conn: &Connection, id: i64) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM clips WHERE id = ?1", params![id])
}

pub fn set_pinboard(
    conn: &Connection,
    id: i64,
    pinboard_id: Option<i64>,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE clips SET pinboard_id = ?2 WHERE id = ?1",
        params![id, pinboard_id],
    )
}

/// Return all clips pinned to board `id` back to plain history.
pub fn set_pinboard_for_board(conn: &Connection, pinboard_id: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE clips SET pinboard_id = NULL WHERE pinboard_id = ?1",
        params![pinboard_id],
    )
}

pub fn increment_paste_count(conn: &Connection, id: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE clips SET paste_count = paste_count + 1 WHERE id = ?1",
        params![id],
    )
}

/// Store the OCR result for an image clip, making it searchable.
pub fn set_ocr_text(conn: &Connection, id: i64, text: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE clips SET ocr_text = ?2 WHERE id = ?1",
        params![id, text],
    )
}

/// Startup fixup: rows recognized before CJK space collapsing existed carry
/// spaced-out text ("监 控 台") that substring search can never match.
/// Rewrite them with the current normalization (idempotent — already-normal
/// rows are left untouched). Returns the number of rows changed.
pub fn normalize_existing_ocr_texts(conn: &Connection) -> usize {
    let Ok(mut stmt) =
        conn.prepare("SELECT id, ocr_text FROM clips WHERE kind = 'image' AND ocr_text LIKE '% %'")
    else {
        return 0;
    };
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .ok()
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>().ok())
        .unwrap_or_default();
    let mut changed = 0;
    for (id, text) in rows {
        let normalized = crate::ocr::normalize_ocr_text(&text);
        if normalized != text {
            if set_ocr_text(conn, id, &normalized).is_ok() {
                changed += 1;
            }
        }
    }
    changed
}

/// Image clips still awaiting OCR (oldest first): (id, image_path). Rows with
/// a NULL image_path are skipped — nothing to recognize. The caller passes a
/// batch limit so a large history is backfilled incrementally.
pub fn list_missing_ocr(
    conn: &Connection,
    limit: i64,
) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, image_path FROM clips
         WHERE kind = 'image' AND ocr_text IS NULL AND image_path IS NOT NULL
         ORDER BY created_at ASC, id ASC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
    })?;
    rows.collect()
}

/// How many image clips are still awaiting OCR — the number behind the
/// panel's OCR progress indicator.
pub fn count_missing_ocr(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM clips
         WHERE kind = 'image' AND ocr_text IS NULL AND image_path IS NOT NULL",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

/// Delete all unpinned clips, keeping pinboarded ones. Returns the image
/// files of the deleted rows so the caller can remove them from disk too.
pub fn clear_history(conn: &Connection) -> rusqlite::Result<Vec<Option<String>>> {
    let mut stmt = conn.prepare("SELECT image_path FROM clips WHERE pinboard_id IS NULL")?;
    let paths = stmt
        .query_map([], |r| r.get::<_, Option<String>>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    conn.execute("DELETE FROM clips WHERE pinboard_id IS NULL", [])?;
    Ok(paths)
}

/// Enforce max_clips limit (oldest unpinned first). Returns ids deleted + files to clean.
/// Delete unpinned clips older than `cutoff_ms`, returning their image
/// files so the caller can remove them from disk. Pinned clips always
/// survive — retention must never destroy deliberately kept content.
pub fn prune_expired(
    conn: &Connection,
    cutoff_ms: i64,
) -> rusqlite::Result<Vec<(i64, Option<String>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, image_path FROM clips WHERE pinboard_id IS NULL AND created_at < ?1",
    )?;
    let victims = stmt
        .query_map(params![cutoff_ms], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if !victims.is_empty() {
        conn.execute(
            "DELETE FROM clips WHERE pinboard_id IS NULL AND created_at < ?1",
            params![cutoff_ms],
        )?;
    }
    Ok(victims)
}

pub fn enforce_limit(
    conn: &Connection,
    max: i64,
) -> rusqlite::Result<Vec<(i64, Option<String>)>> {
    if max <= 0 {
        return Ok(vec![]);
    }
    let mut stmt = conn.prepare(
        "SELECT id, image_path FROM clips WHERE pinboard_id IS NULL
         ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?1",
    )?;
    let rows = stmt
        .query_map(params![max], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn distinct_sources(conn: &Connection) -> rusqlite::Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT source_name, source_path, source_color FROM clips
         WHERE source_name != '' GROUP BY source_path ORDER BY MAX(created_at) DESC LIMIT 50",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    rows.collect()
}

// ---------------------------------------------------------------------------
// pinboards
// ---------------------------------------------------------------------------

pub fn list_pinboards(conn: &Connection) -> rusqlite::Result<Vec<Pinboard>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, position, created_at FROM pinboards ORDER BY position, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Pinboard {
            id: r.get(0)?,
            name: r.get(1)?,
            position: r.get(2)?,
            created_at: r.get(3)?,
        })
    })?;
    rows.collect()
}

/// Insert a pinboard and return the stored row (real position/created_at).
pub fn insert_pinboard(conn: &Connection, name: &str) -> rusqlite::Result<Pinboard> {
    let pos: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM pinboards",
        [],
        |r| r.get(0),
    )?;
    let now = time::now();
    conn.execute(
        "INSERT INTO pinboards (name, position, created_at) VALUES (?1, ?2, ?3)",
        params![name, pos, now],
    )?;
    Ok(Pinboard {
        id: conn.last_insert_rowid(),
        name: name.to_string(),
        position: pos,
        created_at: now,
    })
}

pub fn rename_pinboard(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE pinboards SET name = ?2 WHERE id = ?1",
        params![id, name],
    )
}

pub fn delete_pinboard(conn: &Connection, id: i64) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM pinboards WHERE id = ?1", params![id])
}

mod time {
    /// Seconds since unix epoch without pulling the `chrono` crate.
    pub fn now() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique writable scratch dir for one test. Some locked-down machines
    /// (security software) deny writes under %TEMP% to freshly built
    /// unsigned test binaries — fall back to a workspace-local dir so the
    /// suite still runs.
    fn scratch_dir(prefix: &str) -> std::path::PathBuf {
        let suffix = format!(
            "{}-{}-{}",
            prefix,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let candidates = [
            std::env::temp_dir(),
            std::env::current_dir()
                .unwrap_or_default()
                .join("target")
                .join("test-tmp"),
        ];
        candidates
            .iter()
            .find_map(|base| {
                let dir = base.join(&suffix);
                std::fs::create_dir_all(&dir).ok()?;
                Some(dir)
            })
            .expect("no writable temp dir available for tests")
    }

    /// Fresh on-disk DB (WAL pragma needs a file) with a unique temp dir.
    fn test_db() -> Connection {
        let dir = scratch_dir("paste-test");
        open_db(&dir).unwrap()
    }

    fn clip(kind: ClipKind, text: Option<&str>, image_path: Option<&str>) -> Clip {
        Clip {
            id: 0,
            kind,
            text: text.map(str::to_string),
            html: None,
            image_path: image_path.map(str::to_string),
            files: None,
            ocr_text: None,
            source_name: "test".into(),
            source_path: String::new(),
            source_color: String::new(),
            source_icon: String::new(),
            pinboard_id: None,
            created_at: 0,
            paste_count: 0,
        }
    }

    #[test]
    fn insert_lists_newest_first() {
        let conn = test_db();
        for (i, word) in ["one", "two", "three"].iter().enumerate() {
            let mut c = clip(ClipKind::Text, Some(word), None);
            c.created_at = 100 + i as i64;
            insert_clip(&conn, &c).unwrap();
        }
        let clips = list_clips(&conn, Some(None), "", "plain", None, 100, 0).unwrap();
        assert_eq!(clips.len(), 3);
        assert_eq!(clips[0].text.as_deref(), Some("three"));
        assert_eq!(clips[2].text.as_deref(), Some("one"));
    }

    /// History view (Some(None)) must exclude pinboarded clips, a board view
    /// must show only its own, and None (internal lookups) shows everything.
    #[test]
    fn pinboard_filters() {
        let conn = test_db();
        let board_id = insert_pinboard(&conn, "board").unwrap().id;

        let mut free = clip(ClipKind::Text, Some("free"), None);
        free.created_at = 1;
        let free_id = insert_clip(&conn, &free).unwrap();
        let mut pinned = clip(ClipKind::Text, Some("pinned"), None);
        pinned.created_at = 2;
        let pinned_id = insert_clip(&conn, &pinned).unwrap();
        set_pinboard(&conn, pinned_id, Some(board_id)).unwrap();

        let history = list_clips(&conn, Some(None), "", "plain", None, 100, 0).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, free_id);

        let board = list_clips(&conn, Some(Some(board_id)), "", "plain", None, 100, 0).unwrap();
        assert_eq!(board.len(), 1);
        assert_eq!(board[0].id, pinned_id);

        let all = list_clips(&conn, None, "", "plain", None, 100, 0).unwrap();
        assert_eq!(all.len(), 2);
    }

    /// % and _ must match literally (LIKE ESCAPE), not as wildcards.
    #[test]
    fn search_escapes_like_wildcards() {
        let conn = test_db();
        let mut a = clip(ClipKind::Text, Some("100%_done"), None);
        a.created_at = 1;
        insert_clip(&conn, &a).unwrap();
        let mut b = clip(ClipKind::Text, Some("100x done"), None);
        b.created_at = 2;
        insert_clip(&conn, &b).unwrap();

        let hits = list_clips(&conn, Some(None), "100%", "plain", None, 10, 0).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].text.as_deref(), Some("100%_done"));

        let hits = list_clips(&conn, Some(None), "100x", "plain", None, 10, 0).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].text.as_deref(), Some("100x done"));
    }

    /// find_text_clip dedupes across text-bearing kinds, newest match first.
    #[test]
    fn find_text_clip_matches_newest() {
        let conn = test_db();
        let mut a = clip(ClipKind::Text, Some("dupe"), None);
        a.created_at = 1;
        insert_clip(&conn, &a).unwrap();
        let mut b = clip(ClipKind::Link, Some("dupe"), None);
        b.created_at = 2;
        let b_id = insert_clip(&conn, &b).unwrap();

        let found = find_text_clip(&conn, "dupe").unwrap().unwrap();
        assert_eq!(found.id, b_id);
        assert!(find_text_clip(&conn, "absent").unwrap().is_none());
    }

    /// clear_history removes only unpinned rows and reports their image
    /// files so the caller can delete them from disk.
    #[test]
    fn clear_history_keeps_pinned_reports_images() {
        let conn = test_db();
        let board_id = insert_pinboard(&conn, "b").unwrap().id;
        let mut unpinned = clip(ClipKind::Image, None, Some("C:/tmp/a.png"));
        unpinned.created_at = 1;
        insert_clip(&conn, &unpinned).unwrap();
        let mut pinned = clip(ClipKind::Image, None, Some("C:/tmp/b.png"));
        pinned.created_at = 2;
        let pinned_id = insert_clip(&conn, &pinned).unwrap();
        set_pinboard(&conn, pinned_id, Some(board_id)).unwrap();

        let removed = clear_history(&conn).unwrap();
        assert_eq!(removed, vec![Some("C:/tmp/a.png".to_string())]);

        let rest = list_clips(&conn, None, "", "plain", None, 100, 0).unwrap();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].id, pinned_id);
    }

    /// enforce_limit removes the OLDEST unpinned rows beyond `max`.
    #[test]
    #[test]
    fn wildcard_to_like_translates_and_escapes() {
        assert_eq!(wildcard_to_like("投*仓"), "投%仓");
        assert_eq!(wildcard_to_like("a?b"), "a_b");
        assert_eq!(wildcard_to_like("100%"), "100\\%");
        assert_eq!(wildcard_to_like("a_b\\c"), "a\\_b\\\\c");
        assert_eq!(wildcard_to_like("plain"), "plain");
    }

    #[test]
    fn wildcard_search_matches_glob_semantics() {
        let conn = test_db();
        for text in ["投机非日内开仓", "投机日记", "别的"] {
            let mut c = clip(ClipKind::Text, Some(text), None);
            insert_clip(&conn, &mut c).unwrap();
        }
        let hits = list_clips(&conn, Some(None), "投*仓", "wildcard", None, 10, 0).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].text.as_deref(), Some("投机非日内开仓"));
    }

    #[test]
    fn regex_search_mode_is_case_insensitive_and_tolerates_invalid_patterns() {
        let conn = test_db();
        for text in ["Alpha Note", "beta item"] {
            let mut c = clip(ClipKind::Text, Some(text), None);
            insert_clip(&conn, &mut c).unwrap();
        }
        let hits = list_clips(&conn, Some(None), "^alpha.*note$", "regex", None, 10, 0).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].text.as_deref(), Some("Alpha Note"));

        // An invalid pattern matches nothing instead of erroring the query.
        let broken = list_clips(&conn, Some(None), "([invalid", "regex", None, 10, 0).unwrap();
        assert!(broken.is_empty());
    }

    fn prune_expired_keeps_pinned_and_recent() {
        let conn = test_db();
        let now: i64 = 1_700_000_500_000;
        let old = now - 10 * 86_400_000;
        let fresh = now - 1_000;
        let mut a = clip(ClipKind::Text, Some("old unpinned"), None);
        a.created_at = old;
        let mut b = clip(ClipKind::Text, Some("old pinned"), None);
        b.created_at = old;
        b.pinboard_id = Some(1);
        let mut c = clip(ClipKind::Text, Some("fresh unpinned"), None);
        c.created_at = fresh;
        let a_id = insert_clip(&conn, &a).unwrap();
        insert_clip(&conn, &b).unwrap();
        insert_clip(&conn, &c).unwrap();
        let victims = prune_expired(&conn, now - 5 * 86_400_000).unwrap();
        assert_eq!(victims.len(), 1);
        assert_eq!(victims[0].0, a_id);
        // Query ALL clips (Some(None) is the unpinned-history view, which by
        // design excludes the pinned survivor).
        let names: Vec<String> =
            list_clips(&conn, None, "", "plain", None, 100, 0)
                .unwrap()
                .into_iter()
                .map(|c| c.text.unwrap_or_default())
                .collect();
        assert!(names.contains(&"old pinned".to_string()));
        assert!(names.contains(&"fresh unpinned".to_string()));
        assert!(!names.contains(&"old unpinned".to_string()));
    }

    fn enforce_limit_drops_oldest() {
        let conn = test_db();
        for i in 1..=5i64 {
            let mut c = clip(
                ClipKind::Text,
                Some(&format!("clip-{i}")),
                if i == 1 { Some("old.png") } else { None },
            );
            c.created_at = i;
            insert_clip(&conn, &c).unwrap();
        }
        let mut victims = enforce_limit(&conn, 3).unwrap();
        victims.sort();
        assert_eq!(victims.len(), 2);
        // created_at 1 and 2 are the oldest; row 1 carries the image file.
        assert_eq!(
            victims,
            vec![
                (1, Some("old.png".to_string())),
                (2, None),
            ]
        );
    }

    /// Pinboard rows come back with their real position/created_at.
    #[test]
    fn insert_pinboard_returns_stored_row() {
        let conn = test_db();
        let p1 = insert_pinboard(&conn, "first").unwrap();
        let p2 = insert_pinboard(&conn, "second").unwrap();
        assert_eq!(p1.position, 1);
        assert_eq!(p2.position, 2);
        assert!(p2.created_at >= p1.created_at);
        assert_eq!(p2.name, "second");
    }

    /// An image clip whose OCR text carries the query must be found in all
    /// three search modes, even though its `text` column is NULL.
    #[test]
    fn ocr_text_is_searchable_in_all_modes() {
        let conn = test_db();
        let mut c = clip(ClipKind::Image, None, Some("C:/tmp/shot.png"));
        c.ocr_text = Some("会议纪要：下周三发布 v0.7.6".to_string());
        insert_clip(&conn, &c).unwrap();

        for mode in ["plain", "wildcard", "regex"] {
            let q = match mode {
                "plain" => "会议纪要",
                "wildcard" => "会*要",
                "regex" => "v0\\.7\\.6$",
                _ => unreachable!(),
            };
            let hits = list_clips(&conn, Some(None), q, mode, None, 10, 0).unwrap();
            assert_eq!(hits.len(), 1, "mode {mode} must match the OCR text");
            assert_eq!(hits[0].kind, ClipKind::Image);
        }

        // A query matching neither column still finds nothing.
        let none = list_clips(&conn, Some(None), "预算表", "plain", None, 10, 0).unwrap();
        assert!(none.is_empty());
    }

    /// Regex search must tolerate rows with NULL text and NULL ocr_text
    /// (image clips) instead of erroring the whole query away.
    #[test]
    fn regex_search_ignores_null_text_rows() {
        let conn = test_db();
        let mut img = clip(ClipKind::Image, None, Some("C:/tmp/pending.png"));
        img.ocr_text = None;
        insert_clip(&conn, &img).unwrap();
        let mut a = clip(ClipKind::Text, Some("Alpha Note"), None);
        a.created_at = 1;
        insert_clip(&conn, &a).unwrap();

        let hits = list_clips(&conn, Some(None), "^alpha", "regex", None, 10, 0).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].text.as_deref(), Some("Alpha Note"));
    }

    /// The startup fixup collapses spaces inside CJK OCR text (making it
    /// searchable) while leaving latin spacing and already-normal rows alone.
    #[test]
    fn normalize_existing_ocr_texts_fixes_spaced_cjk() {
        let conn = test_db();
        let mut spaced = clip(ClipKind::Image, None, Some("C:/tmp/a.png"));
        spaced.ocr_text = Some("运 行 监 控 台".to_string());
        let spaced_id = insert_clip(&conn, &spaced).unwrap();
        let mut latin = clip(ClipKind::Image, None, Some("C:/tmp/b.png"));
        latin.ocr_text = Some("hello world".to_string());
        insert_clip(&conn, &latin).unwrap();

        let changed = normalize_existing_ocr_texts(&conn);
        assert_eq!(changed, 1);
        assert_eq!(
            get_clip(&conn, spaced_id).unwrap().unwrap().ocr_text.as_deref(),
            Some("运行监控台")
        );
        // Now the plain search matches.
        let hits = list_clips(&conn, Some(None), "监控", "plain", None, 10, 0).unwrap();
        assert_eq!(hits.len(), 1);
        // Idempotent: a second pass changes nothing.
        assert_eq!(normalize_existing_ocr_texts(&conn), 0);
    }

    /// set_ocr_text makes the clip searchable and removes it from the
    /// missing-OCR queue the backfill scans.
    #[test]
    fn set_ocr_text_updates_and_backfill_queue_drains() {
        let conn = test_db();
        let mut old = clip(ClipKind::Image, None, Some("C:/tmp/old.png"));
        old.created_at = 1;
        let old_id = insert_clip(&conn, &old).unwrap();
        let mut fresh = clip(ClipKind::Image, None, Some("C:/tmp/new.png"));
        fresh.created_at = 2;
        let fresh_id = insert_clip(&conn, &fresh).unwrap();
        let mut text = clip(ClipKind::Text, Some("not an image"), None);
        insert_clip(&conn, &text).unwrap();

        let missing = list_missing_ocr(&conn, 10).unwrap();
        // Oldest first; text clips are never queued.
        assert_eq!(
            missing,
            vec![(old_id, "C:/tmp/old.png".to_string()), (fresh_id, "C:/tmp/new.png".to_string())]
        );

        set_ocr_text(&conn, old_id, "hello world").unwrap();
        let missing = list_missing_ocr(&conn, 10).unwrap();
        assert_eq!(missing, vec![(fresh_id, "C:/tmp/new.png".to_string())]);

        let hits = list_clips(&conn, Some(None), "hello", "plain", None, 10, 0).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, old_id);
        assert_eq!(hits[0].ocr_text.as_deref(), Some("hello world"));
    }

    /// A DB written before ocr_text existed is migrated on reopen.
    #[test]
    fn migration_readds_dropped_ocr_column() {
        let dir = scratch_dir("paste-ocr-migration");
        let path = dir.join("paste.db");

        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(
            "CREATE TABLE clips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                text TEXT,
                html TEXT,
                image_path TEXT,
                files TEXT,
                source_name TEXT NOT NULL DEFAULT '',
                source_path TEXT NOT NULL DEFAULT '',
                source_color TEXT NOT NULL DEFAULT '',
                source_icon TEXT NOT NULL DEFAULT '',
                pinboard_id INTEGER,
                created_at INTEGER NOT NULL,
                paste_count INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
        drop(conn);

        let conn = open_db(&dir).unwrap();
        let has_ocr: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('clips') WHERE name = 'ocr_text'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_ocr, 1);
        // The migrated column is usable end to end.
        let c = clip(ClipKind::Image, None, Some("C:/tmp/x.png"));
        let c_id = insert_clip(&conn, &c).unwrap();
        set_ocr_text(&conn, c_id, "migrated").unwrap();
        let hits = list_clips(&conn, Some(None), "migrated", "plain", None, 10, 0).unwrap();
        assert_eq!(hits.len(), 1);
    }
}
