"use client";
import { useSyncExternalStore } from "react";

/** DESIGN §2 / BUILD §5.3: the console is laid out no narrower than this. */
export const MIN_VIEWPORT_WIDTH = 1280;
/**
 * Founder decision 3 (Nov 16, 2026): between this width and MIN_VIEWPORT_WIDTH the console renders at 1280 px inside a
 * sideways-scrolling shell (zoom and 13-inch laptops, WCAG 1.4.4); below it, NeedsLargerWindow.
 */
export const MIN_SCROLL_WIDTH = 640;

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function read(): number | undefined {
  return typeof window === "undefined" ? undefined : window.innerWidth;
}

/**
 * The window's inner width, updated on resize. `undefined` during SSR so the server renders the shell
 * (ARCHITECTURE §14: measured client-side).
 */
export function useViewportWidth(): number | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}

/** True when a measured width is below the minimum. An unmeasured width (SSR) is treated as large enough. */
export function isViewportTooSmall(width: number | undefined, min = MIN_VIEWPORT_WIDTH): boolean {
  return typeof width === "number" && width < min;
}

/** True when a measured width is too narrow even for the sideways-scrolling console (under 640 px). */
export function isViewportTooNarrowToScroll(width: number | undefined): boolean {
  return typeof width === "number" && width < MIN_SCROLL_WIDTH;
}
