"use client";
/**
 * Desktop only (BUILD §2.1 rule 10, DESIGN §2): below 1280 px a page renders NeedsLargerWindow and nothing else, except
 * the routes in `SMALL_SCREEN_PREFIXES`, the sign-in page among them (CLAUDE.md "Small screens": the outer product
 * works from 390 px), which render as they are at every width. The viewport meta stays
 * `width=device-width` (app/layout.tsx), so a phone or tablet reports its real width here instead of a 1280 px layout
 * viewport it would show as a 390 px slice (audit PAS-4). Unmeasured (server render) counts as large enough, like the
 * landing page and the business shell.
 *
 * A page that any route may render in place of its own content and that works from 390 px (the api's `on_waitlist`
 * refusal, components/shell/ApiErrorPage.tsx) says so by rendering `<WorksOnSmallScreens />`: while it is on the page,
 * the window is not asked to grow. It is seen on the page's first render (the server's, and the hydration that follows
 * it, which runs before the width is measured), which is how a person arrives there: by a full load after sign-in.
 */
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { NeedsLargerWindow, isViewportTooSmall, useViewportWidth } from "@foundmill/dugout";

/**
 * The routes that work from 390 px and never show NeedsLargerWindow. The one list to grow as the outer product gains
 * small-screen routes (docs/THESIS_REVIEW.md package 2.1): a project's public page first, then a person's public
 * profile (package 2.3), the sign-in page (`/login`, its notices and Continue with Google), the home of a person with no project yet (`/home`,
 * package 2.4), then the two pages an email from Foundmill opens, read on a phone: the one-click answer
 * (`/a/<token>`) and the pause page (`/email/pause`) (founder, 2026-11-12), then the Terms of Service and the Privacy
 * Policy (`/terms`, `/privacy`, founder 2026-11-13), and an invitation to a project (`/i/<token>`, THESIS_REVIEW 3.1).
 * An entry ending in "/" is a prefix; any
 * other is that one path.
 */
export const SMALL_SCREEN_PREFIXES: readonly string[] = [
  "/p/",
  "/u/",
  "/m/",
  "/login",
  "/home",
  "/a/",
  "/email/pause",
  "/terms",
  "/privacy",
  // The landing page's hero and idea box (founder, 2026-11-13; docs/IDEA_BOX.md): exactly "/", never a prefix; and the
  // card a person kept from it, where sign-in lands them.
  "/",
  "/new/card/",
  // The person's own pages and the people pages (package 2.1): their profile, finding people, communities, messages.
  "/public-profile",
  "/network",
  "/communities",
  "/communities/",
  "/profiles/",
  // An invitation to a project (THESIS_REVIEW 3.1).
  "/i/",
];

/**
 * Routes inside a project that work from 390 px (package 2.1): Today and Needs you (the Inbox), each in the business
 * shell's phone layout. Matched as patterns because the project's id is part of the path; every other project route
 * keeps the 1280 px floor.
 */
export const SMALL_SCREEN_PATTERNS: readonly RegExp[] = [
  /^\/b\/[0-9a-f-]{36}\/today\/?$/i,
  /^\/b\/[0-9a-f-]{36}\/inbox(\/[^/]+)?\/?$/i,
];

/** Whether `pathname` renders at every width (one of `SMALL_SCREEN_PREFIXES` or `SMALL_SCREEN_PATTERNS`). */
export function worksOnSmallScreens(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (SMALL_SCREEN_PATTERNS.some((re) => re.test(pathname))) return true;
  return SMALL_SCREEN_PREFIXES.some((entry) =>
    entry === "/"
      ? pathname === "/"
      : entry.endsWith("/")
      ? pathname.startsWith(entry) && pathname.length > entry.length
      : pathname === entry || pathname === `${entry}/`,
  );
}

/** The page's own word that it works from 390 px (`WorksOnSmallScreens`), for `DesktopOnly`. */
const SmallScreenAllowance = createContext<((on: boolean) => void) | null>(null);

export function DesktopOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const width = useViewportWidth();
  const [allowed, setAllowed] = useState(false);
  if (!allowed && !worksOnSmallScreens(pathname) && isViewportTooSmall(width))
    return <NeedsLargerWindow width={width} />;
  return <SmallScreenAllowance.Provider value={setAllowed}>{children}</SmallScreenAllowance.Provider>;
}

/** Rendered by a page that works from 390 px wherever it is shown (see the file comment); renders nothing. */
export function WorksOnSmallScreens() {
  const allow = useContext(SmallScreenAllowance);
  useLayoutEffect(() => {
    allow?.(true);
    return () => allow?.(false);
  }, [allow]);
  return null;
}
