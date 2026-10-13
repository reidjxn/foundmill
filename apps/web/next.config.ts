import type { NextConfig } from "next";
import { canonicalHostRedirects, canonicalOrigin } from "./lib/auth/canonical-origin";
import { securityHeaders } from "./lib/security-headers";

/**
 * Next.js 16 App Router config (docs/ARCHITECTURE.md §14).
 * - Every @foundmill/* package ships TypeScript source, so each one is transpiled here.
 * - NEXT_PUBLIC_* fallbacks let `next build` run without a .env (staging sets the real values on Vercel).
 * - www.foundmill.com (the www twin of the canonical origin) answers every path with a 308 to the same path on the
 *   canonical origin, so sign-in, its PKCE cookie and the API's CORS check all see one host (lib/auth/canonical-origin.ts).
 * - Every path carries the security headers (CSP with frame-ancestors 'none', nosniff, referrer and permissions policies,
 *   HSTS: lib/security-headers.ts), and the X-Powered-By header is off.
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
};

const env = Object.fromEntries(Object.entries(PUBLIC_DEFAULTS).map(([k, v]) => [k, process.env[k] ?? v]));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env,
  // Checked before the proxy and the filesystem, so the www host never refreshes a session or sets a cookie.
  redirects: async () => canonicalHostRedirects(canonicalOrigin(env.NEXT_PUBLIC_APP_URL)),
  headers: async () => [{ source: "/:path*", headers: securityHeaders(env, { dev: process.env.NODE_ENV !== "production" }) }],
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
    // Client router cache for dynamic pages (default 0 s): going back to a screen within 5 minutes reuses its page
    // segment instead of asking the server again. The pages are thin client screens; their data lives in TanStack
    // Query, which keeps it fresh on its own schedule (lib/query-client.ts).
    staleTimes: { dynamic: 300 },
  },
};

export default nextConfig;
