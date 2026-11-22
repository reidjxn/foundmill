/**
 * A domain registered through Foundmill in the api (WP-08 domain plan, Path A; 0149), on the mocks: only the founders
 * quote, pay and turn forwarding on; Pay needs the agreement accepted and the price the founder saw; nothing is
 * registered until the checkout is paid, and then once; the founder's details are kept apart and deleted after; a live
 * payment Stripe has not confirmed registers nothing; nothing simulated on staging.
 */
import { repos } from "@foundmill/db";
import { MOCK_COM_COST_MINOR } from "@foundmill/connectors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiDeps, CallerUser } from "../context";
import { createCaller } from "../router";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "regdomain" });
}, 120_000);
afterAll(() => hz.close());

const ON = { PLATFORM_MAIL_DOMAIN: "mail.foundmill.test" } as const;
const callerWith = (env: Partial<ApiDeps["env"]>, user: CallerUser) => createCaller({ ...hz.deps, env: { ...hz.deps.env, ...env } }, user);
const OWNER = { firstName: "Maya", lastName: "Lee", address1: "12 Elm Street", city: "Springfield", state: "IL", postalCode: "62701", country: "US", phone: "+1.2175550123", email: "maya@example.com" };
const PRICE = MOCK_COM_COST_MINOR + 300;

