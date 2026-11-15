"use client";
/**
 * Whether an element's own width is below `page-wide` (640 px, the token): the people pages swap a dense table for a list,
 * and Messages shows one pane, on a small screen (CLAUDE.md "Small screens"). The layout itself is container queries in
 * CSS; this is only for what must render differently, not just lay out differently. It assumes wide until it has
 * measured (the server, jsdom and the first paint), so the desktop layout is never replaced by a guess.
 */
import { useEffect, useState, type RefObject } from "react";

export const PAGE_WIDE_PX = 640;

export function useNarrow(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // A width of 0 is "not laid out" (jsdom, a hidden tab), not a narrow screen.
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      setNarrow(width > 0 && width < PAGE_WIDE_PX);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}
