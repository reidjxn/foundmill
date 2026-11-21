/**
 * A domain registered through Foundmill (docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md, Path A), one flow for
 * both callers like the own-domain flow: the gateway runs it on the live connectors (`POST /v1/domains/register`), the
 * api on the mocks.
 *
 *   quote     OpenSRS says whether the name is free and its cost for a year; the founder's price is that plus the
 *             markup (`domainRegistrationEstimate`), shown as an Estimate.
 *   register  the founder pressed Register with the price and Tucows' agreement in front of them (the api checks the
 *             acceptance and who pressed). The price is quoted again and must be the one they saw; OpenSRS registers
 *             the name with the founder as owner, admin and billing contact; the row is written at once (a registration
 *             that went through is never lost), then `setup` runs.
 *   setup     SendGrid's domain authentication, then the whole zone on OpenSRS's DNS: the ownership TXT, SendGrid's
 *             CNAMEs, the site's `www`, MX to SendGrid Inbound Parse (mail comes into Foundmill) and DMARC `p=none`.
 *             Safe to run again ("Finish setup") when a step failed after the registration.
 */
import { AppError, domainRegistrationEstimate, OWN_DOMAIN_DEFAULT_SENDER, OWN_DOMAIN_SENDING_SUBDOMAIN, ownDomainSiteRecord, parseDomain, REGISTERED_DOMAIN_DMARC, REGISTERED_DOMAIN_MX, type OwnDomainRecord, type RegistrantContact } from "@foundmill/shared";
import { ownershipRecord, type OwnDomainRow } from "../sending_domain/flow";
import type { ZoneRecordT } from "./tools";

export interface DomainQuote {
  domain: string;
  available: boolean;
  /** USD cents for a year: OpenSRS's cost plus the markup. An Estimate. Null when the name is not available. */
  priceMinor: number | null;
}

export interface RegisteredDomainStore<R extends OwnDomainRow> {
  get(businessId: string): Promise<R | null>;
  putRegistered(businessId: string, input: { domain: string; senderLocalPart: string; orderId: string; registeredAt: Date; expiresAt: Date; priceMinor: number; addedBy: string | null; simulated: boolean }): Promise<R>;
  saveSetup(businessId: string, input: { sendgridDomainId: string; records: OwnDomainRecord[] }): Promise<R | null>;
}

export interface RegisterFlowDeps<R extends OwnDomainRow> {
  /** One `opensrs` tool call. */
  registrar<T>(tool: string, args: Record<string, unknown>): Promise<T>;
  /** One `sending_domain` tool call. */
  sending<T>(tool: string, args: Record<string, unknown>): Promise<T>;
  store: RegisteredDomainStore<R>;
  simulated: boolean;
}

/** The domain as a registrable name: `label.tld` with an allowed TLD (the Commit screen's list), else null. */
export const registrableDomain = (input: string): string | null => parseDomain(input.trim().toLowerCase().replace(/\.$/, ""))?.domain ?? null;

export async function quoteDomain(deps: Pick<RegisterFlowDeps<OwnDomainRow>, "registrar">, input: string): Promise<DomainQuote> {
  const domain = registrableDomain(input);
  if (!domain) throw new AppError("validation", "Enter a name like yourproject.com, ending in .com, .io, .co, .app, .ai, .org, .net or .dev.", 400);
  const r = await deps.registrar<{ available: boolean; costMinor: number | null }>("lookup_domain", { domain });
  return { domain, available: r.available && r.costMinor !== null, priceMinor: r.available && r.costMinor !== null ? domainRegistrationEstimate(r.costMinor) : null };
}

/**
 * shortcut: check-then-register is not atomic (two presses at once could both register). Harmless while a live
 * `register` is refused; before it opens, register from the paid domain checkout's webhook with the checkout as the
 * idempotency key and a placeholder row written first.
 */
