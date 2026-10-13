/**
 * live.* after the LIVE social audit (#28, #34, #65, #66):
 * - a request or a message reaches its RECIPIENT (an Inbox note and the event in each LIVE business they speak for, and
 *   a signal on their own stream channel), never the sender's business, and a repeated request notifies nobody;
 * - groups need everyone connected; removing a connection closes the direct thread; block anyone from a thread; leave
 *   and mute;
 * - posts pass a moderation screen (held ones wait for a moderator), members report, authors edit and delete,
 *   moderators hide, restore and remove; communities are created here and private ones are joined by invitation;
 * - "Ask to connect" reaches a leaderboard business's owner.
 */
import { events, inboxItems, repos } from "@foundmill/db";
import { MemoryRedis, userStreamKey } from "@foundmill/events";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADULTS_ONLY } from "../routers/live";
import { liveLimiter, plainQuote } from "../services/live";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let redis: MemoryRedis;
beforeAll(async () => {
  redis = new MemoryRedis();
  hz = await createApiHarness({ prefix: "live-social", redis });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => liveLimiter.reset());

const as = (userId: string) => hz.caller({ userId });

async function goLive(businessId: string) {
  await repos.businesses.setGameMode(hz.db, businessId, "live");
  await repos.businesses.commit(hz.db, businessId, { archetype: "b2b_saas" });
}

async function connect(from: string, to: string) {
  const c = await repos.social.requestConnection(hz.db, from, to);
  return repos.social.respondConnection(hz.db, to, c.id, "accepted");
}

async function failure(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code ?? "OTHER", message: String(e.message) };
  }
  return { code: "OK", message: "" };
}

const eventsOf = (businessId: string, type: string) => hz.db.select().from(events).where(and(eq(events.businessId, businessId), eq(events.type, type)));
const notesOf = (businessId: string) => hz.db.select().from(inboxItems).where(and(eq(inboxItems.businessId, businessId), eq(inboxItems.type, "human_message")));
const signals = async (userId: string) => (await redis.xrange(userStreamKey(userId), "-", "+")).map(([, fields]) => JSON.parse(String(fields[fields.indexOf("json") + 1])) as { kind: string; threadId?: string });

/** A fresh person (who has confirmed that they are 18 or older) who owns a fresh LIVE business, so delivery has somewhere to file. */
async function founder(tag: string, live = true, adult = true): Promise<{ userId: string; businessId: string }> {
  const userId = await hz.h.createUser(`${tag}@live-social.test`);
  const business = await repos.businesses.create(hz.db, { name: `Biz ${tag}`, slug: `biz-${tag}`, createdBy: userId });
  await repos.memberships.add(hz.db, business.id, { userId, role: "owner" });
  if (live) await goLive(business.id);
  if (adult) await repos.social.confirmAdult(hz.db, userId);
  return { userId, businessId: business.id };
}

