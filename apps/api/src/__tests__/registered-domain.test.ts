/**
 * A domain registered through Foundmill in the api (WP-08 domain plan, Path A), on the mocks: only the founders quote,
 * register and turn forwarding on; the press needs the agreement accepted and the price the founder saw; the founder is
 * the owner; the press is audited; a registered domain cannot be removed; nothing simulated on staging.
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

describe("integrations.registerDomain", () => {
  it("quotes OpenSRS's cost plus $3 for a founder; a member cannot", async () => {
    expect(await callerWith(ON, { userId: hz.A.ownerId }).integrations.quoteDomain({ businessId: hz.A.businessId, domain: "acme-goods.com" })).toEqual({ domain: "acme-goods.com", available: true, priceMinor: PRICE, simulated: true });
    await expect(callerWith(ON, { userId: hz.A.memberId }).integrations.quoteDomain({ businessId: hz.A.businessId, domain: "acme-goods.com" })).rejects.toThrow();
  });

  it("refuses the press without the agreement accepted, or at another price", async () => {
    const owner = callerWith(ON, { userId: hz.A.ownerId });
    await expect(owner.integrations.registerDomain({ businessId: hz.A.businessId, domain: "acme-goods.com", priceMinor: PRICE, owner: OWNER, acceptAgreement: false as never })).rejects.toThrow();
    await expect(owner.integrations.registerDomain({ businessId: hz.A.businessId, domain: "acme-goods.com", priceMinor: PRICE - 1, owner: OWNER, acceptAgreement: true })).rejects.toThrow(/price changed/);
    expect(await repos.projectDomains.get(hz.db, hz.A.businessId)).toBeNull();
  });

  it("registers for the founder, sets the records, audits the press, and cannot be removed", async () => {
    const owner = callerWith(ON, { userId: hz.A.ownerId });
    const r = await owner.integrations.registerDomain({ businessId: hz.A.businessId, domain: "acme-goods.com", priceMinor: PRICE, owner: OWNER, acceptAgreement: true });
    expect(r.domain).toMatchObject({ domain: "acme-goods.com", source: "registered", priceMinor: PRICE, forwarding: false });
    expect(r.domain?.records.map((x) => x.purpose)).toEqual(["sending", "sending", "sending", "sending", "inbound", "dmarc"]);
    expect((await repos.projectDomains.get(hz.db, hz.A.businessId))?.addedBy).toBe(hz.A.ownerId);
    const log = await repos.audit.list(hz.db, hz.A.businessId, { limit: 20 });
    expect(log.items.find((e: { action: string }) => e.action === "integrations.domain_registered")?.details).toMatchObject({ domain: "acme-goods.com", priceMinor: PRICE, agreementAccepted: true, simulated: true });
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

  it("another project's founder never registers for it, and nothing simulated on staging", async () => {
    await expect(callerWith(ON, { userId: hz.B.ownerId }).integrations.registerDomain({ businessId: hz.A.businessId, domain: "b-goods.com", priceMinor: PRICE, owner: OWNER, acceptAgreement: true })).rejects.toThrow();
    await expect(callerWith({ ...ON, APP_ENV: "staging" }, { userId: hz.B.ownerId }).integrations.quoteDomain({ businessId: hz.B.businessId, domain: "b-goods.com" })).rejects.toThrow(/not available yet/);
    expect(await repos.projectDomains.get(hz.db, hz.B.businessId)).toBeNull();
  });
});
