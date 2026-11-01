# Paste

A clipboard manager modeled on [Paste for macOS](https://pasteapp.io) —
unlimited clipboard history in a visual card strip, summoned anywhere with a
global hotkey. Built with Tauri 2 (Rust + React + TypeScript).

![stack](https://img.shields.io/badge/platform-Windows%2010%2F11%20%7C%20macOS%2011%2B%20(Apple%20Silicon)-blue) ![rust](https://img.shields.io/badge/backend-Rust-orange) ![react](https://img.shields.io/badge/frontend-React%2018-61dafb)

## Features

- **Unlimited clipboard history** — text, rich text (HTML), links, images,
  files, and hex colors, all stored locally in SQLite
- **Paste-style card strip** — full-width translucent panel, newest cards on
  the left, each tagged with the source app's icon and brand color
- **Global hotkey** `Ctrl+Shift+V` on Windows / `Cmd+Shift+V` on macOS
  (remappable) to toggle the panel anywhere
- **Quick paste** `Ctrl+1…9` on Windows, `Cmd+1…9` on macOS — paste the most
  recent clips without opening the panel
- **Keyboard-first** — `←`/`→` navigate, `Enter` paste,
  `Ctrl/Cmd+Enter` paste as plain text, `Ctrl/Cmd+P` pin, `Del` delete,
  `Tab` cycle filters, `Esc` close
- **Pinboards** — keep frequently used snippets permanently, organized into
  boards in the sidebar
- **Power search** — full-text search across the whole history plus per-type
  filters (text / links / images / files / colors)
- **Source app detection** — every clip records which app it was copied from
  (icon + brand color extracted from the binary)
- **Privacy** — nothing leaves the machine; excluded-app list skips password
  managers (1Password, Bitwarden, KeePass…) by default; pause capture any
  time from the tray
- **System integration** — tray icon, launch at login, history size limit

## Development

```powershell
# prerequisites: Node.js LTS, Rust (stable-msvc), VS 2022 Build Tools (C++)
npm install
npm run tauri dev     # run the app with hot reload
npm run tauri build   # produce an NSIS installer in src-tauri/target/release/bundle
```

The database and cached icons live in `%APPDATA%\com.pasteclone.app\`.

Debug helper: `cargo run --example dbquery` (from `src-tauri/`) prints the
most recent clips.

## Architecture

```
src/                     React frontend (panel + settings, hash-routed)
  components/            card strip, per-type card renderers, sidebar
  store/useStore.ts      zustand state, IPC calls, live event handling
  settings/              settings window UI
src-tauri/src/           Rust backend
  clipboard/listener.rs  message-only window + WM_CLIPBOARDUPDATE (no polling)
  clipboard/capture.rs   CF_UNICODETEXT / CF_HTML / CF_DIB / CF_HDROP readers,
                         link & color classification, DIB↔PNG, HTML sanitizer
  clipboard/set.rs       writes any clip kind back to the clipboard
  appinfo.rs             foreground app → exe icon → brand color
  paste.rs               focus restore (AttachThreadInput) + SendInput Ctrl+V
  store.rs               SQLite schema + queries
  commands.rs            Tauri IPC surface
```

## macOS port (Apple Silicon, M-series)

macOS 11+ on Apple Silicon is a first-class target. Per-platform pieces:

```
src-tauri/src/
  macos.rs               hand-rolled msg_send! bindings: NSPasteboard read/write,
                         NSWorkspace frontmost app + icon, NSRunningApplication
                         activation, CGEvent Cmd+V injection, AX permission check
  clipboard/listener.rs  Windows: message-only window (event-driven);
                         macOS: NSPasteboard.changeCount polling (thread-safe)
  clipboard/capture.rs   Windows: CF_* flavors; macOS: UTI flavors via NSPasteboard
  clipboard/set.rs       writes any clip kind back (Win32 / NSPasteboard)
  appinfo.rs             foreground app → icon → brand color (Win32 / NSWorkspace)
  paste.rs               focus restore (AttachThreadInput / activateFromOptions)
                         + keystroke synthesis (SendInput Ctrl+V / CGEvent Cmd+V)
```

Design notes:

- **No private APIs.** Clipboard capture polls `changeCount` (150 ms) on a
  dedicated thread; `NSPasteboard` is documented thread-safe.
- **Main-thread discipline.** `NSWorkspace`/`NSImage` calls are dispatched to
  the main thread via `state::on_main_sync` (inline-safe when already there).
- **Accessibility permission** is required for pasting: `CGEventPost` is
  blocked until the user trusts the app under *System Settings → Privacy &
  Security → Accessibility*. The Settings window shows a banner
  (`paste_permission_granted` IPC) until granted.
- Hotkeys follow platform convention: the panel hotkey default
  `CmdOrCtrl+Shift+V` maps to `Cmd+Shift+V`; quick paste registers
  `Cmd+1…9` (`Modifiers::SUPER`) instead of `Ctrl+1…9`.
- Frontend is shared; labels switch `Ctrl`/`Cmd` via `src/lib/platform.ts`.

Build on an M-series Mac:

```bash
npm install
npm run tauri build -- --target aarch64-apple-darwin
# → .app and .dmg in src-tauri/target/aarch64-apple-darwin/release/bundle/
```

(macOS compilation must run on a Mac — the host cannot cross-compile the
AppKit wiring from Windows.)

## Not in scope (v1)

OCR search, Paste Stack, MCP/AI integration, cross-device sync — the same
scope cuts the original plan made for the desktop ports.
