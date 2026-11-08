import { useState } from "react";
import { useStore } from "../store/useStore";
import type { ClipKind } from "../types";
import { api } from "../lib/api";
import { modLabel } from "../lib/platform";
import { useT } from "../i18n";
import ConfirmPopover from "./ConfirmPopover";

const FILTERS: { key: ClipKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "text", label: "Text" },
  { key: "link", label: "Links" },
  { key: "image", label: "Images" },
  { key: "file", label: "Files" },
  { key: "color", label: "Colors" },
];

export default function SearchBar() {
  const t = useT();
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const kindFilter = useStore((s) => s.kindFilter);
  const setKindFilter = useStore((s) => s.setKindFilter);
  const view = useStore((s) => s.view);
  const pinboards = useStore((s) => s.pinboards);
  const settings = useStore((s) => s.settings);
  const paused = useStore((s) => s.paused);
  const searchMode = settings?.searchMode ?? "plain";

  let invalidRegex = false;
  if (searchMode === "regex" && query) {
    try {
      new RegExp(query);
    } catch {
      invalidRegex = true;
    }
  }

  const board = view.type === "board" ? pinboards.find((p) => p.id === view.id) : null;

  return (
    <div className="search-area">
      <div className="search-row">
        <button className="icon-btn" title={t(`Toggle sidebar (${modLabel}+B)`)} onClick={() => useStore.getState().toggleSidebar()}>
          <SidebarIcon />
        </button>
        <input
          className="search-input"
          type="text"
          placeholder={t("Search clipboard history…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Space semantics depend on the box state: an EMPTY box hands
            // Space to the panel (toggle the preview — a space in an empty
            // query is worthless), a filled box keeps Space as a query
            // character for multi-word searches. Escape clears the query
            // and returns to card navigation (second Esc hides the panel).
            if (e.nativeEvent.isComposing) return;
            if (e.key === " " && query === "") {
              e.preventDefault();
              e.stopPropagation();
              const s = useStore.getState();
              if (s.detailClipId != null) s.closeDetail();
              else s.openDetail();
              return;
            }
            if (e.key === "Escape" && query !== "") {
              e.preventDefault();
              e.stopPropagation();
              setQuery("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
        />
        <button className="icon-btn" title={paused ? t("Resume history") : t("Pause history")} onClick={() => api.togglePause()}>
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button className="icon-btn" title={t("Settings")} onClick={() => api.openSettings()}>
          <GearIcon />
        </button>
      </div>
      {invalidRegex && (
        <div className="search-error">
          {t("Invalid regular expression — matching is paused until it is fixed")}
        </div>
      )}
      <div className="filter-row">
        {board && <span className="board-chip">{board.name}</span>}
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip ${kindFilter === f.key ? "active" : ""}`}
            onClick={() => setKindFilter(f.key)}
          >
            {t(f.label)}
          </button>
        ))}
        <div className="spacer" />
        <ClearHistoryChip />
        <span className="app-label">{settings?.hotkey.replace("CmdOrCtrl", modLabel)}</span>
      </div>
    </div>
  );
}

/// Clear-history button with an in-panel confirmation popover.
/// (A native confirm() dialog would steal focus from the panel and trigger
/// the auto-hide-on-blur behavior, closing the panel — so we never use one.)
function ClearHistoryChip() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="clear-wrap">
      <button
        className={`chip danger ${open ? "active" : ""}`}
        title={t("Clear History")}
        onClick={() => setOpen((v) => !v)}
      >
        {t("Clear History")}
      </button>
      {open && (
        <ConfirmPopover
          message={t("Clear all clipboard history? Pinned items are kept.")}
          confirmLabel={t("Clear")}
          onConfirm={() => {
            useStore.getState().clearHistory();
            setOpen(false);
          }}
          onDismiss={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5 3.5v9a.7.7 0 0 0 1.07.6l7-4.5a.7.7 0 0 0 0-1.2l-7-4.5A.7.7 0 0 0 5 3.5z" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7L3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}
