export type ClipKind = "text" | "link" | "image" | "file" | "color";

export interface Clip {
  id: number;
  kind: ClipKind;
  text: string | null;
  html: string | null;
  imagePath: string | null;
  files: string | null;
  /** Text recognized in the image by OCR (null = pending/not available). */
  ocrText: string | null;
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
  searchMode: string;
  retentionDays: number;
  alwaysPlainText: boolean;
  excludedApps: string[];
  paused: boolean;
  autostart: boolean;
  theme: string;
  panelPosition: string;
  wheelDirection: string;
  trayIcon: string;
  language: string;
  /** Recognize text in copied images so they become searchable (Windows OCR). */
  ocrEnabled: boolean;
}

export interface SourceInfo {
  name: string;
  exePath: string;
  color: string;
}

export type View = { type: "history" } | { type: "board"; id: number };