describe("#65: requests and messages reach the recipient", () => {
  it("a request is filed in the recipient's LIVE business (event, Inbox note, signal), never the requester's, once", async () => {
    const asker = await founder("asker");
    const target = await founder("target");
    await repos.founders.upsert(hz.db, asker.userId, { displayName: "Ana [[ent:00000000-0000-4000-8000-000000000001|Spoof]] Ruiz", visibility: "private" });
    const c = await as(asker.userId).live.connections.request({ businessId: asker.businessId, toUserId: target.userId, message: "Loved your post on ![img](http://x) <b>pricing</b>" });
    expect(c).toMatchObject({ fromUser: asker.userId, toUser: target.userId, status: "requested" });

    const theirs = await eventsOf(target.businessId, "connection.requested");
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ narrated: true, payload: expect.objectContaining({ connectionId: c.id, fromUserId: asker.userId, toUserId: target.userId, fromBusinessId: asker.businessId }) });
    expect(await eventsOf(asker.businessId, "connection.requested")).toEqual([]);
    const notes = await notesOf(target.businessId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ fromUserId: asker.userId, state: "unread", sourceEventIds: [theirs[0]!.id] });
    expect(notes[0]!.subject).toBe("Connection request from Ana Spoof Ruiz");
    // The sender's words are quoted as plain text: no entity markup, link, image or HTML survives.
    expect(notes[0]!.bodyMd).toContain("Biz asker");
    expect(notes[0]!.bodyMd).not.toMatch(/\[\[ent:|!\[|<b>|\]\(/);
    expect(await notesOf(asker.businessId)).toEqual([]);
    // The recipient's Inbox › Messages tab has it; the requester's does not.
    expect((await as(target.userId).inbox.list({ businessId: target.businessId, tab: "messages" })).items.map((i) => i.id)).toEqual([notes[0]!.id]);
    expect((await as(asker.userId).inbox.list({ businessId: asker.businessId, tab: "messages" })).items).toEqual([]);
    expect(await signals(target.userId)).toEqual([expect.objectContaining({ kind: "connection_requested" })]);

    // Asking again returns the same row and notifies nobody.
    await as(asker.userId).live.connections.request({ businessId: asker.businessId, toUserId: target.userId });
    expect(await eventsOf(target.businessId, "connection.requested")).toHaveLength(1);
    expect(await signals(target.userId)).toHaveLength(1);
    expect((await as(target.userId).live.summary()).requestsWaiting).toBe(1);
  });

  it("asking, withdrawing and asking again files one unread note; a read note lets the next request through", async () => {
    const asker = await founder("again");
    const target = await founder("again-target");
    const ask = () => as(asker.userId).live.connections.request({ businessId: asker.businessId, toUserId: target.userId });
    const withdraw = (connectionId: string) => as(asker.userId).live.connections.remove({ connectionId });
    await withdraw((await ask()).id);
    const again = await ask();
    // Each new request is still an event in the recipient's business, but the Inbox gets one note while it is unread.
    expect(await eventsOf(target.businessId, "connection.requested")).toHaveLength(2);
    const notes = await notesOf(target.businessId);
    expect(notes).toHaveLength(1);
    await repos.inbox.markRead(hz.db, target.businessId, notes[0]!.id);
    await withdraw(again.id);
    await ask();
    expect(await notesOf(target.businessId)).toHaveLength(2);
  });

  it("never files anything in a business the sender belongs to, even one the recipient speaks for (co-founders)", async () => {
    const lead = await founder("cofounder-lead");
    const partner = await founder("cofounder-partner");
    await repos.memberships.add(hz.db, lead.businessId, { userId: partner.userId, role: "admin" });
    const c = await as(lead.userId).live.connections.request({ businessId: lead.businessId, toUserId: partner.userId });
    // The partner speaks for both businesses; only the one the requester is not in hears about it.
    expect(await eventsOf(lead.businessId, "connection.requested")).toEqual([]);
    expect(await eventsOf(partner.businessId, "connection.requested")).toHaveLength(1);
    await as(partner.userId).live.connections.respond({ connectionId: c.id, status: "accepted" });
    await as(lead.userId).live.messages.send({ toUserIds: [partner.userId], body: "Board deck by Friday?" });
    expect(await eventsOf(lead.businessId, "message.received")).toEqual([]);
    expect(await notesOf(lead.businessId)).toEqual([]);
    expect(await eventsOf(partner.businessId, "message.received")).toHaveLength(1);
  });

  it("a recipient with no LIVE business still sees it on their badge (summary), and nothing is filed anywhere", async () => {
    const asker = await founder("asker2");
    const personal = await founder("personal", false);
    await as(asker.userId).live.connections.request({ businessId: asker.businessId, toUserId: personal.userId });
    expect(await eventsOf(personal.businessId, "connection.requested")).toEqual([]);
    expect(await eventsOf(asker.businessId, "connection.requested")).toEqual([]);
    expect(await as(personal.userId).live.summary()).toMatchObject({ requestsWaiting: 1, total: 1 });
    expect(await signals(personal.userId)).toEqual([expect.objectContaining({ kind: "connection_requested" })]);
  });

  it("a message emits message.received in the recipient's business, one unread note per thread, nothing for the sender or a muted thread", async () => {
    const sender = await founder("sender");
    const reader = await founder("reader");
    await connect(sender.userId, reader.userId);
    const first = await as(sender.userId).live.messages.send({ toUserIds: [reader.userId], body: "Hello <script>x</script> there" });
    await as(sender.userId).live.messages.send({ threadId: first.threadId, body: "Second" });
    const received = await eventsOf(reader.businessId, "message.received");
    expect(received).toHaveLength(2);
    expect(received.map((e) => e.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: first.id, threadId: first.threadId, fromUserId: sender.userId, preview: "Hello script x /script there", negotiation: false }),
        expect.objectContaining({ threadId: first.threadId, preview: "Second" }),
      ]),
    );
    expect(received.every((e) => e.narrated)).toBe(true);
    // A burst makes one unread note.
    const notes = await notesOf(reader.businessId);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.subject).toMatch(/^Message from /);
    expect(await eventsOf(sender.businessId, "message.received")).toEqual([]);
    expect(await notesOf(sender.businessId)).toEqual([]);
    expect((await signals(reader.userId)).filter((s) => s.kind === "message_received")).toHaveLength(2);
    expect(await as(reader.userId).live.summary()).toMatchObject({ unreadMessages: 2 });
    // Once the note is read, the next message makes a new one.
    await repos.inbox.markRead(hz.db, reader.businessId, notes[0]!.id);
    await as(sender.userId).live.messages.send({ threadId: first.threadId, body: "Third" });
    expect(await notesOf(reader.businessId)).toHaveLength(2);
    // Muted: no event, no note, no signal, no badge.
    await as(reader.userId).live.messages.mute({ threadId: first.threadId, muted: true });
    const before = (await signals(reader.userId)).length;
    await as(sender.userId).live.messages.send({ threadId: first.threadId, body: "Fourth" });
    expect(await eventsOf(reader.businessId, "message.received")).toHaveLength(3);
    expect(await signals(reader.userId)).toHaveLength(before);
    expect((await as(reader.userId).live.summary()).unreadMessages).toBe(0);
    expect((await as(reader.userId).live.messages.threads()).items.find((t) => t.id === first.threadId)).toMatchObject({ muted: true, unread: 4 });
    // The sender never learns who muted the thread.
    expect((await as(sender.userId).live.messages.threads()).items.find((t) => t.id === first.threadId)).toMatchObject({ muted: false });
  });

  it("quotes other people's text as plain text", () => {
    expect(plainQuote("Hi [[ent:abc|Mara]] see ![x](javascript:alert(1)) <img src=x>", 200)).toBe("Hi Mara see x javascript:alert 1 img src=x");
    expect(plainQuote("a".repeat(300), 10)).toHaveLength(10);
  });
});

