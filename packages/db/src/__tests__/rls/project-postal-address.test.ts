/**
 * 0097 `project_postal_addresses` (the founders' postal address for the project's marketing email, US CAN-SPAM).
 *
 * One row per business, so it is not in the generated cross-tenant suite; this file covers tenancy by hand:
 *   - the founders (owner, admin) read, enter, change and remove their own project's address;
 *   - collaborators (member, viewer) neither read nor write it, and nobody reaches another business's row;
 *   - a non-member and anon see nothing;
 *   - the service connection (the gateway) reads it for the footer;
 * and what only this table has: one line, a postal address's length, the founders' note raised once, closed on save.
 */
import { POSTAL_ADDRESS_NOTE } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

const A_ADDRESS = "PO Box 1234, Springfield, IL 62701, USA";
const B_ADDRESS = "12 Harbor Road, Portland, ME 04101, USA";

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
  A = await createBusinessFixture(h, "postal-a");
  B = await createBusinessFixture(h, "postal-b");
  outsiderId = await h.createUser("postal-outsider@test.local");
  await h.asUser(B.ownerId).run((tx) => repos.postalAddress.set(tx, B.businessId, { address: B_ADDRESS, userId: B.ownerId }));
}, 120_000);
afterAll(() => h?.close());

describe("project_postal_addresses: tenancy", () => {
  it("a founder enters, reads and changes their own project's address", async () => {
    const row = await h.asUser(A.ownerId).run((tx) => repos.postalAddress.set(tx, A.businessId, { address: "  PO Box 1234\nSpringfield, IL 62701\nUSA ", userId: A.ownerId }));
    expect(row.address).toBe(A_ADDRESS);
    expect(row.updatedBy).toBe(A.ownerId);
    expect(await h.asUser(A.adminId).run((tx) => repos.postalAddress.addressOf(tx, A.businessId))).toBe(A_ADDRESS);
    const changed = await h.asUser(A.adminId).run((tx) => repos.postalAddress.set(tx, A.businessId, { address: "PO Box 99, Springfield, IL 62701, USA", userId: A.adminId }));
    expect(changed.id).toBe(row.id);
    expect(changed.updatedBy).toBe(A.adminId);
    await h.asUser(A.ownerId).run((tx) => repos.postalAddress.set(tx, A.businessId, { address: A_ADDRESS, userId: A.ownerId }));
  });

  it("collaborators neither read nor write it", async () => {
    for (const userId of [A.memberId, A.viewerId]) {
      expect(await h.asUser(userId).run((tx) => repos.postalAddress.get(tx, A.businessId))).toBeNull();
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.projectPostalAddresses).set({ address: "1 Evil Street, Nowhere 00000" }).where(eq(s.projectPostalAddresses.businessId, A.businessId)).returning({ id: s.projectPostalAddresses.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.delete(s.projectPostalAddresses).where(eq(s.projectPostalAddresses.businessId, A.businessId)).returning({ id: s.projectPostalAddresses.id })));
    }
    const c = await createBusinessFixture(h, "postal-c");
    for (const userId of [c.memberId, c.viewerId]) {
      await expect(h.asUser(userId).run((tx) => repos.postalAddress.set(tx, c.businessId, { address: A_ADDRESS, userId }))).rejects.toThrow(RLS_DENIED);
    }
    expect(await repos.postalAddress.addressOf(h.db as never, c.businessId)).toBeNull();
    expect(await repos.postalAddress.addressOf(h.db as never, A.businessId)).toBe(A_ADDRESS);
  });

  it("nobody reaches another business's row: no read, no insert with its id, no change, no delete", async () => {
    for (const userId of [B.ownerId, B.adminId, B.memberId, B.viewerId]) {
      expect(await h.asUser(userId).run((tx) => repos.postalAddress.get(tx, A.businessId))).toBeNull();
      await expect(h.asUser(userId).run((tx) => tx.insert(s.projectPostalAddresses).values({ businessId: A.businessId, address: "1 Evil Street, Nowhere 00000" }))).rejects.toThrow(/RLS|row-level security|duplicate|unique/i);
      await expectNoEffect(h.asUser(userId).run((tx) => tx.update(s.projectPostalAddresses).set({ address: "1 Evil Street, Nowhere 00000" }).where(eq(s.projectPostalAddresses.businessId, A.businessId)).returning({ id: s.projectPostalAddresses.id })));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.delete(s.projectPostalAddresses).where(eq(s.projectPostalAddresses.businessId, A.businessId)).returning({ id: s.projectPostalAddresses.id })));
    }
    // A founder of B cannot move B's row onto A either.
    await expectNoEffect(h.asUser(B.ownerId).run((tx) => tx.update(s.projectPostalAddresses).set({ businessId: A.businessId }).where(eq(s.projectPostalAddresses.businessId, B.businessId)).returning({ id: s.projectPostalAddresses.id })));
    expect(await repos.postalAddress.addressOf(h.db as never, A.businessId)).toBe(A_ADDRESS);
    expect(await repos.postalAddress.addressOf(h.db as never, B.businessId)).toBe(B_ADDRESS);
  });

  it("a non-member and anon see nothing; the service connection reads it for the footer", async () => {
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.projectPostalAddresses))).toHaveLength(0);
    await expectNoEffect(h.anon().run((tx) => tx.select().from(s.projectPostalAddresses)));
    expect(await h.service().run((tx) => repos.postalAddress.addressOf(tx, A.businessId))).toBe(A_ADDRESS);
  });

  it("a founder removes it", async () => {
    const d = await createBusinessFixture(h, "postal-d");
    await h.asUser(d.ownerId).run((tx) => repos.postalAddress.set(tx, d.businessId, { address: A_ADDRESS, userId: d.ownerId }));
    expect(await h.asUser(d.adminId).run((tx) => repos.postalAddress.clear(tx, d.businessId))).toBe(true);
    expect(await repos.postalAddress.addressOf(h.db as never, d.businessId)).toBeNull();
  });
});

