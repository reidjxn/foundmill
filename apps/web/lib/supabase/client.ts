"use client";
/**
 * Browser Supabase client (@supabase/ssr `createBrowserClient`, cookie-backed so the proxy and server components see
 * the same session). One instance per tab. Resolves to null when Supabase is not configured (dev bypass only).
 *
 * @supabase/ssr (about 60 KB gzipped) is its own chunk, not part of the page: every route reaches this file through
 * the tRPC token getter, and in development, tests and the mock stack the client is never created at all. Where
 * Supabase is configured the browser starts fetching it as soon as this module runs (while the page hydrates), so the
 * first API call after hydration does not wait for the download.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabase, publicEnv } from "@/lib/env";

let client: Promise<SupabaseClient | null> | undefined;

export function createClient(): Promise<SupabaseClient | null> {
  if (client) return client;
  const env = publicEnv();
  if (!hasSupabase(env)) {
    client = Promise.resolve(null);
    return client;
  }
  const loading = import("@supabase/ssr").then(({ createBrowserClient }) => createBrowserClient(env.supabaseUrl, env.supabaseAnonKey));
  // A failed chunk load (offline, a new deploy) is not cached: the next call tries again.
  client = loading.catch((err: unknown) => {
    client = undefined;
    throw err;
  });
  return client;
}

if (typeof window !== "undefined" && hasSupabase(publicEnv())) void createClient().catch(() => undefined);

/** The current access token, or null when there is no Supabase session. */
export async function getBrowserAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
