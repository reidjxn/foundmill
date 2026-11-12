"use client";
/**
 * Desktop only (BUILD §2.1 rule 10, DESIGN §2): below 1280 px a page renders NeedsLargerWindow and nothing else, except
 * the routes in `SMALL_SCREEN_PREFIXES`, the sign-in page among them (CLAUDE.md "Small screens": the outer product
 * works from 390 px), which render as they are at every width. The viewport meta stays
 * `width=device-width` (app/layout.tsx), so a phone or tablet reports its real width here instead of a 1280 px layout
 * viewport it would show as a 390 px slice (audit PAS-4). Unmeasured (server render) counts as large enough, like the
 * landing page and the business shell.
 */
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NeedsLargerWindow, isViewportTooSmall, useViewportWidth } from "@foundmill/dugout";

/**
 * The routes that work from 390 px and never show NeedsLargerWindow. The one list to grow as the outer product gains
 * small-screen routes (docs/THESIS_REVIEW.md package 2.1): a project's public page first, then a person's public
 * profile (package 2.3), the sign-in page (`/login`, its notices and Continue with Google), then the two pages an email from Foundmill opens, read on a phone: the one-click answer
 * (`/a/<token>`) and the pause page (`/email/pause`) (founder, 2026-11-12). An entry ending in "/" is a prefix; any
 * other is that one path.
 */
export const SMALL_SCREEN_PREFIXES: readonly string[] = [
  "/p/",
  "/u/",
  "/m/",
  "/login",
  "/a/",
  "/email/pause",
];

/** Whether `pathname` renders at every width (one of `SMALL_SCREEN_PREFIXES`). */
export function worksOnSmallScreens(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return SMALL_SCREEN_PREFIXES.some((entry) =>
    entry.endsWith("/")
      ? pathname.startsWith(entry) && pathname.length > entry.length
      : pathname === entry || pathname === `${entry}/`,
  );
}

export function DesktopOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const width = useViewportWidth();
  if (!worksOnSmallScreens(pathname) && isViewportTooSmall(width))
    return <NeedsLargerWindow width={width} />;
  return <>{children}</>;
}
