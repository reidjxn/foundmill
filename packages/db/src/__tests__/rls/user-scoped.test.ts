/** Tables whose tenancy is not a plain business_id: user-owned, nullable-until-commit, platform-wide and social. */
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { postColumns, threadColumns } from "./client-columns";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "user-a");
  B = await createBusinessFixture(h, "user-b");
  outsiderId = await h.createUser("user-outsider@test.local");
});
afterAll(() => h?.close());

describe("founder_profiles", () => {
  it("founder_profiles: a user can create and read only their own profile", async () => {
    await h.asUser(A.ownerId).run((tx) => tx.insert(s.founderProfiles).values({ userId: A.ownerId, displayName: "Owner A" }));
    await h.asUser(B.ownerId).run((tx) => tx.insert(s.founderProfiles).values({ userId: B.ownerId, displayName: "Owner B", visibility: "public" }));
    const mine = await h.asUser(A.ownerId).run((tx) => tx.select().from(s.founderProfiles));
    expect(mine.map((p) => p.userId)).toEqual([A.ownerId]);
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.founderProfiles).values({ userId: B.memberId, displayName: "Spoof" }))).rejects.toThrow(RLS_DENIED);
  });
  it("founder_profiles: a user cannot update someone else's profile", async () => {
    const rows = await h.asUser(A.ownerId).run((tx) => tx.update(s.founderProfiles).set({ displayName: "Hacked" }).where(eq(s.founderProfiles.userId, B.ownerId)).returning());
    expect(rows).toHaveLength(0);
  });
});

describe("dashboard_layouts", () => {
  const sees = (userId: string) => h.asUser(userId).run((tx) => tx.select().from(s.dashboardLayouts));

  it("dashboard_layouts: every member reads a co-member's live dashboard (the shared link) but writes only their own", async () => {
    const [shared] = await h.asUser(A.ownerId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: A.businessId, userId: A.ownerId, name: "Shared home" }).returning());
    await h.asUser(A.memberId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: A.businessId, userId: A.memberId, name: "Home" }));
    expect((await sees(A.memberId)).map((l) => l.name).sort()).toEqual(["Home", "Shared home"]);
    expect((await sees(A.viewerId)).map((l) => l.id)).toContain(shared!.id);
    // Reading is all a co-member gets: no spoofed insert, no update, no delete of someone else's row.
    await expect(h.asUser(A.memberId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: A.businessId, userId: A.ownerId, name: "Spoof" }))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(A.memberId).run((tx) => tx.update(s.dashboardLayouts).set({ name: "Hacked" }).where(eq(s.dashboardLayouts.id, shared!.id)).returning())).toHaveLength(0);
    expect(await h.asUser(A.memberId).run((tx) => tx.delete(s.dashboardLayouts).where(eq(s.dashboardLayouts.id, shared!.id)).returning())).toHaveLength(0);
    expect((await h.db.select().from(s.dashboardLayouts).where(eq(s.dashboardLayouts.id, shared!.id)))[0]!.name).toBe("Shared home");
  });

  it("dashboard_layouts: an archived dashboard is readable only by its owner", async () => {
    const [gone] = await h.asUser(A.ownerId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: A.businessId, userId: A.ownerId, name: "Old", isActive: false, archivedAt: new Date() }).returning());
    expect((await sees(A.ownerId)).map((l) => l.id)).toContain(gone!.id);
    expect((await sees(A.memberId)).map((l) => l.id)).not.toContain(gone!.id);
  });

  it("dashboard_layouts: viewers write nothing, not even a Home of their own", async () => {
    await expect(h.asUser(A.viewerId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: A.businessId, userId: A.viewerId, name: "Mine" }))).rejects.toThrow(RLS_DENIED);
  });

  it("dashboard_layouts: nobody outside the business reads or writes its dashboards", async () => {
    expect((await sees(B.ownerId)).every((l) => l.businessId === B.businessId)).toBe(true);
    expect((await sees(outsiderId)).length).toBe(0);
    await expect(h.asUser(B.memberId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: A.businessId, userId: B.memberId, name: "Cross" }))).rejects.toThrow(RLS_DENIED);
  });

  it("dashboard_layouts: one active dashboard per person and business (two first loads make one Home)", async () => {
    await h.asUser(B.memberId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: B.businessId, userId: B.memberId, name: "Home" }));
    await expect(h.asUser(B.memberId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: B.businessId, userId: B.memberId, name: "Home again" }))).rejects.toThrow(/dashboard_layouts_one_active_key|unique/i);
    // Inactive and archived rows are not limited.
    await h.asUser(B.memberId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: B.businessId, userId: B.memberId, name: "Second", isActive: false }));
  });
});

