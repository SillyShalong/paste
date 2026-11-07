// Scroll engine for the card strip: animated keep-selected-visible for
// keyboard navigation, with user-scroll takeover. A native scroll event that
// isn't ours (trackpad pan, wheel) cancels the animation — otherwise the
// loop fights the user's fingers and the strip jitters instead of scrolling.
import { scrollTarget } from "./navigation.mjs";
import { useStore } from "../store/useStore";

let scrollFrame = 0;
let destination = 0;
let lastFrameTime = 0;
let lastProgrammaticAt = 0;

/** True within ~80ms of the engine writing scrollLeft itself. */
export function isProgrammaticScroll(): boolean {
  return performance.now() - lastProgrammaticAt < 80;
}

/** Stop an in-flight keyboard scroll animation (user took over). */
export function cancelCardScrollAnimation(): void {
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
}

function markProgrammatic(): void {
  lastProgrammaticAt = performance.now();
}

export function scrollToCard(index: number): void {
  requestAnimationFrame(() => {
    // Superseded by a newer key press — the newest call will retarget.
    if (useStore.getState().sel !== index) return;
    const el = document.querySelector<HTMLElement>(`[data-card-index="${index}"]`);
    const row = el?.closest<HTMLElement>(".cards-row");
    if (!el || !row) return;
    const base = scrollFrame ? destination : row.scrollLeft;
    destination = scrollTarget(
      base,
      row.clientWidth,
      el.offsetLeft,
      el.offsetWidth,
      row.scrollWidth - row.clientWidth,
    );
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelCardScrollAnimation();
      markProgrammatic();
      row.scrollLeft = destination;
      return;
    }
    if (scrollFrame) return; // already ticking — it steers to the new destination
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
        markProgrammatic();
        row.scrollLeft = destination;
        scrollFrame = 0;
      } else {
        markProgrammatic();
        row.scrollLeft += remaining * (1 - Math.exp(-elapsed / 75));
        scrollFrame = requestAnimationFrame(tick);
      }
    };
    scrollFrame = requestAnimationFrame(tick);
  });
}
