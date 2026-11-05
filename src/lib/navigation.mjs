/** Return the next valid card index for a keyboard movement. */
export function moveSelection(current, delta, count) {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, current + delta));
}

/** Keep the card and its visual outline inside the horizontal viewport. */
export function scrollTarget(current, viewport, left, width, maxScroll, padding = 12) {
  let target = current;
  if (left - padding < current) target = left - padding;
  else if (left + width + padding > current + viewport) target = left + width + padding - viewport;
  return Math.max(0, Math.min(maxScroll, target));
}
