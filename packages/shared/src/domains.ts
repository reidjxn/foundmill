/**
 * Domain names for the Commit screen's availability check (audit 2026-10-13 #458). One definition for the web (which
 * candidates it asks about), the api (which it accepts) and the `domains` connector (which it will look up): a name is
 * only ever looked up when it is `parseDomain`-valid, so nothing built from free text reaches a registry.
 */

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