describe("saved_table_views (0041)", () => {
  it("saved_table_views: a person reads and writes only their own views, and only for businesses they belong to", async () => {
    await h.asUser(A.memberId).run((tx) => tx.insert(s.savedTableViews).values({ businessId: A.businessId, userId: A.memberId, tableKey: "team.agents" }));
    await h.asUser(A.ownerId).run((tx) => tx.insert(s.savedTableViews).values({ businessId: A.businessId, userId: A.ownerId, tableKey: "team.agents" }));
    const mine = await h.asUser(A.memberId).run((tx) => tx.select().from(s.savedTableViews));
    expect(mine.map((v) => v.userId)).toEqual([A.memberId]);
    // Not as someone else, and not in a business the person is not a member of.
    await expect(h.asUser(A.memberId).run((tx) => tx.insert(s.savedTableViews).values({ businessId: A.businessId, userId: A.ownerId, tableKey: "crm.list" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(B.memberId).run((tx) => tx.insert(s.savedTableViews).values({ businessId: A.businessId, userId: B.memberId, tableKey: "crm.list" }))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(B.ownerId).run((tx) => tx.select().from(s.savedTableViews))).toHaveLength(0);
    const upd = await h.asUser(A.memberId).run((tx) => tx.update(s.savedTableViews).set({ activeViewId: "hacked" }).where(eq(s.savedTableViews.userId, A.ownerId)).returning());
    expect(upd).toHaveLength(0);
  });
  it("saved_table_views: account-wide rows (the LIVE pages, no business) are the person's own too", async () => {
    await h.asUser(outsiderId).run((tx) => tx.insert(s.savedTableViews).values({ businessId: null, userId: outsiderId, tableKey: "live.communities" }));
    expect(await h.asUser(A.ownerId).run((tx) => tx.select().from(s.savedTableViews).where(isNull(s.savedTableViews.businessId)))).toHaveLength(0);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.savedTableViews))).toHaveLength(1);
  });
});

describe("ideas (nullable business_id until commit)", () => {
  it("ideas: private to the owner before commit, visible to members after", async () => {
    const [idea] = await h.asUser(A.ownerId).run((tx) => tx.insert(s.ideas).values({ ownerUserId: A.ownerId, title: "Robot bakery" }).returning());
    expect(idea).toBeDefined();
    const seenByMember = await h.asUser(A.memberId).run((tx) => tx.select().from(s.ideas));
    expect(seenByMember).toHaveLength(0);
    await h.asUser(A.ownerId).run((tx) => tx.update(s.ideas).set({ businessId: A.businessId, committedAt: new Date() }).where(eq(s.ideas.id, idea!.id)));
    const afterCommit = await h.asUser(A.memberId).run((tx) => tx.select().from(s.ideas));
    expect(afterCommit.map((i) => i.id)).toEqual([idea!.id]);
    const seenByB = await h.asUser(B.ownerId).run((tx) => tx.select().from(s.ideas));
    expect(seenByB).toHaveLength(0);
  });
  it("ideas: a user cannot create an idea owned by someone else or attach it to a business they are not in", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.ideas).values({ ownerUserId: B.ownerId, title: "Spoof" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.ideas).values({ ownerUserId: A.ownerId, businessId: B.businessId, title: "Cross" }))).rejects.toThrow(RLS_DENIED);
  });
  it("idea_versions / idea_comparisons: same owner-or-member rule", async () => {
    const [idea] = await h.asUser(outsiderId).run((tx) => tx.insert(s.ideas).values({ ownerUserId: outsiderId, title: "Solo" }).returning());
    await h.asUser(outsiderId).run((tx) => tx.insert(s.ideaVersions).values({ ideaId: idea!.id, ownerUserId: outsiderId, version: 1, title: "Solo v1" }));
    await h.asUser(outsiderId).run((tx) => tx.insert(s.ideaComparisons).values({ ownerUserId: outsiderId, ideaVersionIds: [], verdictMd: "n/a" }));
    expect(await h.asUser(A.ownerId).run((tx) => tx.select().from(s.ideaVersions).where(eq(s.ideaVersions.ownerUserId, outsiderId)))).toHaveLength(0);
    expect(await h.asUser(A.ownerId).run((tx) => tx.select().from(s.ideaComparisons))).toHaveLength(0);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.ideaVersions))).toHaveLength(1);
  });
});

