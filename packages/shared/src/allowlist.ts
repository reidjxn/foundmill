/**
 * Who may use the app (`SIGNUP_ALLOWLIST`, docs/DEPLOY.md §4): exact addresses (`founder@example.com`) and whole
 * domains (`@example.com`), comma- or space-separated, compared without regard to case. Unset (or empty) admits every
 * account that can sign in. One definition for every service that admits people: apps/api (every signed-in request,
 * services/access.ts), apps/stream (the WebSocket upgrade) and apps/collab (every connection), so an account taken off
 * the list reaches neither the procedures nor the live channels once the services restart with the new list (security
 * review S1). Zod-free, so a browser bundle may import it.
 */

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

/**
 * Whether a signed-in account may use the app under this list: always without a list, always for the development
 * bypass user (it carries no email; `loadEnv` clears it outside development and test), otherwise only a listed address.
 */
export function admittedBy(list: SignupAllowlist | null, user: { userId: string; email: string | null }, devUserId?: string | null): boolean {
  if (!list) return true;
  if (devUserId && user.userId.toLowerCase() === devUserId.toLowerCase()) return true;
  return allowlisted(list, user.email);
}

/**
 * How this deployment admits people (THESIS_REVIEW package 2.2; founder 2026-11-12: invite-only until the per-account
 * spend ceilings and the reporting of people ship, then open with a daily ceiling), from configuration alone:
 *   - `open`: SIGNUP_OPEN is on (off by default). Anyone with a confirmed address is admitted until the UTC day's new
 *     accounts reach SIGNUP_DAILY_CEILING (default 200); listed addresses are admitted without counting; past the
 *     ceiling a new person is refused with `on_waitlist`.
 *   - `invite_only`: SIGNUP_ALLOWLIST is set and SIGNUP_OPEN is off. The listed addresses and the accounts a valid
 *     invitation admitted get in; everyone else is refused with `not_invited`.
 *   - `unrestricted`: neither. Every account that can sign in is admitted (local stacks and tests, as before).
 * apps/api decides who is admitted (`admitOrWait`, services/access.ts) and records each admission it makes; apps/stream
 * and apps/collab admit an account the list names or one with a recorded admission, in the two modes that restrict.
 */
export type SignupMode = "unrestricted" | "invite_only" | "open";

export const signupOpen = (raw: string | null | undefined): boolean => /^(1|true|yes|on)$/i.test((raw ?? "").trim());

export function signupMode(env: { SIGNUP_ALLOWLIST?: string | null | undefined; SIGNUP_OPEN?: string | null | undefined }): SignupMode {
  if (signupOpen(env.SIGNUP_OPEN)) return "open";
  return parseSignupAllowlist(env.SIGNUP_ALLOWLIST) ? "invite_only" : "unrestricted";
}

/**
 * The live channels' check (apps/stream's upgrade, apps/collab's connection), the same rule apps/api applies on every
 * request: in `unrestricted` mode everyone, otherwise a listed address, the development bypass user, or an account the
 * api has admitted (`isAdmitted`, a lookup of `account_admissions`, asked only when the list does not already answer;
 * a lookup that fails refuses).
 */
export function liveChannelAdmit(
  env: { SIGNUP_ALLOWLIST?: string | null | undefined; SIGNUP_OPEN?: string | null | undefined },
  devUserId: string | null | undefined,
  isAdmitted: (userId: string) => Promise<boolean>,
): (user: { userId: string; email: string | null }) => boolean | Promise<boolean> {
  if (signupMode(env) === "unrestricted") return () => true;
  const list = parseSignupAllowlist(env.SIGNUP_ALLOWLIST);
  return (user) => {
    if (devUserId && user.userId.toLowerCase() === devUserId.toLowerCase()) return true;
    if (list && allowlisted(list, user.email)) return true;
    return isAdmitted(user.userId).catch(() => false);
  };
}

/**
 * The refusal of a signed-in person the admission did not let in today (services/access.ts): its `appCode`, and the
 * words of the panel the web shows for it (components/shell/ApiErrorPage.tsx) and the api's message.
 */
export const ON_WAITLIST_CODE = "on_waitlist";
export const ON_WAITLIST_WORDS = { title: "You're on the list.", body: "We'll let you in as soon as there is room. Come back tomorrow to check." } as const;
/**
 * The line that promises an email. The waitlist sends it since WP-03 T2 (the `waitlist-admissions` sweep) and the
 * ceiling's page stores the person since WP-03 T1, but production does not email yet (WP-00 S1/S2). The saved line under
 * the card promises it only where the api says it is sent (`waitlistEmails`, apps/web `WAITLIST_WORDS`); the card's body
 * stays without a promise.
 */
export const ON_WAITLIST_EMAIL_PROMISE = "We'll email you when you're in.";
