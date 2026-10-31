import type { Clip } from "../../types";

export function ColorPreview({ clip }: { clip: Clip }) {
  const raw = (clip.text ?? "").trim();
  const hex = /^#?[0-9a-fA-F]{6}$/.test(raw.replace(/^0x/i, "").slice(0, 7)) || /^#[0-9a-fA-F]{3}$/.test(raw)
    ? normalizeHex(raw)
    : null;
  return (
    <div className="preview color">
      <div
        className="color-swatch"
        style={{ background: hex ?? raw }}
      />
      <div className="color-value">{raw}</div>
    </div>
  );
}

function normalizeHex(raw: string): string {
  let h = raw.replace(/^0x/i, "").replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h.toLowerCase()}`;
}
