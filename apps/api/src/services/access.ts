/**
 * Who may use the app (`SIGNUP_ALLOWLIST`, docs/DEPLOY.md §4). Supabase lets anyone with an inbox create an account,
 * and every signed-in account can drive model calls on the platform key, so a deployment that is not open to the public
 * names its people here: exact addresses (`founder@example.com`) and whole domains (`@example.com`), comma- or
 * space-separated, compared without regard to case. Unset (or empty) admits every account that can sign in.
 *
 * `protectedProcedure` (trpc.ts) checks it on every signed-in request, so an account that is not on the list can sign in
 * but reaches nothing: no founder profile, no Ideation, no business. The answer is FORBIDDEN with `appCode`
 * `not_invited`, which the web turns into its invite-only page (components/shell/NotInvitedPage.tsx).
 */
import { AppError } from "@foundmill/shared";

export const NOT_INVITED_CODE = "not_invited";
export const NOT_INVITED_MESSAGE = "This address is not on the invite list yet. Ask the person who invited you to add it, or sign in with an address that is on it.";

export interface SignupAllowlist {
  emails: ReadonlySet<string>;
  /** Domains without the `@` (`example.com`). */
  domains: ReadonlySet<string>;
}

/** Parses `SIGNUP_ALLOWLIST`; null when unset or empty (everyone may use the app). */
export function parseSignupAllowlist(raw: string | null | undefined): SignupAllowlist | null {
  const entries = (raw ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) return null;
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const e of entries) {
    if (e.startsWith("@")) {
      if (e.length > 1) domains.add(e.slice(1));
    } else if (e.includes("@")) emails.add(e);
    // Anything else (a bare word) names nobody: an entry must be an address or an @domain.
  }
  return { emails, domains };
}

/** True when `email` is on the list: the exact address, or an address at a listed domain (not its subdomains). */
export function allowlisted(list: SignupAllowlist, email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  if (list.emails.has(e)) return true;
  const at = e.lastIndexOf("@");
  return at > 0 && list.domains.has(e.slice(at + 1));
}

let memo: { raw: string | undefined; list: SignupAllowlist | null } | null = null;

/** The parsed list for an env value (parsed once per distinct value). */
function listFor(raw: string | undefined): SignupAllowlist | null {
  if (!memo || memo.raw !== raw) memo = { raw, list: parseSignupAllowlist(raw) };
  return memo.list;
}

/**
 * Refuses a signed-in account that the allow-list does not name. The development bypass user (`DEV_AUTH_USER_ID`, which
 * `loadEnv` clears outside development and test) is always admitted: it carries no email.
 */
export function assertAllowlisted(env: { SIGNUP_ALLOWLIST?: string; DEV_AUTH_USER_ID?: string }, user: { userId: string; email: string | null }): void {
  const list = listFor(env.SIGNUP_ALLOWLIST);
  if (!list) return;
  if (env.DEV_AUTH_USER_ID && user.userId === env.DEV_AUTH_USER_ID) return;
  if (!allowlisted(list, user.email)) throw new AppError(NOT_INVITED_CODE, NOT_INVITED_MESSAGE, 403);
}
