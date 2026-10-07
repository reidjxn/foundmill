"use client";
/**
 * Browser Supabase client (@supabase/ssr `createBrowserClient`, cookie-backed so the proxy and server components see
 * the same session). One instance per tab. Returns null when Supabase is not configured (dev bypass only).
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabase, publicEnv } from "@/lib/env";

let client: SupabaseClient | null | undefined;

export function createClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const env = publicEnv();
  client = hasSupabase(env) ? createBrowserClient(env.supabaseUrl, env.supabaseAnonKey) : null;
  return client;
}

/** The current access token, or null when there is no Supabase session. */
export async function getBrowserAccessToken(): Promise<string | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
