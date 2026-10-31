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

function fileName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

export function FilePreview({ clip }: { clip: Clip }) {
  let paths: string[] = [];
  try {
    paths = clip.files ? JSON.parse(clip.files) : [];
  } catch {
    /* ignore */
  }
  if (paths.length === 0) return <div className="preview plain">Empty file selection</div>;

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
