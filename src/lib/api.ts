import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Clip, ClipKind, Pinboard, Settings, SourceInfo } from "../types";

export { convertFileSrc };

export const api = {
  getInitial: () =>
    invoke<{
      settings: Settings;
      pinboards: Pinboard[];
      clips: Clip[];
      sources: SourceInfo[];
      paused: boolean;
    }>("get_initial"),

  listClips: (opts: {
    pinboardId?: number | null;
    search?: string;
    kind?: ClipKind | null;
    limit?: number;
    offset?: number;
  }) =>
    invoke<Clip[]>("list_clips", {
      // null = plain history (unpinned only); a number = that pinboard.
      pinboardId: opts.pinboardId ?? null,
      search: opts.search ?? "",
      kind: opts.kind ?? null,
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
    }),

  pasteClip: (id: number, plain = false) => invoke<boolean>("paste_clip", { id, plain }),

  deleteClip: (id: number) => invoke<boolean>("delete_clip", { id }),

  setPinboard: (id: number, pinboardId: number | null) =>
    invoke<boolean>("set_pinboard", { id, pinboardId }),

  clearHistory: () => invoke<boolean>("clear_history"),

  getSettings: () => invoke<Settings>("get_settings"),

  setSettings: (newSettings: Settings) => invoke<void>("set_settings", { newSettings }),

  createPinboard: (name: string) => invoke<Pinboard | null>("create_pinboard", { name }),
  renamePinboard: (id: number, name: string) =>
    invoke<boolean>("rename_pinboard", { id, name }),
  deletePinboard: (id: number) => invoke<boolean>("delete_pinboard", { id }),

  listTrayIcons: () => invoke<{ id: string; pngBase64: string }[]>("list_tray_icons"),

  /// Data URL for an image file clip (extension/size checked backend-side),
  /// or null when the path is unreadable or not a renderable image.
  readFileImage: (path: string) => invoke<string | null>("read_file_image", { path }),

  togglePause: () => invoke<boolean>("toggle_pause"),
  hidePanel: () => invoke<void>("hide_panel"),
  openSettings: () => invoke<void>("open_settings"),
  /// macOS Accessibility permission for synthesizing paste keystrokes.
  pastePermissionGranted: () => invoke<boolean>("paste_permission_granted"),
};

export const events = {
  onNewClip: (cb: (clip: Clip) => void) =>
    listen<Clip>("clipboard:new", (e) => cb(e.payload)),
  onPanelOpened: (cb: () => void) => listen("panel:opened", cb),
  onPauseChanged: (cb: (paused: boolean) => void) =>
    listen<boolean>("pause:changed", (e) => cb(e.payload)),
  onSettingsChanged: (cb: (s: Settings) => void) =>
    listen<Settings>("settings:changed", (e) => cb(e.payload)),
};
