/**
 * "Add any website" (founder, Nov 24, 2026): a site the founder types in, not on the static site list. Foundmill builds
 * the site's entry from the address: its one exact host, the sign-in hosts found on its home page, and the sandbox's
 * egress limited to them (`browserEgress`). A connector key is static (the registry, the grants and the integrations
 * table's unique key), so a project has a few fixed slots, `browser_web_1` .. `browser_web_<WEB_SLOTS>`, and the site in
 * a slot lives in its integration's `config`, never in code.
 *
 * shortcut: five slots a project, so five typed websites at once; upgrade by raising WEB_SLOTS (a slot is one key in
 * the grants table and the catalogue) when a plan or a founder needs more.
 * shortcut: the registrable domain is the last two labels, or three under a common two-level suffix (co.uk, com.au);
 * upgrade to a full public-suffix list when a site on an uncommon suffix needs its sign-in host.
 *
 * Everything here is pure: the gateway reads the web, the api asks the gateway, and both build the entry with these
 * functions, so a client can never hand in a host of its own.
 */
import { isIP } from "node:net";
import { APP_NAME } from "@foundmill/config";
import { BROWSER_SITES, hostWithin, neverReason, NEVER_WORDS, type BrowserSite, type NeverSite } from "./browser-sites";

export const WEB_SLOTS = 5;
export const WEB_SLOT_PREFIX = "browser_web_";
export const webSlotKey = (n: number): string => `${WEB_SLOT_PREFIX}${n}`;
export const WEB_SLOT_KEYS: readonly string[] = Object.freeze(Array.from({ length: WEB_SLOTS }, (_, i) => webSlotKey(i + 1)));
/** The slot a connector key names (1..WEB_SLOTS), or null. */
export const webSlotOf = (connectorKey: string): number | null => {
  const m = /^browser_web_([1-9])$/.exec(connectorKey);
  return m && Number(m[1]) <= WEB_SLOTS ? Number(m[1]) : null;
};
export const webSiteKey = (slot: number): string => `web_${slot}`;
/** The connector whose mode (mock or live) decides how typed websites are checked, everywhere: the gateway's check, a session's re-check and the api's connect. */
export const WEB_CHECK_KEY = webSlotKey(1);

export type TermsVerdict = "forbids" | "unclear" | "allows";

/** What the terms check found about a host (the gateway's answer; cached platform-wide for 30 days). */
export interface SiteCheck {
  verdict: TermsVerdict;
  /** A quote from the terms, as found in the fetched text; null when there is none. */
  line: string | null;
  termsUrl: string | null;
  /** Other hosts of the same site where its sign-in lives. */
  signInHosts: readonly string[];
  checkedOn: string;
}

export interface SiteAddress {
  host: string;
  startUrl: string;
}

const REFUSED = {
  not_an_address: "That is not a web address. Type one like shop.example.com.",
  not_https: "Only https addresses can be added.",
  tricks: "Type the plain address of the site, with no name, password or port in it.",
  private: "That address is not a public website.",
} as const;

export type AddressRefusal = { ok: false; code: "not_an_address" | "not_https" | "tricks" | "private" | "never"; message: string };

/**
 * An address the founder typed, as one exact host: https only, no userinfo or port, an IDN as punycode (the URL parser
 * does that), no IP address, localhost or local name. The page the founder typed is not kept: the session starts at the
 * host's own front page.
 */
export function parseSiteAddress(input: string): ({ ok: true } & SiteAddress) | AddressRefusal {
  const text = input.trim();
  if (text.length < 3 || text.length > 300 || /\s/.test(text)) return { ok: false, code: "not_an_address", message: REFUSED.not_an_address };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, code: "not_an_address", message: REFUSED.not_an_address };
  }
  if (u.protocol !== "https:") return { ok: false, code: "not_https", message: REFUSED.not_https };
  if (u.username || u.password || u.port) return { ok: false, code: "tricks", message: REFUSED.tricks };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  // An IP address (v4 or v6, however it is written: the parser has already turned 0x7f.1 into 127.0.0.1) is never a site.
  if (host.includes(":") || host.startsWith("[") || isIP(host) || /^[0-9.]+$/.test(host)) return { ok: false, code: "private", message: REFUSED.private };
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || host.length > 253 || /(^|\.)(localhost|local|internal|localdomain|home|lan|corp|test|invalid|example)$/.test(host)) return { ok: false, code: "private", message: REFUSED.private };
  return { ok: true, host, startUrl: `https://${host}/` };
}

