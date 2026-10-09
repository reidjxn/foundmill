import type { NextConfig } from "next";

/**
 * Next.js 16 App Router config (docs/ARCHITECTURE.md §14).
 * - Every @foundmill/* package ships TypeScript source, so each one is transpiled here.
 * - NEXT_PUBLIC_* fallbacks let `next build` run without a .env (staging sets the real values on Vercel).
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
};

const env = Object.fromEntries(Object.entries(PUBLIC_DEFAULTS).map(([k, v]) => [k, process.env[k] ?? v]));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env,
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
