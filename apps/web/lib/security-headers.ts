/**
 * HTTP security headers of the web app (audit SECX-7, PAS-3), set for every path from next.config.ts.
 *
 * - `frame-ancestors 'none'` (and the older X-Frame-Options: DENY) so no other site can frame the app;
 * - a Content-Security-Policy that names where scripts, styles, images, fonts, frames and connections may come from.
 *   Connections go to the app's own services only: the API, the event stream, the spec editor's collaboration server, the
 *   ingest service (Simulate) and Supabase (sign-in). The policy has no nonce: a nonce makes every page dynamic, and the
 *   landing page is static (the root layout reads no cookie for it). Next.js's own inline bootstrap scripts and the
 *   root layout's text-size head script (components/providers/text-size-cookie.ts) need `'unsafe-inline'`; the rest of
 *   the policy (no remote script hosts, no `object`, a fixed `base-uri` and `form-action`) is what limits an injected tag;
 * - nosniff, a strict-origin-when-cross-origin referrer policy and a Permissions-Policy that turns off every device API
 *   the app never uses and allows the microphone for the app's own pages only (Team call, docs/TEAM_CALL.md: the browser
 *   still asks the person; `microphone=()` refused it without asking); HSTS for the HTTPS deployments (browsers ignore it
 *   over http://localhost).
 */

/** The NEXT_PUBLIC_* variables next.config.ts resolves: the API, stream, collab, ingest and Supabase URLs are read from it. */
export type SecurityHeaderEnv = Readonly<Record<string, string | undefined>>;

export interface SecurityHeader {
  key: string;
  value: string;
}

/** The origin of a URL ("wss://stream.foundmill.com/path" → "wss://stream.foundmill.com"); null for an empty or invalid one. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.origin === "null" ? `${u.protocol}//${u.host}` : u.origin;
  } catch {
    return null;
  }
}

/** The ws(s) twin of an http(s) origin and the other way round, so one configured URL covers both kinds of request. */
function bothSchemes(origin: string): string[] {
  if (origin.startsWith("https://")) return [origin, `wss://${origin.slice(8)}`];
  if (origin.startsWith("http://")) return [origin, `ws://${origin.slice(7)}`];
  if (origin.startsWith("wss://")) return [origin, `https://${origin.slice(6)}`];
  if (origin.startsWith("ws://")) return [origin, `http://${origin.slice(5)}`];
  return [origin];
}

export function contentSecurityPolicy(env: SecurityHeaderEnv, options: { dev?: boolean } = {}): string {
  const connect = new Set<string>(["'self'"]);
  for (const url of [env.NEXT_PUBLIC_API_URL, env.NEXT_PUBLIC_STREAM_URL, env.NEXT_PUBLIC_COLLAB_URL, env.NEXT_PUBLIC_INGEST_URL, env.NEXT_PUBLIC_SUPABASE_URL]) {
    const origin = originOf(url);
    if (origin) for (const o of bothSchemes(origin)) connect.add(o);
  }
  // The dev server hot-reloads over a WebSocket on its own origin and evaluates source maps.
  if (options.dev) connect.add("ws:");
  const apiOrigin = originOf(env.NEXT_PUBLIC_API_URL);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(options.dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // Agent avatars and logos are data: SVGs; a business's own logo and previews may be https images. The AI-generated
    // faces of anthropomorphic agents load from the API's public /personas/<style>/<key> route: its origin is named, since a
    // local API is plain http (https: alone would block it).
    ["img-src", ["'self'", "data:", "blob:", "https:", ...(apiOrigin ? [apiOrigin] : [])]],
    ["font-src", ["'self'", "data:"]],
    // Team call plays each spoken turn as it streams from the api's own route (`/team-call-audio/<ticket>`, so the API's
    // origin), or from a data: URL (simulated, or the whole clip when a stream fails), or a blob: URL; without this the
    // audio fell back to default-src 'self' and was blocked without a word.
    ["media-src", ["'self'", "data:", "blob:", ...(apiOrigin ? [apiOrigin] : [])]],
    ["connect-src", [...connect]],
    // The Development preview shows the branch's own deployment in a sandboxed iframe.
    ["frame-src", ["'self'", "https:"]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export function securityHeaders(env: SecurityHeaderEnv, options: { dev?: boolean } = {}): SecurityHeader[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env, options) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}
