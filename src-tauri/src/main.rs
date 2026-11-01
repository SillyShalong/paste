// Prevents an additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebView2 keeps its browser profile under %LOCALAPPDATA%\<identifier>\
    // EBWebView by default. On some machines a security component holds the
    // whole %APPDATA% tree (Local and Roaming alike; observed on a
    // domain-joined box right after a WebView2 runtime update), and every
    // profile under it fails to create with 0x800700AA ERROR_BUSY — original
    // and brand-new folders, ProgramData too. Home-directory paths outside
    // AppData keep working, so park the profile in ~/.paste/webview2.
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        if let Some(home) = std::env::var_os("USERPROFILE") {
            let dir = std::path::Path::new(&home).join(".paste").join("webview2");
            if std::fs::create_dir_all(&dir).is_ok() {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &dir);
            }
        }
    }
    paste_lib::run()
}
