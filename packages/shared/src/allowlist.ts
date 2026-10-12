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
