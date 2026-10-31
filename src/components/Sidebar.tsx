import { useState } from "react";
import { useStore } from "../store/useStore";
import { api } from "../lib/api";

export default function Sidebar() {
  const open = useStore((s) => s.sidebarOpen);
  const pinboards = useStore((s) => s.pinboards);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  if (!open) return null;

  const create = async () => {
    const name = newName.trim();
    if (name) {
      await useStore.getState().createPinboard(name);
    }
    setNewName("");
    setCreating(false);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-title">Pinboards</div>
      <button
        className={`board-item ${view.type === "history" ? "active" : ""}`}
        onClick={() => setView({ type: "history" })}
      >
        <ClockIcon /> History
      </button>
      {pinboards.map((p) => (
        <div
          key={p.id}
          className={`board-item ${view.type === "board" && view.id === p.id ? "active" : ""}`}
          onClick={() => setView({ type: "board", id: p.id })}
        >
          <BoardIcon />
          <span className="board-name">{p.name}</span>
          <button
            className="board-del"
            title="Delete pinboard"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete pinboard “${p.name}”? Clips return to history.`)) {
                useStore.getState().deletePinboard(p.id);
              }
            }}
          >
            ×
          </button>
        </div>
      ))}
      {creating ? (
        <input
          className="board-input"
          autoFocus
          placeholder="Pinboard name…"
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
          + New Pinboard
        </button>
      )}
      <div className="spacer" />
      <div className="sidebar-foot">
        <button onClick={() => api.openSettings()}>Settings…</button>
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
