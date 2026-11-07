import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../i18n";

/// First-run onboarding window (macOS): walks the user through the
/// Accessibility permission with a deep link to the exact settings pane and
/// a live grant check. Closes itself once the permission is granted and the
/// user confirms.
export default function OnboardingApp() {
  const t = useT();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .pastePermissionGranted()
        .then((v) => alive && setGranted(v))
        .catch(() => {});
    check();
    const timer = setInterval(check, 1200);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const step = (n: number, title: string, body: React.ReactNode, extra?: React.ReactNode) => (
    <div className="onb-step">
      <div className="onb-num">{n}</div>
      <div className="onb-body">
        <div className="onb-title">{title}</div>
        {body && <div className="onb-desc">{body}</div>}
        {extra}
      </div>
    </div>
  );

  return (
    <div className="onb-root">
      <img src="/app-icon.png" alt="Paste" className="onb-icon" />
      <h1 className="onb-heading">{t("Welcome to Paste")}</h1>
      <p className="onb-lead">{t("Everything you copy, saved locally and one keystroke away.")}</p>

      {step(
        1,
        t("Copying is captured automatically"),
        t("Text, links, images, files and colors — no action needed."),
      )}

      {step(
        2,
        t("Allow pasting (Accessibility permission)"),
        t(
          "macOS needs permission before Paste can type into other apps. Tap the button — Paste is added to the Accessibility list automatically; switch it on there.",
        ),
        <div className="onb-actions">
          <button
            className="onb-btn primary"
            onClick={() => api.requestAccessibilityPermission()}
          >
            {t("Request Accessibility Permission")}
          </button>
          <button className="onb-btn" onClick={() => api.openAccessibilitySettings()}>
            {t("Open System Settings")}
          </button>
          <span className={`onb-badge ${granted ? "ok" : granted === false ? "pending" : ""}`}>
            {granted === null
              ? t("Checking…")
              : granted
                ? t("Granted ✓")
                : t("Not granted yet")}
          </span>
        </div>,
      )}

      {step(
        3,
        t("Open the panel with Cmd+Shift+V"),
        t("Or click the Paste icon in the menu bar. Enter pastes, Space previews, Esc closes."),
      )}

      {granted && (
        <button className="onb-btn primary onb-done" onClick={() => setDone(true)}>
          {t("Granted ✓ — start using Paste")}
        </button>
      )}

      {done ? (
        <div className="onb-final">
          <p>{t("You're all set. Press Cmd+Shift+V anywhere and pick a card.")}</p>
          <button className="onb-btn primary" onClick={() => api.closeWindow("onboarding")}>
            {t("Finish")}
          </button>
        </div>
      ) : (
        <button className="onb-later" onClick={() => api.closeWindow("onboarding")}>
          {t("I'll do this later")}
        </button>
      )}
    </div>
  );
}
