import type { Clip } from "../../types";

export function LinkPreview({ clip }: { clip: Clip }) {
  const url = clip.text ?? "";
  let host = url;
  let path = "";
  try {
    const u = new URL(url.startsWith("www.") ? `https://${url}` : url);
    host = u.hostname.replace(/^www\./, "");
    path = u.pathname.length > 1 ? u.pathname : "";
  } catch {
    /* keep raw */
  }
  return (
    <div className="preview link">
      <div className="link-favicon">{host.charAt(0).toUpperCase()}</div>
      <div className="link-text">
        <div className="link-host">{host}</div>
        {path && <div className="link-path">{decodeURIComponent(path)}</div>}
        <div className="link-url">{url}</div>
      </div>
    </div>
  );
}
