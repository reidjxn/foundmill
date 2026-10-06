/** Tables whose tenancy is not a plain business_id: user-owned, nullable-until-commit, platform-wide and social. */
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
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
  it("dashboard_layouts: a member sees only their own layout for a business they belong to", async () => {
    await h.asUser(A.memberId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: A.businessId, userId: A.memberId, name: "Home" }));
    await h.asUser(A.ownerId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: A.businessId, userId: A.ownerId, name: "Home" }));
    const mine = await h.asUser(A.memberId).run((tx) => tx.select().from(s.dashboardLayouts));
    expect(mine.map((l) => l.userId)).toEqual([A.memberId]);
    await expect(h.asUser(A.memberId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: A.businessId, userId: A.ownerId, name: "Spoof" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(B.memberId).run((tx) => tx.insert(s.dashboardLayouts).values({ businessId: A.businessId, userId: B.memberId, name: "Cross" }))).rejects.toThrow(RLS_DENIED);
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
  it("messages: only thread participants can read or post", async () => {
    const [thread] = await h.asUser(A.ownerId).run((tx) => tx.insert(s.messageThreads).values({ participantIds: [A.ownerId, B.ownerId] }).returning());
    await h.asUser(B.ownerId).run((tx) => tx.insert(s.messages).values({ threadId: thread!.id, fromUser: B.ownerId, body: "hello" }));
    expect(await h.asUser(A.ownerId).run((tx) => tx.select().from(s.messages))).toHaveLength(1);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.messages))).toHaveLength(0);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.messageThreads))).toHaveLength(0);
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.messages).values({ threadId: thread!.id, fromUser: outsiderId, body: "intrude" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.messages).values({ threadId: thread!.id, fromUser: B.ownerId, body: "impersonate" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.messageThreads).values({ participantIds: [A.ownerId, B.ownerId] }))).rejects.toThrow(RLS_DENIED);
  });
});

describe("communities, community_members, posts", () => {
  it("communities: public ones are listable; posts only for active members; moderation for moderators", async () => {
    const [community] = await h.asUser(A.ownerId).run((tx) => tx.insert(s.communities).values({ name: "Founders EU", slug: "founders-eu", createdBy: A.ownerId }).returning());
    await h.service().run((tx) => tx.insert(s.communityMembers).values({ communityId: community!.id, userId: A.ownerId, role: "owner" }));
    // B joins a public community as a plain member.
    await h.asUser(B.ownerId).run((tx) => tx.insert(s.communityMembers).values({ communityId: community!.id, userId: B.ownerId }));
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.communityMembers).values({ communityId: community!.id, userId: outsiderId, role: "owner" }))).rejects.toThrow(RLS_DENIED);
    await h.asUser(B.ownerId).run((tx) => tx.insert(s.posts).values({ communityId: community!.id, authorUserId: B.ownerId, bodyMd: "hi all" }));
    await expect(h.asUser(outsiderId).run((tx) => tx.insert(s.posts).values({ communityId: community!.id, authorUserId: outsiderId, bodyMd: "spam" }))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.posts))).toHaveLength(0);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.communities))).toHaveLength(1);
    // B cannot hide others' posts, the owner (moderator) can.
    const byB = await h.asUser(B.ownerId).run((tx) => tx.update(s.communities).set({ name: "Mine now" }).where(eq(s.communities.id, community!.id)).returning());
    expect(byB).toHaveLength(0);
    const byOwner = await h.asUser(A.ownerId).run((tx) => tx.update(s.posts).set({ status: "hidden" }).where(eq(s.posts.communityId, community!.id)).returning());
    expect(byOwner).toHaveLength(1);
    expect(await h.asUser(B.ownerId).run((tx) => tx.select().from(s.posts))).toHaveLength(0);
  });
});

describe("leaderboards and public views (LIVE only)", () => {
  it("leaderboard_entries: visible only for committed LIVE businesses; never writable by app roles", async () => {
    const [board] = await h.service().run((tx) => tx.insert(s.leaderboards).values({ boardKind: "revenue", period: "2026-Q4", metric: "mrr" }).returning());
    await h.service().run((tx) =>
      tx.insert(s.leaderboardEntries).values([
        { leaderboardId: board!.id, businessId: A.businessId, position: 1, metricValue: "1000" },
        { leaderboardId: board!.id, businessId: B.businessId, position: 2, metricValue: "900" },
      ]),
    );
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.leaderboardEntries))).toHaveLength(0);
    await h.db.update(s.businesses).set({ gameMode: "live", committedAt: new Date() }).where(eq(s.businesses.id, A.businessId));
    const visible = await h.asUser(outsiderId).run((tx) => tx.select().from(s.leaderboardEntries));
    expect(visible.map((e) => e.businessId)).toEqual([A.businessId]);
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.leaderboardEntries).values({ leaderboardId: board!.id, businessId: A.businessId, position: 0, metricValue: "1" }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.leaderboards).values({ boardKind: "x", period: "p", metric: "m" }))).rejects.toThrow(/permission denied/);
  });
  it("public_profiles: lists LIVE businesses and their public founders only", async () => {
    await h.db.update(s.businesses).set({ gameMode: "live", committedAt: new Date() }).where(eq(s.businesses.id, A.businessId));
    await h.db.insert(s.founderProfiles).values({ userId: A.memberId, displayName: "Private member", visibility: "private" });
    await h.db.insert(s.founderProfiles).values({ userId: A.adminId, displayName: "Public admin", visibility: "public" });
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
