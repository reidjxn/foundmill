/** LIVE social: public profiles, connections, threads/messages, communities/posts, negotiations. */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { MAX_MESSAGE_RECIPIENTS } from "../../repos/social";
import * as s from "../../schema";
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
    // The blocked person only learns that the request could not be sent; the blocker is told to unblock first.
    await expect(repos.social.requestConnection(r.db, a, r.B.memberId)).rejects.toThrow(/could not be sent/);
    await expect(repos.social.requestConnection(r.db, r.B.memberId, a)).rejects.toThrow(/unblock them/);
  });

  it("a block belongs to whoever set it: nobody else can answer, accept over or delete it, and it is recorded", async () => {
    const asker = r.A.adminId;
    const blocker = r.B.adminId;
    const c = await repos.social.requestConnection(r.db, asker, blocker, "Hi");
    expect((await repos.social.respondConnection(r.db, blocker, c.id, "blocked")).blockedBy).toBe(blocker);
    // The blocked party cannot accept, re-block (which would take the row over) or delete the row; the row reads to them
    // exactly like one that does not exist (respond: not found; remove: the same quiet no-op as a missing id), so the
    // error never confirms the block (audit GLS2F-04).
    await expect(repos.social.respondConnection(r.db, asker, c.id, "accepted")).rejects.toThrow(/not found/i);
    await expect(repos.social.respondConnection(r.db, asker, c.id, "blocked")).rejects.toThrow(/not found/i);
    await expect(repos.social.respondConnection(r.db, asker, "00000000-0000-4000-8000-0000000000ff", "accepted")).rejects.toThrow(/not found/i);
    await expect(repos.social.removeConnection(r.db, asker, c.id)).resolves.toBeNull();
    expect((await repos.social.listConnections(r.db, blocker, { status: "blocked" })).map((x) => x.id), "the no-op removed nothing").toContain(c.id);
    await expect(repos.social.requestConnection(r.db, asker, blocker)).rejects.toThrow(/could not be sent/);
    // Not even the blocker can write `accepted` over it; they unblock (delete), and a fresh request starts clean.
    await expect(repos.social.respondConnection(r.db, blocker, c.id, "accepted")).rejects.toThrow(/Unblock/);
    expect((await repos.social.respondConnection(r.db, blocker, c.id, "blocked")).id).toBe(c.id); // idempotent
    // A block is never announced: only the blocker sees the row in their lists.
    expect((await repos.social.listConnections(r.db, blocker, { status: "blocked" })).map((x) => x.id)).toContain(c.id);
    // The person who asked keeps seeing their request as still waiting (a request that vanished would say it was blocked).
    expect((await repos.social.listConnections(r.db, asker, { direction: "outgoing" })).find((x) => x.id === c.id)).toMatchObject({ status: "requested", blockedBy: null, respondedAt: null });
    expect((await repos.social.listConnections(r.db, asker, { status: "requested" })).map((x) => x.id)).toContain(c.id);
    expect(await repos.social.listConnections(r.db, asker, { status: "blocked" })).toEqual([]);
    // The person who was asked no longer has the request at all.
    expect((await repos.social.listConnections(r.db, blocker, { direction: "incoming" })).find((x) => x.id === c.id)).toMatchObject({ status: "blocked", blockedBy: blocker });
    await repos.social.removeConnection(r.db, blocker, c.id);
    expect((await repos.social.listConnections(r.db, asker)).map((x) => x.id)).not.toContain(c.id);
    const again = await repos.social.requestConnection(r.db, asker, blocker);
    expect(again).toMatchObject({ status: "requested", blockedBy: null });
    // A requester who blocks after the recipient accepted owns the block too.
    await repos.social.respondConnection(r.db, blocker, again.id, "accepted");
    expect((await repos.social.respondConnection(r.db, asker, again.id, "blocked")).blockedBy).toBe(asker);
    await repos.social.removeConnection(r.db, blocker, again.id); // quiet no-op: the block is not theirs
    expect((await repos.social.listConnections(r.db, asker, { status: "blocked" })).map((x) => x.id)).toContain(again.id);
    await repos.social.removeConnection(r.db, asker, again.id);
    // Someone who is not a party removes nothing and learns nothing.
    const third = await repos.social.requestConnection(r.db, asker, blocker);
    await repos.social.removeConnection(r.db, r.A.viewerId, third.id);
    expect((await repos.social.listConnections(r.db, asker)).map((x) => x.id)).toContain(third.id);
    await repos.social.removeConnection(r.db, asker, third.id);
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

  it("a Send opens a thread only to people who exist, are not blocked, and are connected or already in a thread with the sender", async () => {
    const me = r.A.adminId;
    const friend = r.B.viewerId;
    const stranger = r.A.memberId;
    const nobody = "00000000-0000-4000-8000-0000000000f0";
    await expect(repos.social.startThread(r.db, me, [nobody], "Hi")).rejects.toThrow(/recipient/);
    await expect(repos.social.startThread(r.db, me, [me])).rejects.toThrow(/other than yourself/);
    const crowd = Array.from({ length: MAX_MESSAGE_RECIPIENTS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    await expect(repos.social.startThread(r.db, me, crowd)).rejects.toThrow(/recipients/);
    // First contact needs a connection.
    await expect(repos.social.startThread(r.db, me, [stranger])).rejects.toThrow(/cannot message/);
    await expect(repos.social.startThread(r.db, me, [friend])).rejects.toThrow(/cannot message/);
    const link = await repos.social.requestConnection(r.db, me, friend);
    await expect(repos.social.startThread(r.db, me, [friend])).rejects.toThrow(/cannot message/); // a request is not a connection
    await repos.social.respondConnection(r.db, friend, link.id, "accepted");
    // A subject cannot pose as the platform or its staff (audit GLS2F-06); an honest one is kept as written.
    for (const subject of ["Foundmill Support: verify your account", "F0undmi11 notice", "Support: your account", "Fo\u200bundmill"]) {
      await expect(repos.social.startThread(r.db, me, [friend], subject), subject).rejects.toThrow(/reserved/);
    }
    const thread = await repos.social.startThread(r.db, me, [friend, friend], "Hello");
    expect(thread.participantIds.sort()).toEqual([me, friend].sort());
    expect((await repos.social.startThread(r.db, friend, [me])).id).toBe(thread.id);
    await repos.social.sendMessage(r.db, me, thread.id, "Hi friend");
    // One of two recipients being a stranger refuses the whole Send.
    await expect(repos.social.startThread(r.db, me, [friend, stranger])).rejects.toThrow(/cannot message/);
    // Sharing a thread is not a connection (0027): a thread from before the gate (or a group) neither opens a new Send
    // nor takes a message between people who are not connected, whatever its id.
    const legacy = await repos.social.findOrCreateThread(r.db, me, [stranger]);
    await expect(repos.social.startThread(r.db, me, [stranger])).rejects.toThrow(/cannot message/);
    await expect(repos.social.sendMessage(r.db, me, legacy.id, "still here")).rejects.toThrow(/cannot message/);
    await expect(repos.social.sendMessage(r.db, stranger, legacy.id, "and me")).rejects.toThrow(/cannot message/);
    // Two people in a group the sender made are not connected to each other because of it, and cannot write there.
    const group = await repos.social.findOrCreateThread(r.db, friend, [stranger, me]);
    await expect(repos.social.startThread(r.db, stranger, [friend])).rejects.toThrow(/cannot message/);
    await expect(repos.social.sendMessage(r.db, stranger, group.id, "hello group")).rejects.toThrow(/cannot message/);
    expect(group.participantIds).toHaveLength(3);
    expect(group.kind).toBe("group");
    // A block in either direction ends it, new threads and existing ones alike, and reads the same as not being connected.
    await repos.social.respondConnection(r.db, friend, link.id, "blocked");
    const blockedMessage = await repos.social.startThread(r.db, me, [friend]).catch((e: Error) => e.message);
    const strangerMessage = await repos.social.startThread(r.db, me, [stranger]).catch((e: Error) => e.message);
    expect(blockedMessage).toBe(strangerMessage);
    await expect(repos.social.sendMessage(r.db, me, thread.id, "Still there?")).rejects.toThrow(strangerMessage as string);
    await expect(repos.social.startThread(r.db, friend, [me])).rejects.toThrow(/cannot message/);
    await expect(repos.social.sendMessage(r.db, me, thread.id, "Still there?")).rejects.toThrow(/cannot message/);
    await expect(repos.social.sendMessage(r.db, friend, thread.id, "Hello?")).rejects.toThrow(/cannot message/);
    expect((await repos.social.blockedWith(r.db, me, [friend, stranger, nobody])).has(friend)).toBe(true);
    expect((await repos.social.existingUsers(r.db, [me, nobody])).has(nobody)).toBe(false);
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

describe("one row per pair, races, and closed threads", () => {
  it("asking someone who already asked you (or is connected to you) returns that row; the pair key refuses a second row", async () => {
    const a = r.B.adminId;
    const b = r.A.memberId;
    const first = await repos.social.requestConnection(r.db, a, b, "First");
    const reverse = await repos.social.requestConnection(r.db, b, a, "Second");
    expect(reverse.id).toBe(first.id);
    expect(await repos.social.listConnections(r.db, a)).toHaveLength(1);
    await expect(r.db.insert(s.connections).values({ fromUser: b, toUser: a })).rejects.toThrow();
    await repos.social.respondConnection(r.db, b, first.id, "accepted");
    expect((await repos.social.requestConnection(r.db, a, b)).id).toBe(first.id);
    expect((await repos.social.requestConnection(r.db, b, a)).id).toBe(first.id);
  });

  /** A stand-in for the database whose reads and writes are scripted, to meet races that one connection cannot produce. */
  function scripted(opts: { rows: unknown[][]; insertError?: unknown; updated?: unknown[]; failFirstTransaction?: unknown }) {
    const reads = [...opts.rows];
    const chain = (): Record<string, unknown> => {
      const c: Record<string, unknown> = {};
      for (const k of ["from", "where", "orderBy", "innerJoin"]) c[k] = () => c;
      c.limit = async () => reads.shift() ?? [];
      return c;
    };
    let transactions = 0;
    const tx = {
      select: () => chain(),
      execute: async () => ({ rows: [{ blocked: false }] }),
      insert: () => ({ values: () => ({ returning: async () => { throw opts.insertError; } }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => opts.updated ?? [] }) }) }),
    };
    return {
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        transactions++;
        if (transactions === 1 && opts.failFirstTransaction) throw opts.failFirstTransaction;
        return fn(tx);
      },
    } as never;
  }
  const row = (over: Record<string, unknown>) => ({ id: "c1", fromUser: r.A.ownerId, toUser: r.B.ownerId, status: "requested", blockedBy: null, createdAt: new Date(), ...over });
  const uniqueViolation = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }) });

  it("a request that loses a race for the same pair gets the winner's row, or the same refusal a block gives, never a raw database error", async () => {
    const A = r.A.ownerId;
    const B = r.B.ownerId;
    // The insert hit the pair key (23505) after the lookup saw nothing: the winner's row is returned.
    const winner = row({ id: "winner", fromUser: B, toUser: A });
    await expect(repos.social.requestConnection(scripted({ rows: [[], [winner]], insertError: uniqueViolation }), A, B)).resolves.toMatchObject({ id: "winner" });
    // The winner turned out to be a block by the other side: the same answer as any request over a block.
    const blocked = row({ id: "b", fromUser: B, toUser: A, status: "blocked", blockedBy: B });
    await expect(repos.social.requestConnection(scripted({ rows: [[], [blocked]], insertError: uniqueViolation }), A, B)).rejects.toThrow(/could not be sent/);
    // Nothing there on the second look either: a conflict to retry, not a 500.
    await expect(repos.social.requestConnection(scripted({ rows: [[], []], insertError: uniqueViolation }), A, B)).rejects.toMatchObject({ code: "conflict", status: 409 });
    // Any other database error is not swallowed.
    await expect(repos.social.requestConnection(scripted({ rows: [[]], insertError: new Error("disk full") }), A, B)).rejects.toThrow(/disk full/);
  });

  it("an answer that finds the row changed under it writes nothing and says so", async () => {
    const asked = row({ id: "c9", fromUser: r.A.ownerId, toUser: r.B.ownerId, status: "requested" });
    // The UPDATE matched no row (it carries the status that was read): the other side answered in between.
    await expect(repos.social.respondConnection(scripted({ rows: [[asked]], updated: [] }), r.B.ownerId, "c9", "accepted")).rejects.toMatchObject({ code: "conflict", status: 409 });
    await expect(repos.social.respondConnection(scripted({ rows: [[asked]], updated: [{ ...asked, status: "accepted" }] }), r.B.ownerId, "c9", "accepted")).resolves.toMatchObject({ status: "accepted" });
  });

  it("a closed (archived) thread takes no more messages", async () => {
    const a = r.A.ownerId;
    const b = r.B.ownerId;
    const thread = await repos.social.findOrCreateThread(r.db, a, [b], "Closing");
    await repos.social.sendMessage(r.db, a, thread.id, "Before");
    await r.db.update(s.messageThreads).set({ archivedAt: new Date() }).where(eq(s.messageThreads.id, thread.id));
    await expect(repos.social.sendMessage(r.db, a, thread.id, "After")).rejects.toThrow(/closed/);
    await r.db.update(s.messageThreads).set({ archivedAt: null }).where(eq(s.messageThreads.id, thread.id));
  });

  it("the member list is capped (a community's member_count has the total)", async () => {
    const community = await repos.social.createCommunity(r.db, { name: "Crowd", slug: "crowd-room", createdBy: r.A.ownerId });
    for (const u of [r.A.adminId, r.A.memberId, r.B.ownerId]) await repos.social.joinCommunity(r.db, u, community.id);
    expect(await repos.social.listMembers(r.db, community.id)).toHaveLength(4);
    expect(await repos.social.listMembers(r.db, community.id, 2)).toHaveLength(2);
    expect((await repos.social.getCommunity(r.db, community.id)).memberCount).toBe(4);
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
    // Accepting the request must not make the person who asked anonymous again (audit VGLS2F3-X1): they made contact.
    await repos.social.respondConnection(r.db, viewer, request.id, "accepted");
    expect((await names())[priv]).toBe("Pat Private");
    // The other way round: the viewer asked, the private founder only accepted. They have not made contact with the viewer.
    await repos.founders.upsert(r.db, conn, profile("Cal Connection", "private"));
    expect((await names())[conn]).toBeNull();
    await repos.founders.upsert(r.db, conn, profile("Cal Connection", "connections"));
    expect((await names())[conn]).toBe("Cal Connection");
    const thread = await repos.social.findOrCreateThread(r.db, viewer, [stranger]);
    expect((await names())[stranger]).toBeNull();
    await repos.founders.upsert(r.db, stranger, profile("Sam Stranger", "private"));
    // A Private profile stays unnamed to a connection; writing to the viewer names them.
    const known = await repos.social.requestConnection(r.db, viewer, stranger);
    await repos.social.respondConnection(r.db, stranger, known.id, "accepted");
    expect((await names())[stranger]).toBeNull();
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
    const link = await repos.social.requestConnection(r.db, a, c);
    await repos.social.respondConnection(r.db, c, link.id, "accepted");
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

describe("community membership and replies", () => {
  it("only a member who left comes back by joining: a muted member reads but does not post, and stays muted; a ban stands", async () => {
    const community = await repos.social.createCommunity(r.db, { name: "Moderated", slug: "moderated-room", createdBy: r.A.ownerId });
    const member = r.B.adminId;
    await repos.social.joinCommunity(r.db, member, community.id);
    await repos.social.moderateMember(r.db, r.A.ownerId, community.id, member, "mute");
    expect((await repos.social.joinCommunity(r.db, member, community.id)).status).toBe("muted");
    expect(await repos.social.isMember(r.db, member, community.id)).toBe(true);
    await expect(repos.social.createPost(r.db, { communityId: community.id, authorUserId: member, bodyMd: "Back again" })).rejects.toThrow(/muted you/);
    // Leaving and joining again does not lift a mute.
    await repos.social.leaveCommunity(r.db, member, community.id);
    expect(await repos.social.isMember(r.db, member, community.id)).toBe(false);
    expect((await repos.social.joinCommunity(r.db, member, community.id)).status).toBe("muted");
    await r.db.update(s.communityMembers).set({ status: "banned" }).where(and(eq(s.communityMembers.communityId, community.id), eq(s.communityMembers.userId, member)));
    await expect(repos.social.joinCommunity(r.db, member, community.id)).rejects.toThrow(/Banned/);
    expect(await repos.social.isMember(r.db, member, community.id)).toBe(false);
    // Someone who left rejoins.
    const other = r.B.memberId;
    await repos.social.joinCommunity(r.db, other, community.id);
    await repos.social.leaveCommunity(r.db, other, community.id);
    expect((await repos.social.joinCommunity(r.db, other, community.id)).status).toBe("active");
  });

  it("a reply goes under a visible top-level post of the same community; anything else is a missing post", async () => {
    const here = await repos.social.createCommunity(r.db, { name: "Here", slug: "replies-here", createdBy: r.A.ownerId });
    const there = await repos.social.createCommunity(r.db, { name: "There", slug: "replies-there", visibility: "private", createdBy: r.A.ownerId });
    const author = r.A.ownerId;
    const top = await repos.social.createPost(r.db, { communityId: here.id, authorUserId: author, bodyMd: "Top" });
    const elsewhere = await repos.social.createPost(r.db, { communityId: there.id, authorUserId: author, bodyMd: "Elsewhere" });
    const reply = await repos.social.createPost(r.db, { communityId: here.id, authorUserId: author, bodyMd: "Reply", parentPostId: top.id });
    await expect(repos.social.createPost(r.db, { communityId: here.id, authorUserId: author, bodyMd: "x", parentPostId: elsewhere.id })).rejects.toThrow(/not found/);
    await expect(repos.social.createPost(r.db, { communityId: here.id, authorUserId: author, bodyMd: "x", parentPostId: "00000000-0000-4000-8000-000000000001" })).rejects.toThrow(/not found/);
    await expect(repos.social.createPost(r.db, { communityId: here.id, authorUserId: author, bodyMd: "x", parentPostId: reply.id })).rejects.toThrow(/under a post/);
    await repos.social.setPostStatus(r.db, top.id, "hidden");
    await expect(repos.social.createPost(r.db, { communityId: here.id, authorUserId: author, bodyMd: "x", parentPostId: top.id })).rejects.toThrow(/not found/);
    expect((await repos.social.replyCounts(r.db, [elsewhere.id])).size).toBe(0);
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
