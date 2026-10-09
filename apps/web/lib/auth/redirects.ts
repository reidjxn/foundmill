/**
 * Pure routing rules behind proxy.ts (unit-tested without Next.js).
 *
 * - Unauthenticated → /login?next=<path> for every app route, except `/`, which renders the landing page.
 * - Authenticated on /login → / (the index picks the last business or onboarding).
 * - The founder-profile gate for /b/* and the LIVE pages (AC-11.1.1) is enforced server-side in app/b/[bid]/layout.tsx and
 *   app/(live)/layout.tsx, because only the API knows whether the profile exists; the proxy only knows who is signed in.
 */
import { NEXT_PARAM } from "./constants";

/** Routes that never need a session. */
const PUBLIC_PREFIXES = ["/login", "/auth/", "/_next/", "/brand/", "/favicon", "/icon", "/apple-icon", "/opengraph-image", "/robots.txt", "/sitemap.xml", "/health"];

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/auth") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/** The LIVE pages (BUILD §6.2): signed-in only like every app screen; their layout needs the founder profile and a business. */
const LIVE_PREFIXES = ["/network", "/communities", "/leaderboards"];

export function isFounderPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/onboarding" || pathname.startsWith("/new") || pathname.startsWith("/b/") || LIVE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type RedirectDecision = { kind: "next" } | { kind: "redirect"; to: string };

/** Clamp a `next` parameter to an in-app path so a magic link can never bounce the founder off-site. */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("://") || next.startsWith("/login")) return fallback;
  return next;
}

export function decideRedirect(input: { pathname: string; search?: string; authenticated: boolean }): RedirectDecision {
  const { pathname, authenticated } = input;
  const search = input.search ?? "";
  if (authenticated && pathname === "/login") {
    const params = new URLSearchParams(search);
    return { kind: "redirect", to: safeNextPath(params.get(NEXT_PARAM)) };
  }
  if (isPublicPath(pathname)) return { kind: "next" };
  if (!authenticated) {
    if (pathname === "/") return { kind: "next" }; // the landing page
    return { kind: "redirect", to: `/login?${NEXT_PARAM}=${encodeURIComponent(`${pathname}${search}`)}` };
  }
  return { kind: "next" };
}
