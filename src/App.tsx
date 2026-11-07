import { useEffect } from "react";
import { useStore } from "./store/useStore";
import { api, events } from "./lib/api";
import ClipboardPanel from "./components/ClipboardPanel";
import { scrollToCard } from "./lib/cardScroll";

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
      if (
        (e.key === "ArrowUp" || e.key === "ArrowDown") &&
        !inSearch &&
        !detailOpen
      ) {
        // Vertical arrows cycle the sidebar views: History, then pinboards
        // in display order — switching pinboards without the mouse.
        e.preventDefault();
        const { pinboards, view } = s;
        const views: Array<{ type: "history" } | { type: "board"; id: number }> = [
          { type: "history" },
          ...pinboards.map((p) => ({ type: "board" as const, id: p.id })),
        ];
        const cur =
          view.type === "board" ? 1 + pinboards.findIndex((p) => p.id === view.id) : 0;
        const next = (cur + (e.key === "ArrowDown" ? 1 : -1) + views.length) % views.length;
        s.setView(views[next]);
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
        useStore.setState({ navMode: true });
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
      if (
        !inSearch &&
        !onOtherInput &&
        (e.key === "Delete" || (mod && (e.key === "d" || e.key === "D")))
      ) {
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
      if (e.key === "/" && !inSearch && !onOtherInput) {
        // explicit: focus the search box ("/" is the conventional shortcut)
        e.preventDefault();
        useStore.setState({ navMode: false });
        document.querySelector<HTMLInputElement>(".search-input")?.focus();
        return;
      }
      // Single characters fall into search ONLY in search mode. After
      // arrows/wheel selected a card (navMode), letters and Space belong to
      // the cards — typing must not hijack focus into the search box.
      if (
        !s.navMode &&
        !inSearch &&
        !onOtherInput &&
        e.key.length === 1 &&
        !mod &&
        !e.altKey
      ) {
        // start typing anywhere → close the preview and jump into search
        if (detailOpen) s.closeDetail();
        useStore.setState({ navMode: false });
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