describe("project_postal_addresses: the address", () => {
  it("is refused in plain words when it is not a postal address, and the table holds one line", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => repos.postalAddress.set(tx, A.businessId, { address: "home", userId: A.ownerId }))).rejects.toThrow(/whole address/);
    await expect(h.asUser(A.ownerId).run((tx) => repos.postalAddress.set(tx, A.businessId, { address: "https://example.com 12", userId: A.ownerId }))).rejects.toThrow(/not a web or email address/);
    await expect(h.pg.query(`update project_postal_addresses set address = $1 where business_id = $2`, ["12 Main St\nSpringfield", A.businessId])).rejects.toThrow(/one_line/);
    await expect(h.pg.query(`update project_postal_addresses set address = 'short' where business_id = $1`, [A.businessId])).rejects.toThrow(/address_length/);
  });
});

describe("the founders' note", () => {
  it("is raised once while open, stays quiet after Later, and a founder finds the open one", async () => {
    const e = await createBusinessFixture(h, "postal-e");
    const now = new Date();
    const first = await h.service().run((tx) => repos.postalAddress.raiseNote(tx, e.businessId, { fromAgentId: e.agentId, now }));
    expect(first?.subject).toBe(POSTAL_ADDRESS_NOTE.subject);
    expect((first?.decision as { key?: string } | null)?.key).toBe(POSTAL_ADDRESS_NOTE.key);
    expect(first?.blocksContinue).toBe(false);
    expect(await h.service().run((tx) => repos.postalAddress.raiseNote(tx, e.businessId, { fromAgentId: e.agentId, now }))).toBeNull();
    // Put aside with Later: quiet for a week, then once more.
    await h.service().run((tx) => repos.inbox.decide(tx, e.businessId, first!.id, { chosenOption: POSTAL_ADDRESS_NOTE.options.later, decidedByKind: "user", decidedBy: e.ownerId }));
    expect(await h.service().run((tx) => repos.postalAddress.raiseNote(tx, e.businessId, { fromAgentId: e.agentId, now: new Date(now.getTime() + 86_400_000) }))).toBeNull();
    const again = await h.service().run((tx) => repos.postalAddress.raiseNote(tx, e.businessId, { fromAgentId: e.agentId, now: new Date(now.getTime() + POSTAL_ADDRESS_NOTE.quietMs + 60_000) }));
    expect(again).not.toBeNull();
    // The founder finds the open one under RLS (saving the address answers it: apps/api `setPostalAddress`).
    expect((await h.asUser(e.ownerId).run((tx) => repos.postalAddress.openNote(tx, e.businessId)))?.id).toBe(again!.id);
    await h.service().run((tx) => repos.inbox.decide(tx, e.businessId, again!.id, { chosenOption: POSTAL_ADDRESS_NOTE.options.add, decidedByKind: "user", decidedBy: e.ownerId }));
    expect(await repos.postalAddress.openNote(h.db as never, e.businessId)).toBeNull();
  });
});
