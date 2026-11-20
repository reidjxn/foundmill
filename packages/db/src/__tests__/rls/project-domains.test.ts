/**
 * 0147 `project_domains` (a project's own domain, WP-08 domain plan Path B).
 *
 * One row per business, written only on the service connection, so it is covered here by hand:
 *   - members read their own project's domain and never another's; a non-member and anon read nothing;
 *   - no app role writes at all: not the project's own owner (nobody marks a domain verified without the check);
 *   - a domain is verified by one project at most, and a pending row never blocks the project that verifies it.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OwnDomainTakenError, repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

const sending = (found: boolean | null) => [{ purpose: "sending" as const, type: "CNAME" as const, host: "em.acme-a.com", value: "u1.wl.sendgrid.net", found }];

async function expectNoEffect(p: Promise<unknown>) {
  try {
    const rows = await p;
    if (Array.isArray(rows)) expect(rows).toHaveLength(0);
    else expect(rows).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "domain-a");
  B = await createBusinessFixture(h, "domain-b");
  outsiderId = await h.createUser("domain-outsider@test.local");
  await h.service().run((tx) => repos.projectDomains.put(tx, A.businessId, { domain: "acme-a.com", senderLocalPart: "hello", sendgridDomainId: "1", records: sending(null), addedBy: A.ownerId, simulated: false }));
  await h.service().run((tx) => repos.projectDomains.put(tx, B.businessId, { domain: "acme-b.com", senderLocalPart: "maya", sendgridDomainId: "2", records: sending(null), addedBy: B.ownerId, simulated: false }));
}, 120_000);
afterAll(() => h?.close());

describe("project_domains: tenancy", () => {
  it("every member reads their own project's domain and never another's", async () => {
    for (const userId of [A.ownerId, A.adminId, A.memberId, A.viewerId]) {
      expect((await h.asUser(userId).run((tx) => repos.projectDomains.view(tx, A.businessId)))?.domain).toBe("acme-a.com");
      expect(await h.asUser(userId).run((tx) => repos.projectDomains.view(tx, B.businessId))).toBeNull();
    }
  });

  it("a non-member and anon read nothing", async () => {
    expect(await h.asUser(outsiderId).run((tx) => tx.select({ id: s.projectDomains.id }).from(s.projectDomains))).toHaveLength(0);
    await expectNoEffect(h.anon().run((tx) => tx.select({ id: s.projectDomains.id }).from(s.projectDomains)));
  });

  it("a member never reads SendGrid's id or who added it (the column grant)", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => tx.select({ id: s.projectDomains.sendgridDomainId }).from(s.projectDomains))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.memberId).run((tx) => tx.select({ by: s.projectDomains.addedBy }).from(s.projectDomains))).rejects.toThrow(/permission denied/);
  });

  it("no app role writes: the project's own owner cannot mark its domain verified, remove it or add one", async () => {
    for (const userId of [A.ownerId, A.adminId, A.memberId, outsiderId]) {
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.projectDomains).set({ status: "verified" }).where(eq(s.projectDomains.businessId, A.businessId)).returning({ id: s.projectDomains.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.projectDomains).set({ domain: "evil.com" }).where(eq(s.projectDomains.businessId, B.businessId)).returning({ id: s.projectDomains.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.delete(s.projectDomains).where(eq(s.projectDomains.businessId, A.businessId)).returning({ id: s.projectDomains.id })));
    }
    const c = await createBusinessFixture(h, "domain-c");
    await expect(h.asUser(c.ownerId).run((tx) => tx.insert(s.projectDomains).values({ businessId: c.businessId, domain: "acme-c.com", sendgridDomainId: "3" }))).rejects.toThrow(RLS_DENIED);
    expect((await repos.projectDomains.get(h.db as never, A.businessId))?.status).toBe("pending");
  });
});

describe("project_domains: verification", () => {
  it("sends from the domain only once a check found every sending record", async () => {
    const live = { live: true };
    expect(await repos.projectDomains.sendingFrom(h.db as never, B.businessId, live)).toBeNull();
    await h.service().run((tx) => repos.projectDomains.saveCheck(tx, B.businessId, { records: sending(false), verified: false, now: new Date() }));
    expect(await repos.projectDomains.sendingFrom(h.db as never, B.businessId, live)).toBeNull();
    await h.service().run((tx) => repos.projectDomains.saveCheck(tx, B.businessId, { records: sending(true), verified: true, now: new Date() }));
    expect(await repos.projectDomains.sendingFrom(h.db as never, B.businessId, live)).toEqual({ email: "maya@acme-b.com", domain: "acme-b.com" });
    // A later failed check (a DNS hiccup) keeps it verified: it never frees the domain for another project.
    await h.service().run((tx) => repos.projectDomains.saveCheck(tx, B.businessId, { records: sending(false), verified: false, now: new Date() }));
    expect((await repos.projectDomains.get(h.db as never, B.businessId))?.status).toBe("verified");
  });

  it("a domain is verified by one project at most; a pending claim never blocks the owner", async () => {
    const d = await createBusinessFixture(h, "domain-d");
    // D types B's verified domain: it may sit pending, but never verifies.
    await h.service().run((tx) => repos.projectDomains.put(tx, d.businessId, { domain: "acme-b.com", senderLocalPart: "hello", sendgridDomainId: "4", records: sending(null), addedBy: d.ownerId, simulated: false }));
    expect(await repos.projectDomains.takenElsewhere(h.db as never, d.businessId, "acme-b.com")).toBe(true);
    expect(await repos.projectDomains.takenElsewhere(h.db as never, B.businessId, "acme-b.com")).toBe(false);
    await expect(h.service().run((tx) => repos.projectDomains.saveCheck(tx, d.businessId, { records: sending(true), verified: true, now: new Date() }))).rejects.toBeInstanceOf(OwnDomainTakenError);
    // A pending row for A's domain elsewhere does not stop A from verifying it.
    await h.service().run((tx) => repos.projectDomains.put(tx, d.businessId, { domain: "acme-a.com", senderLocalPart: "hello", sendgridDomainId: "5", records: sending(null), addedBy: d.ownerId, simulated: false }));
    expect((await h.service().run((tx) => repos.projectDomains.saveCheck(tx, A.businessId, { records: sending(true), verified: true, now: new Date() })))?.status).toBe("verified");
  });

  it("a simulated verification never becomes the From of a live send, and never holds the domain", async () => {
    const f = await createBusinessFixture(h, "domain-f");
    await h.service().run((tx) => repos.projectDomains.put(tx, f.businessId, { domain: "acme-a.com", senderLocalPart: "hello", sendgridDomainId: "7", records: sending(true), addedBy: null, simulated: true }));
    // A real project verified acme-a.com already; the simulated one may verify too (outside the unique index).
    expect((await h.service().run((tx) => repos.projectDomains.saveCheck(tx, f.businessId, { records: sending(true), verified: true, now: new Date() })))?.status).toBe("verified");
    expect(await repos.projectDomains.sendingFrom(h.db as never, f.businessId, { live: true })).toBeNull();
    expect(await repos.projectDomains.sendingFrom(h.db as never, f.businessId, { live: false })).toEqual({ email: "hello@acme-a.com", domain: "acme-a.com" });
  });

  it("the format checks refuse what is not a domain or a sender name", async () => {
    const e = await createBusinessFixture(h, "domain-e");
    await expect(h.service().run((tx) => repos.projectDomains.put(tx, e.businessId, { domain: "not a domain", senderLocalPart: "hello", sendgridDomainId: "6", records: [], addedBy: null, simulated: false }))).rejects.toThrow();
    await expect(h.service().run((tx) => repos.projectDomains.put(tx, e.businessId, { domain: "acme-e.com", senderLocalPart: "Hello There", sendgridDomainId: "6", records: [], addedBy: null, simulated: false }))).rejects.toThrow();
  });
});
