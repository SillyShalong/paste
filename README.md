# Paste for Windows

A Windows clipboard manager modeled on [Paste for macOS](https://pasteapp.io) —
unlimited clipboard history in a visual card strip, summoned anywhere with a
global hotkey. Built with Tauri 2 (Rust + React + TypeScript).

![stack](https://img.shields.io/badge/platform-Windows%2010%2F11-blue) ![rust](https://img.shields.io/badge/backend-Rust-orange) ![react](https://img.shields.io/badge/frontend-React%2018-61dafb)

## Features

- **Unlimited clipboard history** — text, rich text (HTML), links, images,
  files, and hex colors, all stored locally in SQLite
- **Paste-style card strip** — full-width translucent panel, newest cards on
  the left, each tagged with the source app's icon and brand color
- **Global hotkey** `Ctrl+Shift+V` (remappable) to toggle the panel anywhere
- **Quick paste** `Ctrl+1…9` — paste the most recent clips without opening
  the panel
- **Keyboard-first** — `←`/`→` navigate, `Enter` paste,
  `Ctrl+Enter` paste as plain text, `Ctrl+P` pin, `Del` delete,
  `Tab` cycle filters, `Esc` close
- **Pinboards** — keep frequently used snippets permanently, organized into
  boards in the sidebar
- **Power search** — full-text search across the whole history plus per-type
  filters (text / links / images / files / colors)
- **Source app detection** — every clip records which app it was copied from
  (icon + brand color extracted from the exe)
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

## Not in scope (v1)

OCR search, Paste Stack, MCP/AI integration, cross-device sync — the same
scope cuts the original plan made for the Windows port.

## macOS port

The React frontend is platform-neutral. Porting = adding
`clipboard/listener_mac.rs` (NSPasteboard changeCount polling), swapping the
foreground-app lookup to NSWorkspace, and adapting the hotkey/window behavior
to macOS conventions.
