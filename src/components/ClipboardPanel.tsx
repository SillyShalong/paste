import { useStore } from "../store/useStore";
import SearchBar from "./SearchBar";
import Sidebar from "./Sidebar";
import CardStrip from "./CardStrip";
import ContentDetail from "./ContentDetail";

export default function ClipboardPanel() {
  const paused = useStore((s) => s.paused);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const theme = settings?.theme ?? "system";
  const detailClipId = useStore((s) => s.detailClipId);
  const detailClip = useStore((s) => s.clips.find((c) => c.id === s.detailClipId)) ?? null;

  return (
    <div className="panel" data-theme={theme === "system" ? undefined : theme}>
      <div className="panel-body">
        <Sidebar />
        <div className="panel-main">
          <SearchBar />
          {paused && (
            <div className="paused-banner">
              Clipboard history is paused — new copies are not being recorded.
            </div>
          )}
          <CardStrip />
          <footer className="panel-footer">
            {detailClip ? (
              <>
                <span className="hint"><kbd>↑</kbd><kbd>↓</kbd> Scroll</span>
                <span className="hint"><kbd>←</kbd><kbd>→</kbd> Browse</span>
                <span className="hint"><kbd>Space</kbd>/<kbd>Esc</kbd> Close</span>
                <span className="hint"><kbd>Enter</kbd> Paste</span>
                <span className="hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> Plain</span>
              </>
            ) : (
              <>
                <span className="hint"><kbd>←</kbd><kbd>→</kbd> Navigate</span>
                <span className="hint"><kbd>Space</kbd> Full content</span>
                <span className="hint"><kbd>Enter</kbd> Paste</span>
                <span className="hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> Plain</span>
                <span className="hint"><kbd>Ctrl</kbd>+<kbd>P</kbd> Pin</span>
                <span className="hint"><kbd>Del</kbd> Delete</span>
                <span className="hint"><kbd>Tab</kbd> Filter</span>
                <span className="hint"><kbd>Esc</kbd> Close</span>
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
