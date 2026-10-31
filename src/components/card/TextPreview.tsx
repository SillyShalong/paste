import type { Clip } from "../../types";

export function TextPreview({ clip }: { clip: Clip }) {
  // Rich text (has sanitized HTML) renders formatted; plain text renders mono-ish.
  if (clip.html && clip.html.trim()) {
    return (
      <div className="preview rich" dangerouslySetInnerHTML={{ __html: clip.html }} />
    );
  }
  return <div className="preview plain">{clip.text}</div>;
}
