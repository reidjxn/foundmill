/**
 * Who may use the app (`SIGNUP_ALLOWLIST`, docs/DEPLOY.md §4). Supabase lets anyone with an inbox create an account,
 * and every signed-in account can drive model calls on the platform key, so a deployment that is not open to the public
 * names its people here: exact addresses (`founder@example.com`) and whole domains (`@example.com`), comma- or
 * space-separated, compared without regard to case. Unset (or empty) admits every account that can sign in.
 *
 * `protectedProcedure` (trpc.ts) checks it on every signed-in request, so an account that is not on the list can sign in
 * but reaches nothing: no founder profile, no Ideation, no business. The answer is FORBIDDEN with `appCode`
 * `not_invited`, which the web turns into its invite-only page (components/shell/NotInvitedPage.tsx). A listed address
 * counts only once confirmed: Supabase's "Confirm email" must stay on (docs/DEPLOY.md §4). apps/stream and apps/collab refuse that
 * account's sockets by the same list (security review S1).
 */
import { admittedBy, AppError, parseSignupAllowlist, type SignupAllowlist } from "@foundmill/shared";

// The list itself is @foundmill/shared's (allowlist.ts): apps/stream and apps/collab admit people by the same rules.
export { allowlisted, parseSignupAllowlist, type SignupAllowlist } from "@foundmill/shared";

export const NOT_INVITED_CODE = "not_invited";
export const NOT_INVITED_MESSAGE = "This address is not on the invite list yet. Ask the person who invited you to add it, or sign in with an address that is on it.";

let memo: { raw: string | undefined; list: SignupAllowlist | null } | null = null;

/** The parsed list for an env value (parsed once per distinct value). */
function listFor(raw: string | undefined): SignupAllowlist | null {
  if (!memo || memo.raw !== raw) memo = { raw, list: parseSignupAllowlist(raw) };
  return memo.list;
}

export const EMAIL_UNCONFIRMED_MESSAGE = "This address is not confirmed yet. Open the link we sent to it, then sign in again.";

/**
 * Refuses a signed-in account that the allow-list does not name. An address counts only when the token shows it is
 * confirmed (auth.ts `emailConfirmedFromPayload`; SEC2 S11): an anonymous sign-in, or an account whose address nobody
 * proved they read, could otherwise claim a listed address. That refusal carries `details.reason: "email_unconfirmed"`.
 * The development bypass user (`DEV_AUTH_USER_ID`, which `loadEnv` clears outside development and test) is always
 * admitted: it carries no email.
 */
export function assertAllowlisted(env: { SIGNUP_ALLOWLIST?: string; DEV_AUTH_USER_ID?: string }, user: { userId: string; email: string | null; emailConfirmed?: boolean }): void {
  const list = listFor(env.SIGNUP_ALLOWLIST);
  if (!list) return;
  if (env.DEV_AUTH_USER_ID && user.userId.toLowerCase() === env.DEV_AUTH_USER_ID.toLowerCase()) return;
  if (!admittedBy(list, user)) throw new AppError(NOT_INVITED_CODE, NOT_INVITED_MESSAGE, 403, { reason: "not_listed" });
  if (user.emailConfirmed !== true) throw new AppError(NOT_INVITED_CODE, EMAIL_UNCONFIRMED_MESSAGE, 403, { reason: "email_unconfirmed" });
}
