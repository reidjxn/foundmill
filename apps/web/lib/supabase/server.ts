/**
 * Server Supabase client for Server Components, Route Handlers and Server Actions (@supabase/ssr
 * `createServerClient` over Next 16's async `cookies()`). Returns null when Supabase is not configured.
 */
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { hasSupabase, publicEnv } from "@/lib/env";

export async function createClient(): Promise<SupabaseClient | null> {
  const env = publicEnv();
  if (!hasSupabase(env)) return null;
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
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

/** The verified session (getUser() round-trips to Supabase Auth; getSession() alone is not trusted server-side). */
export async function getServerSession(): Promise<ServerSession | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const [{ data: userData }, { data: sessionData }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
  const user = userData.user;
  const token = sessionData.session?.access_token;
  if (!user || !token) return null;
  return { accessToken: token, userId: user.id, email: user.email ?? null };
}
