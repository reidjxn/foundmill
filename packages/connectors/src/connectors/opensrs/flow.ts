/**
 * A domain registered through Foundmill (docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md, Path A), one flow for
 * both callers like the own-domain flow: the gateway runs it on the live connectors (`POST /v1/domains/register`), the
 * api on the mocks.
 *
 *   quote     OpenSRS says whether the name is free and its cost for a year; the founder's price is that plus the
 *             markup (`domainRegistrationEstimate`), shown as an Estimate.
 *   register  only for a paid domain checkout (0149): the founder saw the price and Tucows' agreement, entered their
 *             details and paid; the checkout is claimed once, OpenSRS registers the name with the founder as owner,
 *             admin and billing contact, the row is written at once (a registration that went through is never lost),
 *             the founder's details are deleted, then `setup` runs.
 *   setup     SendGrid's domain authentication, then the whole zone on OpenSRS's DNS: the ownership TXT, SendGrid's
 *             CNAMEs, the site's `www`, MX to SendGrid Inbound Parse (mail comes into Foundmill) and DMARC `p=none`.
 *             Safe to run again ("Finish setup") when a step failed after the registration.
 */
import { APP_NAME } from "@foundmill/config";
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

/** A paid domain checkout, claimed for its one registration (0149). */
export interface DomainOrder {
  domain: string;
  /** What the founder paid, USD cents. */
  priceMinor: number;
  owner: RegistrantContact;
  /** Paid by a simulated payment: it never pays for a live registration. */
  simulated: boolean;
  /** The founder who paid (and is the registrant). */
  createdBy: string | null;
}

/** The paid domain checkouts: claim one for its registration, give it back if the registry refused, close it after. */
export interface DomainOrders {
  claim(businessId: string, checkoutId: string): Promise<DomainOrder | null>;
  release(businessId: string, checkoutId: string, failure: string): Promise<void>;
  /** Records why, keeping the claim (the outcome is not known, or the registration went through). */
  note(businessId: string, checkoutId: string, failure: string): Promise<void>;
  done(businessId: string, checkoutId: string): Promise<void>;
}

/**
 * The registration a paid domain checkout allows, once. The founder paid the price they were shown, for this name, with
 * these registrant details; the claim is atomic, so a second press, a retry or a replayed webhook registers nothing. If
 * the name was taken in the meantime or the registry refused outright, the claim is given back with why (the founder
 * can try again, or Foundmill refunds the payment: money only goes out by a person at Stripe). An unclear answer keeps
 * the claim: the name may be registered.
 */
export async function registerDomain<R extends OwnDomainRow>(deps: RegisterFlowDeps<R> & { orders: DomainOrders }, input: { businessId: string; userId: string; checkoutId: string; siteHost: string | null }): Promise<R> {
  if (await deps.store.get(input.businessId)) throw new AppError("domain_exists", "This project has a domain already.", 409);
  const order = await deps.orders.claim(input.businessId, input.checkoutId);
  if (!order) throw new AppError("not_paid", "This payment cannot register a domain: it is not paid yet, or its domain is already being registered.", 409);
  if (order.simulated !== deps.simulated) {
    await deps.orders.release(input.businessId, input.checkoutId, "a simulated payment never pays for a live registration");
    throw new AppError("not_paid", "This payment was simulated: it cannot register a real domain.", 409);
  }
  let done: { orderId: string; registeredAt: string; expiresAt: string };
  try {
    const quote = await quoteDomain(deps, order.domain);
    if (!quote.available) throw new AppError("domain_unavailable", `${order.domain} was registered by someone else in the meantime. Your payment will be refunded.`, 409);
    done = await deps.registrar("register_domain", { domain: order.domain, owner: order.owner });
  } catch (e) {
    // Only a definite refusal gives the payment back for another try (or a refund): after a timeout or a 5xx the
    // registry may have registered the name, so the claim stays and Foundmill checks before anything else happens.
    // The failure is a fixed sentence, never the vendor's text (it could echo the founder's details).
    const status = (e as { status?: unknown }).status;
    const taken = e instanceof AppError && e.code === "domain_unavailable";
    if (taken || (typeof status === "number" && status >= 400 && status < 500)) await deps.orders.release(input.businessId, input.checkoutId, taken ? "The name was taken before it could be registered." : "The registry refused the registration.");
    else await deps.orders.note(input.businessId, input.checkoutId, `The registry did not answer clearly. ${APP_NAME} checks this registration before anything else happens.`);
    throw e;
  }
  let row: R;
  try {
    row = await deps.store.putRegistered(input.businessId, { domain: order.domain, senderLocalPart: OWN_DOMAIN_DEFAULT_SENDER, orderId: done.orderId, registeredAt: new Date(done.registeredAt), expiresAt: new Date(done.expiresAt), priceMinor: order.priceMinor, addedBy: order.createdBy ?? input.userId, simulated: deps.simulated });
  } catch (e) {
    // Registered at the registry but not recorded here: the claim stays, with the order id to record it by hand.
    await deps.orders.note(input.businessId, input.checkoutId, `Registered at the registry (order ${done.orderId}) but not recorded yet.`).catch(() => undefined);
    throw e;
  }
  await deps.orders.done(input.businessId, input.checkoutId);
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
