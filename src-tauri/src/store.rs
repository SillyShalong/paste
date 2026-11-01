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

pub fn open_db(data_dir: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(data_dir.join("paste.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
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
    "id, kind, text, html, image_path, files, source_name, source_path, source_color, \
     source_icon, pinboard_id, created_at, paste_count";

/// List clips, newest first. `pinboard_id`: Some(Some(id)) = clips of that
/// pinboard; Some(None) = unpinned history; None = everything.
pub fn list_clips(
    conn: &Connection,
    pinboard_id: Option<Option<i64>>,
    search: &str,
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
        // Escape LIKE wildcards so "100%" or "a_b" match literally.
        let escaped = search
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        sql.push_str(" AND text LIKE '%' || ? || '%' ESCAPE '\\'");
        args.push(Box::new(escaped));
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
        "INSERT INTO clips (kind, text, html, image_path, files, source_name, source_path, \
         source_color, source_icon, pinboard_id, created_at, paste_count)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0)",
        params![
            clip.kind.as_str(),
            clip.text,
            clip.html,
            clip.image_path,
            clip.files,
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

    /// Fresh on-disk DB (WAL pragma needs a file) with a unique temp dir.
    fn test_db() -> Connection {
        let dir = std::env::temp_dir().join(format!(
            "paste-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
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
        let clips = list_clips(&conn, Some(None), "", None, 100, 0).unwrap();
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

        let history = list_clips(&conn, Some(None), "", None, 100, 0).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, free_id);

        let board = list_clips(&conn, Some(Some(board_id)), "", None, 100, 0).unwrap();
        assert_eq!(board.len(), 1);
        assert_eq!(board[0].id, pinned_id);

        let all = list_clips(&conn, None, "", None, 100, 0).unwrap();
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

        let hits = list_clips(&conn, Some(None), "100%", None, 10, 0).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].text.as_deref(), Some("100%_done"));

        let hits = list_clips(&conn, Some(None), "100x", None, 10, 0).unwrap();
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

        let rest = list_clips(&conn, None, "", None, 100, 0).unwrap();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].id, pinned_id);
    }

    /// enforce_limit removes the OLDEST unpinned rows beyond `max`.
    #[test]
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
}
