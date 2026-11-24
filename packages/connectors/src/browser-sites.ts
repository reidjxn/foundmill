/**
 * The site list (founder, Nov 22, 2026): the websites the team may work in through the hosted browser, in the account
 * the founder signed in to. This is data, like the remote MCP servers' tool lists (`remote-mcp/servers.ts`).
 *
 * Three states:
 * - `open`: Foundmill read the site's terms on `terms.checkedOn` and they do not forbid automated use of the owner's
 *   own account. Each entry records the line it relies on and where it was read.
 * - `ask_first`: not yet checked by Foundmill. The founder is told so and decides once, when they connect the site.
 *   Every site on no list is `ask_first` (`siteStateOf`).
 * - `never`: the terms forbid it, or the category is one the team never works in (`NEVER_SITES`): banks, brokerages,
 *   government identity, health records and password managers. A never site cannot be connected, recommended or opened,
 *   whatever a session token says.
 *
 * The browser is the fourth route, used only when a tool has no MCP server and no usable API: an entry here is not a
 * reason to prefer it. Re-read a site's terms and move `checkedOn` when you touch its entry.
 */

import { APP_NAME } from "@foundmill/config";

export type BrowserSiteState = "open" | "ask_first" | "never";

export interface BrowserSite {
  /** snake_case, unique. The site's connector is `browser_<key>`. */
  key: string;
  name: string;
  state: "open" | "ask_first";
  /**
   * The exact hosts the session may be on: the site's own admin, never a wildcard, because on many sites a subdomain is
   * a page one of the site's users wrote. A redirect anywhere else ends the step.
   */
  hosts: readonly string[];
  /** Where the site's own sign-in lives, when that is another host. Only a sign-in page there is ever shown, and only to the founder. */
  signInHosts?: readonly string[];
  /** When set, only paths that start with one of these are opened (a host that also serves its users' public pages). */
  paths?: readonly string[];
  /** Where a session starts and where the founder signs in. */
  startUrl: string;
  /** What the site's terms say about automated use of an account, as read on `checkedOn`. */
  terms: { url: string; line: string; checkedOn: string };
  /** Paths (beyond `HARD_GATE_PATHS`) where pressing anything is the founder's own step. */
  hardGatePages?: readonly RegExp[];
  /** Paths (beyond `NEVER_PATHS`) the team never opens. */
  neverPages?: readonly RegExp[];
  /** Foundmill's own test page: for the operator's live checks and the evals, never shown to a founder. */
  testOnly?: true;
}

const END = "([-_./?#]|$)";
/** Pages where every press is the founder's: paying, plans, deleting or closing the account. Matched on the decoded path, query and fragment. */
export const HARD_GATE_PATHS: readonly RegExp[] = [new RegExp(`/(checkout|payments?|pay|purchase|order/confirm|subscribe|subscriptions?|upgrade|plans?|pricing)${END}`, "i"), /\/(delete|close|cancel|remove)[-_/]?(account|subscription|plan|store|site|workspace)/i, new RegExp(`/(sign|esign|signature)${END}`, "i")];

/** Pages the team never opens on any site: billing, security, API keys, and team and access settings. */
export const NEVER_PATHS: readonly RegExp[] = [
  new RegExp(`/(billing|invoices?/pay|payment[-_]?methods?|cards?)${END}`, "i"),
  new RegExp(`/(security|password|passkeys?|2fa|mfa|two[-_]?(factor|step)|sessions|devices|recovery)${END}`, "i"),
  new RegExp(`/(api[-_]?keys?|tokens?|developers?/apps|oauth|webhooks/secret)${END}`, "i"),
  new RegExp(`/(team|users|members|people|roles|permissions|access|staff|collaborators)${END}`, "i"),
];

