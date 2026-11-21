/**
 * A project's own domain in the api (WP-08 domain plan, Path B): members read it under RLS, never another project's;
 * only the founders add, check and remove it; the api sends the gateway the site host it knows and audits each press;
 * nothing is there while the deployment has no sending domain. With SendGrid mock the api runs the flow on the
 * connector's mock itself (no gateway), and never for a person's project on staging.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiDeps, CallerUser } from "../context";
import { createCaller } from "../router";
import type { GatewayOwnDomainRequest } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const asked: GatewayOwnDomainRequest[] = [];
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "owndomain" });
}, 120_000);
afterAll(() => hz.close());

const MOCK = { PLATFORM_MAIL_DOMAIN: "mail.foundmill.test", SITES_DOMAIN: "foundmill.test" } as const;
// SendGrid live: the api asks the gateway (stubbed here).
const ON = { ...MOCK, LIVE_CONNECTORS: "sendgrid" } as const;
// A stand-in gateway that writes the row the way the real one does, so the read path is the real one.
const callerWith = (env: Partial<ApiDeps["env"]>, user: CallerUser) =>
  createCaller(
    {
      ...hz.deps,
      env: { ...hz.deps.env, ...env },
      gateway: {
        ...hz.deps.gateway,
        ownDomain: async (input) => {
          asked.push(input);
          if (input.action === "remove") {
            await repos.projectDomains.remove(hz.db, input.businessId);
            return { mode: "mock", simulated: true, domain: null };
          }
          const row = input.action === "add" ? await repos.projectDomains.put(hz.db, input.businessId, { domain: input.domain, senderLocalPart: input.senderLocalPart, sendgridDomainId: "1", records: [], addedBy: input.userId, simulated: false }) : await repos.projectDomains.saveCheck(hz.db, input.businessId, { records: [], verified: false, now: new Date() });
          return { mode: "mock", simulated: true, domain: { ...row!, checkedAt: row!.checkedAt?.toISOString() ?? null, verifiedAt: null } };
        },
      },
    },
    user,
  );

describe("integrations.ownDomain", () => {
  it("is null while the deployment has no sending domain, and adding is refused", async () => {
    expect(await hz.caller({ userId: hz.A.ownerId }).integrations.ownDomain({ businessId: hz.A.businessId })).toBeNull();
    await expect(callerWith({}, { userId: hz.A.ownerId }).integrations.addOwnDomain({ businessId: hz.A.businessId, domain: "acme.com", senderLocalPart: "hello" })).rejects.toThrow(/not switched on/);
  });

  it("the founders add it with the site host; members read it; the press is audited", async () => {
    await repos.sites.ensure(hz.db, hz.A.businessId, { slug: "acme-site" });
    const owner = callerWith(ON, { userId: hz.A.ownerId });
    const added = await owner.integrations.addOwnDomain({ businessId: hz.A.businessId, domain: "acme.com", senderLocalPart: "hello" });
    expect(added).toMatchObject({ domain: { domain: "acme.com", senderLocalPart: "hello", status: "pending" }, canEdit: true, simulated: true });
    expect(asked.at(-1)).toEqual({ action: "add", businessId: hz.A.businessId, userId: hz.A.ownerId, domain: "acme.com", senderLocalPart: "hello", siteHost: "acme-site.foundmill.test" });
    expect(JSON.stringify(added)).not.toContain("sendgridDomainId");
    const member = await callerWith(ON, { userId: hz.A.memberId }).integrations.ownDomain({ businessId: hz.A.businessId });
    expect(member).toMatchObject({ domain: { domain: "acme.com" }, canEdit: false });
    const log = await repos.audit.list(hz.db, hz.A.businessId, { limit: 20 });
    expect(log.items.map((e: { action: string }) => e.action)).toContain("integrations.own_domain_added");
  });

  it("a member cannot add, check or remove it", async () => {
    const member = callerWith(ON, { userId: hz.A.memberId });
    const before = asked.length;
    await expect(member.integrations.addOwnDomain({ businessId: hz.A.businessId, domain: "evil.com", senderLocalPart: "hello" })).rejects.toThrow();
    await expect(member.integrations.checkOwnDomain({ businessId: hz.A.businessId })).rejects.toThrow();
    await expect(member.integrations.removeOwnDomain({ businessId: hz.A.businessId })).rejects.toThrow();
    expect(asked.length).toBe(before);
  });

  it("another project's founders never read or change it", async () => {
    const other = callerWith(ON, { userId: hz.B.ownerId });
    await expect(other.integrations.ownDomain({ businessId: hz.A.businessId })).rejects.toThrow();
    await expect(other.integrations.removeOwnDomain({ businessId: hz.A.businessId })).rejects.toThrow();
    expect(await callerWith(ON, { userId: hz.B.ownerId }).integrations.ownDomain({ businessId: hz.B.businessId })).toEqual({ domain: null, canEdit: true, canRegister: true, simulated: false });
    expect((await repos.projectDomains.get(hz.db, hz.A.businessId))?.domain).toBe("acme.com");
  });

  it("the founders check and remove it", async () => {
    const owner = callerWith(ON, { userId: hz.A.ownerId });
    expect((await owner.integrations.checkOwnDomain({ businessId: hz.A.businessId })).domain?.checkedAt).toEqual(expect.any(String));
    expect(await owner.integrations.removeOwnDomain({ businessId: hz.A.businessId })).toMatchObject({ domain: null });
    expect(await repos.projectDomains.get(hz.db, hz.A.businessId)).toBeNull();
  });
});

describe("integrations.ownDomain with SendGrid mock", () => {
  it("runs on the mock without the gateway, and shows SendGrid's records and the site's", async () => {
    const owner = callerWith(MOCK, { userId: hz.A.ownerId });
    const before = asked.length;
    const added = await owner.integrations.addOwnDomain({ businessId: hz.A.businessId, domain: "Mock-Goods.com", senderLocalPart: "hello" });
    expect(added.simulated).toBe(true);
    expect(added.domain?.records.map((r) => r.host)).toEqual(["_foundmill.mock-goods.com", "em.mock-goods.com", "s1._domainkey.mock-goods.com", "s2._domainkey.mock-goods.com", "www.mock-goods.com"]);
    expect((await owner.integrations.checkOwnDomain({ businessId: hz.A.businessId })).domain?.status).toBe("verified");
    expect(asked.length).toBe(before);
    expect(await repos.projectDomains.sendingFrom(hz.db, hz.A.businessId, { live: false })).toEqual({ email: "hello@mock-goods.com", domain: "mock-goods.com" });
    expect((await repos.projectDomains.get(hz.db, hz.A.businessId))?.simulated).toBe(true);
    // The owner's export carries the domain (under RLS, which cannot read SendGrid's id) and never that id.
    const exported = (await owner.business.export({ businessId: hz.A.businessId })).archive.tables.project_domains;
    expect(exported?.map((r) => r.domain)).toEqual(["mock-goods.com"]);
    expect(exported?.every((r) => !("sendgridDomainId" in r) && !("addedBy" in r))).toBe(true);
  });

  it("is refused for a person's project on staging: nothing simulated is written", async () => {
    await expect(callerWith({ ...MOCK, APP_ENV: "staging" }, { userId: hz.B.ownerId }).integrations.addOwnDomain({ businessId: hz.B.businessId, domain: "real.com", senderLocalPart: "hello" })).rejects.toThrow(/not available here yet/);
    expect(await repos.projectDomains.get(hz.db, hz.B.businessId)).toBeNull();
  });
});
