/**
 * Cross-tenant: an example viewer (0065, `memberships.source = 'example'`) of business A is a viewer of A and nothing
 * else. They read A, read nothing of B, and write nothing anywhere: an Inbox decision, a settings update and a note
 * read mark on B are each refused by the policies 0001/0002/0048 already hold viewers to. Nothing here changes RLS;
 * the suite pins that the example row rides the viewer's walls unchanged, and that leaving is the one write they own.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import type { Executor } from "../../repos/_shared";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let explorer: string;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "example-a");
  B = await createBusinessFixture(h, "example-b");
  explorer = await h.createUser("example-explorer@test.local");
  // Opened on the service connection, as business.example.open does (nobody may insert their own membership under RLS).
  await h.service().run((tx) => repos.memberships.openExample(tx as unknown as Executor, A.businessId, explorer));
});
afterAll(() => h?.close());

/** A write that must not happen: Postgres refuses it, or RLS filters every row so nothing changes. */
async function refused(p: Promise<unknown[]>) {
  try {
    const rows = await p;
    expect(rows).toHaveLength(0);
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

describe("memberships: an example viewer of A", () => {
  it("cannot give themselves the membership (only the service connection opens an example)", async () => {
    const other = await h.createUser("example-self@test.local");
    await expect(h.asUser(other).run((tx) => tx.insert(s.memberships).values({ businessId: A.businessId, userId: other, role: "viewer", source: "example" }))).rejects.toThrow(RLS_DENIED);
    expect(await h.db.select().from(s.memberships).where(eq(s.memberships.userId, other))).toHaveLength(0);
  });

  it("reads A (the business, its Inbox, its agents) and sees nothing of B", async () => {
    const visible = await h.asUser(explorer).run((tx) => tx.select({ id: s.businesses.id }).from(s.businesses));
    expect(visible.map((b) => b.id)).toEqual([A.businessId]);
    const inbox = await h.asUser(explorer).run((tx) => tx.select({ businessId: s.inboxItems.businessId }).from(s.inboxItems));
    expect(inbox.length).toBeGreaterThan(0);
    expect(inbox.every((i) => i.businessId === A.businessId)).toBe(true);
    expect(await h.asUser(explorer).run((tx) => tx.select({ id: s.inboxItems.id }).from(s.inboxItems).where(eq(s.inboxItems.businessId, B.businessId)))).toEqual([]);
    expect(await h.asUser(explorer).run((tx) => tx.select({ id: s.agents.id }).from(s.agents).where(eq(s.agents.businessId, B.businessId)))).toEqual([]);
    expect(await h.asUser(explorer).run((tx) => tx.select({ id: s.memberships.id }).from(s.memberships).where(eq(s.memberships.businessId, B.businessId)))).toEqual([]);
  });

  it("writes nothing: an Inbox decision, a settings update and a note read mark are each refused", async () => {
    // An Inbox decision (inbox_items_write holds to owner, admin and member).
    await refused(h.asUser(explorer).run((tx) => tx.update(s.inboxItems).set({ state: "answered", decision: { chosen: "a" } }).where(eq(s.inboxItems.id, A.inboxItemId)).returning()));
    await refused(h.asUser(explorer).run((tx) => tx.update(s.inboxItems).set({ state: "answered" }).where(eq(s.inboxItems.id, B.inboxItemId)).returning()));
    expect((await h.db.select({ state: s.inboxItems.state }).from(s.inboxItems).where(eq(s.inboxItems.id, A.inboxItemId)))[0]?.state).toBe("unread");
    // A settings update (businesses_update holds to owner and admin), on A and on B.
    await refused(h.asUser(explorer).run((tx) => tx.update(s.businesses).set({ name: "Renamed by an example viewer" }).where(eq(s.businesses.id, A.businessId)).returning()));
    await refused(h.asUser(explorer).run((tx) => tx.update(s.businesses).set({ name: "Renamed by an example viewer" }).where(eq(s.businesses.id, B.businessId)).returning()));
    expect((await h.db.select({ name: s.businesses.name }).from(s.businesses).where(eq(s.businesses.id, A.businessId)))[0]?.name).toBe("EXAMPLE-A");
    // A note read mark on B's note (inbox_item_reads_own: own user id and a membership of that business).
    await expect(h.asUser(explorer).run((tx) => tx.insert(s.inboxItemReads).values({ businessId: B.businessId, inboxItemId: B.inboxItemId, userId: explorer }))).rejects.toThrow(RLS_DENIED);
    // A read mark in someone else's name, on A, is refused too.
    await expect(h.asUser(explorer).run((tx) => tx.insert(s.inboxItemReads).values({ businessId: A.businessId, inboxItemId: A.inboxItemId, userId: A.viewerId }))).rejects.toThrow(RLS_DENIED);
    expect(await h.db.select().from(s.inboxItemReads).where(eq(s.inboxItemReads.userId, explorer))).toEqual([]);
    // Nothing of the business's own tables either: a new note, a task, an agent.
    await expect(h.asUser(explorer).run((tx) => tx.insert(s.inboxItems).values({ businessId: A.businessId, type: "update", subject: "From the example viewer" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(explorer).run((tx) => tx.insert(s.tasks).values({ businessId: A.businessId, kind: "ops", title: "Example task" }))).rejects.toThrow(RLS_DENIED);
  });

  it("cannot change their own row (a viewer stays a viewer, an example stays an example) or anyone else's", async () => {
    const own = and(eq(s.memberships.businessId, A.businessId), eq(s.memberships.userId, explorer));
    await refused(h.asUser(explorer).run((tx) => tx.update(s.memberships).set({ role: "member" }).where(own).returning()));
    await refused(h.asUser(explorer).run((tx) => tx.update(s.memberships).set({ source: "invite" }).where(own).returning()));
    await refused(h.asUser(explorer).run((tx) => tx.update(s.memberships).set({ role: "viewer" }).where(and(eq(s.memberships.businessId, A.businessId), eq(s.memberships.userId, A.memberId))).returning()));
    await refused(h.asUser(explorer).run((tx) => tx.delete(s.memberships).where(and(eq(s.memberships.businessId, A.businessId), eq(s.memberships.userId, A.viewerId))).returning()));
    expect((await h.db.select().from(s.memberships).where(own))[0]).toMatchObject({ role: "viewer", source: "example" });
    expect(await h.db.select().from(s.memberships).where(and(eq(s.memberships.businessId, A.businessId), eq(s.memberships.userId, A.viewerId)))).toHaveLength(1);
  });

  it("the example row is always a viewer (the 0065 check), even on the service connection", async () => {
    await expect(h.service().run((tx) => tx.update(s.memberships).set({ role: "member" }).where(and(eq(s.memberships.businessId, A.businessId), eq(s.memberships.userId, explorer))))).rejects.toThrow(/memberships_example_is_viewer/);
    const stranger = await h.createUser("example-stranger@test.local");
    await expect(h.service().run((tx) => tx.insert(s.memberships).values({ businessId: B.businessId, userId: stranger, role: "admin", source: "example" }))).rejects.toThrow(/memberships_example_is_viewer/);
  });

  it("may leave (the one write that is theirs), and then reads nothing of A either", async () => {
    const own = and(eq(s.memberships.businessId, A.businessId), eq(s.memberships.userId, explorer));
    const left = await h.asUser(explorer).run((tx) => tx.delete(s.memberships).where(own).returning({ id: s.memberships.id }));
    expect(left).toHaveLength(1);
    expect(await h.asUser(explorer).run((tx) => tx.select({ id: s.businesses.id }).from(s.businesses))).toEqual([]);
    expect(await h.asUser(explorer).run((tx) => tx.select({ id: s.inboxItems.id }).from(s.inboxItems))).toEqual([]);
    // The business kept every real member.
    expect(await h.db.select().from(s.memberships).where(eq(s.memberships.businessId, A.businessId))).toHaveLength(4);
  });
});