describe("skill_definitions / skill_tests (platform rows have null business_id)", () => {
  it("skill_definitions: platform definitions are readable by everyone signed in but writable only by services", async () => {
    await h.service().run((tx) => tx.insert(s.skillDefinitions).values({ agentType: "engineer", skillKey: "tests", name: "Writes tests", group: "craft" }));
    const seen = await h.asUser(outsiderId).run((tx) => tx.select().from(s.skillDefinitions).where(isNull(s.skillDefinitions.businessId)));
    expect(seen.map((d) => d.skillKey)).toContain("tests");
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.skillDefinitions).values({ agentType: "x", skillKey: "y", name: "z", group: "craft" }))).rejects.toThrow(RLS_DENIED);
    const upd = await h.asUser(A.ownerId).run((tx) => tx.update(s.skillDefinitions).set({ name: "Hacked" }).where(isNull(s.skillDefinitions.businessId)).returning());
    expect(upd).toHaveLength(0);
  });
  it("skill_definitions: business definitions stay inside the business", async () => {
    expect(await h.asUser(B.memberId).run((tx) => tx.select().from(s.skillDefinitions).where(eq(s.skillDefinitions.businessId, A.businessId)))).toHaveLength(0);
    expect(await h.asUser(A.memberId).run((tx) => tx.select().from(s.skillDefinitions).where(eq(s.skillDefinitions.businessId, A.businessId)))).toHaveLength(1);
  });
  it("skill_tests: held-out tests are invisible to app roles even inside the business", async () => {
    await h.service().run((tx) =>
      tx.insert(s.skillTests).values([
        { businessId: A.businessId, skillDefinitionId: A.skillDefinitionId, heldOut: true, task: { secret: true } },
        { businessId: A.businessId, skillDefinitionId: A.skillDefinitionId, heldOut: false, task: { open: true } },
      ]),
    );
    const seen = await h.asUser(A.ownerId).run((tx) => tx.select().from(s.skillTests).where(eq(s.skillTests.businessId, A.businessId)));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.heldOut).toBe(false);
    // ...and cannot create, update or delete held-out rows blind.
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.skillTests).values({ businessId: A.businessId, skillDefinitionId: A.skillDefinitionId, heldOut: true }))).rejects.toThrow(RLS_DENIED);
    const upd = await h.asUser(A.ownerId).run((tx) => tx.update(s.skillTests).set({ task: { leaked: true } }).where(eq(s.skillTests.heldOut, true)).returning());
    expect(upd).toHaveLength(0);
    const del = await h.asUser(A.ownerId).run((tx) => tx.delete(s.skillTests).where(eq(s.skillTests.heldOut, true)).returning());
    expect(del).toHaveLength(0);
    const ownRow = await h.asUser(A.ownerId).run((tx) => tx.insert(s.skillTests).values({ businessId: A.businessId, skillDefinitionId: A.skillDefinitionId, heldOut: false }).returning());
    expect(ownRow).toHaveLength(1);
    expect(await h.asUser(B.ownerId).run((tx) => tx.select().from(s.skillTests))).toHaveLength(0);
  });
});

