import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { useStore } from "../store/useStore";
import type { Clip } from "../types";
import { api, convertFileSrc } from "../lib/api";
import { modLabel } from "../lib/platform";
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
  const t = useT();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const pinboards = useStore((s) => s.pinboards);

  const color = clip.sourceColor || "#6c7a89";
  const icon = clip.sourceIcon ? convertFileSrc(clip.sourceIcon) : null;

  return (
    <div
      className={`card ${selected ? "selected" : ""}`}
      data-card-index={index}
      style={{ ["--source-color" as string]: color }}
      // Scrolling cards beneath a stationary pointer fires mouseenter; do not
      // let that overwrite the keyboard selection. React to mouse movement.
      onMouseMove={(e) => {
        if (e.movementX !== 0 || e.movementY !== 0) useStore.getState().setSel(index);
      }}
      onClick={() => {
        useStore.getState().setSel(index);
        useStore.getState().paste();
      }}
      onDoubleClick={() => {
        useStore.getState().setSel(index);
        useStore.getState().openDetail();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        useStore.getState().setSel(index);
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="card-topbar" />
      <div className="card-head">
        {icon && <img className="app-icon" src={icon} alt="" draggable={false} />}
        <span className="app-name" title={clip.sourceName || t("Unknown")}>
          {clip.sourceName || t("Unknown")}
        </span>
        {clip.pinboardId != null && <PinBadge />}
      </div>
      <div className="card-content">
        <Preview clip={clip} />
      </div>
      {selected && (
        <div className="card-actions">
          <button title={t("Paste (Enter)")} onClick={(e) => { e.stopPropagation(); useStore.getState().paste(); }}>
            {t("Paste")}
          </button>
          <button title={t(`Paste as plain text (${modLabel}+Enter)`)} onClick={(e) => { e.stopPropagation(); useStore.getState().paste(true); }}>
            {t("Plain")}
          </button>
          <button title={t("Delete (Del)")} className="danger" onClick={(e) => { e.stopPropagation(); useStore.getState().deleteClip(); }}>
            {t("Delete")}
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
  const t = useT();
  return (
    <span className="pin-badge" title={t("Pinned")}>
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
  const t = useT();
  useOutsideClose(onClose);
  // Render into body: the card has transform + overflow:hidden, which would
  // clip a fixed-position menu rendered inside it.
  return createPortal(
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      // keep the window-level mousedown closer from firing for menu clicks
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem label={t("Paste")} onClick={() => { useStore.getState().paste(); onClose(); }} />
      <MenuItem label={t("Paste as Plain Text")} onClick={() => { useStore.getState().paste(true); onClose(); }} />
      <div className="menu-sep" />
      {pinboards.length > 0 ? (
        <>
          <div className="menu-label">{t("Pin to")}</div>
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
        <MenuItem label={t("Create a Pinboard first…")} onClick={() => { api.openSettings(); onClose(); }} />
      )}
      <div className="menu-sep" />
      <MenuItem
        label={t("Copy Again")}
        onClick={() => {
          useStore.getState().copyAgain(clip.id);
          onClose();
        }}
      />
      <MenuItem
        label={t("Delete")}
        danger
        onClick={() => {
          useStore.getState().deleteClip(clip.id);
          onClose();
        }}
      />
    </div>,
    document.body,
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
