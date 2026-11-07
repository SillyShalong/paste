import { useState } from "react";
import { useStore } from "../store/useStore";
import { api } from "../lib/api";
import { useT } from "../i18n";

export default function Sidebar() {
  const t = useT();
  const open = useStore((s) => s.sidebarOpen);
  const pinboards = useStore((s) => s.pinboards);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [pendingDel, setPendingDel] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  if (!open) return null;

  const create = async () => {
    const name = newName.trim();
    if (name) {
      await useStore.getState().createPinboard(name);
    }
    setNewName("");
    setCreating(false);
  };

  const commitRename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    const original = pinboards.find((p) => p.id === renaming.id)?.name;
    if (name && name !== original) {
      await useStore.getState().renamePinboard(renaming.id, name);
    }
    setRenaming(null);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-title">{t("Pinboards")}</div>
      <button
        className={`board-item ${view.type === "history" ? "active" : ""}`}
        onClick={() => setView({ type: "history" })}
      >
        <ClockIcon /> {t("History")}
      </button>
      {pinboards.map((p) =>
        renaming?.id === p.id ? (
          <input
            key={p.id}
            className="board-input"
            autoFocus
            value={renaming.name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
        <div
          key={p.id}
          className={`board-item ${view.type === "board" && view.id === p.id ? "active" : ""}`}
          onClick={() => setView({ type: "board", id: p.id })}
          onDoubleClick={() => setRenaming({ id: p.id, name: p.name })}
        >
          <BoardIcon />
          <span className="board-name" onDoubleClick={(e) => { e.stopPropagation(); setRenaming({ id: p.id, name: p.name }); }}>
            {p.name}
          </span>
          {pendingDel === p.id ? (
            <span className="board-del-confirm" onMouseDown={(e) => e.stopPropagation()}>
              <button
                className="yes"
                title={t("Delete pinboard — clips return to history")}
                onClick={(e) => {
                  e.stopPropagation();
                  useStore.getState().deletePinboard(p.id);
                  setPendingDel(null);
                }}
              >
                ✓
              </button>
              <button
                className="no"
                title="Cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDel(null);
                }}
              >
                ✕
              </button>
            </span>
          ) : (
            <>
              <button
                className="board-del"
                title={t("Rename pinboard")}
                onClick={(e) => {
                  e.stopPropagation();
                  setRenaming({ id: p.id, name: p.name });
                }}
              >
                ✎
              </button>
              <button
                className="board-del"
                title={t("Delete pinboard")}
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDel(p.id);
                }}
              >
                ×
              </button>
            </>
          )}
        </div>
      ))}
      {creating ? (
        <input
          className="board-input"
          autoFocus
          placeholder={t("Pinboard name…")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
            if (e.key === "Escape") {
              setCreating(false);
              setNewName("");
            }
          }}
          onBlur={create}
        />
      ) : (
        <button className="board-item add" onClick={() => setCreating(true)}>
          {t("+ New Pinboard")}
        </button>
      )}
      <div className="spacer" />
      <div className="sidebar-foot">
        <button onClick={() => api.openSettings()}>{t("Settings…")}</button>
      </div>
    </aside>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" />
    </svg>
  );
}
function BoardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <line x1="8" y1="3.5" x2="8" y2="20.5" />
    </svg>
  );
}