describe("suppression_list", () => {
  it("suppression_list: platform scope is readable by all members, business scope only by that business", async () => {
    await h.service().run((tx) => tx.insert(s.suppressionList).values({ emailHash: "platform-hash", reason: "complaint", scope: "platform" }));
    await h.asUser(A.memberId).run((tx) => tx.insert(s.suppressionList).values({ businessId: A.businessId, emailHash: "a-hash", reason: "unsubscribe" }));
    const seenByB = await h.asUser(B.memberId).run((tx) => tx.select({ h: s.suppressionList.emailHash }).from(s.suppressionList));
    expect(seenByB.map((r) => r.h)).toEqual(["platform-hash"]);
    await expect(h.asUser(A.memberId).run((tx) => tx.insert(s.suppressionList).values({ emailHash: "x", reason: "r", scope: "platform" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.memberId).run((tx) => tx.insert(s.suppressionList).values({ businessId: B.businessId, emailHash: "x", reason: "r" }))).rejects.toThrow(RLS_DENIED);
  });
});

describe("connections, message_threads, messages", () => {
  it("connections: only the two parties see a request; the requester must be auth.uid()", async () => {
    await h.asUser(A.ownerId).run((tx) => tx.insert(s.connections).values({ fromUser: A.ownerId, toUser: B.ownerId }));
    expect(await h.asUser(B.ownerId).run((tx) => tx.select().from(s.connections))).toHaveLength(1);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.connections))).toHaveLength(0);
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.connections).values({ fromUser: A.ownerId, toUser: outsiderId }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.connections).values({ fromUser: outsiderId, toUser: A.ownerId, status: "accepted" }))).rejects.toThrow(RLS_DENIED);
  });
  it("connections (0016): a block belongs to whoever set it, only the recipient accepts, and nobody starts a request over a block", async () => {
    const asker = A.adminId;
    const blocker = B.adminId;
    const mine = (id: string) => eq(s.connections.id, id);
    const [c] = await h.asUser(asker).run((tx) => tx.insert(s.connections).values({ fromUser: asker, toUser: blocker }).returning());
    // The writer must be the one named as blocking, and a request can never be inserted as blocked or accepted.
    await expect(h.asUser(asker).run((tx) => tx.insert(s.connections).values({ fromUser: asker, toUser: B.memberId, status: "blocked", blockedBy: asker }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(asker).run((tx) => tx.insert(s.connections).values({ fromUser: asker, toUser: B.memberId, blockedBy: blocker }))).rejects.toThrow();
    await expect(h.asUser(asker).run((tx) => tx.update(s.connections).set({ status: "blocked", blockedBy: blocker }).where(mine(c!.id)))).rejects.toThrow(RLS_DENIED);
    // The requester cannot accept their own request; the recipient can.
    await expect(h.asUser(asker).run((tx) => tx.update(s.connections).set({ status: "accepted" }).where(mine(c!.id)))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(blocker).run((tx) => tx.update(s.connections).set({ status: "accepted" }).where(mine(c!.id)).returning())).toHaveLength(1);
    // The recipient blocks, naming themselves.
    const blocked = await h.asUser(blocker).run((tx) => tx.update(s.connections).set({ status: "blocked", blockedBy: blocker }).where(mine(c!.id)).returning());
    expect(blocked.map((r) => r.blockedBy)).toEqual([blocker]);
    // A block is never announced: the blocked party does not see the row, and so can change or delete nothing of it.
    expect(await h.asUser(asker).run((tx) => tx.select().from(s.connections).where(mine(c!.id)))).toHaveLength(0);
    expect(await h.asUser(blocker).run((tx) => tx.select().from(s.connections).where(mine(c!.id)))).toHaveLength(1);
    expect(await h.asUser(asker).run((tx) => tx.update(s.connections).set({ status: "accepted", blockedBy: null }).where(mine(c!.id)).returning())).toHaveLength(0);
    expect(await h.asUser(asker).run((tx) => tx.update(s.connections).set({ blockedBy: asker }).where(mine(c!.id)).returning())).toHaveLength(0);
    expect(await h.asUser(asker).run((tx) => tx.delete(s.connections).where(mine(c!.id)).returning())).toHaveLength(0);
    // Nobody can open a new request between the two while the block stands, from either side.
    await expect(h.asUser(blocker).run((tx) => tx.insert(s.connections).values({ fromUser: blocker, toUser: asker }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(asker).run((tx) => tx.insert(s.connections).values({ fromUser: asker, toUser: blocker }))).rejects.toThrow(/duplicate|unique|row-level/i);
    // A block always names a party, and a row is blocked exactly when it names one.
    await expect(h.service().run((tx) => tx.update(s.connections).set({ blockedBy: outsiderId }).where(mine(c!.id)))).rejects.toThrow();
    await expect(h.service().run((tx) => tx.update(s.connections).set({ blockedBy: null }).where(mine(c!.id)))).rejects.toThrow();
    // Only the blocker lifts it (deletes the row); then a request can start again.
    expect(await h.asUser(blocker).run((tx) => tx.delete(s.connections).where(mine(c!.id)).returning())).toHaveLength(1);
    await h.asUser(asker).run((tx) => tx.insert(s.connections).values({ fromUser: asker, toUser: blocker }));
    expect(await h.service().run((tx) => tx.select().from(s.connections).where(and(eq(s.connections.fromUser, asker), eq(s.connections.toUser, blocker))))).toHaveLength(1);
  });
  it("connections (0016): a row cannot be moved between people, a block is lifted only by deleting it, and the pair is unique", async () => {
    const asker = A.viewerId;
    const victim = B.viewerId;
    const mine = (id: string) => eq(s.connections.id, id);
    const [c] = await h.asUser(asker).run((tx) => tx.insert(s.connections).values({ fromUser: asker, toUser: victim }).returning());
    // A party cannot rewrite who the row is between: swapping the sides to forge "the victim asked me" (or accepted) fails.
    await expect(h.asUser(asker).run((tx) => tx.update(s.connections).set({ fromUser: victim, toUser: asker, status: "accepted" }).where(mine(c!.id)))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(asker).run((tx) => tx.update(s.connections).set({ fromUser: victim, toUser: asker }).where(mine(c!.id)))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(victim).run((tx) => tx.update(s.connections).set({ message: "rewritten" }).where(mine(c!.id)))).rejects.toThrow(RLS_DENIED);
    // Not even the service role may: the trigger holds for every role.
    await expect(h.service().run((tx) => tx.update(s.connections).set({ fromUser: victim, toUser: asker }).where(mine(c!.id)))).rejects.toThrow(/cannot change who it is between/);
    expect(await h.service().run((tx) => tx.select().from(s.connections).where(mine(c!.id)))).toMatchObject([{ fromUser: asker, toUser: victim, status: "requested" }]);
    // One row per pair: the other direction cannot be added beside it, for the client roles or the service.
    await expect(h.service().run((tx) => tx.insert(s.connections).values({ fromUser: victim, toUser: asker }))).rejects.toThrow(/connections_pair_key|duplicate/);
    // A block is lifted by deleting the row, never by turning it into an acceptance (the blocker is the recipient here).
    await h.asUser(victim).run((tx) => tx.update(s.connections).set({ status: "blocked", blockedBy: victim }).where(mine(c!.id)));
    await expect(h.asUser(victim).run((tx) => tx.update(s.connections).set({ status: "accepted", blockedBy: null }).where(mine(c!.id)))).rejects.toThrow(/lifted by deleting/);
    await expect(h.asUser(victim).run((tx) => tx.update(s.connections).set({ status: "requested", blockedBy: null }).where(mine(c!.id)))).rejects.toThrow(/lifted by deleting/);
    await expect(h.service().run((tx) => tx.update(s.connections).set({ status: "accepted", blockedBy: null }).where(mine(c!.id)))).rejects.toThrow(/lifted by deleting/);
    expect(await h.service().run((tx) => tx.select().from(s.connections).where(mine(c!.id)))).toMatchObject([{ status: "blocked", blockedBy: victim }]);
  });
  it("connection_is_blocked answers a party to the pair and the service role, and nobody else; anon cannot call it", async () => {
    const x = A.memberId;
    const y = B.memberId;
    await h.service().run((tx) => tx.insert(s.connections).values({ fromUser: x, toUser: y, status: "blocked", blockedBy: y }));
    const ask = (run: ReturnType<typeof h.asUser>) => run.execute<{ b: boolean }>(sql`select connection_is_blocked(${x}::uuid, ${y}::uuid) as b`);
    expect((await ask(h.asUser(x)))[0]!.b).toBe(true);
    expect((await ask(h.asUser(y)))[0]!.b).toBe(true);
    expect((await ask(h.service()))[0]!.b).toBe(true);
    expect((await ask(h.asUser(outsiderId)))[0]!.b).toBe(false);
    await expect(ask(h.anon())).rejects.toThrow(/permission denied/);
  });
  it("messages: only thread participants can read; no client role can write a thread or a message", async () => {
    const [thread] = await h.service().run((tx) => tx.insert(s.messageThreads).values({ participantIds: [A.ownerId, B.ownerId] }).returning());
    await h.service().run((tx) => tx.insert(s.messages).values({ threadId: thread!.id, fromUser: B.ownerId, body: "hello" }));
    expect(await h.asUser(A.ownerId).run((tx) => tx.select().from(s.messages))).toHaveLength(1);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.messages))).toHaveLength(0);
    expect(await h.asUser(outsiderId).run((tx) => tx.select(threadColumns).from(s.messageThreads))).toHaveLength(0);
    // Writes belong to the api (0016): a forged thread would otherwise pass for a conversation the two share.
    const denied = /permission denied/;
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.messageThreads).values({ participantIds: [A.ownerId, outsiderId] }))).rejects.toThrow(denied);
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.messageThreads).values({ participantIds: [A.ownerId, B.ownerId] }))).rejects.toThrow(denied);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.messageThreads).set({ participantIds: [A.ownerId, outsiderId] }).where(eq(s.messageThreads.id, thread!.id)))).rejects.toThrow(denied);
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.messageThreads).where(eq(s.messageThreads.id, thread!.id)))).rejects.toThrow(denied);
    await expect(h.asUser(B.ownerId).run((tx) => tx.insert(s.messages).values({ threadId: thread!.id, fromUser: B.ownerId, body: "direct write" }))).rejects.toThrow(denied);
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.messages).values({ threadId: thread!.id, fromUser: outsiderId, body: "intrude" }))).rejects.toThrow(denied);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.messages).set({ readBy: [A.ownerId] }).where(eq(s.messages.threadId, thread!.id)))).rejects.toThrow(denied);
    await expect(h.anon().run((tx) => tx.insert(s.messages).values({ threadId: thread!.id, fromUser: A.ownerId, body: "anon" }))).rejects.toThrow(denied);
    expect(await h.service().run((tx) => tx.select().from(s.messages))).toHaveLength(1);
  });
});

