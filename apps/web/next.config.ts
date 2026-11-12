import type { NextConfig } from "next";
import { canonicalHostRedirects, canonicalOrigin } from "./lib/auth/canonical-origin";
import { parsePublicEnv } from "./lib/env";
import { apiRewrites, SAME_ORIGIN_API_HEADERS, SAME_ORIGIN_TRPC_PATH } from "./lib/same-origin-api";
import { securityHeaders } from "./lib/security-headers";

/**
 * Next.js 16 App Router config (docs/ARCHITECTURE.md §14).
 * - Every @foundmill/* package ships TypeScript source, so each one is transpiled here.
 * - NEXT_PUBLIC_* fallbacks let `next build` run without a .env (staging sets the real values on Vercel).
 * - www.foundmill.com (the www twin of the canonical origin) answers every path with a 308 to the same path on the
 *   canonical origin, so sign-in, its PKCE cookie and the API's CORS check all see one host (lib/auth/canonical-origin.ts).
 * - Every path carries the security headers (CSP with frame-ancestors 'none', nosniff, referrer and permissions policies,
 *   HSTS: lib/security-headers.ts), and the X-Powered-By header is off.
 * - The browser's API reads go to `/api/trpc/*` on this origin, rewritten to the API (no CORS preflight per read; the
 *   CDN never caches them): lib/same-origin-api.ts.
 */
const PUBLIC_DEFAULTS: Record<string, string> = {
  NEXT_PUBLIC_APP_ENV: "development",
  NEXT_PUBLIC_API_URL: "http://localhost:4000",
  NEXT_PUBLIC_STREAM_URL: "ws://localhost:4003",
  // Empty on purpose: without a collab server the spec editor keeps edits local; .env.example sets ws://localhost:4004.
  NEXT_PUBLIC_COLLAB_URL: "",
  NEXT_PUBLIC_INGEST_URL: "http://localhost:4005",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  NEXT_PUBLIC_INTEGRATIONS_MODE: "mock",
  // Empty on purpose: staging and production then use APP_ORIGIN (https://foundmill.com) as the canonical origin.
  NEXT_PUBLIC_APP_URL: "",
  // Off until the founder has set up Google in Supabase (docs/DEPLOY.md §4 "Signing in with Google"); "on" shows the button.
  NEXT_PUBLIC_AUTH_GOOGLE: "",
};

const env = Object.fromEntries(Object.entries(PUBLIC_DEFAULTS).map(([k, v]) => [k, process.env[k] ?? v]));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env,
  // Checked before the proxy and the filesystem, so the www host never refreshes a session or sets a cookie.
  redirects: async () => canonicalHostRedirects(canonicalOrigin(env.NEXT_PUBLIC_APP_URL)),
  headers: async () => [
    { source: "/:path*", headers: securityHeaders(env, { dev: process.env.NODE_ENV !== "production" }) },
    { source: `${SAME_ORIGIN_TRPC_PATH}/:path*`, headers: [...SAME_ORIGIN_API_HEADERS] },
  ],
  // The API URL the browser bundle uses (the same default when unset), read at build time like every NEXT_PUBLIC_*.
  rewrites: async () => apiRewrites(parsePublicEnv(env).apiUrl),
  images: { unoptimized: true },
  transpilePackages: [
    "@foundmill/config",
    "@foundmill/shared",
    "@foundmill/dugout",
    "@foundmill/widgets",
    "@foundmill/modules",
    "@foundmill/journey",
    "@foundmill/entity-linker",
    "@foundmill/events",
    "@foundmill/api",
  ],
  // Typecheck and lint run as separate pnpm scripts (pnpm --filter @foundmill/web typecheck | lint).
  typescript: { ignoreBuildErrors: true },
  experimental: {
    // `next start` and `next dev` proxy the rewritten reads themselves and cut a proxied request at 30 s by default. Keep
    // them a little above the browser's own read limit (lib/trpc.ts QUERY_TIMEOUT_MS, 45 s), so a slow read ends with the
    // browser's own message on every host (Vercel's CDN allows 120 s).
    proxyTimeout: 50_000,
    // Client router cache for dynamic pages (default 0 s): going back to a screen within 5 minutes reuses its page
    // segment instead of asking the server again. The pages are thin client screens; their data lives in TanStack
    // Query, which keeps it fresh on its own schedule (lib/query-client.ts).
    staleTimes: { dynamic: 300 },
  },
};

export default nextConfig;
