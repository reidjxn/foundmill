/**
 * live.* after the LIVE social audit (#28, #34, #65, #66, FU-S-2):
 * - a request or a message reaches its RECIPIENT alone: their badge, their Network lists and a signal on their own stream
 *   channel. Nothing is written to any business (no event, no Inbox note), so no member or advisor of the recipient's
 *   business can read a founder's private network messages through the api, the stream or the database;
 * - groups need everyone connected; removing a connection closes the direct thread; block anyone from a thread; leave
 *   and mute;
 * - posts pass a moderation screen (held ones wait for a moderator), members report, authors edit and delete,
 *   moderators hide, restore and remove; communities are created here and private ones are joined by invitation;
 * - "Ask to connect" reaches a leaderboard business's owner.
 */
import { events, inboxItems, messageThreads, messages, outbox, repos } from "@foundmill/db";
import { businessStreamKey, MemoryRedis, userStreamKey } from "@foundmill/events";
import { MEMBERSHIP_ROLES, PERSON_ADDRESSED_EVENT_TYPES, type MembershipRole } from "@foundmill/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADULTS_ONLY } from "../routers/live";
import { liveLimiter, plainQuote } from "../services/live";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let redis: MemoryRedis;
beforeAll(async () => {
  redis = new MemoryRedis();
  hz = await createApiHarness({ prefix: "live-social", redis, env: { LIVE_MODE: "1" } });
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
/** Every person-addressed event, human message and outbox row for one, in any business: there must be none (FU-S-2). */
const everywhere = async () => ({
  events: await hz.db.select().from(events).where(inArray(events.type, [...PERSON_ADDRESSED_EVENT_TYPES])),
  notes: await hz.db.select().from(inboxItems).where(eq(inboxItems.type, "human_message")),
  outbox: ((await hz.db.execute(sql`select o.id from outbox o join events e on e.id = o.event_id where e.type in ('connection.requested', 'message.received')`)) as unknown as { rows: unknown[] }).rows,
});
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

/** The people of a business other than its owner, one per role: everyone who can open its Inbox, events or stream. */
async function staffOf(businessId: string, tag: string): Promise<Record<Exclude<MembershipRole, "owner">, string>> {
  const out = {} as Record<Exclude<MembershipRole, "owner">, string>;
  for (const role of MEMBERSHIP_ROLES.filter((r): r is Exclude<MembershipRole, "owner"> => r !== "owner")) {
    out[role] = await hz.h.createUser(`${role}-${tag}@live-social.test`);
    await repos.memberships.add(hz.db, businessId, { userId: out[role], role });
  }
  return out;
}

const INBOX_TABS = ["all", "respond", "customers", "updates", "messages", "archive"] as const;

describe("#65 / FU-S-2: requests and messages reach the recipient alone", () => {
  it("a request reaches the recipient (badge, Requests, signal on their own stream) and is written to no business, once", async () => {
    const asker = await founder("asker");
    const target = await founder("target");
    const staff = await staffOf(target.businessId, "target");
    await repos.founders.upsert(hz.db, asker.userId, { displayName: "Ana Ruiz", visibility: "private" });
    const c = await as(asker.userId).live.connections.request({ businessId: asker.businessId, toUserId: target.userId, message: "Loved your post on pricing" });
    expect(c).toMatchObject({ fromUser: asker.userId, toUser: target.userId, status: "requested" });

    // The recipient has it: the badge, the Requests list and a content-free signal on their own channel.
    expect((await as(target.userId).live.summary()).requestsWaiting).toBe(1);
    expect((await as(target.userId).live.connections.list({ status: "requested", direction: "incoming" })).map((r) => r.id)).toEqual([c.id]);
    expect(await signals(target.userId)).toEqual([expect.objectContaining({ kind: "connection_requested" })]);
    expect(JSON.stringify(await signals(target.userId))).not.toContain("pricing");

    // Nothing is written to any business: not the recipient's, not the requester's, not as an event, a note or an outbox row.
    expect(await everywhere()).toEqual({ events: [], notes: [], outbox: [] });
    for (const businessId of [target.businessId, asker.businessId]) {
      expect(await eventsOf(businessId, "connection.requested")).toEqual([]);
      expect(await notesOf(businessId)).toEqual([]);
    }
    // The recipient's staff and advisors, in every role, learn nothing: not through the Inbox, not on Network, not in their signals.
    for (const [role, userId] of Object.entries(staff)) {
      const member = as(userId);
      for (const tab of INBOX_TABS) {
        const list = await member.inbox.list({ businessId: target.businessId, tab });
        expect(JSON.stringify(list), `${role} Inbox ${tab}`).not.toMatch(/Ana|pricing|connect/i);
      }
      expect((await member.inbox.list({ businessId: target.businessId, tab: "messages" })).items, role).toEqual([]);
      expect(await member.live.summary(), role).toMatchObject({ requestsWaiting: 0, unreadMessages: 0, total: 0 });
      expect(await member.live.connections.list(), role).toEqual([]);
      expect(await signals(userId), role).toEqual([]);
    }
    // Straight from the database as one of them (row-level security applies): the business's events and Inbox hold nothing of it.
    const staffRows = await hz.h.asUser(staff.member).run(async (tx) => ({
      events: await tx.select().from(events).where(eq(events.businessId, target.businessId)),
      items: await tx.select().from(inboxItems).where(eq(inboxItems.businessId, target.businessId)),
      outbox: await tx.select().from(outbox).where(eq(outbox.businessId, target.businessId)),
    }));
    expect(JSON.stringify(staffRows)).not.toMatch(/connection\.requested|Ana|pricing/);

    // Asking again returns the same row and notifies nobody.
    await as(asker.userId).live.connections.request({ businessId: asker.businessId, toUserId: target.userId });
    expect(await signals(target.userId)).toHaveLength(1);
    expect((await as(target.userId).live.summary()).requestsWaiting).toBe(1);
  });

  it("asking, withdrawing and asking again counts as one waiting request, and still writes nothing to a business", async () => {
    const asker = await founder("again");
    const target = await founder("again-target");
    const ask = () => as(asker.userId).live.connections.request({ businessId: asker.businessId, toUserId: target.userId });
    const withdraw = (connectionId: string) => as(asker.userId).live.connections.remove({ connectionId });
    await withdraw((await ask()).id);
    expect((await as(target.userId).live.summary()).requestsWaiting).toBe(0);
    await ask();
    // The new request signals the recipient's badge again (the signal carries no content); the badge counts the one request.
    expect((await signals(target.userId)).map((x) => x.kind)).toEqual(["connection_requested", "connection_changed", "connection_requested"]);
    expect((await as(target.userId).live.summary()).requestsWaiting).toBe(1);
    expect(await everywhere()).toEqual({ events: [], notes: [], outbox: [] });
  });

  it("co-founders writing to each other are signalled, and neither of their businesses is written to", async () => {
    const lead = await founder("cofounder-lead");
    const partner = await founder("cofounder-partner");
    await repos.memberships.add(hz.db, lead.businessId, { userId: partner.userId, role: "admin" });
    const c = await as(lead.userId).live.connections.request({ businessId: lead.businessId, toUserId: partner.userId });
    expect(await signals(partner.userId)).toEqual([expect.objectContaining({ kind: "connection_requested" })]);
    await as(partner.userId).live.connections.respond({ connectionId: c.id, status: "accepted" });
    await as(lead.userId).live.messages.send({ toUserIds: [partner.userId], body: "Board deck by Friday?" });
    expect((await as(partner.userId).live.summary()).unreadMessages).toBe(1);
    // The partner reads it on Network; the lead's own businesses (theirs too) hold nothing of it.
    expect((await as(partner.userId).live.messages.threads()).items).toHaveLength(1);
    expect(await everywhere()).toEqual({ events: [], notes: [], outbox: [] });
  });

  it("a recipient with no LIVE business sees it on their badge (summary) too", async () => {
    const asker = await founder("asker2");
    const personal = await founder("personal", false);
    await as(asker.userId).live.connections.request({ businessId: asker.businessId, toUserId: personal.userId });
    expect(await as(personal.userId).live.summary()).toMatchObject({ requestsWaiting: 1, total: 1 });
    expect(await signals(personal.userId)).toEqual([expect.objectContaining({ kind: "connection_requested" })]);
    expect(await everywhere()).toEqual({ events: [], notes: [], outbox: [] });
  });

  it("a message is readable by the people in its thread only: not by the recipient's staff, advisors or viewers, through the api, the stream or the database", async () => {
    const sender = await founder("sender");
    const reader = await founder("reader");
    const staff = await staffOf(reader.businessId, "reader");
    await connect(sender.userId, reader.userId);
    const first = await as(sender.userId).live.messages.send({ toUserIds: [reader.userId], body: "Here is the term sheet: valuation 12,000,000 <script>x</script>" });
    await as(sender.userId).live.messages.send({ threadId: first.threadId, body: "Second" });

    // The recipient: the badge, the thread and one signal per message, each without content.
    expect(await as(reader.userId).live.summary()).toMatchObject({ unreadMessages: 2 });
    const mine = (await as(reader.userId).live.messages.threads()).items.find((t) => t.id === first.threadId);
    expect(mine).toMatchObject({ unread: 2, muted: false });
    expect((await as(reader.userId).live.messages.list({ threadId: first.threadId })).items.map((m) => m.body)).toContain("Here is the term sheet: valuation 12,000,000 <script>x</script>");
    const sent = (await signals(reader.userId)).filter((x) => x.kind === "message_received");
    expect(sent).toEqual([expect.objectContaining({ threadId: first.threadId }), expect.objectContaining({ threadId: first.threadId })]);
    expect(JSON.stringify(sent)).not.toMatch(/term sheet|valuation/);

    // Nothing in any business: no event, no human message, no outbox row for the relay to publish on `ev:`.
    expect(await everywhere()).toEqual({ events: [], notes: [], outbox: [] });
    expect(await redis.xrange(businessStreamKey(reader.businessId), "-", "+")).toEqual([]);
    expect(await redis.xrange(businessStreamKey(sender.businessId), "-", "+")).toEqual([]);

    // The reader's staff, advisors and viewers cannot reach it: not in the Inbox, not on Network, not by opening the thread.
    for (const [role, userId] of Object.entries(staff)) {
      const member = as(userId);
      for (const tab of INBOX_TABS) expect(JSON.stringify(await member.inbox.list({ businessId: reader.businessId, tab })), `${role} Inbox ${tab}`).not.toMatch(/term sheet|valuation|Second|Message from/);
      expect(await member.live.summary(), role).toMatchObject({ unreadMessages: 0, total: 0 });
      expect((await member.live.messages.threads()).items, role).toEqual([]);
      expect((await failure(member.live.messages.list({ threadId: first.threadId }))).code, role).toBe("BAD_REQUEST");
      expect((await failure(member.live.messages.thread({ threadId: first.threadId }))).code, role).toBe("BAD_REQUEST");
      expect(await signals(userId), role).toEqual([]);
    }
    // Row-level security, as one of them: the thread and its messages are not theirs to read, and the business's events and Inbox hold nothing.
    for (const userId of [staff.admin, staff.member, staff.advisor, staff.viewer]) {
      const rows = await hz.h.asUser(userId).run(async (tx) => ({
        // Named columns: the client roles read message_threads by column grant (0058), so `select *` is refused.
        threads: await tx.select({ id: messageThreads.id, participantIds: messageThreads.participantIds }).from(messageThreads),
        messages: await tx.select().from(messages),
        events: await tx.select().from(events).where(eq(events.businessId, reader.businessId)),
        items: await tx.select().from(inboxItems).where(eq(inboxItems.businessId, reader.businessId)),
      }));
      expect(rows.threads.filter((t) => t.id === first.threadId)).toEqual([]);
      expect(rows.messages.filter((m) => m.threadId === first.threadId)).toEqual([]);
      expect(JSON.stringify([rows.events, rows.items])).not.toMatch(/term sheet|valuation|message\.received/);
    }

    // Muted: no signal and no badge for the recipient; the sender never learns who muted the thread.
    await as(reader.userId).live.messages.mute({ threadId: first.threadId, muted: true });
    const before = (await signals(reader.userId)).length;
    await as(sender.userId).live.messages.send({ threadId: first.threadId, body: "Fourth" });
    expect(await signals(reader.userId)).toHaveLength(before);
    expect((await as(reader.userId).live.summary()).unreadMessages).toBe(0);
    // The thread still holds the unread message (they read the earlier ones above); the badge leaves it out.
    expect((await as(reader.userId).live.messages.threads()).items.find((t) => t.id === first.threadId)).toMatchObject({ muted: true, unread: 1 });
    expect((await as(sender.userId).live.messages.threads()).items.find((t) => t.id === first.threadId)).toMatchObject({ muted: false });
    expect(await everywhere()).toEqual({ events: [], notes: [], outbox: [] });
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
    // Both other members were signalled on their own channel and read it on Network; no business was written to.
    for (const other of [b, c]) {
      expect(await signals(other.userId)).toEqual([expect.objectContaining({ kind: "message_received", threadId: sent.threadId })]);
      expect((await as(other.userId).live.summary()).unreadMessages).toBe(1);
    }
    expect(await everywhere()).toEqual({ events: [], notes: [], outbox: [] });
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
    expect(await signals(them.userId)).toEqual([expect.objectContaining({ kind: "connection_requested" })]);
    expect(await eventsOf(them.businessId, "connection.requested")).toEqual([]);
    expect((await failure(as(me.userId).live.connections.request({ businessId: me.businessId, toBusinessId: me.businessId }))).code).toBe("BAD_REQUEST");
    expect((await failure(as(me.userId).live.connections.request({ businessId: me.businessId, toBusinessId: hidden.businessId }))).code).toBe("NOT_FOUND");
    expect((await failure(as(me.userId).live.connections.request({ businessId: me.businessId }))).code).toBe("BAD_REQUEST");

    const board = await repos.social.upsertLeaderboard(hz.db, { boardKind: "growth", period: "2026-Q4", metric: "mrr_growth_pct", region: "eu" });
    await repos.social.setLeaderboardEntries(hz.db, board.id, [{ businessId: me.businessId, metricValue: 3 }, { businessId: them.businessId, metricValue: 5 }]);
    const entries = await as(me.userId).live.leaderboards.entries({ leaderboardId: board.id });
    expect(entries.map((e) => [e.businessId, e.own])).toEqual([[them.businessId, false], [me.businessId, true]]);
  });
});