describe("communities, community_members, posts", () => {
  it("communities: public ones are listable, posts are read by members only, and no client role can write any of them", async () => {
    const [community] = await h.service().run((tx) => tx.insert(s.communities).values({ name: "Founders EU", slug: "founders-eu", createdBy: A.ownerId }).returning());
    await h.service().run((tx) => tx.insert(s.communityMembers).values({ communityId: community!.id, userId: A.ownerId, role: "owner" }));
    await h.service().run((tx) => tx.insert(s.communityMembers).values({ communityId: community!.id, userId: B.ownerId }));
    const [post] = await h.service().run((tx) => tx.insert(s.posts).values({ communityId: community!.id, authorUserId: B.ownerId, bodyMd: "hi all" }).returning());
    expect(await h.asUser(B.ownerId).run((tx) => tx.select(postColumns).from(s.posts))).toHaveLength(1);
    expect(await h.asUser(outsiderId).run((tx) => tx.select(postColumns).from(s.posts))).toHaveLength(0);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.communities))).toHaveLength(1);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.communityMembers))).toHaveLength(0);

    // Writes belong to the api (0016): joining, posting, moderating and un-muting each have rules a policy cannot state.
    const denied = /permission denied/;
    const forgedBusiness = A.businessId;
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.communities).values({ name: "Mine", slug: "mine", createdBy: outsiderId }))).rejects.toThrow(denied);
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.communityMembers).values({ communityId: community!.id, userId: outsiderId, businessId: forgedBusiness }))).rejects.toThrow(denied);
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.communityMembers).values({ communityId: community!.id, userId: outsiderId, role: "owner" }))).rejects.toThrow(denied);
    await expect(h.asUser(B.ownerId).run((tx) => tx.insert(s.posts).values({ communityId: community!.id, authorUserId: B.ownerId, businessId: forgedBusiness, bodyMd: "as someone's business" }))).rejects.toThrow(denied);
    await expect(h.asUser(B.ownerId).run((tx) => tx.insert(s.posts).values({ communityId: community!.id, authorUserId: B.ownerId, bodyMd: "plain" }))).rejects.toThrow(denied);
    // A muted member cannot restore or promote themselves, and an author cannot un-hide what was moderated.
    await h.service().run((tx) => tx.update(s.communityMembers).set({ status: "muted" }).where(and(eq(s.communityMembers.communityId, community!.id), eq(s.communityMembers.userId, B.ownerId))));
    await expect(h.asUser(B.ownerId).run((tx) => tx.update(s.communityMembers).set({ status: "active", role: "owner" }).where(eq(s.communityMembers.userId, B.ownerId)))).rejects.toThrow(denied);
    await h.service().run((tx) => tx.update(s.posts).set({ status: "hidden" }).where(eq(s.posts.id, post!.id)));
    await expect(h.asUser(B.ownerId).run((tx) => tx.update(s.posts).set({ status: "visible" }).where(eq(s.posts.id, post!.id)))).rejects.toThrow(denied);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.posts).set({ status: "removed" }).where(eq(s.posts.communityId, community!.id)))).rejects.toThrow(denied);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.communities).set({ name: "Mine now" }).where(eq(s.communities.id, community!.id)))).rejects.toThrow(denied);
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.posts).where(eq(s.posts.id, post!.id)))).rejects.toThrow(denied);
    expect((await h.service().run((tx) => tx.select().from(s.posts).where(eq(s.posts.id, post!.id))))[0]!.status).toBe("hidden");
    expect((await h.service().run((tx) => tx.select().from(s.communityMembers).where(eq(s.communityMembers.userId, B.ownerId))))[0]).toMatchObject({ status: "muted", role: "member" });
  });

  it("0027: an author reads their own held post, a muted member still reads, an invitee sees the private community it is for", async () => {
    const [room] = await h.service().run((tx) => tx.insert(s.communities).values({ name: "Private 27", slug: "private-27", visibility: "private", createdBy: A.adminId }).returning());
    await h.service().run((tx) =>
      tx.insert(s.communityMembers).values([
        { communityId: room!.id, userId: A.adminId, role: "owner" },
        { communityId: room!.id, userId: B.adminId, status: "muted" },
        { communityId: room!.id, userId: B.memberId, status: "invited", invitedBy: A.adminId },
      ]),
    );
    const [held] = await h.service().run((tx) => tx.insert(s.posts).values({ communityId: room!.id, authorUserId: B.adminId, bodyMd: "held", status: "pending_review" }).returning());
    await h.service().run((tx) => tx.insert(s.posts).values({ communityId: room!.id, authorUserId: A.adminId, bodyMd: "visible" }));
    // The muted member reads the feed and their own held post; the invitee sees the community but not its feed.
    expect((await h.asUser(B.adminId).run((tx) => tx.select(postColumns).from(s.posts).where(eq(s.posts.communityId, room!.id)))).map((p) => p.bodyMd).sort()).toEqual(["held", "visible"]);
    expect(await h.asUser(B.memberId).run((tx) => tx.select().from(s.communities).where(eq(s.communities.id, room!.id)))).toHaveLength(1);
    expect(await h.asUser(B.memberId).run((tx) => tx.select(postColumns).from(s.posts).where(eq(s.posts.communityId, room!.id)))).toHaveLength(0);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.communities).where(eq(s.communities.id, room!.id)))).toHaveLength(0);
    // The owner (a moderator) sees the held post too; nobody else outside does.
    expect((await h.asUser(A.adminId).run((tx) => tx.select(postColumns).from(s.posts).where(eq(s.posts.id, held!.id))))).toHaveLength(1);
    expect(await h.asUser(outsiderId).run((tx) => tx.select(postColumns).from(s.posts).where(eq(s.posts.id, held!.id)))).toHaveLength(0);
  });

  it("post_reports (0027): the reporter and the community's moderators read a report; nobody writes one directly", async () => {
    const [room] = await h.service().run((tx) => tx.insert(s.communities).values({ name: "Reports 27", slug: "reports-27", createdBy: A.memberId }).returning());
    await h.service().run((tx) =>
      tx.insert(s.communityMembers).values([
        { communityId: room!.id, userId: A.memberId, role: "owner" },
        { communityId: room!.id, userId: B.viewerId },
        { communityId: room!.id, userId: A.viewerId },
      ]),
    );
    const [post] = await h.service().run((tx) => tx.insert(s.posts).values({ communityId: room!.id, authorUserId: A.viewerId, bodyMd: "spam" }).returning());
    await h.service().run((tx) => tx.insert(s.postReports).values({ postId: post!.id, communityId: room!.id, reporterUserId: B.viewerId, reason: "spam" }));
    expect(await h.asUser(B.viewerId).run((tx) => tx.select().from(s.postReports))).toHaveLength(1);
    expect(await h.asUser(A.memberId).run((tx) => tx.select().from(s.postReports).where(eq(s.postReports.communityId, room!.id)))).toHaveLength(1);
    // The author of the reported post and outsiders never learn who reported it.
    expect(await h.asUser(A.viewerId).run((tx) => tx.select().from(s.postReports))).toHaveLength(0);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.postReports))).toHaveLength(0);
    const denied = /permission denied/;
    await expect(h.asUser(B.viewerId).run((tx) => tx.insert(s.postReports).values({ postId: post!.id, communityId: room!.id, reporterUserId: B.viewerId, reason: "scam" }))).rejects.toThrow(denied);
    await expect(h.asUser(A.memberId).run((tx) => tx.update(s.postReports).set({ resolution: "dismissed", resolvedAt: new Date() }).where(eq(s.postReports.postId, post!.id)))).rejects.toThrow(denied);
    await expect(h.asUser(A.memberId).run((tx) => tx.delete(s.postReports).where(eq(s.postReports.postId, post!.id)))).rejects.toThrow(denied);
    await expect(h.anon().run((tx) => tx.select().from(s.postReports))).rejects.toThrow(denied);
  });
});

