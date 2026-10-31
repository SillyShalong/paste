//! Debug helper: print recent clips from the app database.
use rusqlite::Connection;

fn main() {
    let db_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| {
            let mut p = dirs_data();
            p.push_str("\\paste.db");
            p
        });
    println!("db: {db_path}");
    let conn = Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("open db failed");
    let mut stmt = conn
        .prepare("SELECT id, kind, substr(text,1,50), paste_count, source_name FROM clips ORDER BY id DESC LIMIT 10")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok(format!(
                "id={} kind={} paste_count={} source={} text={:?}",
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(2)?
            ))
        })
        .unwrap();
    for row in rows {
        println!("{}", row.unwrap());
    }
}

fn dirs_data() -> String {
    // %APPDATA%\com.pasteclone.app
    let appdata = std::env::var("APPDATA").expect("no APPDATA");
    format!("{appdata}\\com.pasteclone.app")
}
