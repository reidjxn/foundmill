/**
 * The API's reads, served from the web app's own origin (audit F7, WEB-2). A browser read sent straight to the API
 * (another origin, with an Authorization header) waits for a CORS preflight first, and the browser keeps a preflight
 * per exact URL: a tRPC read carries its input in the URL, so nearly every new read paid one more round trip. Sent to
 * this path instead, it is same-origin and needs none.
 *
 * next.config.ts rewrites the path to `${NEXT_PUBLIC_API_URL}/trpc/*`. On Vercel that is an external rewrite: the CDN
 * proxies it with no function in between, forwards every request header (Authorization included, and the page's
 * cookies, which the API ignores) and adds the visitor's address as x-forwarded-for (the API keys nothing on
 * addresses), within its proxied-request limits (120 s, a 14 KB URL, 32 KB of headers). Locally `next start` and
 * `next dev` proxy it themselves. Only reads use it: changes, answer streams and the event stream run long (a change can
 * wait minutes for a note) and go to the API directly.
 *
 * Imported by next.config.ts: no imports, nothing browser- or React-specific.
 */

/** Where the browser sends its reads (relative to the page's origin). `proxy.ts` leaves it alone (its matcher). */
export const SAME_ORIGIN_TRPC_PATH = "/api/trpc";

/** next.config.ts `rewrites`: the same-origin path to the API's tRPC endpoint. */
export function apiRewrites(apiUrl: string): { source: string; destination: string }[] {
  return [{ source: `${SAME_ORIGIN_TRPC_PATH}/:path*`, destination: `${apiUrl.replace(/\/+$/, "")}/trpc/:path*` }];
}

/**
 * Response headers for the proxied path. Its answers are per person (each request carries the reader's bearer), so the
 * CDN must never keep one: Vercel honors an origin's caching headers on external rewrites unless told not to.
 */
export const SAME_ORIGIN_API_HEADERS: readonly { key: string; value: string }[] = [{ key: "x-vercel-enable-rewrite-caching", value: "0" }];

/** An http(s) origin for a URL (a ws(s) URL gives its http(s) twin); null for an empty or invalid one. */
function httpOrigin(url: string): string | null {
  try {
    const u = new URL(url.replace(/^ws(s?):/, "http$1:"));
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * What the root layout warms while the page loads: a connection to the API (changes and answer streams go there
 * directly, without cookies, hence `crossOrigin: "anonymous"`), and the DNS name of the event stream (a WebSocket
 * cannot reuse a preconnected socket, but it can reuse the name lookup).
 */
export function connectionHints(env: { apiUrl: string; streamUrl: string }): { preconnect: string | null; dnsPrefetch: string | null } {
  const api = httpOrigin(env.apiUrl);
  const stream = httpOrigin(env.streamUrl);
  return { preconnect: api, dnsPrefetch: stream && stream !== api ? stream : null };
}
