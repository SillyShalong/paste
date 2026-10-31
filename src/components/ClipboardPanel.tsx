import { useStore } from "../store/useStore";
import SearchBar from "./SearchBar";
import Sidebar from "./Sidebar";
import CardStrip from "./CardStrip";

export default function ClipboardPanel() {
  const paused = useStore((s) => s.paused);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const theme = settings?.theme ?? "system";

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
            <span className="hint"><kbd>←</kbd><kbd>→</kbd> Navigate</span>
            <span className="hint"><kbd>Enter</kbd> Paste</span>
            <span className="hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> Paste as Plain Text</span>
            <span className="hint"><kbd>Ctrl</kbd>+<kbd>P</kbd> Pin</span>
            <span className="hint"><kbd>Del</kbd> Delete</span>
            <span className="hint"><kbd>Tab</kbd> Filter</span>
            <span className="hint"><kbd>Esc</kbd> Close</span>
          </footer>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
