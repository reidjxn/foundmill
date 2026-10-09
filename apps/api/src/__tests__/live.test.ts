/**
 * live.* behind the Network, Communities and Leaderboards screens: community visibility on the service connection,
 * the feed for members only, posting as a business only when the caller belongs to it, per-thread unread counts,
 * display-name lookup under profile visibility, and the profile visibility setting.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "live" });
}, 120_000);
afterAll(() => hz.close());

const as = (userId: string) => hz.caller({ userId });

describe("communities", () => {
  it("lists public communities and the caller's own, with their role; a private one reads as missing to everyone else", async () => {
    const owner = as(hz.A.ownerId);
    const outsider = as(hz.B.ownerId);
    const open = await repos.social.createCommunity(hz.db, { name: "Open floor", slug: "live-open-floor", createdBy: hz.A.ownerId });
    const closed = await repos.social.createCommunity(hz.db, { name: "Back room", slug: "live-back-room", visibility: "private", createdBy: hz.A.ownerId });

    const mine = await owner.live.communities.list();
    expect(mine.find((c) => c.id === open.id)?.role).toBe("owner");
    expect(mine.map((c) => c.id)).toContain(closed.id);

    const theirs = await outsider.live.communities.list();
    expect(theirs.find((c) => c.id === open.id)?.role).toBeNull();
    expect(theirs.map((c) => c.id)).not.toContain(closed.id);

    await expect(outsider.live.communities.get({ communityId: closed.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(outsider.live.communities.join({ communityId: closed.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A non-member sees a public community's description and size, but not its member list or its feed.
    const seen = await outsider.live.communities.get({ communityId: open.id });
    expect(seen).toMatchObject({ isMember: false, role: null, members: [] });
    expect(seen.community.name).toBe("Open floor");
    await expect(outsider.live.communities.posts({ communityId: open.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.live.communities.post({ communityId: open.id, bodyMd: "Let me in" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await outsider.live.communities.join({ communityId: open.id });
    const joined = await outsider.live.communities.get({ communityId: open.id });
    expect(joined).toMatchObject({ isMember: true, role: "member" });
    expect(joined.members.map((m) => m.userId).sort()).toEqual([hz.A.ownerId, hz.B.ownerId].sort());
    await outsider.live.communities.leave({ communityId: open.id });
    expect((await outsider.live.communities.get({ communityId: open.id })).isMember).toBe(false);
  });

  it("members post and reply; posts carry their reply count; a business can only be spoken for by its members", async () => {
    const owner = as(hz.A.ownerId);
    const community = await repos.social.createCommunity(hz.db, { name: "Feed room", slug: "live-feed-room", createdBy: hz.A.ownerId });
    const post = await owner.live.communities.post({ communityId: community.id, bodyMd: "First post", businessId: hz.A.businessId });
    expect(post.businessId).toBe(hz.A.businessId);
    await owner.live.communities.post({ communityId: community.id, bodyMd: "A reply", parentPostId: post.id });
    const feed = await owner.live.communities.posts({ communityId: community.id });
    expect(feed.items.map((p) => [p.id, p.replyCount])).toEqual([[post.id, 1]]);
    // Authors are named under their profile visibility: this one has no profile, so no name.
    expect(feed.items[0]!.authorName).toBeNull();
    await repos.founders.upsert(hz.db, hz.A.ownerId, { displayName: "Olive Owner", visibility: "private" });
    expect((await owner.live.communities.posts({ communityId: community.id })).items[0]!.authorName).toBe("Olive Owner");
    const replies = await owner.live.communities.posts({ communityId: community.id, parentPostId: post.id });
    expect(replies.items.map((p) => p.bodyMd)).toEqual(["A reply"]);

    // B's owner joins and tries to post as A's business, and to join as it.
    const other = as(hz.B.ownerId);
    await expect(other.live.communities.join({ communityId: community.id, businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await other.live.communities.join({ communityId: community.id, businessId: hz.B.businessId });
    await expect(other.live.communities.post({ communityId: community.id, bodyMd: "As someone else", businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await other.live.communities.post({ communityId: community.id, bodyMd: "As myself", businessId: hz.B.businessId })).businessId).toBe(hz.B.businessId);
  });
});

describe("messages and connections", () => {
  it("threads carry their unread count; reading a thread clears it; only the signed-in person sends", async () => {
    const a = as(hz.A.adminId);
    const b = as(hz.B.adminId);
    const sent = await b.live.messages.send({ toUserIds: [hz.A.adminId], subject: "Intro", body: "Hello from B" });
    await b.live.messages.send({ threadId: sent.threadId, body: "Second line" });
    expect(await a.live.messages.unread()).toBe(2);
    const threads = await a.live.messages.threads();
    expect(threads.items.find((t) => t.id === sent.threadId)?.unread).toBe(2);
    expect((await b.live.messages.threads()).items.find((t) => t.id === sent.threadId)?.unread).toBe(0);
    const read = await a.live.messages.list({ threadId: sent.threadId });
    expect(read.items.map((m) => m.body).sort()).toEqual(["Hello from B", "Second line"]);
    expect(await a.live.messages.unread()).toBe(0);
    expect((await a.live.messages.threads()).items.find((t) => t.id === sent.threadId)?.unread).toBe(0);
    await expect(as(hz.A.viewerId).live.messages.list({ threadId: sent.threadId })).rejects.toThrow(/Not a participant/);
    await expect(hz.caller(null).live.messages.send({ threadId: sent.threadId, body: "No session" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("names people under their profile visibility and businesses from public profiles", async () => {
    await repos.founders.upsert(hz.db, hz.A.memberId, { displayName: "Mia Member", visibility: "public" });
    await repos.founders.upsert(hz.db, hz.B.memberId, { displayName: "Ben Private", visibility: "private" });
    const viewer = as(hz.A.viewerId);
    const result = await viewer.live.people.lookup({ userIds: [hz.A.memberId, hz.B.memberId], businessIds: [hz.A.businessId] });
    expect(Object.fromEntries(result.users.map((u) => [u.userId, u.displayName]))).toEqual({ [hz.A.memberId]: "Mia Member", [hz.B.memberId]: null });
    // A's own members see the business whether or not it is LIVE; the card has what a logo needs.
    expect(result.businesses).toMatchObject([{ businessId: hz.A.businessId, kitPrimary: expect.any(String), kitSecondary: expect.any(String), slug: expect.any(String) }]);
    await expect(hz.caller(null).live.people.lookup({ userIds: [] })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("leaderboards and profile visibility", () => {
  it("returns one board with its entries and the business's positions", async () => {
    const board = await repos.social.upsertLeaderboard(hz.db, { boardKind: "growth", period: "2026-Q4", metric: "mrr_growth_pct", archetype: "b2b_saas" });
    await repos.social.setLeaderboardEntries(hz.db, board.id, [{ businessId: hz.A.businessId, metricValue: 12.5, form: "WWDLW" }]);
    const owner = as(hz.A.ownerId);
    expect((await owner.live.leaderboards.get({ leaderboardId: board.id })).metric).toBe("mrr_growth_pct");
    const entries = await owner.live.leaderboards.entries({ leaderboardId: board.id });
    expect(entries).toMatchObject([{ businessId: hz.A.businessId, position: 1, movement: 0, form: "WWDLW", businessName: "LIVE-A" }]);
    expect(entries[0]!.business).toMatchObject({ businessId: hz.A.businessId, kitPrimary: expect.any(String), slug: expect.any(String) });
    // A business the viewer cannot see (not LIVE and committed, not theirs) is ranked but unnamed.
    const stranger = await as(hz.B.ownerId).live.leaderboards.entries({ leaderboardId: board.id });
    expect(stranger[0]).toMatchObject({ businessId: hz.A.businessId, businessName: null, business: null });
    const positions = await owner.live.leaderboards.positions({ businessId: hz.A.businessId });
    expect(positions.map((p) => [p.position, p.board.id])).toEqual([[1, board.id]]);
    await expect(as(hz.B.ownerId).live.leaderboards.positions({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.live.leaderboards.get({ leaderboardId: "00000000-0000-0000-0000-0000000000aa" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reads and sets the founder's profile visibility", async () => {
    const owner = as(hz.A.ownerId);
    await repos.founders.upsert(hz.db, hz.A.ownerId, { displayName: "Olive Owner" });
    expect((await owner.live.profile.visibility.get()).visibility).toBe("private");
    await owner.live.profile.visibility.set({ visibility: "connections" });
    expect((await owner.live.profile.visibility.get()).visibility).toBe("connections");
    await expect(owner.live.profile.visibility.set({ visibility: "everyone" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
