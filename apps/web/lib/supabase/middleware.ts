/**
 * Session refresh for proxy.ts (Supabase's documented `updateSession` pattern): builds a server client over the
 * request cookies, lets it rotate the tokens onto the response, and reports whether a user is signed in.
 * Without Supabase configured (mock development) only the dev cookie counts.
 *
 * The check makes no network call for a valid session: `getClaims()` verifies the access token's signature locally
 * against the project's published signing keys (fetched once and kept for 10 minutes per server instance). Only an
 * expired token goes to Supabase Auth, for its refresh, bounded by lib/supabase/timeouts.ts: an answer that does not
 * come within the deadline reads as signed out, never as a hung request.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEV_AUTH_COOKIE } from "@/lib/auth/constants";
import { hasSupabase, isDevLike, publicEnv } from "@/lib/env";
import { AUTH_DEADLINE_MS, fetchWithTimeout, withDeadline } from "./timeouts";

export interface SessionCheck {
  response: NextResponse;
  authenticated: boolean;
  /** "supabase" for a verified user, "dev" for the development bypass. */
  via: "supabase" | "dev" | null;
}

export function hasDevBypassCookie(request: Pick<NextRequest, "cookies">): boolean {
  return isDevLike() && request.cookies.get(DEV_AUTH_COOKIE)?.value === "1";
}

export async function updateSession(request: NextRequest): Promise<SessionCheck> {
  let response = NextResponse.next({ request });
  const env = publicEnv();
  if (hasSupabase(env)) {
    const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
      global: { fetch: fetchWithTimeout() },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    // getClaims() refreshes an expired session first (the new cookies reach the response through setAll), then verifies
    // the token's signature; never trust getSession() alone here.
    const claims = await withDeadline(
      supabase.auth.getClaims().then(({ data }) => data?.claims ?? null),
      AUTH_DEADLINE_MS,
      null,
    );
    if (claims?.sub) return { response, authenticated: true, via: "supabase" };
  }
  if (hasDevBypassCookie(request)) return { response, authenticated: true, via: "dev" };
  return { response, authenticated: false, via: null };
}