/** The reason a typed site is refused before anything is fetched, or null: social networks, banks and payment accounts, and the rest of the never list. */
export function neverMessage(host: string): string | null {
  const why = neverReason(host);
  return why ? neverWords(host, why) : null;
}
const neverWords = (host: string, why: NeverSite["why"]): string => `${host} is ${NEVER_WORDS[why]}. The team does not work in it, and it cannot be added.`;

/**
 * What the terms check's model says a site is, from its home page. Any category but "other" makes the site a never site
 * (security review, Nov 24, 2026): the never list names the sites founders are likeliest to type, and this catches the rest.
 */
export const SITE_CATEGORIES = ["bank", "brokerage", "payment", "government_identity", "health_records", "password_manager", "social_network", "other"] as const;
export type SiteCategory = (typeof SITE_CATEGORIES)[number];
const CATEGORY_WHY: Record<Exclude<SiteCategory, "other">, NeverSite["why"]> = { bank: "bank", payment: "bank", brokerage: "brokerage", government_identity: "government_identity", health_records: "health_records", password_manager: "password_manager", social_network: "social_network" };
/** The refusal for a host the model put in a never category; null for "other". */
export const neverCategoryMessage = (host: string, category: SiteCategory): string | null => (category === "other" ? null : neverWords(host, CATEGORY_WHY[category]));

/**
 * Hosts where anyone can get a subdomain: a site there shares its registrable domain with strangers, so it gets no
 * sign-in or sibling hosts at all. shortcut: a short explicit list of common ones, not the public-suffix list; upgrade to
 * the full list (publicsuffix.org, private section) when a founder needs a host on a suffix that is not here.
 */
export const SHARED_HOSTING_SUFFIXES: readonly string[] = Object.freeze(["github.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "blogspot.com", "myshopify.com", "wordpress.com", "wixsite.com", "squarespace.com", "web.app", "firebaseapp.com", "azurewebsites.net", "cloudfront.net", "appspot.com", "glitch.me", "repl.co", "onrender.com", "fly.dev"]);
const sharedSuffixOf = (host: string): string | null => SHARED_HOSTING_SUFFIXES.find((x) => host === x || host.endsWith(`.${x}`)) ?? null;

/** shortcut: see the file header (two-level suffixes) and `SHARED_HOSTING_SUFFIXES`. */
const TWO_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "or", "ne"]);
export function registrableDomain(host: string): string {
  const shared = sharedSuffixOf(host);
  if (shared) return host === shared ? host : `${host.slice(0, -shared.length - 1).split(".").pop()}.${shared}`;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  return labels.slice(-(tld.length === 2 && TWO_LEVEL.has(second) ? 3 : 2)).join(".");
}

/** True when `host` is on a shared hosting suffix (or is one). */
export const isOnSharedHostingSuffix = (host: string): boolean => sharedSuffixOf(host) !== null;

/** True when `host` is itself a shared hosting suffix (github.io): no site can be built on it. */
export const isSharedHostingSuffix = (host: string): boolean => SHARED_HOSTING_SUFFIXES.includes(host);

/**
 * Sign-in hosts that are acceptable for a site: other hosts of its registrable domain, plain names, not the site's own
 * host, not the bare registrable domain (it can be anyone's front page), not a never site. At most 5. None on a shared
 * hosting suffix, where a sibling host belongs to a stranger.
 */
export function cleanSignInHosts(host: string, candidates: readonly string[]): string[] {
  if (sharedSuffixOf(host)) return [];
  const own = registrableDomain(host);
  const ok = candidates.map((c) => c.toLowerCase()).filter((c) => c !== host && c !== own && /^[a-z0-9.-]{3,253}$/.test(c) && hostWithin(c, [own]) && !neverReason(c) && parseSiteAddress(c).ok);
  return [...new Set(ok)].slice(0, 5);
}

/** What the starter list and an unnamed site are called: the host without `www.`. */
export interface StarterSite {
  name: string;
  host: string;
}
/**
 * The sites shown first (founder, Nov 24, 2026), for the founder who sells through a marketplace. Each is shown only when
 * its terms check passes (not `forbids`); the list is addresses, not verdicts. Shopify is its own connection and is never here.
 */
