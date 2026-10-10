"use client";
import { useLayoutEffect, useRef } from "react";

/**
 * The top bar's compaction steps, in the order they apply once the search is down to its icon and the bar still does
 * not hold everything whole (DESIGN §8 "never clip"):
 *
 * 1. `year`: dates drop the current year ("10 Oct", "On holiday until 21 Oct"); the tooltips keep it.
 * 2. `holiday-short`: the holiday caption says "Until 21 Oct".
 * 3. `holiday-icon`: the holiday caption is its palm icon (the caption stays in the tooltip and for screen readers).
 * 4. `chips-icon`: LIVE and the business mode show their icons only (their labels and tooltips keep the words).
 * 5. `date-none`: the date leaves the runway chip; the runway stays.
 *
 * The steps are cumulative: step 3 keeps 1 and 2. Each is a token in the bar's `data-compact` attribute, which CSS
 * (shell.css, kitbar-*) reads.
 */
export const KITBAR_COMPACT_STEPS = ["year", "holiday-short", "holiday-icon", "chips-icon", "date-none"] as const;
export type KitBarCompactStep = (typeof KITBAR_COMPACT_STEPS)[number];

/** The screen title keeps at least this much width (or its natural width, if less) before the chips give way. */
export const KITBAR_TITLE_MIN_WIDTH = 120;

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

/** Writes the step tokens for `level` (0 = none) on the bar. */
export function setKitBarCompact(bar: HTMLElement, level: number): void {
  if (level <= 0) bar.removeAttribute("data-compact");
  else bar.setAttribute("data-compact", KITBAR_COMPACT_STEPS.slice(0, level).join(" "));
}

/**
 * Fit the bar: start whole and apply one step at a time until everything fits (each step is one synchronous layout).
 * Returns the level used. Exported for tests.
 */
export function fitKitBar(bar: HTMLElement, fits: (bar: HTMLElement) => boolean = kitBarFits): number {
  let level = 0;
  setKitBarCompact(bar, 0);
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
    const run = () => {
      fitKitBar(bar);
    };
    run();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(run);
    ro?.observe(bar);
    // Text and structure only: the attribute writes above are not observed, so fitting never re-triggers itself.
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(run);
    mo?.observe(bar, { childList: true, subtree: true, characterData: true });
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", run);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      fonts?.removeEventListener?.("loadingdone", run);
    };
  }, []);
  return <span ref={probe} hidden aria-hidden data-kitbar-fit="" />;
}
