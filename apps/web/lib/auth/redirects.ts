/**
 * Pure routing rules behind proxy.ts (unit-tested without Next.js).
 *
 * - Unauthenticated → /login?next=<path> for every app route, except `/`, which is the landing page: prerendered, and
 *   served from the CDN (`/?example=<id>` from that business's own prerendered page, app/examples/[id]).
 * - Authenticated on `/` with the last-business cookie → that business's Home, straight from the proxy (no API call: the
 *   business layout enforces the profile gate and membership). Without the cookie `/` is rewritten to /start, which
 *   picks the business with `founder.profile.get` (or onboarding, or New business).
 * - Authenticated on /login → next, else the same place `/` would send them.
 * - `/?stale=<id>`: the business layout found the cookie's business gone (lib/auth/last-business.ts); the cookie is
 *   cleared and /start picks again, so a stale cookie costs one extra hop and never loops.
 * - The founder-profile gate for /b/* and the LIVE pages (AC-11.1.1) is enforced server-side in app/b/[bid]/layout.tsx and
 *   app/(live)/layout.tsx, because only the API knows whether the profile exists; the proxy only knows who is signed in.
 */
import { exampleRoute } from "@/components/landing/examples/ids";
import { landingVariant, landingVariantRoute, numberedLandingVariant } from "@/lib/landing-variant";
import { NEXT_PARAM } from "./constants";
import { STALE_BUSINESS_PARAM, lastBusinessHome } from "./last-business";

/**
 * Routes that never need a session. `/p/` is a project's public page (app/p/[slug]) and `/u/` a person's public profile
 * (app/u/[handle]), both open to anyone signed out. `/a/<token>` (a one-click answer) and `/email/pause` are opened from
 * a founder email, often on a phone with no session; `/email/unsubscribe` takes a mail app's one-click unsubscribe.
 * `/i/<token>` (an invitation to a project) is opened by people who may have no account yet: the page says "Sign in"
 * itself and comes back with `next`.
 */
const PUBLIC_PREFIXES = ["/login", "/auth/", "/_next/", "/brand/", "/favicon", "/icon", "/apple-icon", "/opengraph-image", "/robots.txt", "/sitemap.xml", "/llms.txt", "/health", "/examples/", "/p/", "/u/", "/m/", "/explore", "/a/", "/email/pause", "/email/unsubscribe", "/terms", "/privacy", "/i/", "/tour", "/lp/", "/.well-known/"];

/** The signed-in index (app/start/page.tsx): a signed-in `/` the proxy cannot answer itself is rewritten here. */
export const SIGNED_IN_INDEX = "/start";

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/auth") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/** The LIVE pages (BUILD §6.2): signed-in only like every app screen; their layout needs the founder profile and a business. */
const LIVE_PREFIXES = ["/network", "/communities", "/profiles"];

export function isFounderPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/home" || pathname === "/onboarding" || pathname === "/businesses" || pathname === "/public-profile" || pathname.startsWith("/new") || pathname.startsWith("/b/") || LIVE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * `rewrite` serves another route under the same address. `forgetLastBusiness`: clear the last-business cookie on the
 * response (it named a business the founder cannot open).
 */
export type RedirectDecision = { kind: "next" } | { kind: "redirect"; to: string } | { kind: "rewrite"; to: string; forgetLastBusiness?: boolean };

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
 * The only places the three questions go on to (WP-04 T1): a kept card's Commit, the kept card itself, or the Ideation
 * Studio opened on that card (`/new/ideate/<uuid>`); and the Studio itself, for a card kept with "Shape it in the
 * Ideation Studio" (the landing page's idea box).
 */
const ONBOARDING_NEXT = /^(\/new\/(commit|card|ideate)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\/new\/ideate)$/i;

/**
 * `/onboarding?next=`: the path the profile's first save goes on to, or null for anything but `/new/commit/<uuid>`,
 * `/new/card/<uuid>`, `/new/ideate/<uuid>` and `/new/ideate` (the card a person kept from the idea box keeps its thread
 * through the three questions). The path is clamped by `safeNextPath` first, then must be exactly one of these.
 */
export function onboardingNext(raw: string | null | undefined): string | null {
  const path = safeNextPath(raw, "");
  return ONBOARDING_NEXT.test(path) ? path : null;
}

/**
 * Where a signed-in founder goes instead of `target` when `target` is the index: their last business's Home when the
 * cookie names one (the redirect `/` would answer anyway, one hop sooner). Anything else is kept.
 */
export function signedInDestination(target: string, lastBusinessId: string | null | undefined): string {
  return target === "/" ? (lastBusinessHome(lastBusinessId) ?? target) : target;
}

export function decideRedirect(input: { pathname: string; search?: string; authenticated: boolean; lastBusinessId?: string | null; landingVariant?: string | null }): RedirectDecision {
  const { pathname, authenticated, lastBusinessId } = input;
  const search = input.search ?? "";
  if (authenticated && pathname === "/login") {
    const params = new URLSearchParams(search);
    return { kind: "redirect", to: signedInDestination(safeNextPath(params.get(NEXT_PARAM)), lastBusinessId) };
  }
  if (isPublicPath(pathname)) return { kind: "next" };
  // `/1` to `/20`: a landing page by its number (`/1` is `/` itself). A signed-out visitor is sent to `/`, which serves the
  // page from the `fm_lp` cookie proxy.ts sets on this redirect, so the address bar shows only the domain (founder, Nov 19,
  // 2026). The link's query is dropped: `via` is already kept in its cookie by proxy.ts, and nothing reads `utm_*` yet.
  // shortcut: an ad pixel added later would lose `gclid`/`fbclid` here; keep those params on the redirect when one lands.
  // A signed-in person still sees the page in place, since `/` would send them to their project.
  const numbered = numberedLandingVariant(pathname);
  if (numbered) return authenticated ? { kind: "rewrite", to: landingVariantRoute(numbered) ?? "/" } : { kind: "redirect", to: "/" };
  if (!authenticated) {
    if (pathname === "/") {
      // The landing page; a deep link to another example business is that business's own prerendered page.
      const example = exampleRoute(search);
      if (example) return { kind: "rewrite", to: example };
      // One of the landing page's other variants (lib/landing-variant.ts): its own prerendered page, under `/`.
      const variant = landingVariantRoute(landingVariant(search, input.landingVariant));
      return variant ? { kind: "rewrite", to: variant } : { kind: "next" };
    }
    // An address that is no app route reaches Next's 404 (with the right status) instead of a sign-in that leads nowhere.
    if (!isFounderPath(pathname) && pathname !== SIGNED_IN_INDEX && !pathname.startsWith("/integrations/")) return { kind: "next" };
    return { kind: "redirect", to: `/login?${NEXT_PARAM}=${encodeURIComponent(`${pathname}${search}`)}` };
  }
  if (pathname === "/") {
    const stale = new URLSearchParams(search).get(STALE_BUSINESS_PARAM);
    // The layout reported the cookie's business gone: forget it (only if it still names that business) and let the index pick.
    if (stale !== null) return { kind: "rewrite", to: SIGNED_IN_INDEX, forgetLastBusiness: !!lastBusinessId && stale === lastBusinessId };
    const home = lastBusinessHome(lastBusinessId);
    if (home) return { kind: "redirect", to: home };
    return { kind: "rewrite", to: SIGNED_IN_INDEX };
  }
  return { kind: "next" };
}
