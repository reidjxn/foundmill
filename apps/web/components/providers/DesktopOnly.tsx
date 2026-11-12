"use client";
/**
 * Desktop only (BUILD §2.1 rule 10, DESIGN §2): below 1280 px a page renders NeedsLargerWindow and nothing else, the
 * sign-in page and its notices included, except the routes in `SMALL_SCREEN_PREFIXES` (CLAUDE.md "Small screens":
 * the outer product works from 390 px), which render as they are at every width. The viewport meta stays
 * `width=device-width` (app/layout.tsx), so a phone or tablet reports its real width here instead of a 1280 px layout
 * viewport it would show as a 390 px slice (audit PAS-4). Unmeasured (server render) counts as large enough, like the
 * landing page and the business shell.
 */
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NeedsLargerWindow, isViewportTooSmall, useViewportWidth } from "@foundmill/dugout";

/**
 * Path prefixes that work from 390 px and never show NeedsLargerWindow. The one list to grow as the outer product
 * gains small-screen routes (docs/THESIS_REVIEW.md package 2.1): a project's public page first, then a person's public
 * profile (package 2.3).
 */
export const SMALL_SCREEN_PREFIXES: readonly string[] = ["/p/", "/u/"];

/** Whether `pathname` renders at every width (one of `SMALL_SCREEN_PREFIXES`). */
export function worksOnSmallScreens(pathname: string | null | undefined): boolean {
  return Boolean(pathname) && SMALL_SCREEN_PREFIXES.some((prefix) => pathname!.startsWith(prefix));
}

export function DesktopOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const width = useViewportWidth();
  if (!worksOnSmallScreens(pathname) && isViewportTooSmall(width)) return <NeedsLargerWindow width={width} />;
  return <>{children}</>;
}
