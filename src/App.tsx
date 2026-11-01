import { useEffect, useRef } from "react";
import { useStore } from "./store/useStore";
import { api, events } from "./lib/api";
import ClipboardPanel from "./components/ClipboardPanel";

export default function App() {
  const init = useStore((s) => s.init);
  const addClip = useStore((s) => s.addClip);
  const store = useStore;
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    init();
    events.onNewClip((clip) => store.getState().addClip(clip));
    events.onPanelOpened(() => {
      const s = store.getState();
      if (s.query) s.setQuery("");
      s.setSel(0);
      s.closeDetail();
      requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>(".search-input")?.focus();
      });
    });
    events.onPauseChanged((paused) => useStore.setState({ paused }));
    events.onSettingsChanged((settings) => useStore.setState({ settings }));
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

      if (e.key === "Escape") {
        e.preventDefault();
        if (detailOpen) {
          s.closeDetail();
        } else {
          api.hidePanel();
        }
        return;
      }
      if (e.ctrlKey && (e.key === "b" || e.key === "B")) {
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
        s.paste(e.ctrlKey);
        return;
      }
      if (e.ctrlKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        s.pinSelected();
        return;
      }
      if (e.key === "Delete" || (e.ctrlKey && (e.key === "d" || e.key === "D"))) {
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
      if (!inSearch && e.key.length === 1 && !e.ctrlKey && !e.altKey) {
        // start typing anywhere → jump into the search box
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

export function scrollToCard(index: number) {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-card-index="${index}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  });
}
