/**
 * One key per mailbox, for open sign-up's guards (WP-03 T8; apps/api services/access.ts): two addresses that reach the
 * same inbox (`a.b+x@gmail.com`, `ab@googlemail.com`) share a key, so one person cannot take several of the day's places
 * with the same mailbox. Lower case; the local part cut at the first `+`; dots removed from the local part for Gmail,
 * whose two domains are both stored as `gmail.com`. Null when the address does not parse.
 */

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** The key of `email`, or null when it is not an address. */
export function addressKey(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@") || /\s/.test(trimmed)) return null;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null;
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    domain = "gmail.com";
    local = local.replace(/\./g, "");
  }
  return local ? `${local}@${domain}` : null;
}

/** The domain of a key `addressKey` made. */
export const domainOfKey = (key: string): string => key.slice(key.lastIndexOf("@") + 1);

/**
 * Large mailbox providers anyone can get an address at: the per-domain daily number (SIGNUP_PER_DOMAIN_PER_DAY) does
 * not apply to them, since many unrelated people share each one. The day's ceiling and the one-key rule still do.
 */
export const COMMON_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
]);
