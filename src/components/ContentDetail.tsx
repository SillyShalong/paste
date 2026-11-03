import { useEffect, useRef } from "react";
import type { Clip } from "../types";
import { useStore } from "../store/useStore";
import { api, convertFileSrc } from "../lib/api";
import { useT } from "../i18n";
import { isImagePath, parseClipPaths, useImageData } from "./card/FilePreview";

/// Full-content preview for the selected clip, opened with Space. Scrollable,
/// selectable, with paste actions — closes with Space or Esc.
export default function ContentDetail({ clip }: { clip: Clip }) {
  const t = useT();
  const contentRef = useRef<HTMLDivElement>(null);

  // Take keyboard focus away from the search input so Space/typing doesn't
  // leak into the query while the preview is open.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    contentRef.current?.focus();
  }, []);

  const color = clip.sourceColor || "#6c7a89";
  const icon = clip.sourceIcon ? convertFileSrc(clip.sourceIcon) : null;
  const when = new Date(clip.createdAt).toLocaleString();

  const paste = (plain: boolean) => useStore.getState().paste(plain);
  const del = () => {
    useStore.getState().deleteClip(clip.id);
    useStore.getState().closeDetail();
  };

  return (
    <div className="detail-overlay">
      <div className="detail-header">
        {icon && <img className="app-icon" src={icon} alt="" draggable={false} />}
        <span className="detail-app">{clip.sourceName || "Unknown"}</span>
        <span className="detail-kind">{t(clip.kind)}</span>
        <span className="detail-time">{when}</span>
        <div className="spacer" />
        <button className="btn" onClick={() => paste(false)}>{t("Paste")}</button>
        <button className="btn" onClick={() => paste(true)}>{t("Plain")}</button>
        <button className="btn danger" onClick={del}>{t("Delete")}</button>
        <button className="icon-btn" title={t("Close (Esc)")} onClick={() => useStore.getState().closeDetail()}>
          ×
        </button>
      </div>
      <div className="detail-content" ref={contentRef} tabIndex={-1}>
        <Body clip={clip} />
      </div>
    </div>
  );
}

function Body({ clip }: { clip: Clip }) {
  const t = useT();
  switch (clip.kind) {
    case "text":
      return clip.html && clip.html.trim() ? (
        <div className="detail-rich" dangerouslySetInnerHTML={{ __html: clip.html }} />
      ) : (
        <pre className="detail-text">{clip.text}</pre>
      );
    case "link":
      return (
        <div className="detail-link">
          <div className="link-host">{hostOf(clip.text ?? "")}</div>
          <pre className="detail-text">{clip.text}</pre>
        </div>
      );
    case "image":
      return clip.imagePath ? (
        <div className="detail-img">
          <img src={convertFileSrc(clip.imagePath)} alt="clipboard image" draggable={false} />
        </div>
      ) : (
        <div className="detail-text">{t("Image unavailable")}</div>
      );
    case "file": {
      const paths = parseClipPaths(clip);
      // Image files show the picture itself at natural size; everything
      // else keeps the plain path rows.
      if (paths.length > 0 && paths.every(isImagePath)) {
        return (
          <div className="detail-files">
            {paths.map((p) => (
              <DetailFileImage key={p} path={p} />
            ))}
          </div>
        );
      }
      return (
        <div className="detail-files">
          {paths.map((p) => (
            <div className="file-path-row" key={p}>
              {p}
            </div>
          ))}
        </div>
      );
    }
    case "color":
      return (
        <div className="detail-color">
          <div className="color-swatch big" style={{ background: clip.text ?? "transparent" }} />
          <pre className="detail-text">{clip.text}</pre>
        </div>
      );
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("www.") ? `https://${url}` : url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/// One image file inside the full-content preview: natural-size picture with
/// its path as the caption; falls back to the path row when unreadable.
function DetailFileImage({ path }: { path: string }) {
  const dataUrl = useImageData(path);
  return (
    <figure className="detail-file-image">
      {dataUrl && <img src={dataUrl} alt="" draggable={false} />}
      <figcaption>{path}</figcaption>
    </figure>
  );
}
