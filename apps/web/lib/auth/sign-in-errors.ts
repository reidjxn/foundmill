/**
 * Why a magic link did not sign the founder in, as a short reason code that /auth/callback puts on /login?error=…
 * and the login form turns into a message with the way forward (send a new link). Raw Supabase messages never reach
 * the URL or the screen.
 */

export const SIGN_IN_ERROR_PARAM = "error";

export type SignInErrorReason = "other_address" | "expired" | "missing_code" | "not_configured" | "failed";

const REASONS: readonly SignInErrorReason[] = ["other_address", "expired", "missing_code", "not_configured", "failed"];

/** Supabase Auth error codes for a link that is out of date: expired, already used, or older than a newer request. */
const EXPIRED_CODES = new Set(["otp_expired", "flow_state_expired", "flow_state_not_found", "bad_code_verifier"]);

/**
 * Classify a failed `exchangeCodeForSession`. A missing PKCE code verifier means this browser on this host never asked
 * for the link: it was requested on another address (www.foundmill.com before the redirect existed, a preview
 * deployment) or in another browser.
 */
export function classifyExchangeError(error: { code?: string | undefined; name?: string | undefined; message?: string | undefined }): SignInErrorReason {
  if (error.code === "pkce_code_verifier_not_found" || error.name === "AuthPKCECodeVerifierMissingError" || /code verifier not found/i.test(error.message ?? "")) return "other_address";
  if (error.code && EXPIRED_CODES.has(error.code)) return "expired";
  return "failed";
}

/** Supabase sends a link it refused back to the callback with `error_code` (and no `code`), for example `otp_expired`. */
export function classifyCallbackParams(params: URLSearchParams): SignInErrorReason {
  const code = params.get("error_code");
  if (code && EXPIRED_CODES.has(code)) return "expired";
  return params.has("error") || code ? "failed" : "missing_code";
}

/** The reason in `/login?error=`; anything unknown (an older build put raw messages there) reads as a generic failure. */
export function parseSignInError(value: string | null | undefined): SignInErrorReason | null {
  if (!value) return null;
  return (REASONS as readonly string[]).includes(value) ? (value as SignInErrorReason) : "failed";
}

export interface SignInErrorCopy {
  title: string;
  body: string;
}

export function signInErrorCopy(reason: SignInErrorReason): SignInErrorCopy {
  switch (reason) {
    case "other_address":
      return {
        title: "Link opened on a different address",
        body: "This sign-in link was requested on a different address or in another browser, so it can't sign you in here. Send a new link from this page and open it in this browser.",
      };
    case "expired":
      return { title: "Link expired", body: "This sign-in link has expired or was already used. Send a new link and use the newest email." };
    case "missing_code":
      return { title: "Link incomplete", body: "This sign-in link is missing part of its address. Send a new link and open it straight from the email." };
    case "not_configured":
      return { title: "Sign-in unavailable", body: "Email sign-in is not set up on this server yet." };
    case "failed":
      return { title: "Sign-in failed", body: "That sign-in link didn't work. Send a new link to try again." };
  }
}
