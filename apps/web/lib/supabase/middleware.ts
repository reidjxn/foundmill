/**
 * Session refresh for proxy.ts (Supabase's documented `updateSession` pattern): builds a server client over the
 * request cookies, lets it rotate the tokens onto the response, and reports whether a user is signed in.
 * Without Supabase configured (mock development) only the dev cookie counts.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEV_AUTH_COOKIE } from "@/lib/auth/constants";
import { hasSupabase, isDevLike, publicEnv } from "@/lib/env";

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
    // getUser() verifies the token with Supabase Auth and refreshes it when needed; never trust getSession() here.
    const { data } = await supabase.auth.getUser();
    if (data.user) return { response, authenticated: true, via: "supabase" };
  }
  if (hasDevBypassCookie(request)) return { response, authenticated: true, via: "dev" };
  return { response, authenticated: false, via: null };
}