describe("network_attestations (0027)", () => {
  it("network_attestations: a person reads only their own 18+ confirmation; only the api writes one", async () => {
    await h.service().run((tx) => tx.insert(s.networkAttestations).values({ userId: A.ownerId }));
    expect((await h.asUser(A.ownerId).run((tx) => tx.select().from(s.networkAttestations))).map((r) => r.userId)).toEqual([A.ownerId]);
    expect(await h.asUser(B.ownerId).run((tx) => tx.select().from(s.networkAttestations))).toHaveLength(0);
    const denied = /permission denied/;
    await expect(h.asUser(B.ownerId).run((tx) => tx.insert(s.networkAttestations).values({ userId: B.ownerId }))).rejects.toThrow(denied);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.networkAttestations).set({ adultConfirmedAt: new Date(0) }).where(eq(s.networkAttestations.userId, A.ownerId)))).rejects.toThrow(denied);
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.networkAttestations).where(eq(s.networkAttestations.userId, A.ownerId)))).rejects.toThrow(denied);
    await expect(h.anon().run((tx) => tx.select().from(s.networkAttestations))).rejects.toThrow(denied);
  });
});

describe("public views (LIVE only)", () => {
  it("leaderboards are gone (0076): neither table is left for any role to read", async () => {
    const res = await h.db.execute(sql`select to_regclass('public.leaderboards')::text as boards, to_regclass('public.leaderboard_entries')::text as entries`);
    expect((res as unknown as { rows: { boards: string | null; entries: string | null }[] }).rows[0]).toEqual({ boards: null, entries: null });
  });
  it("public_profiles: lists LIVE businesses and their public, confirmed founders only", async () => {
    await h.db.update(s.businesses).set({ gameMode: "live", committedAt: new Date() }).where(eq(s.businesses.id, A.businessId));
    await h.db.insert(s.founderProfiles).values({ userId: A.memberId, displayName: "Private member", visibility: "private" });
    await h.db.insert(s.founderProfiles).values({ userId: A.adminId, displayName: "Public admin", visibility: "public" });
    // A founder card needs the person's 18+ confirmation (0160): unconfirmed, the public admin is not listed yet.
    expect((await h.anon().run((tx) => tx.select().from(s.publicProfiles))).filter((r) => r.kind === "founder")).toEqual([]);
    await h.db.insert(s.adultConfirmations).values({ userId: A.adminId }).onConflictDoNothing();
    const rows = await h.anon().run((tx) => tx.select().from(s.publicProfiles));
    expect(rows.filter((r) => r.kind === "business").map((r) => r.businessId)).toEqual([A.businessId]);
    expect(rows.filter((r) => r.kind === "founder").map((r) => r.displayName)).toEqual(["Public admin"]);
    expect(rows.some((r) => r.businessId === B.businessId)).toBe(false);
  });
});

