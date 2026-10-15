"use client";
/**
 * Browser Supabase client (@supabase/ssr `createBrowserClient`, cookie-backed so the proxy and server components see
 * the same session). One instance per tab. Resolves to null when Supabase is not configured (dev bypass only).
 *
 * @supabase/ssr (about 60 KB gzipped) is its own chunk, not part of the page: every route reaches this file through
 * the tRPC token getter, and in development, tests and the mock stack the client is never created at all. Where
 * Supabase is configured the browser starts fetching it as soon as this module runs (while the page hydrates), so the
 * first API call after hydration does not wait for the download.
 *
 * Token requests (a refresh) are bounded (`SUPABASE_FETCH_TIMEOUT_MS`, audit C5): a refresh that hangs is cut and
 * retried by auth-js instead of holding the session lock, and every API request waiting on it, for good. Other requests
 * keep the browser's own limits (sending a sign-in link can take a few seconds). The API requests bound their own wait
 * for the token (lib/trpc.ts `TOKEN_TIMEOUT_MS`). A tab coming back into view needs nothing here: auth-js already
 * refreshes an expiring session on `visibilitychange` (autoRefreshToken, on in the browser), under the same lock the
 * requests of TanStack's refetch on focus wait on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabase, publicEnv } from "@/lib/env";

let client: Promise<SupabaseClient | null> | undefined;

/** Upper bound of one token request to Supabase Auth from the browser (a refresh). */
export const SUPABASE_FETCH_TIMEOUT_MS = 5_000;

/** A request to Supabase Auth's token endpoint (`/auth/v1/token?grant_type=…`: a refresh, a code exchange). */
export function isTokenRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return /\/auth\/v1\/token(\?|$)/.test(url);
}

/** `fetch` that gives up on a token request after `ms` (the caller's own abort still applies); others pass through. */
export function fetchWithTokenTimeout(ms: number, base?: typeof fetch): typeof fetch {
  return (input, init) => {
    if (!isTokenRequest(input)) return (base ?? globalThis.fetch)(input, init);
    const controller = new AbortController();
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason);
      else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
    }
    // Left to run out after an answer, as lib/trpc.ts `fetchWithTimeout` does: the body is read after `fetch` resolves.
    setTimeout(() => controller.abort(Object.assign(new Error(`No answer within ${ms} ms`), { name: "TimeoutError" })), ms);
    return (base ?? globalThis.fetch)(input, { ...init, signal: controller.signal });
  };
}

export function createClient(): Promise<SupabaseClient | null> {
  if (client) return client;
  const env = publicEnv();
  if (!hasSupabase(env)) {
    client = Promise.resolve(null);
    return client;
  }
  const loading = import("@supabase/ssr").then(({ createBrowserClient }) => createBrowserClient(env.supabaseUrl, env.supabaseAnonKey, { global: { fetch: fetchWithTokenTimeout(SUPABASE_FETCH_TIMEOUT_MS) } }));
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
