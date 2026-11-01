import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "../lib/api";
import type { Pinboard, Settings } from "../types";

export default function SettingsApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pinboards, setPinboards] = useState<Pinboard[]>([]);
  const [recording, setRecording] = useState(false);
  const [newExe, setNewExe] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [pendingDelBoard, setPendingDelBoard] = useState<number | null>(null);
  const [version, setVersion] = useState<string>("…");

  useEffect(() => {
    api.getInitial().then((d) => {
      setSettings(d.settings);
      setPinboards(d.pinboards);
    });
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);

  const update = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    await api.setSettings(next);
  };

  if (!settings) return <div className="settings-root" />;

  return (
    <div className="settings-root">
      <h1>Paste Settings</h1>

      <section className="settings-section">
        <h2>General</h2>
        <Row
          label="Launch at login"
          desc="Start Paste automatically when Windows starts"
        >
          <Toggle on={settings.autostart} onChange={(v) => update({ autostart: v })} />
        </Row>
        <Row label="Pause clipboard history" desc="Temporarily stop recording new copies">
          <Toggle
            on={settings.paused}
            onChange={() =>
              api
                .togglePause()
                .then(() => api.getSettings())
                .then(setSettings)
            }
          />
        </Row>
        <Row label="Paste as plain text by default" desc="Strip formatting when pasting rich content">
          <Toggle on={settings.alwaysPlainText} onChange={(v) => update({ alwaysPlainText: v })} />
        </Row>
        <Row label="Appearance" desc="Panel theme">
          <select
            value={settings.theme}
            onChange={(e) => update({ theme: e.target.value })}
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Row>
        <Row
          label="Panel position"
          desc="Vertical placement — always on the screen you're working on"
        >
          <select
            value={settings.panelPosition || "center"}
            onChange={(e) => update({ panelPosition: e.target.value })}
          >
            <option value="center">Center of screen</option>
            <option value="top">Top of screen</option>
            <option value="bottom">Bottom of screen</option>
          </select>
        </Row>
      </section>

      <section className="settings-section">
        <h2>Shortcuts</h2>
        <Row label="Open Paste" desc="Global shortcut to show or hide the clipboard panel">
          {recording ? (
            <input
              className="hotkey-box recording"
              value="Press keys…"
              readOnly
              autoFocus
              onKeyDown={(e) => {
                e.preventDefault();
                const combo = comboFromEvent(e);
                if (combo) {
                  setRecording(false);
                  update({ hotkey: combo });
                }
              }}
              onBlur={() => setRecording(false)}
            />
          ) : (
            <button className="hotkey-box" onClick={() => setRecording(true)}>
              {settings.hotkey.replace("CmdOrCtrl", "Ctrl")}
            </button>
          )}
        </Row>
        <Row
          label="Quick paste shortcuts"
          desc="Ctrl+1…9 paste the most recent clips without opening the panel"
        >
          <Toggle on={settings.quickPaste} onChange={(v) => update({ quickPaste: v })} />
        </Row>
      </section>

      <section className="settings-section">
        <h2>History</h2>
        <Row label="Keep at most" desc="Oldest unpinned clips are removed beyond this limit">
          <select
            value={String(settings.maxClips)}
            onChange={(e) => update({ maxClips: Number(e.target.value) })}
          >
            <option value="0">Unlimited</option>
            <option value="100">100 clips</option>
            <option value="500">500 clips</option>
            <option value="1000">1000 clips</option>
            <option value="5000">5000 clips</option>
          </select>
        </Row>
        <div className="settings-actions">
          {confirmingClear ? (
            <>
              <span className="confirm-inline-msg">Clear all history? Pinned items are kept.</span>
              <button
                className="btn danger"
                onClick={() => {
                  api.clearHistory();
                  setConfirmingClear(false);
                }}
              >
                Confirm
              </button>
              <button className="btn" onClick={() => setConfirmingClear(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn danger" onClick={() => setConfirmingClear(true)}>
              Clear History
            </button>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h2>Excluded Apps</h2>
        <div className="setting-row" style={{ paddingBottom: 0 }}>
          <div className="setting-label">
            Copies made inside these apps are never recorded
            <span className="desc">Use the executable file name, e.g. 1password.exe</span>
          </div>
        </div>
        <div className="excluded-list">
          {settings.excludedApps.map((exe) => (
            <span className="excluded-chip" key={exe}>
              {exe}
              <button
                onClick={() =>
                  update({
                    excludedApps: settings.excludedApps.filter((x) => x !== exe),
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="settings-actions">
          <input
            type="text"
            placeholder="app.exe"
            value={newExe}
            onChange={(e) => setNewExe(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newExe.trim()) {
                update({
                  excludedApps: [...settings.excludedApps, newExe.trim().toLowerCase()],
                });
                setNewExe("");
              }
            }}
            style={{ width: 200 }}
          />
          <button
            className="btn"
            onClick={() => {
              if (newExe.trim()) {
                update({
                  excludedApps: [...settings.excludedApps, newExe.trim().toLowerCase()],
                });
                setNewExe("");
              }
            }}
          >
            Add
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Pinboards</h2>
        <div className="excluded-list">
          {pinboards.map((p) => (
            <span className="excluded-chip" key={p.id}>
              {p.name}
              {pendingDelBoard === p.id ? (
                <span className="confirm-inline">
                  <button
                    className="yes"
                    title="Delete — clips return to history"
                    onClick={() => {
                      api.deletePinboard(p.id).then(() => {
                        setPinboards((bs) => bs.filter((b) => b.id !== p.id));
                      });
                      setPendingDelBoard(null);
                    }}
                  >
                    ✓
                  </button>
                  <button className="no" title="Cancel" onClick={() => setPendingDelBoard(null)}>
                    ✕
                  </button>
                </span>
              ) : (
                <button onClick={() => setPendingDelBoard(p.id)}>×</button>
              )}
            </span>
          ))}
          {pinboards.length === 0 && (
            <span style={{ color: "var(--text-faint)", fontSize: 12 }}>
              Create pinboards from the panel sidebar.
            </span>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h2>About</h2>
        <div className="about-head">
          <img src="/app-icon.png" alt="Paste" className="about-icon" />
          <div>
            <div className="about-name">Paste for Windows</div>
            <div className="about-version">Version {version}</div>
          </div>
        </div>
        <Row label="Build" desc="Compiler profile this binary was built with">
          <span className="about-value">
            {import.meta.env.TAURI_ENV_DEBUG === "true" ? "Debug (dev)" : "Release (optimized)"}
          </span>
        </Row>
        <Row label="Built at" desc="Timestamp of this build">
          <span className="about-value">{formatBuildDate(__BUILD_DATE__)}</span>
        </Row>
        <Row label="Commit" desc="Source revision this build was produced from">
          <span className="about-value mono">{__GIT_SHA__}</span>
        </Row>
        <Row label="Platform" desc="Operating system and CPU architecture">
          <span className="about-value">
            {import.meta.env.TAURI_ENV_OS || "windows"}{" "}
            {import.meta.env.TAURI_ENV_PLATFORM_VERSION || ""} ·{" "}
            {import.meta.env.TAURI_ENV_ARCH || "x86_64"}
          </span>
        </Row>
      </section>

      <p style={{ color: "var(--text-faint)", fontSize: 11.5 }}>
        Paste for Windows — a desktop clipboard manager inspired by Paste for macOS.
        Data stays on this machine.
      </p>
    </div>
  );
}

function formatBuildDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} UTC${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        {label}
        {desc && <span className="desc">{desc}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} />
  );
}

/// Convert a keydown event into a Tauri shortcut string like "CmdOrCtrl+Shift+V".
function comboFromEvent(e: React.KeyboardEvent): string | null {
  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("CmdOrCtrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let name = key.length === 1 ? key.toUpperCase() : key;
  if (name === " ") name = "Space";
  parts.push(name);
  return parts.join("+");
}