describe("a domain, paid and then registered", () => {
  it("quotes OpenSRS's cost plus $3 for a founder; a member cannot", async () => {
    expect(await callerWith(ON, { userId: hz.A.ownerId }).integrations.quoteDomain({ businessId: hz.A.businessId, domain: "acme-goods.com" })).toEqual({ domain: "acme-goods.com", available: true, priceMinor: PRICE, simulated: true });
    await expect(callerWith(ON, { userId: hz.A.memberId }).integrations.quoteDomain({ businessId: hz.A.businessId, domain: "acme-goods.com" })).rejects.toThrow();
  });

  it("Pay is refused without the agreement accepted, or at another price, and opens nothing", async () => {
    const owner = callerWith(ON, { userId: hz.A.ownerId });
    await expect(owner.integrations.startDomainCheckout({ businessId: hz.A.businessId, domain: "acme-goods.com", priceMinor: PRICE, owner: OWNER, acceptAgreement: false as never })).rejects.toThrow();
    await expect(owner.integrations.startDomainCheckout({ businessId: hz.A.businessId, domain: "acme-goods.com", priceMinor: PRICE - 1, owner: OWNER, acceptAgreement: true })).rejects.toThrow(/price changed/);
    expect((await repos.checkouts.listRecent(hz.db, hz.A.businessId)).filter((c) => c.kind === "domain")).toHaveLength(0);
  });

  it("opens a domain checkout at the quoted price; nothing is registered until it is paid", async () => {
    const owner = callerWith(ON, { userId: hz.A.ownerId });
    const started = await owner.integrations.startDomainCheckout({ businessId: hz.A.businessId, domain: "acme-goods.com", priceMinor: PRICE, owner: OWNER, acceptAgreement: true });
    expect(started.mode).toBe("mock");
    expect(started.checkoutUrl).toContain("/settings/integrations?checkout=");
    const checkout = await repos.checkouts.get(hz.db, hz.A.businessId, started.checkoutId);
    expect(checkout).toMatchObject({ kind: "domain", status: "open", domainName: "acme-goods.com", amountMinor: PRICE });
    // The founder's details are kept apart from the checkout every founder reads.
    expect(await repos.domainRegistrants.get(hz.db, hz.A.businessId, started.checkoutId)).toMatchObject({ firstName: "Maya", email: "maya@example.com" });
    expect(await repos.projectDomains.get(hz.db, hz.A.businessId)).toBeNull();
    // Paying (simulated here) registers it, once: the founder's details are gone after.
    const done = await owner.integrations.completeDomainCheckout({ businessId: hz.A.businessId, checkoutId: started.checkoutId });
    expect(done.domain).toMatchObject({ domain: "acme-goods.com", source: "registered", priceMinor: PRICE, forwarding: false });
    expect(done.domain?.records.map((x) => x.purpose)).toEqual(["sending", "sending", "sending", "sending", "inbound", "dmarc"]);
    expect((await repos.checkouts.get(hz.db, hz.A.businessId, started.checkoutId)).status).toBe("paid");
    expect(await repos.domainRegistrants.get(hz.db, hz.A.businessId, started.checkoutId)).toBeNull();
    const row = await repos.projectDomains.get(hz.db, hz.A.businessId);
    expect(row).toMatchObject({ addedBy: hz.A.ownerId, simulated: true });
    await expect(owner.integrations.completeDomainCheckout({ businessId: hz.A.businessId, checkoutId: started.checkoutId })).rejects.toThrow(/has a domain already/);
    const log = await repos.audit.list(hz.db, hz.A.businessId, { limit: 50 });
    expect(log.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(["billing.checkout_started", "billing.domain_paid", "integrations.domain_registered"]));
    await expect(owner.integrations.removeOwnDomain({ businessId: hz.A.businessId })).rejects.toThrow(/stays with it/);
  });

  it("forwarding goes on only by a founder's own click, and off again", async () => {
    await expect(callerWith(ON, { userId: hz.A.memberId }).integrations.setDomainForwarding({ businessId: hz.A.businessId, on: true })).rejects.toThrow();
    const on = await callerWith(ON, { userId: hz.A.ownerId }).integrations.setDomainForwarding({ businessId: hz.A.businessId, on: true });
    expect(on.domain).toMatchObject({ forwarding: true, forwardingMine: true });
    // Another founder sees that the copy goes to someone else's inbox.
    expect((await callerWith(ON, { userId: hz.A.adminId }).integrations.ownDomain({ businessId: hz.A.businessId }))?.domain).toMatchObject({ forwarding: true, forwardingMine: false });
    expect((await repos.projectDomains.get(hz.db, hz.A.businessId))?.forwardingUserId).toBe(hz.A.ownerId);
    expect((await callerWith(ON, { userId: hz.A.ownerId }).integrations.setDomainForwarding({ businessId: hz.A.businessId, on: false })).domain?.forwarding).toBe(false);
  });

  it("one domain payment at a time; a paid one waiting is offered to finish; payment and registration modes must match", async () => {
    const owner = callerWith(ON, { userId: hz.B.ownerId });
    const started = await owner.integrations.startDomainCheckout({ businessId: hz.B.businessId, domain: "b-first.com", priceMinor: PRICE, owner: OWNER, acceptAgreement: true });
    await expect(owner.integrations.startDomainCheckout({ businessId: hz.B.businessId, domain: "b-second.com", priceMinor: PRICE, owner: OWNER, acceptAgreement: true })).rejects.toThrow(/already open/);
    expect((await owner.integrations.ownDomain({ businessId: hz.B.businessId }))?.pendingCheckout).toMatchObject({ id: started.checkoutId, domain: "b-first.com", paid: false, mode: "mock" });
    // A simulated payment for a live registry is never offered (and the reverse).
    await expect(callerWith({ ...ON, LIVE_CONNECTORS: "opensrs" }, { userId: hz.B.ownerId }).integrations.ownDomain({ businessId: hz.B.businessId })).resolves.toMatchObject({ canRegister: false });
    await repos.checkouts.markExpired(hz.db, hz.B.businessId, started.checkoutId);
  });

  it("a live payment Stripe has not confirmed registers nothing yet", async () => {
    const checkout = await repos.checkouts.create(hz.db, hz.B.businessId, { kind: "domain", mode: "live", amountMinor: PRICE, domainName: "b-goods.com", createdBy: hz.B.ownerId });
    const r = await callerWith(ON, { userId: hz.B.ownerId }).integrations.completeDomainCheckout({ businessId: hz.B.businessId, checkoutId: checkout.id });
    expect(r).toMatchObject({ waiting: true, domain: null });
    expect(await repos.projectDomains.get(hz.db, hz.B.businessId)).toBeNull();
  });

  it("another project's founder never pays or registers for it, and nothing simulated on staging", async () => {
    await expect(callerWith(ON, { userId: hz.B.ownerId }).integrations.startDomainCheckout({ businessId: hz.A.businessId, domain: "b-goods.com", priceMinor: PRICE, owner: OWNER, acceptAgreement: true })).rejects.toThrow();
    await expect(callerWith({ ...ON, APP_ENV: "staging" }, { userId: hz.B.ownerId }).integrations.quoteDomain({ businessId: hz.B.businessId, domain: "b-goods.com" })).rejects.toThrow(/not available yet/);
    expect(await repos.projectDomains.get(hz.db, hz.B.businessId)).toBeNull();
  });
});
