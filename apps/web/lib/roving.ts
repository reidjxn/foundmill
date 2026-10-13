/**
 * Roving focus for a group of options that is one Tab stop (the ARIA radio-group pattern, audit A11Y-20): the arrow
 * keys move focus between the options, Home and End jump to the ends, and Tab leaves the group. Pure, so it is
 * unit-tested; components keep the focused option as their tab stop.
 */

/** The option the arrow/Home/End key moves focus to, or null when the key does not move it. Arrows wrap around. */
export function nextRovingIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The one option that is in the Tab order: the one last focused when it is still there, else the selected one, else the
 * first. Every other option is reachable by the arrow keys only (tabIndex -1).
 */
export function rovingTabStop(ids: readonly string[], focusedId: string | null, selectedId: string | null): string | null {
  if (focusedId && ids.includes(focusedId)) return focusedId;
  if (selectedId && ids.includes(selectedId)) return selectedId;
  return ids[0] ?? null;
}
