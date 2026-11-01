import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import type { Clip } from "../types";
import { api, convertFileSrc } from "../lib/api";
import { TextPreview } from "./card/TextPreview";
import { LinkPreview } from "./card/LinkPreview";
import { ImagePreview } from "./card/ImagePreview";
import { FilePreview } from "./card/FilePreview";
import { ColorPreview } from "./card/ColorPreview";

export default function ClipboardCard({
  clip,
  index,
  selected,
}: {
  clip: Clip;
  index: number;
  selected: boolean;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const pinboards = useStore((s) => s.pinboards);

  const color = clip.sourceColor || "#6c7a89";
  const icon = clip.sourceIcon ? convertFileSrc(clip.sourceIcon) : null;

  return (
    <div
      className={`card ${selected ? "selected" : ""}`}
      data-card-index={index}
      style={{ ["--source-color" as string]: color }}
      onMouseEnter={(e) => useStore.getState().setSel(index)}
      onClick={() => useStore.getState().paste()}
      onContextMenu={(e) => {
        e.preventDefault();
        useStore.getState().setSel(index);
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="card-topbar" />
      <div className="card-head">
        {icon && <img className="app-icon" src={icon} alt="" draggable={false} />}
        <span className="app-name" title={clip.sourceName || "Unknown"}>
          {clip.sourceName || "Unknown"}
        </span>
        {clip.pinboardId != null && <PinBadge />}
      </div>
      <div className="card-content">
        <Preview clip={clip} />
      </div>
      {selected && (
        <div className="card-actions">
          <button title="Paste (Enter)" onClick={(e) => { e.stopPropagation(); useStore.getState().paste(); }}>
            Paste
          </button>
          <button title="Paste as plain text (Ctrl+Enter)" onClick={(e) => { e.stopPropagation(); useStore.getState().paste(true); }}>
            Plain
          </button>
          <button title="Delete (Del)" className="danger" onClick={(e) => { e.stopPropagation(); useStore.getState().deleteClip(); }}>
            Delete
          </button>
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          clip={clip}
          pinboards={pinboards}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function Preview({ clip }: { clip: Clip }) {
  switch (clip.kind) {
    case "text":
      return <TextPreview clip={clip} />;
    case "link":
      return <LinkPreview clip={clip} />;
    case "image":
      return <ImagePreview clip={clip} />;
    case "file":
      return <FilePreview clip={clip} />;
    case "color":
      return <ColorPreview clip={clip} />;
  }
}

function PinBadge() {
  return (
    <span className="pin-badge" title="Pinned">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 3l5 5-5.5 2.5L13 15l-2-4-6 6 6-6-4-2 4.5-2.5z" transform="rotate(45 12 12)" />
      </svg>
    </span>
  );
}

function ContextMenu({
  x,
  y,
  clip,
  pinboards,
  onClose,
}: {
  x: number;
  y: number;
  clip: Clip;
  pinboards: { id: number; name: string }[];
  onClose: () => void;
}) {
  useOutsideClose(onClose);
  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      // keep the window-level mousedown closer from firing for menu clicks
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >      <MenuItem label="Paste" onClick={() => { useStore.getState().paste(); onClose(); }} />
      <MenuItem label="Paste as Plain Text" onClick={() => { useStore.getState().paste(true); onClose(); }} />
      <div className="menu-sep" />
      {pinboards.length > 0 ? (
        <>
          <div className="menu-label">Pin to</div>
          {pinboards.map((p) => (
            <MenuItem
              key={p.id}
              label={clip.pinboardId === p.id ? `✓ ${p.name}` : p.name}
              onClick={() => {
                api.setPinboard(clip.id, clip.pinboardId === p.id ? null : p.id).then(() => {
                  useStore.getState().refetch();
                });
                onClose();
              }}
            />
          ))}
        </>
      ) : (
        <MenuItem label="Create a Pinboard first…" onClick={() => { api.openSettings(); onClose(); }} />
      )}
      <div className="menu-sep" />
      <MenuItem
        label="Copy Again"
        onClick={() => {
          useStore.getState().paste();
          onClose();
        }}
      />
      <MenuItem
        label="Delete"
        danger
        onClick={() => {
          useStore.getState().deleteClip(clip.id);
          onClose();
        }}
      />
    </div>
  );
}

/// Close the context menu on any outside mousedown or window blur. A real
/// effect with cleanup — the previous render-time version leaked listeners
/// on every re-render.
function useOutsideClose(onClose: () => void) {
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener("mousedown", handler);
    window.addEventListener("blur", handler);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("blur", handler);
    };
  }, [onClose]);
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button className={`menu-item ${danger ? "danger" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}
