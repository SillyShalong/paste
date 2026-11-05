import { useEffect } from "react";
import { useStore } from "./store/useStore";
import { api, events } from "./lib/api";
import ClipboardPanel from "./components/ClipboardPanel";
import { scrollTarget } from "./lib/navigation.mjs";

export default function App() {
  const init = useStore((s) => s.init);
  const store = useStore;

  useEffect(() => {
    init();
    const unlisteners = [
      events.onNewClip((clip) => store.getState().addClip(clip)),
      events.onPanelOpened(() => {
        const s = store.getState();
        if (s.query) s.setQuery("");
        s.setSel(0);
        s.closeDetail();
        // Focus intentionally stays OFF the search input so Space toggles
        // the full-content preview; typing any other character jumps into search.
      }),
      events.onPauseChanged((paused) => useStore.setState({ paused })),
      events.onSettingsChanged((settings) => useStore.setState({ settings })),
    ];
    return () => unlisteners.forEach((p) => p.then((off) => off()));
  }, []);

  // Global keyboard handling for the panel window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // let the IME consume keys while composing Chinese input
      if (e.isComposing || e.keyCode === 229) return;
      const s = store.getState();
      const detailOpen = s.detailClipId != null;
      const inSearch =
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.classList.contains("search-input");
      // The user is typing inside another input (pinboard naming, etc.) —
      // that input handles its own keys; don't hijack them for the panel.
      const onOtherInput =
        e.target instanceof HTMLInputElement && !inSearch;

      if (e.key === "Escape") {
        e.preventDefault();
        if (detailOpen) {
          s.closeDetail();
        } else if (!onOtherInput) {
          api.hidePanel();
        }
        return;
      }
      if (onOtherInput) {
        return;
      }
      // Primary modifier: Ctrl on Windows/Linux, Cmd on macOS.
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        s.toggleSidebar();
        return;
      }
      if (e.key === " " && !inSearch) {
        // Space toggles the full-content preview for the selected card
        e.preventDefault();
        if (detailOpen) {
          s.closeDetail();
        } else {
          s.openDetail();
        }
        return;
      }
      if (detailOpen && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) {
        // the preview is open: vertical keys scroll its content
        e.preventDefault();
        scrollDetail(e.key);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (inSearch) {
          // let the caret move; only navigate when at the edge
          const el = document.activeElement as HTMLInputElement;
          // Arrow keys first collapse an existing text selection.
          if (el.selectionStart !== el.selectionEnd) return;
          const atStart = el.selectionStart === 0;
          const atEnd = el.selectionStart === el.value.length;
          if (e.key === "ArrowLeft" && !atStart) return;
          if (e.key === "ArrowRight" && !atEnd) return;
        }
        e.preventDefault();
        const sel = s.moveSel(e.key === "ArrowLeft" ? -1 : 1);
        if (detailOpen) {
          // keep the preview in sync while browsing cards
          const clip = store.getState().clips[sel];
          if (clip) useStore.setState({ detailClipId: clip.id });
          else s.closeDetail();
        }
        scrollToCard(sel);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        s.paste(mod);
        return;
      }
      if (mod && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        s.pinSelected();
        return;
      }
      if (e.key === "Delete" || (mod && (e.key === "d" || e.key === "D"))) {
        e.preventDefault();
        s.deleteClip();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const chips = ["all", "text", "link", "image", "file", "color"] as const;
        const cur = chips.indexOf(s.kindFilter);
        const next = chips[(cur + (e.shiftKey ? chips.length - 1 : 1)) % chips.length];
        s.setKindFilter(next);
        return;
      }
      if (!inSearch && !onOtherInput && e.key.length === 1 && !mod && !e.altKey) {
        // start typing anywhere → close the preview and jump into search
        if (detailOpen) s.closeDetail();
        document.querySelector<HTMLInputElement>(".search-input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <ClipboardPanel />;
}

function scrollDetail(key: string) {
  const el = document.querySelector<HTMLElement>(".detail-content");
  if (!el) return;
  switch (key) {
    case "ArrowDown": el.scrollBy({ top: 80 }); break;
    case "ArrowUp": el.scrollBy({ top: -80 }); break;
    case "PageDown": el.scrollBy({ top: 400 }); break;
    case "PageUp": el.scrollBy({ top: -400 }); break;
    case "Home": el.scrollTop = 0; break;
    case "End": el.scrollTop = el.scrollHeight; break;
  }
}

let scrollFrame = 0;
let destination = 0;
let lastFrameTime = 0;

export function scrollToCard(index: number) {
  requestAnimationFrame(() => {
    // Ignore a queued scroll if a newer key press changed the selection.
    if (useStore.getState().sel !== index) return;
    const el = document.querySelector<HTMLElement>(`[data-card-index="${index}"]`);
    const row = el?.closest<HTMLElement>(".cards-row");
    if (!el || !row) return;
    const base = scrollFrame ? destination : row.scrollLeft;
    destination = scrollTarget(base, row.clientWidth, el.offsetLeft, el.offsetWidth, row.scrollWidth - row.clientWidth);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
      row.scrollLeft = destination;
      return;
    }
    if (scrollFrame) return;
    lastFrameTime = 0;
    const tick = (time: number) => {
      if (!row.isConnected) {
        scrollFrame = 0;
        return;
      }
      destination = Math.max(0, Math.min(destination, row.scrollWidth - row.clientWidth));
      const elapsed = lastFrameTime ? Math.min(time - lastFrameTime, 50) : 16;
      lastFrameTime = time;
      const remaining = destination - row.scrollLeft;
      if (Math.abs(remaining) < 1) {
        row.scrollLeft = destination;
        scrollFrame = 0;
      } else {
        row.scrollLeft += remaining * (1 - Math.exp(-elapsed / 75));
        scrollFrame = requestAnimationFrame(tick);
      }
    };
    scrollFrame = requestAnimationFrame(tick);
  });
}
