/**
 * live.* behind the Network, Communities and Leaderboards screens. The router runs on the service connection, so the
 * rules the row-level-security policies state (and a few they cannot) are applied here and pinned by these tests:
 * - boards serve only listed businesses (LIVE, committed, active), and a business leaves them when it goes Personal;
 * - a block belongs to whoever set it, and blocks stop messages and new requests;
 * - a Send reaches at most 20 people who exist, are connected to the sender and have not blocked them;
 * - only a writer with write access to the `live` section speaks as a LIVE, committed business;
 * - communities: visibility, members-only feeds, muted members, replies under real top-level posts, archived rooms;
 * - errors never echo SQL; a bad reference reads as "not found".
 */
import { communities, communityMembers, leaderboardEntries, repos } from "@foundmill/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as events from "../services/events";
import { internalErrorMessage, pgErrorCode } from "../trpc";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "live", env: { LIVE_MODE: "1" } });
}, 120_000);
afterAll(() => hz.close());
// These cases write far faster than the per-person allowances (services/live-limits.ts) allow; live-limits.test.ts covers those.
beforeEach(() => hz.limits.reset());

const as = (userId: string) => hz.caller({ userId });
const NOBODY = "00000000-0000-4000-8000-0000000000ff";

/** A business that is LIVE and committed: listed on the network. */
async function goLive(businessId: string) {
  await repos.businesses.setGameMode(hz.db, businessId, "live");
  await repos.businesses.commit(hz.db, businessId, { archetype: "b2b_saas" });
}

/** An accepted connection between two people, set up directly. */
async function connect(from: string, to: string) {
  const c = await repos.social.requestConnection(hz.db, from, to);
  await repos.social.respondConnection(hz.db, to, c.id, "accepted");
  return c;
}

/** The outcome of a call as `CODE` or `CODE: message`, for assertions on what a client would be told. */
async function failure(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code ?? "OTHER", message: String(e.message) };
  }
  return { code: "OK", message: "" };
}

