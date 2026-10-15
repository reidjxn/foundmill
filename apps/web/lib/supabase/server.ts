/**
 * Server Supabase client for Server Components, Route Handlers and Server Actions (@supabase/ssr
 * `createServerClient` over Next 16's async `cookies()`). Returns null when Supabase is not configured.
 *
 * Every Supabase Auth request it makes is cut after a few seconds (lib/supabase/timeouts.ts), so a slow or unreachable
 * Supabase never holds a render for minutes.
 */
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { hasSupabase, publicEnv } from "@/lib/env";
import { AUTH_DEADLINE_MS, SUPABASE_REQUEST_TIMEOUT_MS, fetchWithTimeout, withDeadline } from "./timeouts";

/**
 * `requestTimeoutMs` bounds each Supabase Auth request. The default suits the session read on every render; the
 * sign-in callback and sign-out pass a longer one, because giving up on those costs more than a slow answer (an
 * abandoned code exchange may already have spent the one-time code; an abandoned sign-out leaves the session in place).
 */
export async function createClient({ requestTimeoutMs = SUPABASE_REQUEST_TIMEOUT_MS }: { requestTimeoutMs?: number } = {}): Promise<SupabaseClient | null> {
  const env = publicEnv();
  if (!hasSupabase(env)) return null;
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { fetch: fetchWithTimeout(requestTimeoutMs) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}

export interface ServerSession {
  accessToken: string;
  userId: string;
  email: string | null;
}

/**
 * The verified session, or null when nobody is signed in or Supabase Auth did not answer within AUTH_DEADLINE_MS.
 * No network call for a valid token: getSession() reads the cookie (refreshing an expired token, which the proxy has
 * normally done already), and getClaims() verifies that token's signature locally. The user id and email come from
 * the verified claims, never from the cookie's own copy of the user.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  return withDeadline(readVerifiedSession(supabase), AUTH_DEADLINE_MS, null);
}

async function readVerifiedSession(supabase: SupabaseClient): Promise<ServerSession | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return null;
  const { data } = await supabase.auth.getClaims(token);
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { accessToken: token, userId: claims.sub, email: typeof claims.email === "string" && claims.email ? claims.email : null };
}
