/**
 * The one address sign-in happens on (docs/DEPLOY.md §2).
 *
 * Supabase's PKCE flow keeps the code verifier in a cookie on the host that asked for the magic link, and the API only
 * answers the web origins it knows, so a founder must ask for the link, open it and use the app on the same host. The
 * app therefore serves the www twin of its canonical origin (www.foundmill.com) only as a permanent redirect to it
 * (next.config.ts), and every magic link points at the canonical origin rather than whichever host the form was on.
 *
 * Free of Next.js imports: next.config.ts loads this file at build time and the login form loads it in the browser.
 */
import { APP_ORIGIN } from "@foundmill/config";
import { isDevLike, type PublicAppEnv } from "../env";
import { NEXT_PARAM, SIGN_IN_VIA_PARAM } from "./constants";

/** The canonical origin: NEXT_PUBLIC_APP_URL when it is an http(s) URL, otherwise the product's apex (APP_ORIGIN). */
export function canonicalOrigin(appUrl: string | undefined): string {
  const raw = appUrl?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      /* not a URL: fall back to the apex */
    }
  }
  return APP_ORIGIN;
}

/**
 * The www twin of an https canonical origin ("www.foundmill.com" for https://foundmill.com). Null for plain http,
 * localhost, IP addresses and an origin that is itself on www, so local and preview hosts never redirect.
 */
export function wwwAliasHost(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (url.protocol !== "https:" || host.startsWith("www.") || !host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host)) return null;
  return `www.${host}`;
}

export interface HostRedirect {
  source: string;
  has: { type: "host"; value: string }[];
  destination: string;
  permanent: true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * next.config.ts `redirects()`: every path on the www twin goes to the same path on the canonical origin with a 308
 * (Next passes the query string through). Next checks config redirects before the proxy, so the www host never runs
 * the Supabase session refresh or sets a cookie of its own.
 */
export function canonicalHostRedirects(origin: string): HostRedirect[] {
  const alias = wwwAliasHost(origin);
  if (!alias) return [];
  // `has.value` is a regular expression that Next anchors (^…$); escape the dots so only the exact host matches.
  return [{ source: "/:path*", has: [{ type: "host", value: escapeRegExp(alias) }], destination: `${new URL(origin).origin}/:path*`, permanent: true }];
}

/**
 * Where a magic link sends the founder: /auth/callback on the canonical origin, carrying `next`. Staging and production
 * always use NEXT_PUBLIC_APP_URL or the apex, never the page's own origin, so a link asked for on another host (www, a
 * preview deployment) still lands where the app lives. Development and test without NEXT_PUBLIC_APP_URL keep the page's
 * origin, so a local stack's links come back to localhost.
 */
export function magicLinkCallbackUrl(input: { appUrl: string | undefined; appEnv: PublicAppEnv; currentOrigin: string; next: string }): string {
  const hasAppUrl = (input.appUrl?.trim() ?? "").length > 0;
  const base = hasAppUrl || !isDevLike({ appEnv: input.appEnv }) ? canonicalOrigin(input.appUrl) : input.currentOrigin;
  const callback = new URL("/auth/callback", base);
  callback.searchParams.set(NEXT_PARAM, input.next);
  return callback.toString();
}

/**
 * Where Continue with Google returns: the same /auth/callback on the same origin with the same `next` as the magic link
 * (so both methods land the same way), marked `via=google` so a failure there is explained as a Google one.
 */
export function googleCallbackUrl(input: { appUrl: string | undefined; appEnv: PublicAppEnv; currentOrigin: string; next: string }): string {
  const callback = new URL(magicLinkCallbackUrl(input));
  callback.searchParams.set(SIGN_IN_VIA_PARAM, "google");
  return callback.toString();
}
