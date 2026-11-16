/**
 * Why a magic link did not sign the founder in, as a short reason code that /auth/callback puts on /login?error=…
 * and the login form turns into a message with the way forward (send a new link). Raw Supabase messages never reach
 * the URL or the screen.
 */

export const SIGN_IN_ERROR_PARAM = "error";

export type SignInErrorReason = "other_address" | "expired" | "missing_code" | "not_configured" | "failed" | "signups_closed" | "google_failed" | "google_unverified";

const REASONS: readonly SignInErrorReason[] = ["other_address", "expired", "missing_code", "not_configured", "failed", "signups_closed", "google_failed", "google_unverified"];

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

/**
 * Supabase sends a link it refused back to the callback with `error_code` (and no `code`), for example `otp_expired`.
 * A Google sign-in it refused comes back the same way: `signup_disabled` when "Allow new users to sign up" is off and
 * the Google account has no account here yet, `provider_email_needs_verification` when Google has not verified the
 * address (Supabase then finishes no sign-in).
 */
export function classifyCallbackParams(params: URLSearchParams): SignInErrorReason {
  const code = params.get("error_code");
  if (code === "signup_disabled") return "signups_closed";
  if (code === "provider_email_needs_verification") return "google_unverified";
  if (code && EXPIRED_CODES.has(code)) return "expired";
  return params.has("error") || code ? "failed" : "missing_code";
}

/**
 * The reason /auth/callback reports for a sign-in that started with Continue with Google (`via=google`): the email
 * link's own reasons (expired, incomplete, another address) talk about a link the founder never had, so they read as
 * Google sign-in not finishing. Closed sign-ups, an unverified Google address and a server without Supabase keep theirs.
 */
export function googleSignInReason(reason: SignInErrorReason): SignInErrorReason {
  return reason === "signups_closed" || reason === "google_unverified" || reason === "not_configured" ? reason : "google_failed";
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
    case "signups_closed":
      // The words the email form shows for the same refusal (sendLinkErrorMessage "signups_closed").
      return { title: "New sign-ups are closed", body: "There is no account for this address, and new sign-ups are closed for now." };
    case "google_failed":
      return { title: "Google sign-in didn't finish", body: "You're not signed in yet. Try Continue with Google again, or use the email link below." };
    case "google_unverified":
      return { title: "Google address not verified", body: "Google hasn't verified the email address on that account, so it can't sign you in. Use the email link below instead." };
  }
}

/** Under Continue with Google when the button could not start a sign-in (the provider is not turned on, the network dropped). */
/** The sign-in bot check (NEXT_PUBLIC_SIGNIN_BOT_CHECK, WP-03 T8) could not get a token: the idea box's own line. */
export const BROWSER_CHECK_FAILED_MESSAGE = "We could not check this browser. Reload the page and try again.";

export const GOOGLE_UNAVAILABLE_MESSAGE = "Google sign-in isn't available right now. Use the email link below.";

/**
 * Why sending a sign-in link failed (`signInWithOtp`), as a reason the login form turns into plain words. Supabase Auth
 * answers with an error `code` and an HTTP status; older servers send only the message, so the message is the last
 * resort. Raw Supabase text ("Email address not authorized", "email rate limit exceeded") never reaches the screen.
 */
export type SendLinkErrorReason = "too_soon" | "rate_limited" | "address_not_allowed" | "signups_closed" | "invalid_email" | "unavailable" | "offline" | "failed";

export function classifySendLinkError(error: { code?: string | undefined; status?: number | undefined; name?: string | undefined; message?: string | undefined }): SendLinkErrorReason {
  const code = error.code ?? "";
  const message = error.message ?? "";
  // The sender refused the address: Supabase's built-in sender only mails the project's own team (DEPLOY §4 custom SMTP).
  if (code === "email_address_not_authorized" || /not authori[sz]ed/i.test(message)) return "address_not_allowed";
  // The same address asked again inside Supabase's resend window ("you can only request this after 52 seconds").
  if (/only request this after/i.test(message)) return "too_soon";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error.status === 429 || /rate limit/i.test(message)) return "rate_limited";
  if (code === "signup_disabled" || code === "otp_disabled" || /signups? not allowed/i.test(message)) return "signups_closed";
  if (code === "email_address_invalid" || /invalid.*email|email.*invalid/i.test(message)) return "invalid_email";
  if (code === "email_provider_disabled" || /email logins are disabled/i.test(message)) return "unavailable";
  // auth-js reports a request that never reached Supabase as a retryable fetch error with no HTTP status.
  if (error.name === "AuthRetryableFetchError" && !error.status) return "offline";
  return "failed";
}

export function sendLinkErrorMessage(reason: SendLinkErrorReason): string {
  switch (reason) {
    case "too_soon":
      return "A sign-in link was just sent to this address. Wait a minute before asking for another, and check your spam folder too.";
    case "rate_limited":
      return "Too many sign-in links were requested in a short time. Wait a few minutes, then try again.";
    case "address_not_allowed":
      return "We can't send sign-in emails to this address right now. Please contact support.";
    case "signups_closed":
      return "There is no account for this address, and new sign-ups are closed for now.";
    case "invalid_email":
      return "That email address doesn't look right. Check it and try again.";
    case "unavailable":
      return "Email sign-in is turned off on this server right now.";
    case "offline":
      return "We couldn't reach the sign-in service. Check your connection and try again.";
    case "failed":
      return "The sign-in link couldn't be sent. Try again in a moment.";
  }
}