const noSql = (message: string) => expect(message).not.toMatch(/Failed query|insert into|select |violates|"posts"|"connections"|params:/i);

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

  it("members post and reply; posts carry their reply count and author name; a post is as the person unless a listed business is named", async () => {
    const owner = as(hz.A.ownerId);
    const community = await repos.social.createCommunity(hz.db, { name: "Feed room", slug: "live-feed-room", createdBy: hz.A.ownerId });
    const post = await owner.live.communities.post({ communityId: community.id, bodyMd: "First post" });
    expect(post.businessId).toBeNull();
    await owner.live.communities.post({ communityId: community.id, bodyMd: "A reply", parentPostId: post.id });
    const feed = await owner.live.communities.posts({ communityId: community.id });
    expect(feed.items.map((p) => [p.id, p.replyCount])).toEqual([[post.id, 1]]);
    // Authors are named under their profile visibility: this one has no profile, so no name.
    expect(feed.items[0]!.authorName).toBeNull();
    await repos.founders.upsert(hz.db, hz.A.ownerId, { displayName: "Olive Owner", visibility: "private" });
    expect((await owner.live.communities.posts({ communityId: community.id })).items[0]!.authorName).toBe("Olive Owner");
    const replies = await owner.live.communities.posts({ communityId: community.id, parentPostId: post.id });
    expect(replies.items.map((p) => p.bodyMd)).toEqual(["A reply"]);
  });

  it("M3: only a writer with write access to the live section speaks as a LIVE, committed business", async () => {
    const community = await repos.social.createCommunity(hz.db, { name: "Speakers", slug: "live-speakers", createdBy: hz.B.ownerId });
    for (const u of [hz.A.ownerId, hz.A.adminId, hz.A.memberId, hz.A.viewerId, hz.B.ownerId]) await as(u).live.communities.join({ communityId: community.id });
    const say = (user: string, businessId: string | null) => as(user).live.communities.post({ communityId: community.id, bodyMd: `From ${user.slice(-4)}`, businessId });

    // A is still a Personal business: nobody can speak as it, whatever their role (PoC 4).
    expect((await failure(say(hz.A.ownerId, hz.A.businessId))).code).toBe("BAD_REQUEST");
    expect((await failure(as(hz.A.adminId).live.communities.join({ communityId: community.id, businessId: hz.A.businessId }))).code).toBe("BAD_REQUEST");

    await goLive(hz.A.businessId);
    // A viewer belongs to the business but never writes for it; as themselves they may post.
    expect((await failure(say(hz.A.viewerId, hz.A.businessId))).code).toBe("FORBIDDEN");
    expect((await failure(as(hz.A.viewerId).live.communities.join({ communityId: community.id, businessId: hz.A.businessId }))).code).toBe("FORBIDDEN");
    expect((await say(hz.A.viewerId, null)).businessId).toBeNull();
    // Someone who is not a member at all, in either direction.
    expect((await failure(say(hz.B.ownerId, hz.A.businessId))).code).toBe("FORBIDDEN");
    // Owner, admin and member write by default; a restriction on the live section takes it away.
    expect((await say(hz.A.ownerId, hz.A.businessId)).businessId).toBe(hz.A.businessId);
    expect((await say(hz.A.adminId, hz.A.businessId)).businessId).toBe(hz.A.businessId);
    expect((await say(hz.A.memberId, hz.A.businessId)).businessId).toBe(hz.A.businessId);
    await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, { live: "read" });
    expect((await failure(say(hz.A.memberId, hz.A.businessId))).code).toBe("FORBIDDEN");
    await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, { live: "none" });
    expect((await failure(say(hz.A.memberId, hz.A.businessId))).code).toBe("FORBIDDEN");
    await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, {});
    // An archived business is not listed either.
    await repos.businesses.archive(hz.db, hz.A.businessId);
    expect((await failure(say(hz.A.ownerId, hz.A.businessId))).code).toBe("BAD_REQUEST");
    await hz.db.execute(sql`update businesses set archived_at = null where id = ${hz.A.businessId}::uuid`);
  });

  it("a business that stops being listed is no longer named in posts, members or its community, except to its own members", async () => {
    const community = await repos.social.createCommunity(hz.db, { name: "Named", slug: "live-named", createdBy: hz.A.ownerId, ownerBusinessId: hz.A.businessId });
    await as(hz.A.ownerId).live.communities.join({ communityId: community.id, businessId: hz.A.businessId });
    await as(hz.B.ownerId).live.communities.join({ communityId: community.id });
    await as(hz.A.ownerId).live.communities.post({ communityId: community.id, bodyMd: "As the business", businessId: hz.A.businessId });
    const stranger = as(hz.B.ownerId);
    const own = as(hz.A.ownerId);
    // Listed: everyone sees the business id.
    expect((await stranger.live.communities.posts({ communityId: community.id })).items[0]!.businessId).toBe(hz.A.businessId);
    // Back to Personal: the posts keep their business id in the table but it is no longer shown to outsiders (PoC 4).
    await repos.businesses.setGameMode(hz.db, hz.A.businessId, "personal");
    const theirs = await stranger.live.communities.posts({ communityId: community.id });
    expect(theirs.items[0]!.businessId).toBeNull();
    const detail = await stranger.live.communities.get({ communityId: community.id });
    expect(detail.community.ownerBusinessId).toBeNull();
    expect(detail.members.map((m) => m.businessId)).toEqual([null, null]);
    expect((await stranger.live.communities.list()).find((c) => c.id === community.id)?.ownerBusinessId).toBeNull();
    // Its own members still see it, as they do their other Personal businesses.
    expect((await own.live.communities.posts({ communityId: community.id })).items[0]!.businessId).toBe(hz.A.businessId);
    expect((await own.live.communities.get({ communityId: community.id })).community.ownerBusinessId).toBe(hz.A.businessId);
    await goLive(hz.A.businessId);
  });

  it("L1: a muted member stays muted when they join again; only someone who left comes back", async () => {
    const community = await repos.social.createCommunity(hz.db, { name: "Mod room", slug: "live-mod", createdBy: hz.A.ownerId });
    const member = as(hz.B.adminId);
    await member.live.communities.join({ communityId: community.id });
    await hz.db.update(communityMembers).set({ status: "muted" }).where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.userId, hz.B.adminId)));
    expect((await failure(member.live.communities.join({ communityId: community.id }))).code).toBe("BAD_REQUEST");
    expect((await failure(member.live.communities.post({ communityId: community.id, bodyMd: "unmuted?" }))).code).toBe("BAD_REQUEST");
    expect((await member.live.communities.get({ communityId: community.id })).isMember).toBe(false);
    // Someone who left may return.
    const other = as(hz.B.memberId);
    await other.live.communities.join({ communityId: community.id });
    await other.live.communities.leave({ communityId: community.id });
    await expect(other.live.communities.join({ communityId: community.id })).resolves.toMatchObject({ status: "active" });
  });

  it("L2: a reply must go under a visible top-level post of the same community; anything else is a clean not-found or bad request", async () => {
    const secret = await repos.social.createCommunity(hz.db, { name: "Secret", slug: "live-secret", visibility: "private", createdBy: hz.A.ownerId });
    const pub = await repos.social.createCommunity(hz.db, { name: "Pub", slug: "live-pub", createdBy: hz.B.ownerId });
    const secretPost = await as(hz.A.ownerId).live.communities.post({ communityId: secret.id, bodyMd: "secret" });
    const attacker = as(hz.B.ownerId);
    const cross = await failure(attacker.live.communities.post({ communityId: pub.id, bodyMd: "cross", parentPostId: secretPost.id }));
    expect(cross.code).toBe("NOT_FOUND");
    noSql(cross.message);
    // The private room's feed never gained a reply.
    const feed = await as(hz.A.ownerId).live.communities.posts({ communityId: secret.id });
    expect(feed.items.map((p) => p.replyCount)).toEqual([0]);
    const bogus = await failure(attacker.live.communities.post({ communityId: pub.id, bodyMd: "x", parentPostId: "00000000-0000-4000-8000-000000000001" }));
    expect(bogus.code).toBe("NOT_FOUND");
    noSql(bogus.message);
    const top = await attacker.live.communities.post({ communityId: pub.id, bodyMd: "top" });
    const reply = await attacker.live.communities.post({ communityId: pub.id, bodyMd: "reply", parentPostId: top.id });
    expect((await failure(attacker.live.communities.post({ communityId: pub.id, bodyMd: "deep", parentPostId: reply.id }))).code).toBe("BAD_REQUEST");
    await repos.social.setPostStatus(hz.db, top.id, "hidden");
    expect((await failure(attacker.live.communities.post({ communityId: pub.id, bodyMd: "late", parentPostId: top.id }))).code).toBe("NOT_FOUND");
  });

  it("a community with hundreds of members still loads: the member list is capped and the count is the total", async () => {
    const community = await repos.social.createCommunity(hz.db, { name: "Big room", slug: "live-big-room", createdBy: hz.A.ownerId, ownerBusinessId: hz.A.businessId });
    const crowd = await Promise.all(Array.from({ length: 204 }, (_, i) => hz.h.createUser(`crowd-${i}@live.test`)));
    await hz.db.insert(communityMembers).values(crowd.map((userId) => ({ communityId: community.id, userId, businessId: hz.A.businessId })));
    await hz.db.update(communities).set({ memberCount: 205 }).where(eq(communities.id, community.id));
    const seen = await as(hz.A.ownerId).live.communities.get({ communityId: community.id });
    expect(seen.members).toHaveLength(200);
    expect(seen.community.memberCount).toBe(205);
    expect(seen.isMember).toBe(true);
  });

  it("L5: an archived community cannot be read, posted in or joined", async () => {
    const community = await repos.social.createCommunity(hz.db, { name: "Old room", slug: "live-old-room", createdBy: hz.A.ownerId });
    const owner = as(hz.A.ownerId);
    await owner.live.communities.post({ communityId: community.id, bodyMd: "before" });
    await hz.db.update(communities).set({ archivedAt: new Date() }).where(eq(communities.id, community.id));
    expect((await failure(owner.live.communities.posts({ communityId: community.id }))).code).toBe("NOT_FOUND");
    expect((await failure(owner.live.communities.post({ communityId: community.id, bodyMd: "after" }))).code).toBe("NOT_FOUND");
    expect((await failure(as(hz.B.ownerId).live.communities.join({ communityId: community.id }))).code).toBe("NOT_FOUND");
    expect((await failure(owner.live.communities.get({ communityId: community.id }))).code).toBe("NOT_FOUND");
    expect((await owner.live.communities.list()).map((c) => c.id)).not.toContain(community.id);
  });
});

