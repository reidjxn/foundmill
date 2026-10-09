/** LIVE social: public profiles, connections, threads/messages, communities/posts, leaderboards, negotiations. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("live");
  await repos.businesses.setGameMode(r.db, r.A.businessId, "live");
  await repos.businesses.commit(r.db, r.A.businessId, { archetype: "b2b_saas" });
  // B is LIVE but not committed: it must stay out of public_profiles.
  await repos.businesses.setGameMode(r.db, r.B.businessId, "live");
});
afterAll(() => r?.close());

describe("public profiles", () => {
  it("only LIVE businesses appear and name search uses trigram matching", async () => {
    expect((await repos.social.publicProfile(r.db, r.A.businessId))?.displayName).toBe("LIVE-A");
    expect(await repos.social.publicProfile(r.db, r.B.businessId)).toBeNull();
    const hits = await repos.social.searchPublic(r.db, "live");
    expect(hits.map((h) => h.businessId)).toEqual([r.A.businessId]);
  });
});

describe("connections and messages", () => {
  it("request → accept, only the recipient accepts, blocked stays blocked", async () => {
    const a = r.A.ownerId;
    const b = r.B.ownerId;
    const c = await repos.social.requestConnection(r.db, a, b, "Hi!");
    expect(c.status).toBe("requested");
    expect((await repos.social.requestConnection(r.db, b, a)).id).toBe(c.id);
    await expect(repos.social.respondConnection(r.db, a, c.id, "accepted")).rejects.toThrow(/Only the recipient/);
    await expect(repos.social.respondConnection(r.db, r.A.memberId, c.id, "accepted")).rejects.toThrow(/Not a party/);
    expect((await repos.social.respondConnection(r.db, b, c.id, "accepted")).status).toBe("accepted");
    expect(await repos.social.areConnected(r.db, a, b)).toBe(true);
    expect((await repos.social.listConnections(r.db, b, { direction: "incoming", status: "accepted" })).map((x) => x.id)).toEqual([c.id]);
    await expect(repos.social.requestConnection(r.db, a, a)).rejects.toThrow(/yourself/);
    const blocked = await repos.social.requestConnection(r.db, a, r.B.memberId);
    await repos.social.respondConnection(r.db, r.B.memberId, blocked.id, "blocked");
    await expect(repos.social.requestConnection(r.db, a, r.B.memberId)).rejects.toThrow(/blocked/);
  });

  it("threads are unique per participant set; messages, read receipts and unread counts", async () => {
    const a = r.A.ownerId;
    const b = r.B.ownerId;
    const t1 = await repos.social.findOrCreateThread(r.db, a, [b], "Intro");
    const t2 = await repos.social.findOrCreateThread(r.db, b, [a]);
    expect(t2.id).toBe(t1.id);
    const t3 = await repos.social.findOrCreateThread(r.db, a, [b, r.B.memberId]);
    expect(t3.id).not.toBe(t1.id);
    await repos.social.sendMessage(r.db, a, t1.id, "Hello Bravo");
    await repos.social.sendMessage(r.db, b, t1.id, "Hello Alpha");
    await expect(repos.social.sendMessage(r.db, r.A.memberId, t1.id, "Intruder")).rejects.toThrow(/Not a participant/);
    expect(await repos.social.unreadCount(r.db, a)).toBe(1);
    expect(await repos.social.markThreadRead(r.db, a, t1.id)).toBe(1);
    expect(await repos.social.unreadCount(r.db, a)).toBe(0);
    const msgs = await repos.social.listMessages(r.db, b, t1.id);
    expect(msgs.items.map((m) => m.body)).toEqual(["Hello Alpha", "Hello Bravo"]);
    const threads = await repos.social.listThreads(r.db, a);
    expect(threads.items[0]!.id).toBe(t1.id); // most recent message first
    await expect(repos.social.listMessages(r.db, r.A.memberId, t1.id)).rejects.toThrow(/Not a participant/);
  });
});

describe("communities and posts", () => {
  it("creator is owner; join/leave maintain member_count; only members post", async () => {
    const community = await repos.social.createCommunity(r.db, { name: "DTC founders", slug: "dtc-founders", createdBy: r.A.ownerId, ownerBusinessId: r.A.businessId });
    expect(community.memberCount).toBe(1);
    await repos.social.joinCommunity(r.db, r.B.ownerId, community.id, { businessId: r.B.businessId });
    expect((await repos.social.getCommunity(r.db, community.id)).memberCount).toBe(2);
    await repos.social.joinCommunity(r.db, r.B.ownerId, community.id);
    expect((await repos.social.getCommunity(r.db, community.id)).memberCount).toBe(2);
    await expect(repos.social.createPost(r.db, { communityId: community.id, authorUserId: r.A.memberId, bodyMd: "hi" })).rejects.toThrow(/Only members/);
    const post = await repos.social.createPost(r.db, { communityId: community.id, authorUserId: r.B.ownerId, bodyMd: "First post", businessId: r.B.businessId });
    const reply = await repos.social.createPost(r.db, { communityId: community.id, authorUserId: r.A.ownerId, bodyMd: "Welcome", parentPostId: post.id });
    expect((await repos.social.listPosts(r.db, community.id)).items.map((p) => p.id)).toEqual([post.id]);
    expect((await repos.social.listPosts(r.db, community.id, { parentPostId: post.id })).items.map((p) => p.id)).toEqual([reply.id]);
    await repos.social.setPostStatus(r.db, post.id, "hidden");
    expect((await repos.social.listPosts(r.db, community.id)).items).toHaveLength(0);
    await repos.social.leaveCommunity(r.db, r.B.ownerId, community.id);
    expect((await repos.social.getCommunity(r.db, community.id)).memberCount).toBe(1);
    expect(await repos.social.isMember(r.db, r.B.ownerId, community.id)).toBe(false);
    expect((await repos.social.getCommunityBySlug(r.db, "dtc-founders"))?.id).toBe(community.id);
    expect((await repos.social.listCommunities(r.db, { visibility: "public" })).map((c) => c.id)).toContain(community.id);
  });
});

describe("people lookup, unread per thread, community visibility", () => {
  const profile = (displayName: string, visibility: "public" | "connections" | "community" | "private") => ({ displayName, visibility });

  it("names people by their profile visibility, and whoever has written to the viewer", async () => {
    const viewer = r.A.viewerId; // nobody is connected to this user yet
    const [pub, conn, comm, priv, stranger] = [r.A.ownerId, r.A.adminId, r.A.memberId, r.B.memberId, r.B.viewerId];
    await repos.founders.upsert(r.db, pub, profile("Pia Public", "public"));
    await repos.founders.upsert(r.db, conn, profile("Cal Connection", "connections"));
    await repos.founders.upsert(r.db, comm, profile("Cora Community", "community"));
    await repos.founders.upsert(r.db, priv, profile("Pat Private", "private"));
    await repos.founders.upsert(r.db, viewer, profile("Vic Viewer", "private"));
    const ids = [pub, conn, comm, priv, stranger, viewer];
    const names = async () => Object.fromEntries((await repos.social.lookupPeople(r.db, viewer, { userIds: ids })).users.map((u) => [u.userId, u.displayName]));

    // Self and Public are named; everyone else is held back, and a user with no profile has no name.
    expect(await names()).toEqual({ [pub]: "Pia Public", [conn]: null, [comm]: null, [priv]: null, [stranger]: null, [viewer]: "Vic Viewer" });

    // An accepted connection sees Connections and Community profiles.
    const link = await repos.social.requestConnection(r.db, viewer, conn);
    await repos.social.respondConnection(r.db, conn, link.id, "accepted");
    expect((await names())[conn]).toBe("Cal Connection");

    // A shared community shows Community profiles only.
    const club = await repos.social.createCommunity(r.db, { name: "Lookup circle", slug: "lookup-circle", createdBy: viewer });
    await repos.social.joinCommunity(r.db, comm, club.id);
    expect((await names())[comm]).toBe("Cora Community");
    await repos.social.joinCommunity(r.db, priv, club.id);
    expect((await names())[priv]).toBeNull();

    // A pending request to the viewer and a message in a shared thread name the sender, whatever their visibility.
    const request = await repos.social.requestConnection(r.db, priv, viewer, "Hello");
    expect(request.status).toBe("requested");
    expect((await names())[priv]).toBe("Pat Private");
    const thread = await repos.social.findOrCreateThread(r.db, viewer, [stranger]);
    expect((await names())[stranger]).toBeNull();
    await repos.founders.upsert(r.db, stranger, profile("Sam Stranger", "private"));
    await repos.social.sendMessage(r.db, stranger, thread.id, "Hi");
    expect((await names())[stranger]).toBe("Sam Stranger");
    // The same lookup is empty for an empty request and never throws for unknown ids.
    expect(await repos.social.lookupPeople(r.db, viewer, {})).toEqual({ users: [], businesses: [] });
    expect((await repos.social.lookupPeople(r.db, viewer, { userIds: ["00000000-0000-0000-0000-0000000000aa"] })).users).toEqual([{ userId: "00000000-0000-0000-0000-0000000000aa", displayName: null }]);
  });

  it("looks businesses up from public profiles and from the viewer's own memberships, in any game mode", async () => {
    // A is LIVE and committed (public); B is LIVE but uncommitted, so only B's members get its card.
    const asA = await repos.social.lookupPeople(r.db, r.A.memberId, { businessIds: [r.A.businessId, r.B.businessId] });
    expect(asA.businesses.map((b) => [b.businessId, b.name, b.live])).toEqual([[r.A.businessId, "LIVE-A", true]]);
    expect(asA.businesses[0]).toMatchObject({ kitPrimary: expect.any(String), kitSecondary: expect.any(String), slug: expect.any(String) });
    const asB = await repos.social.lookupPeople(r.db, r.B.ownerId, { businessIds: [r.A.businessId, r.B.businessId] });
    expect(asB.businesses.map((b) => b.businessId).sort()).toEqual([r.A.businessId, r.B.businessId].sort());
    await repos.businesses.setGameMode(r.db, r.B.businessId, "personal");
    const personal = await repos.social.lookupPeople(r.db, r.B.ownerId, { businessIds: [r.B.businessId] });
    expect(personal.businesses).toMatchObject([{ businessId: r.B.businessId, live: false }]);
    await repos.businesses.setGameMode(r.db, r.B.businessId, "live");
  });

  it("counts unread per thread, lists only what the viewer may see, and counts replies", async () => {
    const a = r.A.ownerId;
    const c = r.B.adminId;
    const thread = await repos.social.findOrCreateThread(r.db, a, [c], "Per-thread unread");
    await repos.social.sendMessage(r.db, c, thread.id, "one");
    await repos.social.sendMessage(r.db, c, thread.id, "two");
    expect((await repos.social.unreadByThread(r.db, a)).get(thread.id)).toBe(2);
    expect((await repos.social.unreadByThread(r.db, c)).get(thread.id)).toBeUndefined();
    await repos.social.markThreadRead(r.db, a, thread.id);
    expect((await repos.social.unreadByThread(r.db, a)).has(thread.id)).toBe(false);

    const open = await repos.social.createCommunity(r.db, { name: "Open room", slug: "open-room", createdBy: a });
    const closed = await repos.social.createCommunity(r.db, { name: "Closed room", slug: "closed-room", visibility: "private", createdBy: a });
    const seen = async (viewerId: string) => (await repos.social.listCommunities(r.db, { viewerId })).map((x) => x.id);
    expect(await seen(c)).toContain(open.id);
    expect(await seen(c)).not.toContain(closed.id);
    expect(await seen(a)).toEqual(expect.arrayContaining([open.id, closed.id]));
    expect((await repos.social.listCommunities(r.db, {})).map((x) => x.id)).toContain(closed.id); // no viewer, no filter (server jobs)
    expect([...(await repos.social.memberRoles(r.db, a, [open.id, closed.id])).entries()].sort()).toEqual([[open.id, "owner"], [closed.id, "owner"]].sort());
    expect((await repos.social.memberRoles(r.db, c, [open.id])).size).toBe(0);

    const post = await repos.social.createPost(r.db, { communityId: open.id, authorUserId: a, bodyMd: "Top" });
    await repos.social.createPost(r.db, { communityId: open.id, authorUserId: a, bodyMd: "Reply 1", parentPostId: post.id });
    const hidden = await repos.social.createPost(r.db, { communityId: open.id, authorUserId: a, bodyMd: "Reply 2", parentPostId: post.id });
    await repos.social.setPostStatus(r.db, hidden.id, "hidden");
    expect([...(await repos.social.replyCounts(r.db, [post.id])).entries()]).toEqual([[post.id, 1]]);
    expect((await repos.social.replyCounts(r.db, [])).size).toBe(0);
  });
});

describe("leaderboards", () => {
  it("ranks verified values first, computes movement between rebuilds, and removes a business on LIVE → Personal", async () => {
    const board = await repos.social.upsertLeaderboard(r.db, { boardKind: "mrr_growth", period: "2026-Q4", metric: "mrr_growth_pct", archetype: "b2b_saas" });
    expect((await repos.social.upsertLeaderboard(r.db, { boardKind: "mrr_growth", period: "2026-Q4", metric: "mrr_growth_pct", archetype: "b2b_saas" })).id).toBe(board.id);
    const first = await repos.social.setLeaderboardEntries(r.db, board.id, [
      { businessId: r.A.businessId, metricValue: 12.5 },
      { businessId: r.B.businessId, metricValue: 30, verified: false },
    ]);
    // Unverified values never enter a board (check constraint in 0012).
    expect(first.map((e) => [e.businessId, e.position, e.verified])).toEqual([[r.A.businessId, 1, true]]);
    const second = await repos.social.setLeaderboardEntries(r.db, board.id, [
      { businessId: r.A.businessId, metricValue: 10 },
      { businessId: r.B.businessId, metricValue: 30, verified: true, form: "WWD" },
    ]);
    expect(second.map((e) => [e.businessId, e.position, e.movement])).toEqual([
      [r.B.businessId, 1, 0],
      [r.A.businessId, 2, -1],
    ]);
    expect((await repos.social.positionsForBusiness(r.db, r.A.businessId, "2026-Q4"))[0]).toMatchObject({ position: 2, board: { boardKind: "mrr_growth" } });
    expect((await repos.social.getLeaderboard(r.db, board.id)).computedAt).toBeInstanceOf(Date);
    expect(await repos.social.removeBusinessFromLeaderboards(r.db, r.B.businessId)).toBe(1);
    expect((await repos.social.leaderboardEntries(r.db, board.id)).map((e) => e.businessId)).toEqual([r.A.businessId]);
  });
});

describe("negotiations", () => {
  it("opens one thread per subject between two businesses and closes it", async () => {
    const t = await repos.social.openNegotiation(r.db, r.A.businessId, { businessB: r.B.businessId, agentA: r.A.agentId, subject: "Co-marketing", limitsSnapshot: { priceMaxMinor: 50000 } });
    await expect(repos.social.openNegotiation(r.db, r.B.businessId, { businessB: r.A.businessId, subject: "Co-marketing" })).rejects.toThrow(/already exists/);
    await expect(repos.social.openNegotiation(r.db, r.A.businessId, { businessB: r.A.businessId })).rejects.toThrow(/itself/);
    expect((await repos.social.listNegotiations(r.db, r.B.businessId, { status: "open" })).map((x) => x.id)).toEqual([t.id]);
    expect(await repos.social.openNegotiationsCount(r.db, r.A.businessId)).toBe(1);
    const closed = await repos.social.setNegotiationStatus(r.db, r.B.businessId, t.id, "agreed", { transcriptRef: "enc://transcript" });
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(closed.transcriptRef).toBe("enc://transcript");
    await expect(repos.social.getNegotiation(r.db, "00000000-0000-0000-0000-000000000001", t.id)).rejects.toThrow(/not found/);
  });
});
