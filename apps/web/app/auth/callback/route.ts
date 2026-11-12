/**
 * Supabase sign-in callback, for the magic link and Continue with Google alike (`via=google`, which only changes how a
 * failure is worded): exchanges the PKCE code for a session (cookies set by @supabase/ssr) and redirects to
 * `next` (clamped to an in-app path). Without a `next`, a founder whose browser remembers their last business goes
 * straight to its Home, as `/` would send them (lib/auth/redirects.ts), one hop sooner. Failures land on /login with a
 * reason code (lib/auth/sign-in-errors.ts) and the same `next`, where the form says what happened and sends a new link,
 * never on a blank page or a bare form.
 *
 * A link made for someone by hand (Supabase admin `generateLink`; DEPLOY §4 "Inviting someone before custom SMTP")
 * carries `token_hash` and `type` instead of a PKCE code. It is verified here, server-side, so it works in any browser
 * and needs no email from Supabase's sender.
 */
import { NextResponse, type NextRequest } from "next/server";
import { LAST_BUSINESS_COOKIE, NEXT_PARAM, SIGN_IN_VIA_PARAM } from "@/lib/auth/constants";
import { safeNextPath, signedInDestination } from "@/lib/auth/redirects";
import { classifyCallbackParams, classifyExchangeError, googleSignInReason, SIGN_IN_ERROR_PARAM, type SignInErrorReason } from "@/lib/auth/sign-in-errors";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_ACTION_TIMEOUT_MS } from "@/lib/supabase/timeouts";

export const dynamic = "force-dynamic";

/** Link types the callback verifies by token hash: what `generateLink` makes for a sign-in or an invite. */
const TOKEN_HASH_TYPES = ["magiclink", "invite", "email"] as const;
type TokenHashType = (typeof TOKEN_HASH_TYPES)[number];

function tokenHashType(value: string | null): TokenHashType | null {
  return (TOKEN_HASH_TYPES as readonly string[]).includes(value ?? "") ? (value as TokenHashType) : null;
}

function toLogin(request: Request, reason: SignInErrorReason, next: string): NextResponse {
  const login = new URL("/login", request.url);
  login.searchParams.set(SIGN_IN_ERROR_PARAM, reason);
  if (next !== "/") login.searchParams.set(NEXT_PARAM, next);
  return NextResponse.redirect(login);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = tokenHashType(url.searchParams.get("type"));
  const next = safeNextPath(url.searchParams.get(NEXT_PARAM));
  // Continue with Google returns here too (the PKCE code, like the email link); its failures read as Google ones.
  const viaGoogle = url.searchParams.get(SIGN_IN_VIA_PARAM) === "google";
  const fail = (reason: SignInErrorReason) => toLogin(request, viaGoogle ? googleSignInReason(reason) : reason, next);
  const supabase = await createClient({ requestTimeoutMs: SUPABASE_ACTION_TIMEOUT_MS });
  if (!supabase) return fail("not_configured");
  const signIn = code ? supabase.auth.exchangeCodeForSession(code) : tokenHash && type ? supabase.auth.verifyOtp({ type, token_hash: tokenHash }) : null;
  if (!signIn) return fail(classifyCallbackParams(url.searchParams));
  const { error } = await signIn;
  if (error) return fail(classifyExchangeError(error));
  return NextResponse.redirect(new URL(signedInDestination(next, request.cookies.get(LAST_BUSINESS_COOKIE)?.value), request.url));
}
