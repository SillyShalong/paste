import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Clip } from "../../types";

const EXT_COLORS: Record<string, string> = {
  pdf: "#e5484d",
  doc: "#2b7de9", docx: "#2b7de9",
  xls: "#1a7f37", xlsx: "#1a7f37", csv: "#1a7f37",
  ppt: "#d97706", pptx: "#d97706",
  zip: "#8e8e93", rar: "#8e8e93", "7z": "#8e8e93",
  png: "#a855f7", jpg: "#a855f7", jpeg: "#a855f7", gif: "#a855f7", webp: "#a855f7",
  mp4: "#ec4899", mov: "#ec4899", avi: "#ec4899",
  mp3: "#06b6d4", wav: "#06b6d4",
  txt: "#6b7280", md: "#6b7280",
  js: "#eab308", ts: "#3b82f6", tsx: "#3b82f6", json: "#84cc16",
  html: "#f97316", css: "#0ea5e9", rs: "#f97316", py: "#3b82f6",
};

/// Extensions the panel <img> can render (same whitelist as the backend
/// read_file_image command).
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

export function isImagePath(p: string): boolean {
  const name = p.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTS.has(name.slice(dot + 1).toLowerCase());
}

export function parseClipPaths(clip: Clip): string[] {
  try {
    return clip.files ? JSON.parse(clip.files) : [];
  } catch {
    return [];
  }
}

// One IPC read per path per session — cards and the detail preview share it.
const imageDataCache = new Map<string, Promise<string | null>>();

function loadImageData(path: string): Promise<string | null> {
  let p = imageDataCache.get(path);
  if (!p) {
    // Normalize failures (missing file, IPC unavailable in a plain browser)
    // to null so the fallback rendering kicks in.
    p = api.readFileImage(path).catch(() => null);
    imageDataCache.set(path, p);
  }
  return p;
}

/// Resolves to the file's data URL, or null while loading / when the file
/// can't be shown (missing, too large, unreadable) — callers fall back to
/// the plain path rendering.
export function useImageData(path: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadImageData(path).then((d) => {
      if (alive && d) setDataUrl(d);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  return dataUrl;
}

function fileName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

export function FilePreview({ clip }: { clip: Clip }) {
  const paths = parseClipPaths(clip);
  if (paths.length === 0) return <div className="preview plain">Empty file selection</div>;

  // Image files render the picture itself; anything unreadable (missing
  // file, oversized) or a non-image selection keeps the file-type list.
  if (paths.every(isImagePath)) {
    return <FileImagePreview paths={paths} fallback={<FileList paths={paths} />} />;
  }
  return <FileList paths={paths} />;
}

function FileImagePreview({ paths, fallback }: { paths: string[]; fallback: React.ReactNode }) {
  const dataUrl = useImageData(paths[0]);
  if (!dataUrl) return <>{fallback}</>;
  return (
    <div className="preview file-image">
      <img src={dataUrl} alt={fileName(paths[0])} draggable={false} />
      {paths.length > 1 && <span className="file-image-more">×{paths.length}</span>}
    </div>
  );
}

function FileList({ paths }: { paths: string[] }) {
  return (
    <div className="preview files">
      {paths.slice(0, 4).map((p) => {
        const name = fileName(p);
        const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
        return (
          <div className="file-row" key={p}>
            <span className="file-ext" style={{ background: EXT_COLORS[ext] ?? "#6c7a89" }}>
              {ext.slice(0, 4).toUpperCase() || "FILE"}
            </span>
            <span className="file-name" title={p}>{name}</span>
          </div>
        );
      })}
      {paths.length > 4 && <div className="files-more">+{paths.length - 4} more</div>}
    </div>
  );
}