export const STARTER_SITES: readonly StarterSite[] = Object.freeze([
  { name: "Etsy", host: "www.etsy.com" },
  { name: "Amazon Seller Central", host: "sellercentral.amazon.com" },
  { name: "eBay", host: "www.ebay.com" },
  { name: "Gumroad", host: "app.gumroad.com" },
  { name: "Alibaba (supplier side)", host: "supplier.alibaba.com" },
  { name: "Google Business Profile", host: "business.google.com" },
]);

export const siteNameOf = (host: string): string => STARTER_SITES.find((s) => s.host === host)?.name ?? host.replace(/^www\./, "");

/** The words that stand for a site's verdict. Fixed copy: nothing a site wrote is ever shown as the product's own sentence. */
export const STATE_LINE = {
  allows: (name: string) => `${name}'s terms say automated use of your own account is allowed.`,
  unclear: (name: string) => `${APP_NAME} has not confirmed that ${name}'s terms allow this. Its terms were read and do not say either way, so you decide.`,
} as const;

/**
 * The site entry for a slot, from a typed address and its terms check. Refuses what the never list names and a verdict
 * that forbids: a refused site never gets an entry, whatever a caller sends. Used by the api (to show the founder), the
 * connector (at connect) and every call (from the integration's config), so the three always agree.
 */
export function buildWebSite(slot: number, input: { address: string; check: SiteCheck }): BrowserSite {
  const parsed = parseSiteAddress(input.address);
  if (!parsed.ok) throw new WebSiteRefused(parsed.message);
  const never = neverMessage(parsed.host);
  if (never) throw new WebSiteRefused(never);
  if (isSharedHostingSuffix(parsed.host)) throw new WebSiteRefused("That address is shared by many websites. Type the address of your own site on it.");
  if (input.check.verdict === "forbids") throw new WebSiteRefused(`${siteNameOf(parsed.host)}'s terms do not allow automated use of an account.`);
  if (webSlotOf(webSlotKey(slot)) === null) throw new WebSiteRefused("There is no free place for another website. Disconnect one first.");
  // A site that is already on the static list keeps its own entry: its hosts, paths and rules were set by hand.
  if (BROWSER_SITES.some((s) => s.hosts.includes(parsed.host))) throw new WebSiteRefused(`${siteNameOf(parsed.host)} is already on the list. Connect it from there.`);
  const name = siteNameOf(parsed.host);
  return {
    key: webSiteKey(slot),
    name,
    state: input.check.verdict === "allows" ? "open" : "ask_first",
    hosts: [parsed.host],
    signInHosts: cleanSignInHosts(parsed.host, input.check.signInHosts),
    startUrl: parsed.startUrl,
    terms: { url: input.check.termsUrl ?? parsed.startUrl, line: input.check.line ?? (input.check.verdict === "allows" ? STATE_LINE.allows(name) : STATE_LINE.unclear(name)), checkedOn: input.check.checkedOn },
  };
}

/** A typed site that cannot be added. The message is plain words for the founder. */
export class WebSiteRefused extends Error {
  readonly code = "site_refused";
}

/** What an integration's `config` holds for a typed site: enough to build the same entry again, and nothing else. */
export type WebSiteConfig = {
  siteKey: string;
  address: string;
  check: SiteCheck;
};
export const webSiteConfig = (slot: number, address: string, check: SiteCheck): WebSiteConfig => ({ siteKey: webSiteKey(slot), address, check: { ...check, signInHosts: [...check.signInHosts] } });

/** The entry a slot's integration `config` stands for; throws `WebSiteRefused` when it holds none or one that is no longer allowed. */
export function webSiteFromConfig(slot: number, config: unknown): BrowserSite {
  const c = (config ?? {}) as Partial<WebSiteConfig>;
  const check = c.check;
  if (typeof c.address !== "string" || !check || !["forbids", "unclear", "allows"].includes(check.verdict) || !Array.isArray(check.signInHosts)) throw new WebSiteRefused("No website is set up in this place.");
  return buildWebSite(slot, { address: c.address, check: { verdict: check.verdict, line: typeof check.line === "string" ? check.line.slice(0, 300) : null, termsUrl: typeof check.termsUrl === "string" ? check.termsUrl.slice(0, 500) : null, signInHosts: check.signInHosts.filter((h): h is string => typeof h === "string"), checkedOn: typeof check.checkedOn === "string" ? check.checkedOn.slice(0, 10) : "" } });
}
