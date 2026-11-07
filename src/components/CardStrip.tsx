import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";
import { osName } from "../lib/platform";
import { cancelCardScrollAnimation, isProgrammaticScroll } from "../lib/cardScroll";
import ClipboardCard from "./ClipboardCard";
import { useT } from "../i18n";

export default function CardStrip() {
  const clips = useStore((s) => s.clips);
  const sel = useStore((s) => s.sel);
  const query = useStore((s) => s.query);
  const wheelDirection = useStore((s) => s.settings?.wheelDirection || "default");
  // Cancel handle for the keyboard scroll animation + scroll-listener
  // detach (set on .cards-row).
  const rowRef = useRef<HTMLDivElement | null>(null);
  const detachScroll = useRef<(() => void) | null>(null);

  // Trackpad/native scrolling must move the keyboard selection WITH the
  // viewport: without this, pressing → after a swipe teleports the strip
  // back to wherever the stale selection was. The card nearest the left
  // edge of the viewport becomes the selected one.
  const syncSelectionToView = () => {
    if (isProgrammaticScroll()) return; // keyboard animation owns the scroll
    const row = rowRef.current;
    if (!row) return;
    let best = 0;
    let bestDist = Infinity;
    row.querySelectorAll<HTMLElement>("[data-card-index]").forEach((c) => {
      const d = Math.abs(c.offsetLeft - row.scrollLeft);
      if (d < bestDist) {
        bestDist = d;
        best = Number(c.dataset.cardIndex);
      }
    });
    if (useStore.getState().sel !== best) useStore.setState({ sel: best });
  };

  // Ref callback: the row mounts only once the first clip arrives, and can
  // unmount/remount on filter changes — (re)attach the listener each time.
  const attachRow = (el: HTMLDivElement | null) => {
    detachScroll.current?.();
    detachScroll.current = null;
    rowRef.current = el;
    if (el) {
      const onScroll = () => {
        if (isProgrammaticScroll()) return; // keyboard animation owns it
        cancelCardScrollAnimation(); // user took over — stop the animation
        useStore.setState({ navMode: true }); // keys now drive the cards
        syncSelectionToView();
      };
      el.addEventListener("scroll", onScroll, { passive: true });
      detachScroll.current = () => el.removeEventListener("scroll", onScroll);
    }
  };

  useEffect(() => () => detachScroll.current?.(), []);

  if (clips.length === 0) {
    return (
      <div className="card-strip empty">
        <EmptyState query={query} />
      </div>
    );
  }

  return (
    <div className="card-strip">
      <div
        ref={attachRow}
        className="cards-row"
        onWheel={(e) => {
          // User took over scrolling — stop the keyboard scroll animation,
          // otherwise it drags scrollLeft back toward the selected card and
          // the strip jitters instead of scrolling (trackpad pans also fire
          // wheel events on macOS, covering momentum here). The resulting
          // scroll event re-syncs the selection to the visible card.
          cancelCardScrollAnimation();
          useStore.setState({ navMode: true }); // keys now drive the cards
          // vertical wheel scrolls the horizontal history strip; trackpad
          // horizontal swipes (deltaX) pass through natively
          const el = e.currentTarget;
          const dy =
            e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY;
          const dir = wheelDirection === "natural" ? -1 : 1;
          el.scrollLeft += (dy + e.deltaX) * dir;
        }}
      >
        {clips.map((clip, i) => (
          <ClipboardCard key={clip.id} clip={clip} index={i} selected={i === sel} />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  const t = useT();
  return (
    <div className="empty-state">
      <ClipboardGlyph />
      <h2>{query ? t("No matches found") : t("Your clipboard history is empty")}</h2>
      <p>
        {query
          ? t("No matches found")
          : t(`Copy something anywhere in ${osName} and it will show up here instantly.`)}
      </p>
    </div>
  );
}

function ClipboardGlyph() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <rect x="9" y="2" width="6" height="4" rx="1.4" fill="currentColor" stroke="none" opacity="0.9" />
      <line x1="8.5" y1="10" x2="15.5" y2="10" strokeLinecap="round" />
      <line x1="8.5" y1="13.5" x2="15.5" y2="13.5" strokeLinecap="round" />
      <line x1="8.5" y1="17" x2="12.5" y2="17" strokeLinecap="round" />
    </svg>
  );
}