describe("negotiation_threads", () => {
  it("negotiation_threads: both sides read, outsiders do not; only owners/admins may stop", async () => {
    const [thread] = await h.service().run((tx) =>
      tx.insert(s.negotiationThreads).values({ businessA: A.businessId, businessB: B.businessId, agentA: A.agentId, agentB: B.agentId, subject: "Co-marketing" }).returning(),
    );
    expect(await h.asUser(A.viewerId).run((tx) => tx.select().from(s.negotiationThreads))).toHaveLength(1);
    expect(await h.asUser(B.memberId).run((tx) => tx.select().from(s.negotiationThreads))).toHaveLength(1);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.negotiationThreads))).toHaveLength(0);
    const byMember = await h.asUser(A.memberId).run((tx) => tx.update(s.negotiationThreads).set({ status: "stopped" }).where(eq(s.negotiationThreads.id, thread!.id)).returning());
    expect(byMember).toHaveLength(0);
    const byOwner = await h.asUser(B.ownerId).run((tx) => tx.update(s.negotiationThreads).set({ status: "stopped" }).where(eq(s.negotiationThreads.id, thread!.id)).returning());
    expect(byOwner).toHaveLength(1);
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.negotiationThreads).values({ businessA: A.businessId, businessB: B.businessId }))).rejects.toThrow(RLS_DENIED);
  });
});

