/**
 * Pay buttons (WP-07 T7): a project's payment links. A site's button is `/_fm/pay/<key>`; apps/sites sends the visitor
 * on to the link's URL, which never appears in the site's own HTML.
 */

/** Hosts a payment link may point at (WP-07 Decision D4: Stripe only at first). The database checks the same. */
export const PAY_LINK_HOSTS = ["buy.stripe.com"] as const;

export const PAY_LINK_URL_MAX = 500;
export const PAY_LINK_LABEL_MAX = 80;
/** A link's key: what a site's button names (`/_fm/pay/<key>`). */
export const PAY_LINK_KEY = /^[a-z0-9-]{2,40}$/;

const PATH = /^\/[A-Za-z0-9_/-]+$/;
/** The stored form, exactly as the database checks it (0131 `pay_links_url_format`). */
export const PAY_LINK_URL = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_/-]+$/;

/** Why a pasted payment link cannot be used, in plain words, or null when it can. */
export function payLinkUrlProblem(url: string): string | null {
  const text = url.trim();
  if (text.length === 0) return "Paste the payment link from your Stripe account.";
  if (text.length > PAY_LINK_URL_MAX) return "That link is too long to be a Stripe payment link.";
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return "That is not a link. Paste the whole address, starting with https://.";
  }
  if (parsed.protocol !== "https:") return "A payment link starts with https://.";
  if (parsed.username || parsed.password || text.includes("@")) return "That link carries a sign-in. Paste the payment link itself.";
  if (!(PAY_LINK_HOSTS as readonly string[]).includes(parsed.hostname) || parsed.port) return "Only Stripe payment links (buy.stripe.com) can be added for now.";
  if (parsed.search || parsed.hash || !PATH.test(parsed.pathname)) return "Paste the payment link as Stripe shows it, without anything after it.";
  // The text itself, not only what a browser would make of it (a capital host, a backslash, `..` or a tab).
  if (!PAY_LINK_URL.test(text)) return "Paste the payment link as Stripe shows it, starting with https://buy.stripe.com/.";
  return null;
}

/** Why a key cannot be used, or null. */
export function payLinkKeyProblem(key: string): string | null {
  return PAY_LINK_KEY.test(key) ? null : "Use 2 to 40 lowercase letters, numbers or hyphens.";
}

/** A key from a label: "Starter kit" → "starter-kit". */
export function payLinkKeyFrom(label: string): string {
  const key = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return key.length >= 2 ? key : "pay";
}