/** A page's path, query and fragment as the rules read them: percent-decoding undone, so `/%62illing` and `/#/billing` are seen. */
function whereOf(u: URL): string {
  const raw = u.pathname + u.search + u.hash;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export interface NeverSite {
  domains: readonly string[];
  why: "bank" | "brokerage" | "government_identity" | "health_records" | "password_manager" | "terms_forbid";
}

/**
 * Sites that are never open. A category cannot be listed in full, so this names the ones founders are likeliest to
 * type; the connect dialog also says the categories in words, and the step classifier holds every payment, password
 * and signature whatever the site.
 */
export const NEVER_SITES: readonly NeverSite[] = [
  { why: "bank", domains: ["chase.com", "bankofamerica.com", "wellsfargo.com", "citi.com", "capitalone.com", "usbank.com", "mercury.com", "brex.com", "revolut.com", "wise.com", "monzo.com", "n26.com", "paypal.com", "venmo.com", "cash.app"] },
  { why: "brokerage", domains: ["schwab.com", "fidelity.com", "vanguard.com", "robinhood.com", "etrade.com", "interactivebrokers.com", "coinbase.com", "binance.com", "kraken.com"] },
  { why: "government_identity", domains: ["irs.gov", "login.gov", "id.me", "ssa.gov", "gov.uk", "usa.gov", "bankid.com", "skatteverket.se"] },
  { why: "health_records", domains: ["mychart.org", "mychart.com", "healthcare.gov", "nhs.uk"] },
  { why: "password_manager", domains: ["1password.com", "lastpass.com", "bitwarden.com", "dashlane.com", "keepersecurity.com", "proton.me"] },
  // Terms read on Nov 22, 2026 that forbid automated use of an account:
  // LinkedIn User Agreement 8.2(13): "Use bots or other unauthorized automated methods to access the Services".
  // Instagram terms of use: "accessing or collecting information in an automated way without our express permission, regardless of whether such automated access or collection is undertaken while logged-in".
  // Ko-fi terms (July 13, 2026): "Bots or other automatic means must not be used to interact with Ko-fi."
  // Big Cartel terms (07.21.23): "Access or attempt to access the Site ... using any automated means, such as robots, spiders, scrapers, scripts".
  // Typeform usage policy: access "through the use of any engine, software, tool, agent, device or mechanism (including automated scripts...) other than the Software and/or search agents provided by TYPEFORM".
  // Facebook, Threads and X are held with them until the founder decides on social networks' personal accounts (brief, question 2).
  { why: "terms_forbid", domains: ["linkedin.com", "instagram.com", "facebook.com", "threads.net", "threads.com", "x.com", "twitter.com", "ko-fi.com", "bigcartel.com", "typeform.com"] },
];

export const NEVER_WORDS: Readonly<Record<NeverSite["why"], string>> = Object.freeze({
  bank: "a bank or payments account",
  brokerage: "a brokerage or exchange account",
  government_identity: "a government or identity site",
  health_records: "a health records site",
  password_manager: "a password manager",
  terms_forbid: "a site whose terms do not allow automated use of an account",
});

const CHECKED = "2026-11-22";

/**
 * The first entries (Nov 22, 2026). Each has no MCP server and no API that covers its setup, and its terms, as read on
 * that day, do not forbid automated use of the owner's own account; none of them says in words that it is allowed. So
 * every entry is `ask_first` until the founder approves the list (brief, question 1): the connect dialog tells the
 * project's founder that Foundmill has not confirmed the site allows this. Moving an entry to `open` is that approval.
 * Read and left out: Xero, QuickBooks, Tally, Wix, Zoho and Google Business Profile have an API or an MCP server, so the
 * browser is not their route; Gumroad and Substack forbid sharing the account; Etsy's and Canva's terms could not be
 * read. Squarespace's terms were read and do not forbid it, but each site's admin lives on a subdomain that cannot be
 * told apart from another user's site, so it has no entry until its hosts can be named exactly. The hosts and paths
 * below are the admin addresses as known on that day: confirm each with a real account before its entry opens. A site on no list is `ask_first` too, and gets a connector only when it is added here.
 */
export const BROWSER_SITES: readonly BrowserSite[] = Object.freeze([
  // Foundmill's own test page (apps/sites `browser-test.ts`, founder, Nov 24, 2026), at `browser-test.<SITES_DOMAIN>`;
  // the production sites domain is foundmill.app. Open: Foundmill wrote it. Never offered to a founder (`testOnly`).
  // vocab-allow: the line below names the production sites domain, an address, not the product's name in copy.
  { key: "foundmill_test", name: `${APP_NAME} test page`, state: "open", testOnly: true, hosts: ["browser-test.foundmill.app"], startUrl: "https://browser-test.foundmill.app/", terms: { url: "https://browser-test.foundmill.app/", line: "Foundmill's own test page.", checkedOn: "2026-11-24" } },
  { key: "carrd", name: "Carrd", state: "ask_first", hosts: ["carrd.co"], paths: ["/dashboard", "/build"], startUrl: "https://carrd.co/dashboard", terms: { url: "https://carrd.com/docs/general/terms", line: "Forbids only to \"use an automatic device (such as a robot or spider) or manual process to copy or 'scrape' the Website or Website Content\"; silent on working in your own account.", checkedOn: CHECKED } },
  { key: "wave", name: "Wave", state: "ask_first", hosts: ["next.waveapps.com"], startUrl: "https://next.waveapps.com/", terms: { url: "https://www.waveapps.com/legal/terms-of-use", line: "No clause on automated access; \"If you authorize users ('Additional Users') to access and use certain parts of Wave on your behalf, they will have access to your account information\". Its API covers customers, invoices and products only.", checkedOn: CHECKED }, neverPages: [/\/(banking|payroll|payments\/setup|payouts?)([-_./?#]|$)/i] },
] satisfies BrowserSite[]);

const BY_KEY = new Map(BROWSER_SITES.map((s) => [s.key, s] as const));

export const browserSite = (key: string): BrowserSite | null => BY_KEY.get(key) ?? null;

const hostOf = (urlOrHost: string): string | null => {
  try {
    return new URL(urlOrHost.includes("://") ? urlOrHost : `https://${urlOrHost}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
};

/** True when `host` is one of `domains` or a subdomain of one. */
export const hostWithin = (host: string, domains: readonly string[]): boolean => domains.some((d) => host === d || host.endsWith(`.${d}`));

/** Why a host is never open, or null. */
export function neverReason(urlOrHost: string): NeverSite["why"] | null {
  const host = hostOf(urlOrHost);
  if (!host) return null;
  // Any .gov or .mil host, and any host that calls itself a bank, is treated as its category without being listed.
  if (/\.(gov|mil)(\.[a-z]{2})?$/.test(host)) return "government_identity";
  if (/bank/.test(host)) return "bank";
  return NEVER_SITES.find((n) => hostWithin(host, n.domains))?.why ?? null;
}

/** The list's entry for a host, or null: on no list. */
export function browserSiteForHost(urlOrHost: string): BrowserSite | null {
  const host = hostOf(urlOrHost);
  return host ? (BROWSER_SITES.find((s) => s.hosts.includes(host)) ?? null) : null;
}

/** The state of any site: its entry's, `never` for a never site, and `ask_first` for a site on no list. */
export function siteStateOf(urlOrHost: string): BrowserSiteState {
  if (neverReason(urlOrHost)) return "never";
  return browserSiteForHost(urlOrHost)?.state ?? "ask_first";
}

export type PageVerdict = { ok: true; url: URL } | { ok: false; code: "off_site" | "never_page" | "not_https"; host: string; message: string };

/** Whether a session on `site` may be at `url`: https, on the site's own domains, and not a page the team never opens. */
export function sitePageVerdict(site: Pick<BrowserSite, "name" | "hosts" | "paths" | "neverPages">, url: string): PageVerdict {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, code: "off_site", host: "", message: "That is not a web address." };
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:") return { ok: false, code: "not_https", host, message: `Only https pages of ${site.name} are opened.` };
  if (u.username || u.password || !site.hosts.includes(host) || neverReason(host)) return { ok: false, code: "off_site", host, message: `That address is on ${host}, outside ${site.name}. The session stays on ${site.name}.` };
  const where = whereOf(u);
  if (site.paths && !site.paths.some((p) => u.pathname === p || u.pathname.startsWith(`${p}/`))) return { ok: false, code: "off_site", host, message: `That page is outside the part of ${site.name} the team works in.` };
  if ([...NEVER_PATHS, ...(site.neverPages ?? [])].some((p) => p.test(where))) return { ok: false, code: "never_page", host, message: "The team never opens billing, security, API key or access pages. The founder opens that page themselves." };
  return { ok: true, url: u };
}

/** True on a page where every press is the founder's own (paying, plans, closing the account, signing). */
export function isHardGatePage(site: Pick<BrowserSite, "hardGatePages">, url: string): boolean {
  try {
    const u = new URL(url);
    return [...HARD_GATE_PATHS, ...(site.hardGatePages ?? [])].some((p) => p.test(whereOf(u)));
  } catch {
    return true;
  }
}
