//! Verify the macOS AppKit bindings outside the GUI: frontmost app info,
//! name/exe path, icon → TIFFRepresentation → PNG extraction.

#[cfg(target_os = "macos")]
fn main() {
    unsafe {
        match paste_lib::macos::frontmost_app_info() {
            Some(i) => println!(
                "pid={} name={:?} exe={:?} icon_bytes={}",
                i.pid,
                i.name,
                i.exe_path,
                i.icon_png.as_ref().map_or(0, |b| b.len())
            ),
            None => println!("no frontmost app"),
        }
        let cc = paste_lib::macos::change_count();
        println!("pasteboard change_count={cc}");
        let text = paste_lib::macos::read_text();
        println!("pasteboard text={text:?}");
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("macOS only");
}