describe("messages and connections", () => {
  it("threads carry their unread count; reading a thread clears it; only the signed-in person sends", async () => {
    await connect(hz.B.adminId, hz.A.adminId);
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

  it("M1: the recipient cannot re-accept a block the requester set, and a blocked person cannot lift it or ask again (PoC 2, 3)", async () => {
    await goLive(hz.A.businessId);
    await goLive(hz.B.businessId);
    const victim = hz.A.ownerId;
    const attacker = hz.B.memberId;
    const c = await as(victim).live.connections.request({ businessId: hz.A.businessId, toUserId: attacker });
    const blocked = await as(victim).live.connections.respond({ connectionId: c.id, status: "blocked" });
    expect(blocked).toMatchObject({ status: "blocked", blockedBy: victim });
    // The recipient is not the blocker: accepting and re-blocking read as a connection that does not exist, and removing is
    // the same quiet no-op as removing one that does not; none of them changes the row or confirms the block (GLS2F-04).
    expect((await failure(as(attacker).live.connections.respond({ connectionId: c.id, status: "accepted" }))).code).toBe("NOT_FOUND");
    expect((await failure(as(attacker).live.connections.respond({ connectionId: c.id, status: "blocked" }))).code).toBe("NOT_FOUND");
    await expect(as(attacker).live.connections.remove({ connectionId: c.id })).resolves.toBeDefined();
    expect((await as(victim).live.connections.list({ status: "blocked" })).map((r) => [r.id, r.blockedBy])).toEqual([[c.id, victim]]);
    // The blocked person does not see the row at all: a block is never announced.
    expect((await as(attacker).live.connections.list()).map((r) => r.id)).not.toContain(c.id);
    // Asking again: refused, and the refusal does not announce the block.
    const again = await failure(as(attacker).live.connections.request({ businessId: hz.B.businessId, toUserId: victim }));
    expect(again.code).not.toBe("OK");
    expect(again.message).not.toMatch(/block/i);
    // The victim's name stays hidden from them (profile visibility: connections).
    await repos.founders.upsert(hz.db, victim, { displayName: "Victim V", visibility: "connections" });
    expect((await as(attacker).live.people.lookup({ userIds: [victim] })).users[0]!.displayName).toBeNull();

    // A requester who blocks their own request: the recipient cannot accept it either.
    const d = await as(hz.A.adminId).live.connections.request({ businessId: hz.A.businessId, toUserId: hz.B.ownerId });
    await as(hz.A.adminId).live.connections.respond({ connectionId: d.id, status: "blocked" });
    expect((await failure(as(hz.B.ownerId).live.connections.respond({ connectionId: d.id, status: "accepted" }))).code).toBe("NOT_FOUND");
    await as(hz.B.ownerId).live.connections.remove({ connectionId: d.id });
    expect((await as(hz.A.adminId).live.connections.list({ status: "blocked" })).map((r) => r.id), "the recipient's remove changed nothing").toContain(d.id);
    // Only the blocker lifts it; then a fresh request goes through.
    await as(hz.A.adminId).live.connections.remove({ connectionId: d.id });
    expect((await as(hz.B.ownerId).live.connections.list()).map((r) => r.id)).not.toContain(d.id);
    await expect(as(hz.B.ownerId).live.connections.request({ businessId: hz.B.businessId, toUserId: hz.A.adminId })).resolves.toMatchObject({ status: "requested", blockedBy: null });
  });

  it("M2: a Send stops at a block, is capped at 20 recipients who must exist, and first contact needs a connection (PoC 3, 7)", async () => {
    const sender = as(hz.B.ownerId);
    const stranger = hz.A.memberId;
    const friend = hz.A.viewerId;
    // 2,000 ids in one call, and 21, are refused before anything runs.
    const crowd = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    expect((await failure(sender.live.messages.send({ toUserIds: crowd(2000), body: "spam" }))).code).toBe("BAD_REQUEST");
    expect((await failure(sender.live.messages.send({ toUserIds: crowd(21), body: "spam" }))).code).toBe("BAD_REQUEST");
    // Recipients must exist, and the failure is a clean not-found (not a database error).
    const missing = await failure(sender.live.messages.send({ toUserIds: [NOBODY], body: "hello?" }));
    expect(missing.code).toBe("NOT_FOUND");
    noSql(missing.message);
    expect((await failure(sender.live.messages.send({ toUserIds: [hz.B.ownerId], body: "to myself" }))).code).toBe("BAD_REQUEST");
    // First contact needs a connection with each recipient.
    expect((await failure(sender.live.messages.send({ toUserIds: [stranger], body: "cold" }))).code).toBe("FORBIDDEN");
    await repos.social.requestConnection(hz.db, hz.B.ownerId, friend);
    expect((await failure(sender.live.messages.send({ toUserIds: [friend], body: "pending" }))).code).toBe("FORBIDDEN");
    const link = (await repos.social.listConnections(hz.db, friend, { direction: "incoming" })).find((c) => c.fromUser === hz.B.ownerId)!;
    await repos.social.respondConnection(hz.db, friend, link.id, "accepted");
    const sent = await sender.live.messages.send({ toUserIds: [friend], body: "hello friend" });
    expect((await failure(sender.live.messages.send({ toUserIds: [friend, stranger], body: "both" }))).code).toBe("FORBIDDEN");
    // A block ends the conversation for both of them: the blocker too, and the existing thread as well.
    await repos.social.respondConnection(hz.db, friend, link.id, "blocked");
    expect((await failure(sender.live.messages.send({ threadId: sent.threadId, body: "still there?" }))).code).toBe("FORBIDDEN");
    expect((await failure(as(friend).live.messages.send({ threadId: sent.threadId, body: "go away" }))).code).toBe("FORBIDDEN");
    expect((await failure(sender.live.messages.send({ toUserIds: [friend], body: "again" }))).code).toBe("FORBIDDEN");
    // A block is never announced: it reads exactly like not being connected, on a new thread and on an existing one.
    const strangerSend = await failure(sender.live.messages.send({ toUserIds: [stranger], body: "cold" }));
    const blockedSend = await failure(sender.live.messages.send({ toUserIds: [friend], body: "again" }));
    expect(blockedSend.message).toBe(strangerSend.message);
    expect((await failure(sender.live.messages.send({ threadId: sent.threadId, body: "still there?" }))).message).toBe(strangerSend.message);
    expect((await failure(as(friend).live.messages.send({ toUserIds: [hz.B.ownerId], body: "again" }))).code).toBe("FORBIDDEN");
    // The thread and what was said before the block stay readable.
    expect((await as(friend).live.messages.list({ threadId: sent.threadId })).items.map((m) => m.body)).toEqual(["hello friend"]);
  });

  it("M3: asking someone to connect is a write on the live section of a LIVE business", async () => {
    await goLive(hz.A.businessId);
    const request = (user: string, to: string) => as(user).live.connections.request({ businessId: hz.A.businessId, toUserId: to });
    expect((await failure(request(hz.A.viewerId, hz.B.viewerId))).code).toBe("FORBIDDEN");
    await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, { live: "read" });
    expect((await failure(request(hz.A.memberId, hz.B.viewerId))).code).toBe("FORBIDDEN");
    await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, {});
    expect((await failure(as(hz.B.ownerId).live.connections.request({ businessId: hz.A.businessId, toUserId: hz.B.viewerId }))).code).toBe("FORBIDDEN");
    await expect(request(hz.A.memberId, hz.B.viewerId)).resolves.toMatchObject({ status: "requested" });
    // A Personal business cannot ask.
    await repos.businesses.setGameMode(hz.db, hz.A.businessId, "personal");
    expect((await failure(request(hz.A.ownerId, hz.B.viewerId))).code).toBe("BAD_REQUEST");
    await goLive(hz.A.businessId);
  });

  it("L4 and L6: a request to a person who does not exist is a clean not-found, and a request and its event commit together", async () => {
    await goLive(hz.A.businessId);
    const owner = as(hz.A.ownerId);
    const unknown = await failure(owner.live.connections.request({ businessId: hz.A.businessId, toUserId: NOBODY }));
    expect(unknown.code).toBe("NOT_FOUND");
    noSql(unknown.message);

    const target = hz.B.adminId;
    const before = await repos.social.listConnections(hz.db, hz.A.ownerId);
    const spy = vi.spyOn(events, "writeEventRow").mockRejectedValueOnce(new Error("event store down"));
    try {
      expect((await failure(owner.live.connections.request({ businessId: hz.A.businessId, toUserId: target }))).code).toBe("INTERNAL_SERVER_ERROR");
    } finally {
      spy.mockRestore();
    }
    // Nothing was stored: the insert rolled back with the failed event.
    expect(await repos.social.listConnections(hz.db, hz.A.ownerId)).toHaveLength(before.length);
    const made = await owner.live.connections.request({ businessId: hz.A.businessId, toUserId: target });
    expect(made).toMatchObject({ fromUser: hz.A.ownerId, toUser: target, status: "requested" });
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
  it("H1: entries are served only for listed businesses; a business that goes Personal leaves every board (PoC 1)", async () => {
    // A is a Personal business: its number takes no position and a stranger sees nothing of it.
    await repos.businesses.setGameMode(hz.db, hz.A.businessId, "personal");
    const board = await repos.social.upsertLeaderboard(hz.db, { boardKind: "growth", period: "2026-Q4", metric: "mrr_growth_pct", archetype: "b2b_saas" });
    expect(await repos.social.setLeaderboardEntries(hz.db, board.id, [{ businessId: hz.A.businessId, metricValue: 42.5, form: "WWW" }])).toEqual([]);
    const owner = as(hz.A.ownerId);
    const stranger = as(hz.B.ownerId);
    expect(await stranger.live.leaderboards.entries({ leaderboardId: board.id })).toEqual([]);
    expect(await owner.live.leaderboards.positions({ businessId: hz.A.businessId })).toEqual([]);

    // Listed: it ranks, with its card, and everyone sees it.
    await goLive(hz.A.businessId);
    await repos.social.setLeaderboardEntries(hz.db, board.id, [{ businessId: hz.A.businessId, metricValue: 12.5, form: "WWDLW" }]);
    expect((await owner.live.leaderboards.get({ leaderboardId: board.id })).metric).toBe("mrr_growth_pct");
    const entries = await stranger.live.leaderboards.entries({ leaderboardId: board.id });
    expect(entries).toMatchObject([{ businessId: hz.A.businessId, position: 1, movement: 0, form: "WWDLW", businessName: "LIVE-A" }]);
    expect(entries[0]!.business).toMatchObject({ businessId: hz.A.businessId, kitPrimary: expect.any(String), slug: expect.any(String) });
    const positions = await owner.live.leaderboards.positions({ businessId: hz.A.businessId });
    expect(positions.map((p) => [p.position, p.board.id])).toEqual([[1, board.id]]);
    await expect(stranger.live.leaderboards.positions({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.live.leaderboards.get({ leaderboardId: "00000000-0000-0000-0000-0000000000aa" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // LIVE → Personal through the API removes the rows (AC-11.14.2) and the board is empty for strangers at once.
    await owner.business.setGameMode({ businessId: hz.A.businessId, gameMode: "personal", reason: "test" });
    expect(await repos.social.leaderboardEntries(hz.db, board.id)).toEqual([]);
    expect(await stranger.live.leaderboards.entries({ leaderboardId: board.id })).toEqual([]);
    expect(await hz.db.select().from(leaderboardEntries).where(eq(leaderboardEntries.businessId, hz.A.businessId))).toEqual([]);

    // Even if a row were left behind, a Personal business is not served (the read filters as the policy does).
    await goLive(hz.A.businessId);
    await repos.social.setLeaderboardEntries(hz.db, board.id, [{ businessId: hz.A.businessId, metricValue: 12.5 }]);
    await repos.businesses.setGameMode(hz.db, hz.A.businessId, "personal");
    expect(await stranger.live.leaderboards.entries({ leaderboardId: board.id })).toEqual([]);
    expect(await owner.live.leaderboards.positions({ businessId: hz.A.businessId })).toEqual([]);
    await goLive(hz.A.businessId);
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

describe("error text (L4)", () => {
  it("a client outside development and test reads a generic line with the request id, never the database's message", () => {
    const raw = 'Failed query: insert into "posts" ("id", "body_md") values ($1, $2)\nparams: 1,secret';
    for (const env of ["staging", "production"]) {
      const shown = internalErrorMessage(raw, env, "req-123");
      expect(shown).toContain("req-123");
      expect(shown).not.toMatch(/insert|posts|secret|Failed query/);
    }
    for (const env of ["development", "test"]) expect(internalErrorMessage(raw, env, "req-123")).toBe(raw);
  });

  it("finds a Postgres error code through Drizzle's wrapper", () => {
    expect(pgErrorCode({ message: "Failed query", cause: { code: "23503", message: "violates foreign key" } })).toBe("23503");
    expect(pgErrorCode({ code: "23505" })).toBe("23505");
    expect(pgErrorCode(new Error("plain"))).toBeUndefined();
    expect(pgErrorCode({ code: "ECONNRESET" })).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
  });
});