export async function registerDomain<R extends OwnDomainRow>(deps: RegisterFlowDeps<R>, input: { businessId: string; userId: string; domain: string; owner: RegistrantContact; priceMinor: number; siteHost: string | null }): Promise<R> {
  if (await deps.store.get(input.businessId)) throw new AppError("domain_exists", "This project has a domain already. Remove it first to register another.", 409);
  const quote = await quoteDomain(deps, input.domain);
  if (!quote.available || quote.priceMinor === null) throw new AppError("domain_unavailable", `${quote.domain} is not available. Try another name.`, 409);
  if (quote.priceMinor !== input.priceMinor) throw new AppError("price_changed", "The price changed since you looked. Check the new price and press Register again.", 409, { priceMinor: quote.priceMinor });
  const done = await deps.registrar<{ orderId: string; registeredAt: string; expiresAt: string }>("register_domain", { domain: quote.domain, owner: input.owner });
  const row = await deps.store.putRegistered(input.businessId, { domain: quote.domain, senderLocalPart: OWN_DOMAIN_DEFAULT_SENDER, orderId: done.orderId, registeredAt: new Date(done.registeredAt), expiresAt: new Date(done.expiresAt), priceMinor: quote.priceMinor, addedBy: input.userId, simulated: deps.simulated });
  // The registration went through: a failure from here on leaves the row for "Finish setup".
  return (await setupRegisteredDomain(deps, { businessId: input.businessId, siteHost: input.siteHost }).catch(() => null)) ?? row;
}

/** The records Foundmill sets on a registered domain, relative to it (`subdomain` "" is the domain itself). */
export function registeredZone(businessId: string, domain: string, sendgrid: readonly { type: string; host: string; value: string }[], siteHost: string | null): { records: OwnDomainRecord[]; zone: ZoneRecordT[] } {
  const records: OwnDomainRecord[] = [
    ownershipRecord(businessId, domain),
    ...sendgrid.map((r): OwnDomainRecord => ({ purpose: "sending", type: r.type as OwnDomainRecord["type"], host: r.host, value: r.value, found: null })),
    ...(siteHost ? [ownDomainSiteRecord(domain, siteHost)] : []),
    { purpose: "inbound", type: "MX", host: domain, value: REGISTERED_DOMAIN_MX, priority: 10, found: null },
    { purpose: "dmarc", type: "TXT", host: `_dmarc.${domain}`, value: REGISTERED_DOMAIN_DMARC, found: null },
  ];
  const sub = (host: string) => (host === domain ? "" : host.slice(0, -(domain.length + 1)));
  return { records, zone: records.map((r) => ({ type: r.type, subdomain: sub(r.host), value: r.value, ...(r.priority !== undefined ? { priority: r.priority } : {}) })) };
}

export async function setupRegisteredDomain<R extends OwnDomainRow>(deps: RegisterFlowDeps<R>, input: { businessId: string; siteHost: string | null }): Promise<R | null> {
  const row = await deps.store.get(input.businessId);
  if (!row || row.source !== "registered") throw new AppError("not_found", "No domain registered for this project.", 404);
  // A domain registered on the mocks was never registered: the live vendors never set it up.
  if (Boolean(row.simulated) !== deps.simulated) throw new AppError("domain_simulated", "This domain was registered in test mode and does not exist. Nothing was changed.", 409);
  let sendgridDomainId = row.sendgridDomainId;
  let sendgrid = row.records.filter((r) => r.purpose === "sending" && r.type === "CNAME");
  if (!sendgridDomainId) {
    const added = await deps.sending<{ sendgridDomainId: string; records: { type: string; host: string; value: string }[] }>("authenticate_domain", { domain: row.domain, subdomain: OWN_DOMAIN_SENDING_SUBDOMAIN });
    sendgridDomainId = added.sendgridDomainId;
    sendgrid = added.records.map((r) => ({ purpose: "sending", type: r.type as OwnDomainRecord["type"], host: r.host, value: r.value, found: null }));
  }
  const { records, zone } = registeredZone(input.businessId, row.domain, sendgrid, input.siteHost);
  await deps.registrar("set_dns_zone", { domain: row.domain, records: zone });
  return deps.store.saveSetup(input.businessId, { sendgridDomainId, records });
}
