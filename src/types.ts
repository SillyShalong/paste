export type ClipKind = "text" | "link" | "image" | "file" | "color";

export interface Clip {
  id: number;
  kind: ClipKind;
  text: string | null;
  html: string | null;
  imagePath: string | null;
  files: string | null;
  sourceName: string;
  sourcePath: string;
  sourceColor: string;
  sourceIcon: string;
  pinboardId: number | null;
  createdAt: number;
  pasteCount: number;
}

export interface Pinboard {
  id: number;
  name: string;
  position: number;
  createdAt: number;
}

export interface Settings {
  hotkey: string;
  quickPaste: boolean;
  maxClips: number;
  alwaysPlainText: boolean;
  excludedApps: string[];
  paused: boolean;
  autostart: boolean;
  theme: string;
}

export interface SourceInfo {
  name: string;
  exePath: string;
  color: string;
}

export type View = { type: "history" } | { type: "board"; id: number };