describe("#34: groups, removed connections, blocks by person, leave and mute", () => {
  it("the audit's repro: an introducer cannot put two strangers in a group, and an ex-connection's thread closes", async () => {
    const intruder = await founder("intruder");
    const fresh = await founder("fresh");
    const demo = await founder("demo");
    await connect(intruder.userId, fresh.userId);
    const introLink = await connect(intruder.userId, demo.userId);
    // Fresh and Demo are not connected: the group is refused, and Fresh cannot write to Demo directly either.
    expect((await failure(as(intruder.userId).live.messages.send({ toUserIds: [fresh.userId, demo.userId], subject: "Intro", body: "Meet" }))).code).toBe("FORBIDDEN");
    expect((await failure(as(fresh.userId).live.messages.send({ toUserIds: [demo.userId], body: "hi" }))).code).toBe("FORBIDDEN");
    // A direct thread closes when the connection is removed, from both sides.
    const pair = await as(intruder.userId).live.messages.send({ toUserIds: [demo.userId], body: "hello" });
    await as(demo.userId).live.connections.remove({ connectionId: introLink.id });
    expect((await failure(as(intruder.userId).live.messages.send({ threadId: pair.threadId, body: "still there?" }))).code).toBe("FORBIDDEN");
    const pane = await as(demo.userId).live.messages.thread({ threadId: pair.threadId });
    expect(pane).toMatchObject({ canSend: false, closedReason: "closed", participants: [{ userId: intruder.userId, connected: false, blockedByMe: false }] });
    // Demo blocks Intruder from the thread pane, with no connection row left to attach a block to.
    await as(demo.userId).live.connections.block({ userId: intruder.userId });
    expect((await as(demo.userId).live.messages.thread({ threadId: pair.threadId })).participants[0]).toMatchObject({ blockedByMe: true });
    expect((await failure(as(intruder.userId).live.connections.request({ businessId: intruder.businessId, toUserId: demo.userId }))).code).toBe("BAD_REQUEST");
    // Demo leaves the thread: it is gone from their list and its messages no longer reach them.
    expect(await as(demo.userId).live.messages.leave({ threadId: pair.threadId })).toEqual({ left: true, deleted: false });
    expect((await as(demo.userId).live.messages.threads()).items.map((t) => t.id)).not.toContain(pair.threadId);
    expect((await as(intruder.userId).live.messages.thread({ threadId: pair.threadId })).thread.leftIds).toEqual([demo.userId]);
  });

  it("a group of people all connected with each other works, and its pane lists them", async () => {
    const [a, b, c] = await Promise.all([founder("ga"), founder("gb"), founder("gc")]);
    await connect(a.userId, b.userId);
    await connect(a.userId, c.userId);
    await connect(b.userId, c.userId);
    const sent = await as(a.userId).live.messages.send({ toUserIds: [b.userId, c.userId], subject: "Trio", body: "Hello both" });
    const pane = await as(b.userId).live.messages.thread({ threadId: sent.threadId });
    expect(pane.thread.kind).toBe("group");
    expect(pane.canSend).toBe(true);
    expect(pane.participants.map((p) => p.userId).sort()).toEqual([a.userId, c.userId].sort());
    // Both other members got the message in their own business.
    expect(await eventsOf(b.businessId, "message.received")).toHaveLength(1);
    expect(await eventsOf(c.businessId, "message.received")).toHaveLength(1);
    expect((await notesOf(b.businessId))[0]!.bodyMd).toContain("group conversation");
  });
});