describe("journey_daily (security-barrier view over the matview)", () => {
  it("journey_daily: members see only their business; the matview itself is service-only", async () => {
    await h.service().execute(sql`select refresh_journey_daily()`);
    const a = await h.asUser(A.memberId).run((tx) => tx.select().from(s.journeyDaily));
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((r) => r.businessId === A.businessId)).toBe(true);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.journeyDaily))).toHaveLength(0);
    await expect(h.asUser(A.ownerId).run((tx) => tx.select().from(s.journeyDailyMv))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).execute(sql`select refresh_journey_daily()`)).rejects.toThrow(/permission denied/);
    const payments = a.reduce((n, r) => n + r.payments, 0);
    expect(payments).toBe(2); // fixture: 6 conversions, kinds cycle signup/activation/payment
  });
});

describe("members may mark journeys viewed (the one member write on a service table)", () => {
  it("journeys: viewed_at is updatable by a member of the same business only", async () => {
    const mine = await h.asUser(A.memberId).run((tx) =>
      tx.update(s.journeys).set({ viewedAt: new Date() }).where(and(eq(s.journeys.businessId, A.businessId))).returning(),
    );
    expect(mine.length).toBe(0); // fixture has no journeys yet
    await h.service().run((tx) => tx.insert(s.journeys).values({ businessId: A.businessId, conversionId: A.conversionIds[0]!, matchdayLevel: "cup" }));
    const marked = await h.asUser(A.memberId).run((tx) => tx.update(s.journeys).set({ viewedAt: new Date() }).where(eq(s.journeys.businessId, A.businessId)).returning());
    expect(marked).toHaveLength(1);
    const cross = await h.asUser(B.memberId).run((tx) => tx.update(s.journeys).set({ viewedAt: new Date() }).where(eq(s.journeys.businessId, A.businessId)).returning());
    expect(cross).toHaveLength(0);
  });
});
