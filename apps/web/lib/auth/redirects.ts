/**
 * Pure routing rules behind proxy.ts (unit-tested without Next.js).
 *
 * - Unauthenticated → /login?next=<path> for every app route, except `/`, which renders the landing page.
 * - Authenticated on `/` with the last-business cookie → that business's Home, straight from the proxy (no API call: the
 *   business layout enforces the profile gate and membership). Without the cookie `/` renders and the index page picks
 *   the business with `founder.profile.get` (or onboarding, or New business).
 * - Authenticated on /login → next, else the same place `/` would send them.
 * - `/?stale=<id>`: the business layout found the cookie's business gone (lib/auth/last-business.ts); the cookie is
 *   cleared and `/` picks again, so a stale cookie costs one extra hop and never loops.
 * - The founder-profile gate for /b/* and the LIVE pages (AC-11.1.1) is enforced server-side in app/b/[bid]/layout.tsx and
 *   app/(live)/layout.tsx, because only the API knows whether the profile exists; the proxy only knows who is signed in.
 */
import { NEXT_PARAM } from "./constants";
import { STALE_BUSINESS_PARAM, lastBusinessHome } from "./last-business";

/** Routes that never need a session. */
const PUBLIC_PREFIXES = ["/login", "/auth/", "/_next/", "/brand/", "/favicon", "/icon", "/apple-icon", "/opengraph-image", "/robots.txt", "/sitemap.xml", "/health"];

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/auth") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/** The LIVE pages (BUILD §6.2): signed-in only like every app screen; their layout needs the founder profile and a business. */
const LIVE_PREFIXES = ["/network", "/communities", "/leaderboards", "/profiles"];

export function isFounderPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/onboarding" || pathname.startsWith("/new") || pathname.startsWith("/b/") || LIVE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** `forgetLastBusiness`: clear the last-business cookie on the response (it named a business the founder cannot open). */
export type RedirectDecision = { kind: "next"; forgetLastBusiness?: boolean } | { kind: "redirect"; to: string };

const PATH_PROBE_ORIGIN = "https://next-path.invalid";

/**
 * Clamp a `next` parameter to an in-app path so a magic link can never bounce the founder off-site. URL parsers read
 * "\" as "/" and drop tabs and newlines, so "/\evil.example" and "/<tab>/evil.example" resolve to another host: both
 * are refused, and whatever is left must still resolve to the page's own origin.
 *
 * The answer is the parser's own normalized path, never the raw string: dot segments collapse, so "/.//evil.example",
 * "/..//evil.example" and "/%2e%2e//evil.example" become the path "//evil.example", which a redirect (or Next's
 * proxy, which turns a same-host Location into a relative one) sends to another host. Such a path is refused too.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("://")) return fallback;
  // eslint-disable-next-line no-control-regex -- C0 controls and DEL are exactly what must be refused
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, PATH_PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PATH_PROBE_ORIGIN) return fallback;
  if (url.pathname.startsWith("//") || url.pathname.startsWith("/\\")) return fallback;
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Where a signed-in founder goes instead of `target` when `target` is the index: their last business's Home when the
 * cookie names one (the redirect `/` would answer anyway, one hop sooner). Anything else is kept.
 */
export function signedInDestination(target: string, lastBusinessId: string | null | undefined): string {
  return target === "/" ? (lastBusinessHome(lastBusinessId) ?? target) : target;
}

export function decideRedirect(input: { pathname: string; search?: string; authenticated: boolean; lastBusinessId?: string | null }): RedirectDecision {
  const { pathname, authenticated, lastBusinessId } = input;
  const search = input.search ?? "";
  if (authenticated && pathname === "/login") {
    const params = new URLSearchParams(search);
    return { kind: "redirect", to: signedInDestination(safeNextPath(params.get(NEXT_PARAM)), lastBusinessId) };
  }
  if (isPublicPath(pathname)) return { kind: "next" };
  if (!authenticated) {
    if (pathname === "/") return { kind: "next" }; // the landing page
    return { kind: "redirect", to: `/login?${NEXT_PARAM}=${encodeURIComponent(`${pathname}${search}`)}` };
  }
  if (pathname === "/") {
    const stale = new URLSearchParams(search).get(STALE_BUSINESS_PARAM);
    // The layout reported the cookie's business gone: forget it (only if it still names that business) and let the index pick.
    if (stale !== null) return { kind: "next", forgetLastBusiness: !!lastBusinessId && stale === lastBusinessId };
    const home = lastBusinessHome(lastBusinessId);
    if (home) return { kind: "redirect", to: home };
  }
  return { kind: "next" };
}
