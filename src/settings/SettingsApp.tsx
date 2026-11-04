import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "../lib/api";
import { isMac, modLabel } from "../lib/platform";
import { useT } from "../i18n";
import type { Pinboard, Settings } from "../types";

interface TrayIconOption {
  id: string;
  pngBase64: string;
}

export default function SettingsApp() {
  const t = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pinboards, setPinboards] = useState<Pinboard[]>([]);
  const [recording, setRecording] = useState(false);
  const [newExe, setNewExe] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [pendingDelBoard, setPendingDelBoard] = useState<number | null>(null);
  const [version, setVersion] = useState<string>("…");
  // macOS only: paste keystroke injection needs the Accessibility permission.
  const [pasteAllowed, setPasteAllowed] = useState(true);
  const [trayIcons, setTrayIcons] = useState<TrayIconOption[]>([]);

  useEffect(() => {
    api.getInitial().then((d) => {
      setSettings(d.settings);
      setPinboards(d.pinboards);
    });
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
    api.listTrayIcons().then(setTrayIcons).catch(() => setTrayIcons([]));
  }, []);

  useEffect(() => {
    if (isMac) api.pastePermissionGranted().then(setPasteAllowed);
  }, []);

  const update = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const prev = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await api.setSettings(next);
    } catch (e) {
      // Revert the optimistic update and surface the failure (e.g. an
      // unregisterable hotkey) instead of silently diverging from the app.
      setSettings(prev);
      alert(`Failed to apply settings: ${e}`);
    }
  };

  if (!settings) return <div className="settings-root" />;

  return (
    <div className="settings-root">
      <h1>{t("Paste Settings")}</h1>

      {isMac && !pasteAllowed && (
        <div className="settings-warning">
          <span>
            Pasting needs the Accessibility permission. Enable Paste under
            System Settings → Privacy &amp; Security → Accessibility, then
            restart the app.
          </span>
          <button onClick={() => api.pastePermissionGranted().then(setPasteAllowed)}>
            Re-check
          </button>
        </div>
      )}

      <section className="settings-section">
        <h2>{t("General")}</h2>
        <Row label={t("Language")} desc={t("Follow the operating system language")}>
          <select
            value={settings.language || "system"}
            onChange={(e) => update({ language: e.target.value })}
          >
            <option value="system">{t("System")}</option>
            <option value="en">English</option>
            <option value="zh">简体中文</option>
          </select>
        </Row>
        <Row
          label={t("Launch at login")}
          desc={isMac ? t("Start Paste automatically when you log in") : t("Start Paste automatically when Windows starts")}
        >
          <Toggle on={settings.autostart} onChange={(v) => update({ autostart: v })} />
        </Row>
        <Row label={t("Pause clipboard history")} desc={t("Temporarily stop recording new copies")}>
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
        <Row label={t("Paste as plain text by default")} desc={t("Strip formatting when pasting rich content")}>
          <Toggle on={settings.alwaysPlainText} onChange={(v) => update({ alwaysPlainText: v })} />
        </Row>
        <Row label={t("Appearance")} desc={t("Panel theme")}>
          <select
            value={settings.theme ?? "system"}
            onChange={(e) => update({ theme: e.target.value })}
          >
            <option value="system">{t("System")}</option>
            <option value="dark">{t("Dark")}</option>
            <option value="light">{t("Light")}</option>
          </select>
        </Row>
        <Row
          label={t("Panel position")}
          desc={t("Vertical placement — always on the screen you're working on")}
        >
          <select
            value={settings.panelPosition || "center"}
            onChange={(e) => update({ panelPosition: e.target.value })}
          >
            <option value="center">{t("Center of screen")}</option>
            <option value="top">{t("Top of screen")}</option>
            <option value="bottom">{t("Bottom of screen")}</option>
          </select>
        </Row>
        <Row label={t("Wheel direction")} desc={t("Mouse wheel over the history cards")}>
          <select
            value={settings.wheelDirection || "default"}
            onChange={(e) => update({ wheelDirection: e.target.value })}
          >
            <option value="default">{t("Down = browse older (scroll right)")}</option>
            <option value="natural">{t("Down = browse newer (scroll left)")}</option>
          </select>
        </Row>
      </section>

      <section className="settings-section">
        <h2>{t("Tray icon")}</h2>
        <div className="tray-grid">
          {trayIcons.map((ti) => (
            <button
              key={ti.id}
              className={`tray-option ${(settings.trayIcon || "classic") === ti.id ? "active" : ""}`}
              title={ti.id}
              onClick={() => update({ trayIcon: ti.id })}
            >
              <img src={`data:image/png;base64,${ti.pngBase64}`} alt={ti.id} draggable={false} />
              <span>{ti.id}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("Shortcuts")}</h2>
        <Row label={t("Open Paste")} desc={t("Global shortcut to show or hide the clipboard panel")}>
          {recording ? (
            <input
              className="hotkey-box recording"
              value={t("Press keys… (include a modifier)")}
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
              {settings.hotkey.replace("CmdOrCtrl", modLabel)}
            </button>
          )}
        </Row>
        <Row
          label={t("Quick paste shortcuts")}
          desc={t(`${modLabel}+1…9 paste the most recent clips without opening the panel`)}
        >
          <Toggle on={settings.quickPaste} onChange={(v) => update({ quickPaste: v })} />
        </Row>
      </section>

      <section className="settings-section">
        <h2>{t("History")}</h2>
        <Row label={t("Keep at most")} desc={t("Oldest unpinned clips are removed beyond this limit")}>
          <select
            value={String(settings.maxClips)}
            onChange={(e) => update({ maxClips: Number(e.target.value) })}
          >
            <option value="0">{t("Unlimited")}</option>
            <option value="100">{t("100 clips")}</option>
            <option value="500">{t("500 clips")}</option>
            <option value="1000">{t("1000 clips")}</option>
            <option value="5000">{t("5000 clips")}</option>
          </select>
        </Row>
        <div className="settings-actions">
          {confirmingClear ? (
            <>
              <span className="confirm-inline-msg">{t("Clear all history? Pinned items are kept.")}</span>
              <button
                className="btn danger"
                onClick={() => {
                  api.clearHistory();
                  setConfirmingClear(false);
                }}
              >
                {t("Confirm")}
              </button>
              <button className="btn" onClick={() => setConfirmingClear(false)}>
                {t("Cancel")}
              </button>
            </>
          ) : (
            <button className="btn danger" onClick={() => setConfirmingClear(true)}>
              {t("Clear History")}
            </button>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("Excluded Apps")}</h2>
        <div className="setting-row" style={{ paddingBottom: 0 }}>
          <div className="setting-label">
            {t("Copies made inside these apps are never recorded")}
            <span className="desc">
              {isMac
                ? t("Use the app's executable name, e.g. 1password")
                : t("Use the executable file name, e.g. 1password.exe")}
            </span>
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
            placeholder={isMac ? "1password" : "app.exe"}
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
            {t("Add")}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("Pinboards")}</h2>
        <div className="excluded-list">
          {pinboards.map((p) => (
            <span className="excluded-chip" key={p.id}>
              {p.name}
              {pendingDelBoard === p.id ? (
                <span className="confirm-inline">
                  <button
                    className="yes"
                    title={t("Delete — clips return to history")}
                    onClick={() => {
                      api.deletePinboard(p.id).then(() => {
                        setPinboards((bs) => bs.filter((b) => b.id !== p.id));
                      });
                      setPendingDelBoard(null);
                    }}
                  >
                    ✓
                  </button>
                  <button className="no" title={t("Cancel")} onClick={() => setPendingDelBoard(null)}>
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
              {t("Create pinboards from the panel sidebar.")}
            </span>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h2>{t("About")}</h2>
        <div className="about-head">
          <img src="/app-icon.png" alt="Paste" className="about-icon" />
          <div>
            <div className="about-name">Paste for Windows</div>
            <div className="about-version">Version {version}</div>
          </div>
        </div>
        <Row label={t("Build")} desc={t("Compiler profile this binary was built with")}>
          <span className="about-value">
            {import.meta.env.TAURI_ENV_DEBUG === "true" ? "Debug (dev)" : "Release (optimized)"}
          </span>
        </Row>
        <Row label={t("Built at")} desc={t("Timestamp of this build")}>
          <span className="about-value">{formatBuildDate(__BUILD_DATE__)}</span>
        </Row>
        <Row label={t("Commit")} desc={t("Source revision this build was produced from")}>
          <span className="about-value mono">{__GIT_SHA__}</span>
        </Row>
        <Row label={t("Platform")} desc={t("Operating system and CPU architecture")}>
          <span className="about-value">
            {import.meta.env.TAURI_ENV_OS || "windows"}{" "}
            {import.meta.env.TAURI_ENV_PLATFORM_VERSION || ""} ·{" "}
            {import.meta.env.TAURI_ENV_ARCH || "x86_64"}
          </span>
        </Row>
      </section>

      <p style={{ color: "var(--text-faint)", fontSize: 11.5 }}>
        {t("Inspired by Paste for macOS.")}
        {t("Data stays on this machine.")}
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
/// Requires at least one modifier — an unmodified global hotkey would hijack
/// that key system-wide.
function comboFromEvent(e: React.KeyboardEvent): string | null {
  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  if (!(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("CmdOrCtrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let name = key.length === 1 ? key.toUpperCase() : key;
  if (name === " ") name = "Space";
  parts.push(name);
  return parts.join("+");
}
