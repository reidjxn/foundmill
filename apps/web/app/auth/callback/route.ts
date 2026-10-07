/**
 * Supabase magic-link callback: exchanges the PKCE code for a session (cookies set by @supabase/ssr) and redirects to
 * `next` (clamped to an in-app path). Failures land on /login with a reason, never on a blank page.
 */
import { NextResponse } from "next/server";
import { NEXT_PARAM } from "@/lib/auth/constants";
import { safeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get(NEXT_PARAM));
  const supabase = await createClient();
  if (!supabase) return NextResponse.redirect(new URL("/login?error=not_configured", request.url));
  if (!code) return NextResponse.redirect(new URL("/login?error=missing_code", request.url));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
