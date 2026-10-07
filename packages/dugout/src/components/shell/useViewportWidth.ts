"use client";
import { useSyncExternalStore } from "react";

/** DESIGN §2 / BUILD §5.3: below this width the shell renders NeedsLargerWindow only. */
export const MIN_VIEWPORT_WIDTH = 1280;

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
