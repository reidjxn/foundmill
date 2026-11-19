/**
 * Domain names for the Commit screen's availability check (audit 2026-10-13 #458). One definition for the web (which
 * candidates it asks about), the api (which it accepts) and the `domains` connector (which it will look up): a name is
 * only ever looked up when it is `parseDomain`-valid, so nothing built from free text reaches a registry.
 */
import { z } from "zod";

/** The top-level domains the checker answers for. */
export const DOMAIN_TLDS = ["com", "io", "co", "app", "ai", "org", "net", "dev"] as const;
export type DomainTld = (typeof DOMAIN_TLDS)[number];

/** The TLDs offered as candidates for a business name, in the order the Commit screen lists them. */
export const DOMAIN_CANDIDATE_TLDS: readonly DomainTld[] = ["com", "io", "co", "app", "ai"];

/** Most domains one call may ask about (one registry request each). */
export const DOMAIN_CHECK_MAX = 8;

/** Letters, digits and inner hyphens, 1 to 63 characters (RFC 1035 label, no leading or trailing hyphen). */
export const DOMAIN_LABEL_RE = /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface ParsedDomain {
  /** Lower case, as it will be looked up. */
  domain: string;
  label: string;
  tld: DomainTld;
}

/** `label.tld` with a valid label and an allowed TLD, else null. Case is ignored; nothing else (paths, ports, subdomains) passes. */
export function parseDomain(input: string): ParsedDomain | null {
  const domain = input.trim().toLowerCase();
  const dot = domain.lastIndexOf(".");
  if (dot < 1) return null;
  const label = domain.slice(0, dot);
  const tld = domain.slice(dot + 1);
  if (!DOMAIN_LABEL_RE.test(label) || !(DOMAIN_TLDS as readonly string[]).includes(tld)) return null;
  return { domain, label, tld: tld as DomainTld };
}

/** A business name as one domain label: accents folded, letters and digits only. Empty when nothing usable is left or it is too long. */
export function domainSlug(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return DOMAIN_LABEL_RE.test(slug) ? slug : "";
}

/** `ledgerly.com`, `ledgerly.io`... for a business name; none when the name cannot make a valid label. */
export function domainCandidates(name: string): string[] {
  const slug = domainSlug(name);
  return slug ? DOMAIN_CANDIDATE_TLDS.map((tld) => `${slug}.${tld}`) : [];
}

/* ---- A project's own domain (WP-08 domain plan, Path B: a domain the founder already owns) ---- */

/** The subdomain SendGrid's domain authentication uses for the return path (`em.<domain>`), so the founder's own MX is never touched. */
export const OWN_DOMAIN_SENDING_SUBDOMAIN = "em";

/** The host the project's site answers on at the founder's domain (`www.<domain>`, a CNAME to its Foundmill site address). */
export const OWN_DOMAIN_SITE_HOST = "www";

/** The name a message from the founder's domain is sent as (`<local part>@<domain>`) until the founders change it. */
export const OWN_DOMAIN_DEFAULT_SENDER = "hello";

/** A local part for the sender on the founder's own domain: letters, digits, dots, hyphens and underscores, 1 to 40. */
export const OWN_DOMAIN_SENDER_RE = /^(?=.{1,40}$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

/** At least two labels, each a valid label, the last letters only (or an IDN `xn--` one), 253 characters at most. */
const OWN_DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * A domain the founder typed, as it will be authenticated: lower case, without a scheme, a path, a port, a trailing dot
 * or a leading `www.`. Null when what is left is not a domain name, or it is one of the product's own (`brand`, the
 * product's name in lower case, anywhere in it), so no project sends as Foundmill.
 */
export function normalizeOwnDomain(input: string, brand: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (d.startsWith("www.")) d = d.slice(4);
  if (!OWN_DOMAIN_RE.test(d)) return null;
  const mark = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  return mark && d.replace(/[^a-z0-9]/g, "").includes(mark) ? null : d;
}

/** What a DNS record on a project's own domain is for. */
export const OWN_DOMAIN_RECORD_PURPOSES = ["sending", "site", "inbound", "dmarc"] as const;
export type OwnDomainRecordPurpose = (typeof OWN_DOMAIN_RECORD_PURPOSES)[number];

/** One record the founder adds (or Foundmill adds for them), and whether the last check found it. */
export interface OwnDomainRecord {
  purpose: OwnDomainRecordPurpose;
  type: "CNAME" | "MX" | "TXT";
  /** The full name the record is on (`em.acme.com`). */
  host: string;
  value: string;
  priority?: number;
  /** null until checked. */
  found: boolean | null;
  /** Why the check did not find it, in the vendor's or the resolver's words (no secrets in either). */
  reason?: string;
}

/** The site record for a project with a Foundmill site: `www.<domain>` CNAME `<site address host>`. */
export function ownDomainSiteRecord(domain: string, siteHost: string): OwnDomainRecord {
  return { purpose: "site", type: "CNAME", host: `${OWN_DOMAIN_SITE_HOST}.${domain}`, value: siteHost, found: null };
}

/** Sending is ready when every sending record was found by the last check. */
export function ownDomainSendingReady(records: readonly OwnDomainRecord[]): boolean {
  const sending = records.filter((r) => r.purpose === "sending");
  return sending.length > 0 && sending.every((r) => r.found === true);
}

/* ---- A domain registered through Foundmill (WP-08 domain plan, Path A, on OpenSRS) ---- */

/** Added to OpenSRS's cost for a year of a domain (founder, Nov 17, 2026: cost plus about $3); the price is an Estimate. */
export const DOMAIN_REGISTRATION_MARKUP_MINOR = 300;

/** The founder's price for a year, in USD cents: OpenSRS's cost plus the markup. Shown labeled "Estimate". */
export const domainRegistrationEstimate = (costMinor: number): number => costMinor + DOMAIN_REGISTRATION_MARKUP_MINOR;

/** Tucows' registration agreement, which the founder accepts as the domain's owner before registering. */
export const DOMAIN_REGISTRATION_AGREEMENT_URL = "https://opensrs.com/wp-content/uploads/Master_Domain_Registration_Agreement.html";

/** Mail to a registered domain comes into Foundmill through SendGrid Inbound Parse. */
export const REGISTERED_DOMAIN_MX = "mx.sendgrid.net";

/** DMARC at first: report only (founder, Nov 19, 2026), tightened once the reports are clean. */
export const REGISTERED_DOMAIN_DMARC = "v=DMARC1; p=none;";

/**
 * The person who registers the domain, as its owner (registrant of record) and admin and billing contact (founder, Nov
 * 17, 2026: "It should always be our end user"). Never a Foundmill default.
 */
export const RegistrantContact = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  orgName: z.string().trim().max(100).optional(),
  address1: z.string().trim().min(1).max(100),
  address2: z.string().trim().max(100).optional(),
  city: z.string().trim().min(1).max(60),
  state: z.string().trim().max(60).default(""),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "country is a two-letter code"),
  /** OpenSRS's form: +<country code>.<number>, such as +1.4165550123. */
  phone: z.string().trim().regex(/^\+\d{1,3}\.\d{4,14}$/, "phone looks like +1.4165550123"),
  email: z.email().max(254),
});
export type RegistrantContact = z.infer<typeof RegistrantContact>;
