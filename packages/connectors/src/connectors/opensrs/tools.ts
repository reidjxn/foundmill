/**
 * `opensrs`: domains registered through Foundmill (docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md, Path A), on
 * Foundmill's OpenSRS reseller account (XCP over HTTPS, signed with the reseller username and API key; gateway only, and
 * the live host needs the gateway's IP on OpenSRS's allow list).
 *
 * Service-only (`SERVICE_ONLY_CONNECTORS`): the gateway's `POST /v1/domains/register` calls it live after the founder
 * pressed Register with the price and the terms in front of them, and the api runs its mock. No agent session reaches
 * it: registering spends money, accepts Tucows' agreement and uses the founder's identity (hard gates).
 *
 * The founder is the owner contact (OpenSRS: "the registrant contact (known as the Owner contact in OpenSRS)", .CA
 * policy) and the admin and billing contact; the tech contact is the reseller's default (`custom_tech_contact: 0`).
 */
import { z } from "zod";
import { RegistrantContact } from "@foundmill/shared";
import { defineTool } from "../../define";

export const OPENSRS_KEY = "opensrs";
export const OPENSRS_RATE_LIMITS = { perMinute: 30 };

export const OPENSRS_HOSTS = { test: "https://horizon.opensrs.net:55443", live: "https://rr-n1-tor.opensrs.net:55443" } as const;

/** OpenSRS's own DNS service: the zone the connector writes is served from these. */
export const OPENSRS_NAMESERVERS = ["ns1.systemdns.com", "ns2.systemdns.com", "ns3.systemdns.com"] as const;

const Domain = z.string().trim().toLowerCase().regex(/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
/** A record in the zone, relative to the domain: `subdomain` "" is the domain itself. */
export const ZoneRecord = z.object({
  type: z.enum(["CNAME", "MX", "TXT"]),
  subdomain: z.string().regex(/^$|^(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?)(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?)*$/),
  value: z.string().trim().min(1).max(500),
  priority: z.number().int().min(0).max(65535).optional(),
});
export type ZoneRecordT = z.infer<typeof ZoneRecord>;

export const opensrsTools = [
  defineTool({
    name: "lookup_domain",
    description: "Platform only: whether a domain can be registered, and OpenSRS's cost for a year in USD cents. Never available to agents.",
    input: z.object({ domain: Domain }),
    output: z.object({ domain: z.string(), available: z.boolean(), costMinor: z.number().int().nullable() }),
    hints: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }),
  defineTool({
    name: "register_domain",
    description: "Platform only: register a domain for a year with the founder as its owner. Spends money and accepts the registration agreement; never available to agents.",
    input: z.object({ domain: Domain, owner: RegistrantContact }),
    output: z.object({ orderId: z.string(), registeredAt: z.string(), expiresAt: z.string() }),
    hints: { spendsMoney: true, irreversible: true, contactsThirdParty: true },
  }),
  defineTool({
    name: "set_dns_zone",
    description: "Platform only: set a registered domain's DNS records on OpenSRS's DNS service. Never available to agents.",
    input: z.object({ domain: Domain, records: z.array(ZoneRecord).min(1).max(20) }),
    output: z.object({ nameserversOk: z.boolean() }),
    hints: { irreversible: true },
  }),
] as const;

/** One contact as OpenSRS's `contact_set` takes it. */
export function opsContact(c: RegistrantContact): Record<string, string> {
  return {
    first_name: c.firstName,
    last_name: c.lastName,
    org_name: c.orgName?.trim() || `${c.firstName} ${c.lastName}`,
    address1: c.address1,
    ...(c.address2 ? { address2: c.address2 } : {}),
    city: c.city,
    state: c.state,
    postal_code: c.postalCode,
    country: c.country,
    phone: c.phone,
    email: c.email,
  };
}

/** The `records` block of create_dns_zone and set_dns_zone, keyed by type. */
export function opsRecords(records: readonly ZoneRecordT[]): Record<string, Record<string, string | number>[]> {
  const out: Record<string, Record<string, string | number>[]> = {};
  for (const r of records) {
    const entry: Record<string, string | number> = r.type === "TXT" ? { subdomain: r.subdomain, text: r.value } : r.type === "MX" ? { subdomain: r.subdomain, hostname: r.value, priority: r.priority ?? 10 } : { subdomain: r.subdomain, hostname: r.value };
    (out[r.type] ??= []).push(entry);
  }
  return out;
}