describe("#28: screening, reports, author and moderator tools, creation and invitations", () => {
  it("a post passes the screen: clean ones show, harassment, markup and personal data wait for a moderator", async () => {
    const owner = await founder("mod-owner");
    const author = await founder("mod-author");
    const reader = await founder("mod-reader");
    const room = await as(owner.userId).live.communities.create({ name: "Screened room", descriptionMd: "Be kind." });
    expect(room).toMatchObject({ visibility: "public", kind: "category", createdBy: owner.userId });
    expect(room.slug).toMatch(/^screened-room-[0-9a-f]{6}$/);
    for (const u of [author, reader]) await as(u.userId).live.communities.join({ communityId: room.id });
    const write = (bodyMd: string) => as(author.userId).live.communities.post({ communityId: room.id, bodyMd });
    const clean = await write("We moved our onboarding to a checklist and activation went up.");
    expect(clean).toMatchObject({ status: "visible", held: false });
    const held = await Promise.all([write("You idiot, this is wrong."), write("<script>alert(1)</script> click"), write("Call me on +1 415 555 0100 or mail ana@example.com")]);
    expect(held.map((p) => [p.status, p.held])).toEqual(Array(3).fill(["pending_review", true]));
    expect(held.map((p) => p.screening?.flags)).toEqual([expect.arrayContaining(["harassment"]), expect.arrayContaining(["markup"]), expect.arrayContaining(["personal_data"])]);
    // The author sees their held posts in the feed; another member does not, and never sees the screen's verdict.
    expect((await as(author.userId).live.communities.posts({ communityId: room.id })).items).toHaveLength(4);
    const theirs = await as(reader.userId).live.communities.posts({ communityId: room.id });
    expect(theirs.items.map((p) => p.id)).toEqual([clean.id]);
    expect(theirs.items[0]!.screening).toBeNull();
    // The owner was signalled and has them in the queue.
    expect((await signals(owner.userId)).filter((s) => s.kind === "moderation")).toHaveLength(3);
    expect((await as(owner.userId).live.summary()).moderation).toBe(3);
    const queue = await as(owner.userId).live.communities.moderation({ communityId: room.id });
    expect(queue.items.map((q) => q.post.id).sort()).toEqual(held.map((p) => p.id).sort());
    expect((await failure(as(reader.userId).live.communities.moderation({ communityId: room.id }))).code).toBe("FORBIDDEN");
    // Approve one, remove one; the author is told.
    await as(owner.userId).live.posts.moderate({ postId: held[0]!.id, action: "restore" });
    await as(owner.userId).live.posts.moderate({ postId: held[1]!.id, action: "remove", note: "Script markup" });
    expect((await as(reader.userId).live.communities.posts({ communityId: room.id })).items.map((p) => p.id).sort()).toEqual([clean.id, held[0]!.id].sort());
    // The author is told what happened, never which moderator did it; the moderators see who acted.
    const approved = (id: string) => (items: { id: string; moderatedBy: string | null }[]) => items.find((p) => p.id === id)!;
    expect(approved(held[0]!.id)((await as(author.userId).live.communities.posts({ communityId: room.id })).items).moderatedBy).toBeNull();
    expect(approved(held[0]!.id)((await as(owner.userId).live.communities.posts({ communityId: room.id })).items).moderatedBy).toBe(owner.userId);
    expect((await signals(author.userId)).filter((s) => s.kind === "moderation")).toHaveLength(2);
    expect((await failure(as(reader.userId).live.posts.moderate({ postId: clean.id, action: "hide" }))).code).toBe("FORBIDDEN");
  });

  it("a screen that fails holds the post instead of letting it through", async () => {
    const owner = await founder("fail-owner");
    const room = await as(owner.userId).live.communities.create({ name: "Fail room" });
    const spy = vi.spyOn(hz.deps.models, "complete").mockRejectedValueOnce(new Error("overloaded"));
    try {
      const post = await as(owner.userId).live.communities.post({ communityId: room.id, bodyMd: "Hello" });
      expect(post).toMatchObject({ status: "pending_review", held: true, screening: { mode: "unavailable", decision: "hold" } });
    } finally {
      spy.mockRestore();
    }
  });

  it("members report a post once each; three reports hold it; authors edit and delete their own", async () => {
    const owner = await founder("rep-owner");
    const author = await founder("rep-author");
    const reporters = await Promise.all([founder("rep-1"), founder("rep-2"), founder("rep-3")]);
    const room = await as(owner.userId).live.communities.create({ name: "Report room" });
    for (const u of [author, ...reporters]) await as(u.userId).live.communities.join({ communityId: room.id });
    const post = await as(author.userId).live.communities.post({ communityId: room.id, bodyMd: "Buy my course today" });
    expect((await failure(as(author.userId).live.posts.report({ postId: post.id, reason: "spam" }))).code).toBe("BAD_REQUEST");
    const results = [];
    for (const r of reporters) results.push(await as(r.userId).live.posts.report({ postId: post.id, reason: "spam" }));
    expect(results.map((r) => r.held)).toEqual([false, false, true]);
    expect((await as(reporters[0]!.userId).live.communities.posts({ communityId: room.id })).items).toEqual([]);
    // The author edits: screened again, but members' reports still hold it until a moderator decides on the new text;
    // another member cannot edit or delete it.
    const edited = await as(author.userId).live.posts.edit({ postId: post.id, bodyMd: "Here is what worked for our onboarding." });
    expect(edited).toMatchObject({ status: "pending_review", held: true, bodyMd: "Here is what worked for our onboarding." });
    expect(edited.editedAt).not.toBeNull();
    expect((await as(owner.userId).live.communities.moderation({ communityId: room.id })).items.map((q) => [q.post.id, q.post.bodyMd, q.openReports])).toEqual([[post.id, "Here is what worked for our onboarding.", 3]]);
    await as(owner.userId).live.posts.moderate({ postId: post.id, action: "restore" });
    expect((await as(reporters[0]!.userId).live.communities.posts({ communityId: room.id })).items.map((p) => p.id)).toEqual([post.id]);
    // Once approved, an edit the screen allows stays in the feed.
    expect(await as(author.userId).live.posts.edit({ postId: post.id, bodyMd: "Here is what worked, with numbers." })).toMatchObject({ status: "visible", held: false });
    expect((await failure(as(reporters[0]!.userId).live.posts.edit({ postId: post.id, bodyMd: "Mine" }))).code).toBe("FORBIDDEN");
    expect((await failure(as(reporters[0]!.userId).live.posts.delete({ postId: post.id }))).code).toBe("FORBIDDEN");
    expect(await as(author.userId).live.posts.delete({ postId: post.id })).toEqual({ postId: post.id, status: "removed" });
    expect((await as(author.userId).live.communities.posts({ communityId: room.id })).items).toEqual([]);
  });

  it("a muted member is refused before the screen runs, and a post written as a business is edited only while its author speaks for it", async () => {
    const owner = await founder("gate-owner");
    const member = await founder("gate-member");
    const room = await as(owner.userId).live.communities.create({ name: "Gate room" });
    await as(member.userId).live.communities.join({ communityId: room.id });
    await as(owner.userId).live.communities.moderateMember({ communityId: room.id, userId: member.userId, action: "mute" });
    const spy = vi.spyOn(hz.deps.models, "complete");
    try {
      const muted = await failure(as(member.userId).live.communities.post({ communityId: room.id, bodyMd: "Still here" }));
      expect(muted).toEqual({ code: "BAD_REQUEST", message: expect.stringMatching(/muted you/) });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    // The owner posts as their business, then the business goes Personal: it no longer speaks on the network, so the
    // post's text cannot change under its name; deleting it still works.
    const post = await as(owner.userId).live.communities.post({ communityId: room.id, bodyMd: "Hello from the team", businessId: owner.businessId });
    expect(post.businessId).toBe(owner.businessId);
    await repos.businesses.setGameMode(hz.db, owner.businessId, "personal");
    expect((await failure(as(owner.userId).live.posts.edit({ postId: post.id, bodyMd: "Edited under the old name" }))).code).toBe("BAD_REQUEST");
    expect((await repos.social.getPost(hz.db, post.id)).bodyMd).toBe("Hello from the team");
    expect(await as(owner.userId).live.posts.delete({ postId: post.id })).toEqual({ postId: post.id, status: "removed" });
  });

  it("private communities are joined by invitation only; owners and moderators manage members", async () => {
    const owner = await founder("inv-owner");
    const friend = await founder("inv-friend");
    const stranger = await founder("inv-stranger");
    const room = await as(owner.userId).live.communities.create({ name: "Private circle", visibility: "private", kind: "cohort" });
    // Nobody else sees it, or can join it, without an invitation.
    expect((await as(stranger.userId).live.communities.list()).map((c) => c.id)).not.toContain(room.id);
    expect((await failure(as(stranger.userId).live.communities.join({ communityId: room.id }))).code).toBe("NOT_FOUND");
    // Invitations go to connections only.
    expect((await failure(as(owner.userId).live.communities.invite({ communityId: room.id, userId: stranger.userId }))).code).toBe("FORBIDDEN");
    await connect(owner.userId, friend.userId);
    expect(await as(owner.userId).live.communities.invite({ communityId: room.id, userId: friend.userId })).toEqual({ status: "invited" });
    expect(await signals(friend.userId)).toContainEqual(expect.objectContaining({ kind: "community_invited" }));
    expect((await as(friend.userId).live.summary()).invitations).toBe(1);
    const invites = await as(friend.userId).live.communities.invitations();
    expect(invites.map((i) => [i.community.id, i.invitedBy])).toEqual([[room.id, owner.userId]]);
    expect((await as(friend.userId).live.communities.list()).find((c) => c.id === room.id)).toMatchObject({ invited: true, role: null });
    expect(await as(friend.userId).live.communities.get({ communityId: room.id })).toMatchObject({ invited: true, isMember: false, members: [] });
    await as(friend.userId).live.communities.join({ communityId: room.id });
    expect(await as(friend.userId).live.communities.get({ communityId: room.id })).toMatchObject({ isMember: true, canPost: true, role: "member" });
    // The owner makes them a moderator, then mutes and restores (the owner is never moderated).
    await as(owner.userId).live.communities.setRole({ communityId: room.id, userId: friend.userId, role: "moderator" });
    expect((await failure(as(friend.userId).live.communities.moderateMember({ communityId: room.id, userId: owner.userId, action: "mute" }))).code).toBe("FORBIDDEN");
    expect(await as(owner.userId).live.communities.moderateMember({ communityId: room.id, userId: friend.userId, action: "mute" })).toMatchObject({ status: "muted" });
    expect((await as(owner.userId).live.communities.moderation({ communityId: room.id })).restricted).toEqual([expect.objectContaining({ userId: friend.userId, status: "muted" })]);
    expect(await as(owner.userId).live.communities.moderateMember({ communityId: room.id, userId: friend.userId, action: "restore" })).toMatchObject({ status: "active" });
    // Declining an invitation removes it.
    const other = await founder("inv-other");
    await connect(owner.userId, other.userId);
    await as(owner.userId).live.communities.invite({ communityId: room.id, userId: other.userId });
    expect(await as(other.userId).live.communities.decline({ communityId: room.id })).toEqual({ declined: true });
    expect((await failure(as(other.userId).live.communities.get({ communityId: room.id }))).code).toBe("NOT_FOUND");
    // The owner of a community joined by invitation cannot leave it (nobody could let them back in).
    expect((await failure(as(owner.userId).live.communities.leave({ communityId: room.id }))).code).toBe("BAD_REQUEST");
    expect(await as(owner.userId).live.communities.get({ communityId: room.id })).toMatchObject({ isMember: true, role: "owner" });
  });

  it("a community's name and description are screened, and creating is limited per person", async () => {
    const owner = await founder("create-limit");
    expect((await failure(as(owner.userId).live.communities.create({ name: "Idiot founders", descriptionMd: "For losers" }))).code).toBe("BAD_REQUEST");
    liveLimiter.reset();
    for (let i = 0; i < 3; i++) await as(owner.userId).live.communities.create({ name: `Room ${i}` });
    expect((await failure(as(owner.userId).live.communities.create({ name: "One too many" }))).code).toBe("TOO_MANY_REQUESTS");
  });

  it("posting is limited per person (each post is a model call)", async () => {
    const owner = await founder("post-limit");
    const room = await as(owner.userId).live.communities.create({ name: "Burst room" });
    for (let i = 0; i < 6; i++) await as(owner.userId).live.communities.post({ communityId: room.id, bodyMd: `Post ${i}` });
    const burst = await failure(as(owner.userId).live.communities.post({ communityId: room.id, bodyMd: "Seventh" }));
    expect(burst.code).toBe("TOO_MANY_REQUESTS");
    expect(burst.message).toMatch(/Post limit reached/);
  });
});

describe("#28: the network is for adults", () => {
  it("every step onto the network waits for the person's 18+ confirmation; stepping back never does", async () => {
    const kid = await founder("adult-gate", true, false);
    const other = await founder("adult-other");
    const room = await as(other.userId).live.communities.create({ name: "Open room" });
    const me = as(kid.userId);
    expect((await me.live.summary()).adultConfirmed).toBe(false);
    for (const step of [
      me.live.connections.request({ businessId: kid.businessId, toUserId: other.userId }),
      me.live.communities.create({ name: "Mine" }),
      me.live.communities.join({ communityId: room.id }),
    ]) {
      const refused = await failure(step);
      expect(refused).toEqual({ code: "FORBIDDEN", message: ADULTS_ONLY });
    }
    // An incoming request cannot be accepted yet, but it can always be blocked.
    const incoming = await repos.social.requestConnection(hz.db, other.userId, kid.userId);
    expect((await failure(me.live.connections.respond({ connectionId: incoming.id, status: "accepted" }))).code).toBe("FORBIDDEN");
    expect(await me.live.connections.respond({ connectionId: incoming.id, status: "blocked" })).toMatchObject({ status: "blocked", blockedBy: kid.userId });
    expect(await me.live.connections.block({ userId: other.userId })).toEqual({ blocked: true });
    // Once confirmed, the steps go through; the first confirmation stands.
    const { adultConfirmedAt } = await me.live.profile.confirmAdult({ confirm: true });
    expect((await me.live.profile.confirmAdult({ confirm: true })).adultConfirmedAt.getTime()).toBe(adultConfirmedAt.getTime());
    expect((await me.live.summary()).adultConfirmed).toBe(true);
    expect(await me.live.communities.join({ communityId: room.id })).toMatchObject({ status: "active" });
    expect(await me.live.communities.post({ communityId: room.id, bodyMd: "Hello, room." })).toMatchObject({ status: "visible" });
  });

  it("going LIVE asks for the confirmation once; going back to Personal never does", async () => {
    const ada = await founder("adult-golive", false, false);
    const owner = as(ada.userId);
    const refused = await failure(owner.business.setGameMode({ businessId: ada.businessId, gameMode: "live" }));
    expect(refused.code).toBe("FORBIDDEN");
    expect(refused.message).toMatch(/18 or older/);
    expect((await repos.businesses.get(hz.db, ada.businessId)).gameMode).toBe("personal");
    expect(await owner.business.setGameMode({ businessId: ada.businessId, gameMode: "live", confirmAdult: true })).toMatchObject({ gameMode: "live" });
    expect(await repos.social.adultConfirmedAt(hz.db, ada.userId)).not.toBeNull();
    expect(await owner.business.setGameMode({ businessId: ada.businessId, gameMode: "personal" })).toMatchObject({ gameMode: "personal" });
    // Confirmed already: going LIVE again needs nothing more.
    expect(await owner.business.setGameMode({ businessId: ada.businessId, gameMode: "live" })).toMatchObject({ gameMode: "live" });
  });

  it("taking charge of a LIVE business asks too; a Personal one never does", async () => {
    const userId = await hz.h.createUser("adult-commit@live-social.test");
    const caller = as(userId);
    await caller.founder.profile.update({ displayName: "Noor", experience: "first-time", skills: { sales: 10 }, targetMarkets: ["EU"], riskAppetite: "medium" });
    const [first] = (await caller.idea.generate({ prompt: "invoicing for freelance designers" })).ideas;
    // Without the confirmation nothing is created: no business, and the idea stays uncommitted.
    const refused = await failure(caller.idea.commit({ ideaId: first!.id, name: "Noor Live", archetype: "b2b_saas", gameMode: "live" }));
    expect(refused).toEqual({ code: "FORBIDDEN", message: expect.stringMatching(/18 or older/) });
    expect((await caller.idea.get({ ideaId: first!.id })).idea.committedAt).toBeNull();
    expect(await repos.memberships.listForUser(hz.db, userId)).toEqual([]);
    expect(await repos.social.adultConfirmedAt(hz.db, userId)).toBeNull();
    // A Personal business needs no confirmation (another person: the free plan holds one business each).
    const otherId = await hz.h.createUser("adult-commit-personal@live-social.test");
    const other = as(otherId);
    await other.founder.profile.update({ displayName: "Mika", experience: "first-time", skills: { sales: 10 }, targetMarkets: ["EU"], riskAppetite: "medium" });
    const [second] = (await other.idea.generate({ prompt: "invoicing for freelance designers" })).ideas;
    expect((await other.idea.commit({ ideaId: second!.id, name: "Mika Personal", archetype: "b2b_saas", gameMode: "personal" })).business.gameMode).toBe("personal");
    expect(await repos.social.adultConfirmedAt(hz.db, otherId)).toBeNull();
    // A LIVE one goes through with the confirmation, and records it.
    const live = await caller.idea.commit({ ideaId: first!.id, name: "Noor Live", archetype: "b2b_saas", gameMode: "live", confirmAdult: true });
    expect(live.business.gameMode).toBe("live");
    expect(await repos.social.adultConfirmedAt(hz.db, userId)).not.toBeNull();
  });
});

describe("#66: asking to connect from a leaderboard row reaches the business's owner", () => {
  it("resolves a listed business to its owner, refuses one's own business and an unlisted one", async () => {
    const me = await founder("lb-me");
    const them = await founder("lb-them");
    const hidden = await founder("lb-hidden", false);
    const c = await as(me.userId).live.connections.request({ businessId: me.businessId, toBusinessId: them.businessId, message: "Congrats on the board" });
    expect(c).toMatchObject({ fromUser: me.userId, toUser: them.userId, status: "requested" });
    expect(await eventsOf(them.businessId, "connection.requested")).toHaveLength(1);
    expect((await failure(as(me.userId).live.connections.request({ businessId: me.businessId, toBusinessId: me.businessId }))).code).toBe("BAD_REQUEST");
    expect((await failure(as(me.userId).live.connections.request({ businessId: me.businessId, toBusinessId: hidden.businessId }))).code).toBe("NOT_FOUND");
    expect((await failure(as(me.userId).live.connections.request({ businessId: me.businessId }))).code).toBe("BAD_REQUEST");

    const board = await repos.social.upsertLeaderboard(hz.db, { boardKind: "growth", period: "2026-Q4", metric: "mrr_growth_pct", region: "eu" });
    await repos.social.setLeaderboardEntries(hz.db, board.id, [{ businessId: me.businessId, metricValue: 3 }, { businessId: them.businessId, metricValue: 5 }]);
    const entries = await as(me.userId).live.leaderboards.entries({ leaderboardId: board.id });
    expect(entries.map((e) => [e.businessId, e.own])).toEqual([[them.businessId, false], [me.businessId, true]]);
  });
});
