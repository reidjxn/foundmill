"use client";
import { useLayoutEffect, useRef } from "react";

/**
 * The top bar's compaction steps, in the order they apply (DESIGN §8 "never clip"):
 *
 * 1. `chips-brief`: the chips drop their long words (the mode chip's "Asks before spending over £50" becomes "Asks over
 *    £50"; `KITBAR_BRIEF_ONLY_CLASS`), and the runway chip its second phrase (the runway chip's
 *    "· connect a bank"; `KITBAR_BRIEF_CLASS` in ModeChip.tsx). Unlike the later steps it applies as soon as the search
 *    is below its whole width, so the extra words never cost the search its placeholder: they are the first thing to go.
 * 2. `year`: dates drop the current year ("Oct 10", "On vacation until Oct 21"); the tooltips keep it.
 * 3. `holiday-short`: the vacation caption says "Until Oct 21".
 * 4. `holiday-icon`: the vacation caption is its palm icon (the caption stays in the tooltip and for screen readers).
 * 5. `chips-icon`: LIVE and the business mode show their icons only (their labels and tooltips keep the words).
 * 6. `date-none`: the date leaves the runway chip; the runway stays.
 *
 * Steps 2 to 6 apply once the search is down to its icon and the bar still does not hold everything whole. The steps are
 * cumulative: step 4 keeps 1 to 3. Each is a token in the bar's `data-compact` attribute, which CSS (shell.css,
 * kitbar-*, and the brief class) reads.
 */
export const KITBAR_COMPACT_STEPS = ["chips-brief", "year", "holiday-short", "holiday-icon", "chips-icon", "date-none"] as const;
export type KitBarCompactStep = (typeof KITBAR_COMPACT_STEPS)[number];

/** The screen title keeps at least this much width (or its natural width, if less) before the chips give way. */
export const KITBAR_TITLE_MIN_WIDTH = 120;
/** The search's whole width (shell.css `--kitbar-search`), the fallback when the stylesheet cannot be read. */
export const KITBAR_SEARCH_FULL_WIDTH = 320;

/** True when nothing in the bar is pushed past its edge and the screen title has its room. Exported for tests. */
export function kitBarFits(bar: HTMLElement): boolean {
  if (bar.scrollWidth > bar.clientWidth + 1) return false;
  const title = bar.querySelector<HTMLElement>("[data-testid='kitbar-screen-title']");
  if (!title) return true;
  const ghost = title.querySelector<HTMLElement>(".fit-ghost");
  const natural = ghost ? ghost.scrollWidth : title.scrollWidth;
  const need = Math.min(natural, KITBAR_TITLE_MIN_WIDTH);
  return title.getBoundingClientRect().width + 0.5 >= need;
}

/** The search's whole width: its CSS max-width (the `--kitbar-search` token), else the fallback. Exported for tests. */
export function kitBarSearchFullWidth(search: HTMLElement): number {
  const max = typeof getComputedStyle === "function" ? Number.parseFloat(getComputedStyle(search).maxWidth) : Number.NaN;
  return Number.isFinite(max) && max > 0 ? max : KITBAR_SEARCH_FULL_WIDTH;
}

/**
 * `kitBarSearchFullWidth`, read once per search element and kept until `clear` (the bar calls it when it resizes), so
 * a change of words in the bar costs no style read. Exported for tests.
 */
export function createSearchWidthCache(read: (search: HTMLElement) => number = kitBarSearchFullWidth): {
  get: (search: HTMLElement) => number;
  clear: () => void;
} {
  let held: { search: HTMLElement; width: number } | null = null;
  return {
    get: (search) => {
      if (held?.search !== search) held = { search, width: read(search) };
      return held.width;
    },
    clear: () => {
      held = null;
    },
  };
}

/**
 * True when the search has its whole width, so the chips may carry their second phrase (the widest step). A bar
 * without a search is roomy by definition. Exported for tests.
 */
export function kitBarIsRoomy(bar: HTMLElement, fullWidth: (search: HTMLElement) => number = kitBarSearchFullWidth): boolean {
  const search = bar.querySelector<HTMLElement>("[data-testid='kitbar-search']");
  if (!search) return true;
  return search.getBoundingClientRect().width + 0.5 >= fullWidth(search);
}

/** Writes the step tokens for `level` (0 = none) on the bar. */
export function setKitBarCompact(bar: HTMLElement, level: number): void {
  if (level <= 0) bar.removeAttribute("data-compact");
  else bar.setAttribute("data-compact", KITBAR_COMPACT_STEPS.slice(0, level).join(" "));
}

/**
 * Fit the bar: start whole; drop the chips' second phrase as soon as the search is squeezed or anything overflows; then
 * apply one step at a time until everything fits (each step is one synchronous layout). Returns the level used.
 * Exported for tests.
 */
export function fitKitBar(bar: HTMLElement, fits: (bar: HTMLElement) => boolean = kitBarFits, roomy: (bar: HTMLElement) => boolean = kitBarIsRoomy): number {
  let level = 0;
  setKitBarCompact(bar, 0);
  if (!roomy(bar) || !fits(bar)) {
    level = 1;
    setKitBarCompact(bar, level);
  }
  while (level < KITBAR_COMPACT_STEPS.length && !fits(bar)) {
    level += 1;
    setKitBarCompact(bar, level);
  }
  return level;
}

/**
 * Rendered inside the KitBar (a hidden probe): fits its parent bar now, whenever the bar resizes (window, sidebar), and
 * whenever its words change (title, Continue's state, a chip). The bar's own element keeps the attribute; React never
 * renders it, so the two never fight.
 */
export function KitBarFit() {
  const probe = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const bar = probe.current?.parentElement;
    if (!bar) return;
    // The search's whole width is read once and again only after a resize, never on a change of words.
    const searchWidth = createSearchWidthCache();
    const roomy = (b: HTMLElement) => kitBarIsRoomy(b, searchWidth.get);
    const run = () => {
      fitKitBar(bar, kitBarFits, roomy);
    };
    const rerun = () => {
      searchWidth.clear();
      run();
    };
    run();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(rerun);
    ro?.observe(bar);
    // Text and structure only: the attribute writes above are not observed, so fitting never re-triggers itself.
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(run);
    mo?.observe(bar, { childList: true, subtree: true, characterData: true });
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", rerun);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      fonts?.removeEventListener?.("loadingdone", rerun);
    };
  }, []);
  return <span ref={probe} hidden aria-hidden data-kitbar-fit="" />;
}
