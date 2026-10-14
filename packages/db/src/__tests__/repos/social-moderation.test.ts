/**
 * LIVE social after 0027 (audit #28, #34, #65): group rules, closing a thread when a connection ends, blocks by person,
 * leaving and muting threads, community invitations, member and post moderation, reports and the delivery lookups.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { MAX_NETWORK_BUSINESSES, REPORTS_TO_HOLD } from "../../repos/social";
import * as s from "../../schema";
import type { PostScreening } from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("social27");
}, 120_000);
afterAll(() => r?.close());

async function connect(a: string, b: string) {
  const c = await repos.social.requestConnection(r.db, a, b);
  return repos.social.respondConnection(r.db, b, c.id, "accepted");
}

const people = async (n: number, tag: string) => Promise.all(Array.from({ length: n }, (_, i) => r.h.createUser(`${tag}-${i}@social27.test`)));

const ALLOW: PostScreening = { decision: "allow", flags: [], rationale: "Nothing found.", mode: "mock" };
const HOLD: PostScreening = { decision: "hold", flags: ["harassment"], rationale: "Harassment.", mode: "mock" };

describe("connections: a request notifies once, and a block needs no prior row", () => {
  it("onCreated runs inside the transaction only when this call inserted the row", async () => {
    const [a, b] = await people(2, "created");
    const seen: string[] = [];
    const onCreated = async (_tx: unknown, c: { id: string }) => void seen.push(c.id);
    const first = await repos.social.requestConnection(r.db, a!, b!, "Hi", { onCreated });
    // Asking again (either way) returns the same row and notifies nobody.
    await repos.social.requestConnection(r.db, a!, b!, "Hi again", { onCreated });
    await repos.social.requestConnection(r.db, b!, a!, null, { onCreated });
    expect(seen).toEqual([first.id]);
    // A failing hook rolls the request back.
    const [c, d] = await people(2, "rollback");
    await expect(repos.social.requestConnection(r.db, c!, d!, null, { onCreated: async () => Promise.reject(new Error("inbox down")) })).rejects.toThrow(/inbox down/);
    expect(await repos.social.listConnections(r.db, c!)).toEqual([]);
  });

  it("blocks a stranger with no row, turns a request or connection into a block, and never takes over the other side's block", async () => {
    const [me, stranger, asker, friend, blocker] = await people(5, "block");
    const fresh = await repos.social.blockPerson(r.db, me!, stranger!);
    expect(fresh).toMatchObject({ fromUser: me, toUser: stranger, status: "blocked", blockedBy: me });
    expect(await repos.social.blockPerson(r.db, me!, stranger!)).toMatchObject({ id: fresh!.id }); // idempotent
    await expect(repos.social.requestConnection(r.db, stranger!, me!)).rejects.toThrow(/could not be sent/);
    // An incoming request becomes the block (the asker cannot see or lift it).
    const req = await repos.social.requestConnection(r.db, asker!, me!);
    expect(await repos.social.blockPerson(r.db, me!, asker!)).toMatchObject({ id: req.id, status: "blocked", blockedBy: me });
    // The asker keeps seeing their request as still waiting (a request that vanished would say it was blocked).
    expect((await repos.social.listConnections(r.db, asker!)).find((c) => c.id === req.id)).toMatchObject({ status: "requested", blockedBy: null });
    // An accepted connection too.
    await connect(me!, friend!);
    expect((await repos.social.blockPerson(r.db, me!, friend!))?.status).toBe("blocked");
    // When the other side blocked first, their block stands for both and is not announced: nothing to show.
    await repos.social.blockPerson(r.db, blocker!, me!);
    expect(await repos.social.blockPerson(r.db, me!, blocker!)).toBeNull();
    expect((await repos.social.blockedWith(r.db, me!, [blocker!])).has(blocker!)).toBe(true);
    await expect(repos.social.blockPerson(r.db, me!, me!)).rejects.toThrow(/yourself/);
    await expect(repos.social.blockPerson(r.db, me!, "00000000-0000-4000-8000-0000000000e1")).rejects.toThrow(/not found/);
    // Only the blocker lifts it.
    await repos.social.removeConnection(r.db, me!, fresh!.id);
    expect((await repos.social.blockedWith(r.db, me!, [stranger!])).size).toBe(0);
  });
});

describe("threads: groups need everyone connected; a removed connection closes the thread; leave and mute", () => {
  it("a group needs every two people in it connected, checked when it starts and on every Send", async () => {
    const [intro, ana, ben] = await people(3, "group");
    await connect(intro!, ana!);
    await connect(intro!, ben!);
    // Ana and Ben are not connected: the introducer cannot put them in a room together.
    await expect(repos.social.startThread(r.db, intro!, [ana!, ben!], "Meet")).rejects.toThrow(/Everyone in a group/);
    const link = await connect(ana!, ben!);
    const group = await repos.social.startThread(r.db, intro!, [ana!, ben!], "Meet");
    expect(group.kind).toBe("group");
    await repos.social.sendMessage(r.db, ana!, group.id, "Hello both");
    // Once Ana and Ben disconnect, neither writes into the group (the introducer still can: connected to both).
    await repos.social.removeConnection(r.db, ben!, link.id);
    await expect(repos.social.sendMessage(r.db, ben!, group.id, "Still here")).rejects.toThrow(/cannot message/);
    await expect(repos.social.sendMessage(r.db, ana!, group.id, "Me too")).rejects.toThrow(/cannot message/);
    await expect(repos.social.sendMessage(r.db, intro!, group.id, "Hello?")).resolves.toMatchObject({ threadId: group.id });
    expect(await repos.social.sendState(r.db, ben!, group)).toEqual({ canSend: false, reason: "closed" });
    // Ben leaves: he no longer reads it, the others see he left, and Ana can write again.
    expect(await repos.social.leaveThread(r.db, ben!, group.id)).toEqual({ left: true, deleted: false });
    await expect(repos.social.listMessages(r.db, ben!, group.id)).rejects.toThrow(/Not a participant/);
    const after = await repos.social.getThread(r.db, ana!, group.id);
    expect(after.participantIds.sort()).toEqual([intro!, ana!].sort());
    expect(after.leftIds).toEqual([ben]);
    expect(after.kind).toBe("group");
    await expect(repos.social.sendMessage(r.db, ana!, group.id, "Just us")).resolves.toMatchObject({ threadId: group.id });
    // The group that shrank to two is never taken for the pair's direct thread.
    const direct = await repos.social.startThread(r.db, ana!, [intro!]);
    expect(direct.id).not.toBe(group.id);
    expect(direct.kind).toBe("direct");
    // Everyone leaves: the last one out deletes it.
    await repos.social.leaveThread(r.db, intro!, group.id);
    await expect(repos.social.sendMessage(r.db, ana!, group.id, "Anyone?")).rejects.toThrow(/Everyone else has left/);
    expect(await repos.social.leaveThread(r.db, ana!, group.id)).toEqual({ left: true, deleted: true });
    expect(await r.db.select().from(s.messageThreads).where(eq(s.messageThreads.id, group.id))).toEqual([]);
  });

  it("removing a connection closes the direct thread to new messages from both sides; history stays readable", async () => {
    const [me, ex] = await people(2, "removed");
    const link = await connect(me!, ex!);
    const thread = await repos.social.startThread(r.db, ex!, [me!]);
    await repos.social.sendMessage(r.db, ex!, thread.id, "Hi");
    await repos.social.removeConnection(r.db, me!, link.id);
    await expect(repos.social.sendMessage(r.db, ex!, thread.id, "Still there?")).rejects.toThrow(/cannot message/);
    await expect(repos.social.sendMessage(r.db, me!, thread.id, "Bye")).rejects.toThrow(/cannot message/);
    expect((await repos.social.listMessages(r.db, me!, thread.id)).items.map((m) => m.body)).toEqual(["Hi"]);
    // Connecting again opens it again.
    await connect(ex!, me!);
    await expect(repos.social.sendMessage(r.db, ex!, thread.id, "Back")).resolves.toMatchObject({ threadId: thread.id });
  });

  it("a muted thread stops counting toward the badge; unmuting brings it back", async () => {
    const [me, them] = await people(2, "mute");
    await connect(me!, them!);
    const thread = await repos.social.startThread(r.db, them!, [me!]);
    await repos.social.sendMessage(r.db, them!, thread.id, "one");
    expect(await repos.social.unreadCount(r.db, me!)).toBe(1);
    await repos.social.setThreadMuted(r.db, me!, thread.id, true);
    expect(await repos.social.unreadCount(r.db, me!)).toBe(0);
    expect((await repos.social.unreadByThread(r.db, me!)).get(thread.id)).toBe(1);
    expect((await repos.social.getThread(r.db, me!, thread.id)).mutedIds).toEqual([me]);
    await repos.social.setThreadMuted(r.db, me!, thread.id, true); // idempotent
    expect((await repos.social.getThread(r.db, me!, thread.id)).mutedIds).toEqual([me]);
    await repos.social.setThreadMuted(r.db, me!, thread.id, false);
    expect(await repos.social.unreadCount(r.db, me!)).toBe(1);
    await expect(repos.social.setThreadMuted(r.db, r.A.viewerId, thread.id, true)).rejects.toThrow(/Not a participant/);
  });

  it("counts requests waiting for an answer", async () => {
    const [me, a, b] = await people(3, "incoming");
    await repos.social.requestConnection(r.db, a!, me!);
    await repos.social.requestConnection(r.db, b!, me!);
    await repos.social.requestConnection(r.db, me!, r.A.ownerId);
    expect(await repos.social.incomingRequestCount(r.db, me!)).toBe(2);
  });
});

describe("communities: invitations, roles and member moderation", () => {
  it("an owner or moderator invites a connection; the invitee sees the community, then joins or declines", async () => {
    const [owner, friend, stranger, other] = await people(4, "invite");
    const room = await repos.social.createCommunity(r.db, { name: "Back room", slug: "invite-back-room", visibility: "private", kind: "cohort", createdBy: owner });
    expect(room.kind).toBe("cohort");
    await connect(owner!, friend!);
    await expect(repos.social.inviteToCommunity(r.db, owner!, room.id, stranger!)).rejects.toThrow(/invite your connections/);
    await expect(repos.social.inviteToCommunity(r.db, friend!, room.id, owner!)).rejects.toThrow(/owner and moderators/);
    const invite = await repos.social.inviteToCommunity(r.db, owner!, room.id, friend!);
    expect(invite).toMatchObject({ status: "invited", invitedBy: owner, role: "member" });
    expect((await repos.social.listCommunities(r.db, { viewerId: friend })).map((c) => c.id)).toContain(room.id);
    expect((await repos.social.listCommunities(r.db, { viewerId: stranger })).map((c) => c.id)).not.toContain(room.id);
    expect(await repos.social.invitationCount(r.db, friend!)).toBe(1);
    expect((await repos.social.listInvitations(r.db, friend!)).map((i) => [i.community.id, i.invitedBy])).toEqual([[room.id, owner]]);
    // An invitee is not a member until they join.
    expect(await repos.social.isMember(r.db, friend!, room.id)).toBe(false);
    expect((await repos.social.joinCommunity(r.db, friend!, room.id)).status).toBe("active");
    expect((await repos.social.getCommunity(r.db, room.id)).memberCount).toBe(2);
    expect(await repos.social.invitationCount(r.db, friend!)).toBe(0);
    // Inviting a member again leaves them as they are.
    expect((await repos.social.inviteToCommunity(r.db, owner!, room.id, friend!)).status).toBe("active");
    // Declining deletes the invitation.
    await connect(owner!, other!);
    await repos.social.inviteToCommunity(r.db, owner!, room.id, other!);
    expect(await repos.social.declineInvitation(r.db, other!, room.id)).toBe(true);
    expect(await repos.social.membership(r.db, other!, room.id)).toBeNull();
    expect(await repos.social.declineInvitation(r.db, other!, room.id)).toBe(false);
    // Its owner stays (nobody could let them back in); a member leaves as anywhere else.
    await expect(repos.social.leaveCommunity(r.db, owner!, room.id)).rejects.toThrow(/cannot leave/);
    expect((await repos.social.membership(r.db, owner!, room.id))?.status).toBe("active");
    await repos.social.leaveCommunity(r.db, friend!, room.id);
    expect((await repos.social.membership(r.db, friend!, room.id))?.status).toBe("left");
  });

  it("mute, ban and restore: nobody moderates the owner, only the owner moderates a moderator, and the count follows", async () => {
    const [owner, mod, a, b] = await people(4, "modmembers");
    const room = await repos.social.createCommunity(r.db, { name: "Moderated room", slug: "modmembers-room", createdBy: owner });
    for (const u of [mod, a, b]) await repos.social.joinCommunity(r.db, u!, room.id);
    expect((await repos.social.setMemberRole(r.db, owner!, room.id, mod!, "moderator")).role).toBe("moderator");
    await expect(repos.social.setMemberRole(r.db, mod!, room.id, a!, "moderator")).rejects.toThrow(/Only the community's owner/);
    await expect(repos.social.moderateMember(r.db, mod!, room.id, owner!, "ban")).rejects.toThrow(/owner/);
    await expect(repos.social.moderateMember(r.db, a!, room.id, b!, "mute")).rejects.toThrow(/owner and moderators/);
    expect((await repos.social.moderateMember(r.db, mod!, room.id, a!, "mute")).status).toBe("muted");
    expect((await repos.social.getCommunity(r.db, room.id)).memberCount).toBe(4);
    expect((await repos.social.moderateMember(r.db, mod!, room.id, b!, "ban")).status).toBe("banned");
    expect((await repos.social.getCommunity(r.db, room.id)).memberCount).toBe(3);
    await expect(repos.social.joinCommunity(r.db, b!, room.id)).rejects.toThrow(/Banned/);
    // A ban lifted is "left": the person may join again; a mute lifted is "active".
    expect((await repos.social.moderateMember(r.db, mod!, room.id, b!, "restore")).status).toBe("left");
    expect((await repos.social.joinCommunity(r.db, b!, room.id)).status).toBe("active");
    expect((await repos.social.moderateMember(r.db, mod!, room.id, a!, "restore")).status).toBe("active");
    expect((await repos.social.getCommunity(r.db, room.id)).memberCount).toBe(4);
    // A moderator is moderated by the owner only.
    const [mod2] = await people(1, "modmembers2");
    await repos.social.joinCommunity(r.db, mod2!, room.id);
    await repos.social.setMemberRole(r.db, owner!, room.id, mod2!, "moderator");
    await expect(repos.social.moderateMember(r.db, mod!, room.id, mod2!, "mute")).rejects.toThrow(/Only the owner/);
    expect((await repos.social.moderateMember(r.db, owner!, room.id, mod2!, "ban")).role).toBe("member");
    expect((await repos.social.listMembers(r.db, room.id, 200, ["banned"])).map((m) => m.userId)).toEqual([mod2]);
    await expect(repos.social.updateCommunity(r.db, mod!, room.id, { name: "Mine" })).rejects.toThrow(/owner/);
    expect((await repos.social.updateCommunity(r.db, owner!, room.id, { descriptionMd: "Rules: be kind.", visibility: "private" })).visibility).toBe("private");
  });
});

describe("posts: screening, author edits and deletes, reports and the moderators' queue", () => {
  it("a held post waits for review: only its author sees it in the feed, and a moderator approves or removes it", async () => {
    const [owner, author, reader] = await people(3, "screen");
    const room = await repos.social.createCommunity(r.db, { name: "Screened", slug: "screened-room", createdBy: owner });
    for (const u of [author, reader]) await repos.social.joinCommunity(r.db, u!, room.id);
    const ok = await repos.social.createPost(r.db, { communityId: room.id, authorUserId: author!, bodyMd: "Hello all", screening: ALLOW });
    const held = await repos.social.createPost(r.db, { communityId: room.id, authorUserId: author!, bodyMd: "You idiot", screening: HOLD });
    expect([ok.status, held.status]).toEqual(["visible", "pending_review"]);
    expect(held.screening).toMatchObject({ decision: "hold", flags: ["harassment"] });
    const feed = async (viewerId: string) => (await repos.social.listPosts(r.db, room.id, { viewerId })).items.map((p) => p.id);
    expect(await feed(author!)).toEqual([held.id, ok.id]);
    expect(await feed(reader!)).toEqual([ok.id]);
    expect((await repos.social.moderationQueue(r.db, room.id)).map((q) => q.post.id)).toEqual([held.id]);
    expect(await repos.social.moderationCount(r.db, owner!)).toBe(1);
    expect(await repos.social.moderationCount(r.db, reader!)).toBe(0);
    await expect(repos.social.moderatePost(r.db, reader!, held.id, "restore")).rejects.toThrow(/owner and moderators/);
    expect((await repos.social.moderatePost(r.db, owner!, held.id, "restore")).status).toBe("visible");
    expect(await feed(reader!)).toEqual([held.id, ok.id]);
    // Hide is restorable; remove is final.
    expect((await repos.social.moderatePost(r.db, owner!, held.id, "hide", "Off topic")).moderationNote).toBe("Off topic");
    expect(await feed(author!)).toEqual([ok.id]);
    expect((await repos.social.moderatePost(r.db, owner!, held.id, "remove")).status).toBe("removed");
    await expect(repos.social.moderatePost(r.db, owner!, held.id, "restore")).rejects.toThrow(/removed/);
    expect(await repos.social.moderationCount(r.db, owner!)).toBe(0);
  });

  it("the author edits (screened again) and deletes their own post; nobody else can", async () => {
    const [owner, author, other] = await people(3, "edit");
    const room = await repos.social.createCommunity(r.db, { name: "Edits", slug: "edits-room", createdBy: owner });
    for (const u of [author, other]) await repos.social.joinCommunity(r.db, u!, room.id);
    const post = await repos.social.createPost(r.db, { communityId: room.id, authorUserId: author!, bodyMd: "Frist", screening: ALLOW });
    await expect(repos.social.editPost(r.db, other!, post.id, "Mine now", ALLOW)).rejects.toThrow(/Only the author/);
    const edited = await repos.social.editPost(r.db, author!, post.id, "First", ALLOW);
    expect(edited).toMatchObject({ bodyMd: "First", status: "visible" });
    expect(edited.editedAt).toBeInstanceOf(Date);
    expect((await repos.social.editPost(r.db, author!, post.id, "You idiot", HOLD)).status).toBe("pending_review");
    expect((await repos.social.editPost(r.db, author!, post.id, "First again", ALLOW)).status).toBe("visible");
    await expect(repos.social.deleteOwnPost(r.db, other!, post.id)).rejects.toThrow(/Only the author/);
    const gone = await repos.social.deleteOwnPost(r.db, author!, post.id);
    expect(gone).toMatchObject({ status: "removed", moderatedBy: author });
    expect((await repos.social.listPosts(r.db, room.id, { viewerId: author })).items).toEqual([]);
    await expect(repos.social.editPost(r.db, author!, post.id, "Undo", ALLOW)).rejects.toThrow(/no longer be edited/);
    // A moderator's hide stands against an edit.
    const second = await repos.social.createPost(r.db, { communityId: room.id, authorUserId: author!, bodyMd: "Second", screening: ALLOW });
    await repos.social.moderatePost(r.db, owner!, second.id, "hide");
    await expect(repos.social.editPost(r.db, author!, second.id, "Second, edited", ALLOW)).rejects.toThrow(/no longer be edited/);
  });

  it(`members report a post once each; ${REPORTS_TO_HOLD} reports hold it; a moderator's decision resolves them`, async () => {
    const [owner, author, ...reporters] = await people(2 + REPORTS_TO_HOLD, "report");
    const [outsider] = await people(1, "report-outsider");
    const room = await repos.social.createCommunity(r.db, { name: "Reports", slug: "reports-room", createdBy: owner });
    for (const u of [author, ...reporters]) await repos.social.joinCommunity(r.db, u!, room.id);
    const post = await repos.social.createPost(r.db, { communityId: room.id, authorUserId: author!, bodyMd: "Buy my course", screening: ALLOW });
    await expect(repos.social.reportPost(r.db, author!, post.id, { reason: "spam" })).rejects.toThrow(/own post/);
    await expect(repos.social.reportPost(r.db, outsider!, post.id, { reason: "spam" })).rejects.toThrow(/not found/);
    const first = await repos.social.reportPost(r.db, reporters[0]!, post.id, { reason: "spam", note: "Third time today" });
    expect(first).toMatchObject({ held: false, report: { reason: "spam", note: "Third time today" } });
    // The same member reporting again changes nothing.
    expect((await repos.social.reportPost(r.db, reporters[0]!, post.id, { reason: "scam" })).report.id).toBe(first.report.id);
    expect((await repos.social.moderationQueue(r.db, room.id)).map((q) => [q.post.id, q.openReports, q.reasons])).toEqual([[post.id, 1, ["spam"]]]);
    let last = first;
    for (const u of reporters.slice(1)) last = await repos.social.reportPost(r.db, u!, post.id, { reason: "scam" });
    expect(last.held).toBe(true);
    expect((await repos.social.getPost(r.db, post.id)).status).toBe("pending_review");
    expect(await repos.social.moderationCount(r.db, owner!)).toBe(1);
    // An edit is no way out of a report: the screen allows the new text, yet the post waits for the moderator.
    expect(await repos.social.openReportCount(r.db, post.id)).toBe(REPORTS_TO_HOLD);
    expect((await repos.social.editPost(r.db, author!, post.id, "Here is what worked for us", ALLOW)).status).toBe("pending_review");
    // Approving puts it back and closes the reports.
    await repos.social.moderatePost(r.db, owner!, post.id, "restore");
    const closed = await r.db.select().from(s.postReports).where(eq(s.postReports.postId, post.id));
    expect(closed.map((x) => x.resolution)).toEqual(Array(REPORTS_TO_HOLD).fill("approved"));
    expect(await repos.social.moderationQueue(r.db, room.id)).toEqual([]);
  });

  it("a muted member reads the feed but cannot post or edit", async () => {
    const [owner, muted] = await people(2, "muted-post");
    const room = await repos.social.createCommunity(r.db, { name: "Quiet", slug: "quiet-room", createdBy: owner });
    await repos.social.joinCommunity(r.db, muted!, room.id);
    const post = await repos.social.createPost(r.db, { communityId: room.id, authorUserId: muted!, bodyMd: "Before", screening: ALLOW });
    await repos.social.moderateMember(r.db, owner!, room.id, muted!, "mute");
    await expect(repos.social.createPost(r.db, { communityId: room.id, authorUserId: muted!, bodyMd: "After", screening: ALLOW })).rejects.toThrow(/muted you/);
    await expect(repos.social.editPost(r.db, muted!, post.id, "Edited", ALLOW)).rejects.toThrow(/can post/);
    expect((await repos.social.listPosts(r.db, room.id, { viewerId: muted })).items.map((p) => p.id)).toEqual([post.id]);
  });
});

describe("delivery lookups", () => {
  it("names the listed businesses a person speaks for (owner or admin, LIVE, committed, active) and a listed business's owner", async () => {
    expect((await repos.social.listedBusinessesFor(r.db, [r.A.ownerId])).get(r.A.ownerId)).toBeUndefined();
    expect(await repos.social.listedBusinessOwner(r.db, r.A.businessId)).toBeNull();
    await repos.businesses.setGameMode(r.db, r.A.businessId, "live");
    await repos.businesses.commit(r.db, r.A.businessId, { archetype: "b2b_saas" });
    const map = await repos.social.listedBusinessesFor(r.db, [r.A.ownerId, r.A.adminId, r.A.memberId, r.A.viewerId]);
    expect(map.get(r.A.ownerId)).toEqual([r.A.businessId]);
    expect(map.get(r.A.adminId)).toEqual([r.A.businessId]);
    expect(map.has(r.A.memberId)).toBe(false);
    expect(map.has(r.A.viewerId)).toBe(false);
    expect(await repos.social.listedBusinessOwner(r.db, r.A.businessId)).toBe(r.A.ownerId);
    await repos.businesses.setGameMode(r.db, r.A.businessId, "personal");
    expect((await repos.social.listedBusinessesFor(r.db, [r.A.ownerId])).size).toBe(0);
    expect(MAX_NETWORK_BUSINESSES).toBeGreaterThan(0);
  });
});

describe("the network is for adults", () => {
  it("records a person's own 18+ confirmation once; nobody else's changes", async () => {
    const [ada, bo] = await people(2, "adult");
    expect(await repos.social.adultConfirmedAt(r.db, ada!)).toBeNull();
    const at = await repos.social.confirmAdult(r.db, ada!);
    expect(at).toBeInstanceOf(Date);
    // The first confirmation stands.
    expect((await repos.social.confirmAdult(r.db, ada!)).getTime()).toBe(at.getTime());
    expect((await repos.social.adultConfirmedAt(r.db, ada!))?.getTime()).toBe(at.getTime());
    expect(await repos.social.adultConfirmedAt(r.db, bo!)).toBeNull();
    await expect(repos.social.confirmAdult(r.db, "not-a-user")).rejects.toThrow();
  });
});
