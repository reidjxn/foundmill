/**
 * Supabase magic-link callback: exchanges the PKCE code for a session (cookies set by @supabase/ssr) and redirects to
 * `next` (clamped to an in-app path). Failures land on /login with a reason code (lib/auth/sign-in-errors.ts) and the
 * same `next`, where the form says what happened and sends a new link, never on a blank page or a bare form.
 */
import { NextResponse } from "next/server";
import { NEXT_PARAM } from "@/lib/auth/constants";
import { safeNextPath } from "@/lib/auth/redirects";
import { classifyCallbackParams, classifyExchangeError, SIGN_IN_ERROR_PARAM, type SignInErrorReason } from "@/lib/auth/sign-in-errors";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function toLogin(request: Request, reason: SignInErrorReason, next: string): NextResponse {
  const login = new URL("/login", request.url);
  login.searchParams.set(SIGN_IN_ERROR_PARAM, reason);
  if (next !== "/") login.searchParams.set(NEXT_PARAM, next);
  return NextResponse.redirect(login);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get(NEXT_PARAM));
  const supabase = await createClient();
  if (!supabase) return toLogin(request, "not_configured", next);
  if (!code) return toLogin(request, classifyCallbackParams(url.searchParams), next);
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return toLogin(request, classifyExchangeError(error), next);
  return NextResponse.redirect(new URL(next, request.url));
}
