import { useStore } from "../store/useStore";
import { isMac, modLabel } from "../lib/platform";
import SearchBar from "./SearchBar";
import Sidebar from "./Sidebar";
import CardStrip from "./CardStrip";
import ContentDetail from "./ContentDetail";
import { useT } from "../i18n";

export default function ClipboardPanel() {
  const t = useT();
  const paused = useStore((s) => s.paused);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const theme = settings?.theme ?? "system";
  const detailClipId = useStore((s) => s.detailClipId);
  const detailClip = useStore((s) => s.clips.find((c) => c.id === s.detailClipId)) ?? null;

  return (
    <div
      className="panel"
      data-theme={theme === "system" ? undefined : theme}
      data-platform={isMac ? "mac" : "windows"}
    >
      <div className="panel-body">
        <Sidebar />
        <div className="panel-main">
          <SearchBar />
          {paused && (
            <div className="paused-banner">
              {t("Clipboard history is paused — new copies are not being recorded.")}
            </div>
          )}
          <CardStrip />
          <footer className="panel-footer">
            {detailClip ? (
              <>
                <span className="hint"><kbd>↑</kbd><kbd>↓</kbd> {t("Scroll")}</span>
                <span className="hint"><kbd>←</kbd><kbd>→</kbd> {t("Browse")}</span>
                <span className="hint"><kbd>Space</kbd>/<kbd>Esc</kbd> {t("Close")}</span>
                <span className="hint"><kbd>Enter</kbd> {t("Paste")}</span>
                <span className="hint"><kbd>{modLabel}</kbd>+<kbd>Enter</kbd> {t("Plain")}</span>
              </>
            ) : (
              <>
                <span className="hint"><kbd>←</kbd><kbd>→</kbd> {t("Navigate")}</span>
                <span className="hint"><kbd>Space</kbd> {t("Full content")}</span>
                <span className="hint"><kbd>Enter</kbd> {t("Paste")}</span>
                <span className="hint"><kbd>{modLabel}</kbd>+<kbd>Enter</kbd> {t("Plain")}</span>
                <span className="hint"><kbd>{modLabel}</kbd>+<kbd>P</kbd> {t("Pin")}</span>
                <span className="hint"><kbd>Del</kbd> {t("Delete")}</span>
                <span className="hint"><kbd>Tab</kbd> {t("Filter")}</span>
                <span className="hint"><kbd>Esc</kbd> {t("Close")}</span>
              </>
            )}
          </footer>
        </div>
      </div>
      {detailClip && <ContentDetail clip={detailClip} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
