/** Return the next valid card index for a keyboard movement. */
export function moveSelection(current, delta, count) {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, current + delta));
}
