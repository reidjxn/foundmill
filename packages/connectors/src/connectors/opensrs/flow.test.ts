/**
 * The registration flow (Path A) on the mocks: the price must be the one the founder saw; OpenSRS gets the founder as
 * owner; the row is written as soon as the registration went through; the zone carries the ownership TXT, SendGrid's
 * CNAMEs, the site, MX to Foundmill's inbound and DMARC p=none; one domain per project.
 */
import { describe, expect, it } from "vitest";
import type { OwnDomainRecord, RegistrantContact } from "@foundmill/shared";
import { makeToolContext } from "../../testing/contract-suite";
import type { OwnDomainRow } from "../sending_domain/flow";
import { sendingDomainMock } from "../sending_domain/mock";
import { MOCK_COM_COST_MINOR, opensrsMock } from "./index";
import { quoteDomain, registerDomain, registeredZone, setupRegisteredDomain, type RegisterFlowDeps } from "./flow";

const BIZ = "0f0a0d00-0000-4000-8000-0000000000b1";
const FOUNDER: RegistrantContact = { firstName: "Maya", lastName: "Lee", address1: "12 Elm Street", city: "Springfield", state: "IL", postalCode: "62701", country: "US", phone: "+1.2175550123", email: "maya@example.com" };

function deps(overrides: Partial<RegisterFlowDeps<OwnDomainRow>> = {}) {
  const rows = new Map<string, OwnDomainRow & Record<string, unknown>>();
  const asked: { tool: string; args: Record<string, unknown> }[] = [];
  const via = (c: typeof opensrsMock) => async <T>(tool: string, args: Record<string, unknown>): Promise<T> => {
    asked.push({ tool, args });
    const r = await c.callTool(tool, args, makeToolContext(c));
    if (!r.ok) throw new Error(r.error?.message);
    return r.data as T;
  };
  const d: RegisterFlowDeps<OwnDomainRow> = {
    registrar: via(opensrsMock),
    sending: via(sendingDomainMock),
    simulated: true,
    store: {
      get: async (id) => rows.get(id) ?? null,
      putRegistered: async (id, input) => {
        const row = { domain: input.domain, senderLocalPart: input.senderLocalPart, sendgridDomainId: null, records: [] as OwnDomainRecord[], status: "pending", source: "registered", simulated: input.simulated, orderId: input.orderId };
        rows.set(id, row);
        return row;
      },
      saveSetup: async (id, input) => {
        const row = { ...rows.get(id)!, ...input };
        rows.set(id, row);
        return row;
      },
    },
    ...overrides,
  };
  return { d, rows, asked };
}

describe("registering a domain", () => {
  it("quotes OpenSRS's cost plus $3, as the founder's price", async () => {
    expect(await quoteDomain(deps().d, "Acme-Goods.com")).toEqual({ domain: "acme-goods.com", available: true, priceMinor: MOCK_COM_COST_MINOR + 300 });
    expect((await quoteDomain(deps().d, "google.com")).available).toBe(false);
    await expect(quoteDomain(deps().d, "acme.xyz")).rejects.toThrow(/ending in/);
  });

  it("refuses a price other than the one the founder saw, before anything is registered", async () => {
    const { d, asked } = deps();
    await expect(registerDomain(d, { businessId: BIZ, userId: BIZ, domain: "acme-goods.com", owner: FOUNDER, priceMinor: 100, siteHost: null })).rejects.toMatchObject({ code: "price_changed" });
    expect(asked.map((a) => a.tool)).toEqual(["lookup_domain"]);
  });

  it("registers with the founder as owner and sets every record in the zone", async () => {
    const { d, rows, asked } = deps();
    const row = await registerDomain(d, { businessId: BIZ, userId: BIZ, domain: "acme-goods.com", owner: FOUNDER, priceMinor: MOCK_COM_COST_MINOR + 300, siteHost: "acme.foundmill.app" });
    expect(asked.map((a) => a.tool)).toEqual(["lookup_domain", "register_domain", "authenticate_domain", "set_dns_zone"]);
    expect(asked.find((a) => a.tool === "register_domain")?.args.owner).toEqual(FOUNDER);
    expect(row.sendgridDomainId).toEqual(expect.any(String));
    expect(rows.get(BIZ)?.records.map((r) => [r.purpose, r.type, r.host])).toEqual([
      ["sending", "TXT", "_foundmill.acme-goods.com"],
      ["sending", "CNAME", "em.acme-goods.com"],
      ["sending", "CNAME", "s1._domainkey.acme-goods.com"],
      ["sending", "CNAME", "s2._domainkey.acme-goods.com"],
      ["site", "CNAME", "www.acme-goods.com"],
      ["inbound", "MX", "acme-goods.com"],
      ["dmarc", "TXT", "_dmarc.acme-goods.com"],
    ]);
    const zone = asked.find((a) => a.tool === "set_dns_zone")?.args.records as { type: string; subdomain: string; value: string }[];
    expect(zone).toContainEqual({ type: "MX", subdomain: "", value: "mx.sendgrid.net", priority: 10 });
    expect(zone).toContainEqual({ type: "TXT", subdomain: "_dmarc", value: "v=DMARC1; p=none;" });
    expect(zone).toContainEqual({ type: "CNAME", subdomain: "www", value: "acme.foundmill.app" });
  });

  it("one domain per project", async () => {
    const { d } = deps();
    await registerDomain(d, { businessId: BIZ, userId: BIZ, domain: "acme-goods.com", owner: FOUNDER, priceMinor: MOCK_COM_COST_MINOR + 300, siteHost: null });
    await expect(registerDomain(d, { businessId: BIZ, userId: BIZ, domain: "acme-two.com", owner: FOUNDER, priceMinor: MOCK_COM_COST_MINOR + 300, siteHost: null })).rejects.toMatchObject({ code: "domain_exists" });
  });

  it("keeps the row when the setup fails after the registration went through", async () => {
    const { d, rows } = deps();
    const failing = { ...d, sending: async () => Promise.reject(new Error("SendGrid down")) };
    const row = await registerDomain(failing, { businessId: BIZ, userId: BIZ, domain: "acme-goods.com", owner: FOUNDER, priceMinor: MOCK_COM_COST_MINOR + 300, siteHost: null });
    expect(row).toMatchObject({ domain: "acme-goods.com", source: "registered", sendgridDomainId: null });
    expect(rows.has(BIZ)).toBe(true);
  });

  it("a domain registered on the mocks is never set up on the live vendors", async () => {
    const { d } = deps();
    await registerDomain(d, { businessId: BIZ, userId: BIZ, domain: "acme-goods.com", owner: FOUNDER, priceMinor: MOCK_COM_COST_MINOR + 300, siteHost: null });
    const store = { ...d.store, get: async () => ({ ...(await d.store.get(BIZ))!, simulated: true }) };
    await expect(setupRegisteredDomain({ ...d, store, simulated: false }, { businessId: BIZ, siteHost: null })).rejects.toMatchObject({ code: "domain_simulated" });
  });

  it("the zone's subdomains are relative to the domain", () => {
    expect(registeredZone(BIZ, "a.com", [{ type: "CNAME", host: "em.a.com", value: "u1.wl.sendgrid.net" }], null).zone.map((z) => z.subdomain)).toEqual(["_foundmill", "em", "", "_dmarc"]);
  });
});
