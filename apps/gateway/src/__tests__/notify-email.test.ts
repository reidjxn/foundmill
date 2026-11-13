/**
 * Email from Foundmill to a person, the gateway's part (packages 1.5 and 5.1): `POST /v1/notify/email`.
 *   - the api only; ids in, nothing else trusted: the address from auth.users, the words from the gateway's own reads;
 *   - from Foundmill's own address on the platform domain, with a link into the app and a signed link that turns the
 *     kind off; one `notify.email_sent` (user id, never the address) through the outbox, and an audit row without it;
 *   - never about a sample, never to an example visitor or someone walled off the Inbox, never after the person turned
 *     it off or opened the note, never for a note younger than a day;
 *   - one a day per person and project, three a day per person in all, this email's own ceiling (`pn:all:day`, never
 *     the projects' `pm:all:day`), and none while the projects' mail is above 75% of its ceiling;
 *   - once per note within the lookback, held here too (the event and a Redis marker), never for a note over 7 days old;
 *   - the subject as the Inbox shows it to the person: no amount behind a Finance wall, no customer behind a CRM wall;
 *   - a note that holds up the team's work after 30 minutes away (founder 2026-11-12), never while the person is here;
 *   - every other kind by the same route (a win, the morning brief), the brief outside the per-person limits;
 *   - one founder_notifications row per email, its links' tokens never stored;
 *   - refused, with a plain sentence, when platform mail is off or not configured; never simulated for a person's
 *     project on staging or production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatformNotifyMock, readNotifyOffToken } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import * as s from "@foundmill/db";
import { APP_NAME } from "@foundmill/config";
import { NOTIFY_EMAIL_REFUSALS } from "@foundmill/shared";
import { DEV_PLATFORM_MAIL_SECRET, PLATFORM_MAIL_CEILING_KEY, type PlatformMailConfig } from "../platform-mail";
import { NOTIFY_EMAIL_ROUTE, notifyItemKey, notifyPersonDayKey, notifyProjectDayKey, PLATFORM_NOTIFY_CEILING_KEY } from "../notify-email";
import { MemoryRateLimitStore } from "../rate-limit";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";

const DOMAIN = "mail.foundmill.test";
const HOURS = 3_600_000;
const config = (over: Partial<PlatformMailConfig> = {}): PlatformMailConfig => ({ domain: DOMAIN, dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", notifyLocalPart: "hello", appUrl: "http://localhost:3000", ...over });

describe("email from Foundmill to a person (gateway)", () => {
  let g: GatewayFixture;
  const mock = createPlatformNotifyMock();
  let n = 0;

  beforeAll(async () => {
    g = await setupGateway({ connectors: [mock] });
    g.deps.appEnv = "test";
  }, 120_000);
  afterAll(async () => g.close());
  beforeEach(() => {
    g.deps.platformMail = config();
  });

  /** A member with a profile and a note from the agent that has waited 26 hours. */
  async function person(over: { role?: "owner" | "admin" | "member" | "viewer"; source?: "invite" | "example"; sectionPermissions?: Record<string, "read" | "write" | "none">; subject?: string; entityIds?: string[]; hoursAgo?: number; blocksContinue?: boolean; type?: "decision" | "customer_won" } = {}) {
    n += 1;
    const userId = await g.h.createUser(`Person${n}@Example.com`);
    await repos.founders.upsert(g.db, userId, { displayName: `Maya ${n}` });
    await g.h.db.insert(s.memberships).values({ businessId: g.businessId, userId, role: over.role ?? "owner", source: over.source ?? "invite", sectionPermissions: over.sectionPermissions ?? {} });
    const [item] = await g.h.db
      .insert(s.inboxItems)
      .values({ businessId: g.businessId, type: over.type ?? "decision", blocksContinue: over.blocksContinue ?? false, fromAgentId: g.agentId, subject: over.subject ?? `Which price should [[ent:00000000-0000-4000-8000-000000000001|Starter]] have? (${n})`, entityIds: over.entityIds ?? [], createdAt: new Date(Date.now() - (over.hoursAgo ?? 26) * HOURS) })
      .returning({ id: s.inboxItems.id });
    return { userId, email: `person${n}@example.com`, itemId: item!.id };
  }

  async function ask(body: Record<string, unknown>, svc: string | null = "api") {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
    const res = await fetch(`${g.server.url}${NOTIFY_EMAIL_ROUTE}`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { sent?: boolean; simulated?: boolean; reason?: string; message?: string; eventId?: string; error?: { code: string } } };
  }
  const about = (p: { userId: string; itemId: string }) => ({ userId: p.userId, kind: "decision_waiting", businessId: g.businessId, data: { inboxItemId: p.itemId } });
  const sentTo = (email: string) => mock.sentFor(g.businessId).filter((m) => m.to === email);

  it("sends one email from Foundmill's own address, to the account's address, with the link into the app and the way out", async () => {
    const p = await person();
    const r = await ask(about(p));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sent: true, simulated: true });
    const [sent, ...more] = sentTo(p.email);
    expect(more).toHaveLength(0);
    expect(sent!.from).toBe(`hello@${DOMAIN}`);
    expect((sent!.body as { from: { name: string } }).from.name).toBe(APP_NAME);
    expect(sent!.subject).toBe("Gateway Test Club needs your answer");
    expect(sent!.text).toContain(`Hi Maya ${n},`);
    expect(sent!.text).toContain("Test Worker asked you something 26 hours ago and the team is waiting on it:");
    // Entity markup reduced to its name.
    expect(sent!.text).toContain(`“Which price should Starter have? (${n})”`);
    expect(sent!.text).toContain(`Open it: http://localhost:3000/b/${g.businessId}/inbox/${p.itemId}`);
    expect(sent!.text).toContain(`You get this because you are part of Gateway Test Club on ${APP_NAME}. Turn these emails off: http://localhost:4005/mail/notify/off?t=`);
    // The link carries the record's id, so the return it brings is counted (`founder.session_started`, via email).
    expect(sent!.html).toMatch(new RegExp(`<a href="http://localhost:3000/b/${g.businessId}/inbox/${p.itemId}\\?via=email&amp;n=[0-9a-f-]{36}">Open it</a>`));
    const link = sent!.text.match(/\/mail\/notify\/off\?t=(\S+)/);
    expect(readNotifyOffToken(DEV_PLATFORM_MAIL_SECRET, decodeURIComponent(link![1]!))).toEqual({ userId: p.userId, kind: "decision_waiting" });
    expect((sent!.body as { headers: Record<string, string> }).headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // One event, the user id only; one audit row; neither holds the address.
    const events = (await repos.events.list(g.db, g.businessId, { type: "notify.email_sent" })).items.filter((e) => (e.payload as { userId: string }).userId === p.userId);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ kind: "decision_waiting", userId: p.userId, inboxItemId: p.itemId, simulated: true });
    expect(events[0]!.id).toBe(r.body.eventId);
    const audit = (await repos.audit.list(g.db, g.businessId, { action: "gateway.notify.email_sent" })).items;
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify([events, audit])).not.toMatch(/person\d+@/i);
  });

  it("one a day per person and project, and three a day per person across projects", async () => {
    const p = await person();
    expect((await ask(about(p))).body.sent).toBe(true);
    const second = await g.h.db.insert(s.inboxItems).values({ businessId: g.businessId, type: "decision", subject: "Another", createdAt: new Date(Date.now() - 30 * HOURS) }).returning({ id: s.inboxItems.id });
    expect((await ask(about({ userId: p.userId, itemId: second[0]!.id }))).body).toEqual({ sent: false, reason: "per_project", message: NOTIFY_EMAIL_REFUSALS.per_project });
    // The refused one was given back: still one counted.
    expect(g.rateLimits.peek(notifyProjectDayKey(p.userId, g.businessId), Date.now())).toBe(1);
    // Two more projects' worth reach the person's own limit.
    const q = await person();
    await g.rateLimits.hit(notifyPersonDayKey(q.userId), 86_400_000, Date.now());
    await g.rateLimits.hit(notifyPersonDayKey(q.userId), 86_400_000, Date.now());
    await g.rateLimits.hit(notifyPersonDayKey(q.userId), 86_400_000, Date.now());
    expect((await ask(about(q))).body.reason).toBe("per_person");
    expect(sentTo(q.email)).toHaveLength(0);
    // And this email's own ceiling.
    const c = await person();
    g.deps.platformMail = config({ notifyCeiling: 0 });
    expect((await ask(about(c))).body.reason).toBe("ceiling");
    expect(sentTo(c.email)).toHaveLength(0);
  });

  it("counts against its own ceiling, never the projects' pm:all:day, and waits while the projects' mail is above 75% of theirs", async () => {
    const projectsBefore = g.rateLimits.peek(PLATFORM_MAIL_CEILING_KEY, Date.now());
    const ownBefore = g.rateLimits.peek(PLATFORM_NOTIFY_CEILING_KEY, Date.now());
    const p = await person();
    expect((await ask(about(p))).body.sent).toBe(true);
    expect(g.rateLimits.peek(PLATFORM_MAIL_CEILING_KEY, Date.now())).toBe(projectsBefore);
    expect(g.rateLimits.peek(PLATFORM_NOTIFY_CEILING_KEY, Date.now())).toBe(ownBefore + 1);
    // The projects have sent 3 of 4 today (75%): there is still room.
    for (let i = g.rateLimits.peek(PLATFORM_MAIL_CEILING_KEY, Date.now()); i < 3; i += 1) await g.rateLimits.hit(PLATFORM_MAIL_CEILING_KEY, 86_400_000, Date.now());
    const at = await person();
    g.deps.platformMail = config({ ceiling: 4 });
    expect((await ask(about(at))).body.sent).toBe(true);
    // One more (above 75%): this email waits and the projects keep the room; the note can still be emailed later.
    await g.rateLimits.hit(PLATFORM_MAIL_CEILING_KEY, 86_400_000, Date.now());
    const above = await person();
    const ownNow = g.rateLimits.peek(PLATFORM_NOTIFY_CEILING_KEY, Date.now());
    expect((await ask(about(above))).body).toEqual({ sent: false, reason: "busy", message: NOTIFY_EMAIL_REFUSALS.busy });
    expect(sentTo(above.email)).toHaveLength(0);
    expect(g.rateLimits.peek(PLATFORM_NOTIFY_CEILING_KEY, Date.now())).toBe(ownNow);
    expect(g.rateLimits.peek(notifyProjectDayKey(above.userId, g.businessId), Date.now())).toBe(0);
    expect(g.rateLimits.marked(notifyItemKey(above.userId, above.itemId), Date.now())).toBe(false);
    for (let i = 0; i < 4; i += 1) await g.rateLimits.release(PLATFORM_MAIL_CEILING_KEY, 86_400_000, Date.now());
    expect((await ask(about(above))).body.sent).toBe(true);
  });

  it("once per note, even when the event that records the email could not be written", async () => {
    const p = await person();
    const tx = vi.spyOn(g.deps.db, "transaction").mockRejectedValueOnce(new Error("connection lost"));
    try {
      expect((await ask(about(p))).body).toMatchObject({ sent: true, eventId: null });
    } finally {
      tx.mockRestore();
    }
    expect(await repos.notifyEmail.emailedItems(g.db, g.businessId, p.userId, [p.itemId])).toEqual(new Set());
    // A new UTC day's counts would let it through; the marker does not.
    await g.rateLimits.release(notifyProjectDayKey(p.userId, g.businessId), 86_400_000, Date.now());
    await g.rateLimits.release(notifyPersonDayKey(p.userId), 86_400_000, Date.now());
    expect((await ask(about(p))).body).toEqual({ sent: false, reason: "already_sent", message: NOTIFY_EMAIL_REFUSALS.already_sent });
    expect(sentTo(p.email)).toHaveLength(1);
  });

  it("once per note by the recorded event too, when the marker is gone (a Redis flushed or replaced)", async () => {
    const p = await person();
    expect((await ask(about(p))).body.sent).toBe(true);
    const store = g.deps.rateLimits;
    g.deps.rateLimits = new MemoryRateLimitStore();
    try {
      expect((await ask(about(p))).body.reason).toBe("already_sent");
    } finally {
      g.deps.rateLimits = store;
    }
    expect(sentTo(p.email)).toHaveLength(1);
  });

  it("never about a note older than the 7-day lookback", async () => {
    const old = await person({ hoursAgo: 9 * 24 });
    expect((await ask(about(old))).body).toEqual({ sent: false, reason: "too_old", message: NOTIFY_EMAIL_REFUSALS.too_old });
    expect(sentTo(old.email)).toHaveLength(0);
    expect(g.rateLimits.peek(notifyProjectDayKey(old.userId, g.businessId), Date.now())).toBe(0);
  });

  it("quotes the subject as the Inbox shows it to the person: no amount behind a Finance wall, no customer behind a CRM wall", async () => {
    const money = "Cash is £2,300, runway 2 months: approve the $400 ad test?";
    const financeWalled = await person({ role: "member", sectionPermissions: { finance: "none" }, subject: money });
    expect((await ask(about(financeWalled))).body.sent).toBe(true);
    const [f] = sentTo(financeWalled.email);
    expect(f!.text).toContain("“Cash is (amount hidden) runway (hidden): approve the (amount hidden) ad test?”");
    expect(`${f!.text}${f!.html}${f!.subject}`).not.toMatch(/2,300|\$400|2 months/);

    const [customer] = await g.h.db.insert(s.entities).values({ businessId: g.businessId, kind: "person", displayName: "Wren Garza", aliases: ["Wren"] }).returning({ id: s.entities.id });
    const crmSubject = `Thank [[ent:${customer!.id}|Wren Garza]] for the order? Wren asked twice`;
    const crmWalled = await person({ role: "member", sectionPermissions: { crm: "none" }, subject: crmSubject, entityIds: [customer!.id] });
    expect((await ask(about(crmWalled))).body.sent).toBe(true);
    const [c] = sentTo(crmWalled.email);
    expect(c!.text).toContain("“Thank a contact for the order? A contact asked twice”");
    expect(`${c!.text}${c!.html}${c!.subject}`).not.toMatch(/Wren|Garza/);

    // Without a wall the subject reads as before.
    const open = await person({ subject: money });
    expect((await ask(about(open))).body.sent).toBe(true);
    expect(sentTo(open.email)[0]!.text).toContain(`“${money}”`);
    const openCrm = await person({ subject: crmSubject, entityIds: [customer!.id] });
    expect((await ask(about(openCrm))).body.sent).toBe(true);
    expect(sentTo(openCrm.email)[0]!.text).toContain("“Thank Wren Garza for the order? Wren asked twice”");
  });

  it("never to someone who turned it off, opened the note, cannot read the Inbox or is an example visitor; never for a fresh note", async () => {
    const off = await person();
    await repos.preferences.update(g.db, off.userId, { email: { decision_waiting: false } });
    expect((await ask(about(off))).body.reason).toBe("turned_off");
    const opened = await person();
    await repos.inbox.markRead(g.db, g.businessId, opened.itemId, opened.userId);
    expect((await ask(about(opened))).body.reason).toBe("not_waiting");
    const walled = await person({ role: "member", sectionPermissions: { inbox: "none" } });
    expect((await ask(about(walled))).body.reason).toBe("not_member");
    const visitor = await person({ role: "viewer", source: "example" });
    expect((await ask(about(visitor))).body.reason).toBe("not_member");
    const fresh = await person();
    await g.h.pg.query("update inbox_items set created_at = now() - interval '2 hours' where id = $1", [fresh.itemId]);
    expect((await ask(about(fresh))).body.reason).toBe("not_waiting");
    // A note of another business, named with this one's id, is not found.
    const stranger = await person();
    expect((await ask({ ...about(stranger), businessId: "00000000-0000-4000-8000-000000000009" })).body.reason).toBe("not_member");
    for (const p of [off, opened, walled, visitor, fresh, stranger]) expect(sentTo(p.email)).toHaveLength(0);
  });

  it("never to a collaborator whose access has ended (0092), though one whose date is ahead is told", async () => {
    const ended = await person({ role: "member" });
    await g.h.pg.query("update memberships set role = 'collaborator', expires_at = now() - interval '1 hour' where business_id = $1 and user_id = $2", [g.businessId, ended.userId]);
    expect((await ask(about(ended))).body.reason).toBe("not_member");
    expect(sentTo(ended.email)).toHaveLength(0);
    // The api's pass does not even list them (repos.notifyEmail.waitingAnswers).
    const waiting = await repos.notifyEmail.waitingAnswers(g.db, { olderThan: new Date(), since: new Date(Date.now() - 7 * 24 * HOURS) });
    expect(waiting.some((w) => w.userId === ended.userId)).toBe(false);
    const current = await person({ role: "member" });
    await g.h.pg.query("update memberships set role = 'collaborator', expires_at = now() + interval '7 days' where business_id = $1 and user_id = $2", [g.businessId, current.userId]);
    expect((await repos.notifyEmail.waitingAnswers(g.db, { olderThan: new Date(), since: new Date(Date.now() - 7 * 24 * HOURS) })).some((w) => w.userId === current.userId)).toBe(true);
    expect((await ask(about(current))).body.sent).toBe(true);
  });

  it("never about a sample business", async () => {
    const p = await person();
    await g.h.pg.query("update businesses set is_demo = true where id = $1", [g.businessId]);
    try {
      expect((await ask(about(p))).body.reason).toBe("sample");
    } finally {
      await g.h.pg.query("update businesses set is_demo = false where id = $1", [g.businessId]);
    }
    expect(sentTo(p.email)).toHaveLength(0);
  });

  it("refused in plain words while platform mail is off or not configured, and never simulated for a person's project on staging", async () => {
    const p = await person();
    g.deps.platformMail = config({ domain: null });
    expect((await ask(about(p))).body).toEqual({ sent: false, reason: "off", message: NOTIFY_EMAIL_REFUSALS.off });
    g.deps.platformMail = undefined;
    expect((await ask(about(p))).body.reason).toBe("off");
    g.deps.appEnv = "staging";
    try {
      g.deps.platformMail = config({ signingSecret: "s".repeat(40) });
      expect((await ask(about(p))).body.reason).toBe("unconfigured");
      g.deps.platformMail = config({ signingSecret: "s".repeat(40), unsubscribeBase: "https://ingest.example", appUrl: "https://app.example" });
      expect((await ask(about(p))).body.reason).toBe("simulated");
    } finally {
      g.deps.appEnv = "test";
    }
    expect(sentTo(p.email)).toHaveLength(0);
  });

  it("a note that holds up the team's work goes out 30 minutes after the person left, never while they are here; any other note waits a day", async () => {
    const away = await person({ blocksContinue: true, hoursAgo: 0.75 });
    expect((await ask(about(away))).body).toMatchObject({ sent: true });
    const here = await person({ blocksContinue: true, hoursAgo: 0.75 });
    await repos.presence.ping(g.db, g.businessId, here.userId, { now: new Date(Date.now() - 10 * 60_000) });
    expect((await ask(about(here))).body).toMatchObject({ sent: false, reason: "present" });
    const fresh = await person({ blocksContinue: true, hoursAgo: 0.25 });
    expect((await ask(about(fresh))).body).toMatchObject({ sent: false, reason: "not_waiting" });
    const plain = await person({ hoursAgo: 0.75 });
    expect((await ask(about(plain))).body).toMatchObject({ sent: false, reason: "not_waiting" });
    expect(sentTo(here.email)).toHaveLength(0);
  });

  it("sends the other kinds by the same route, and the morning brief never counts toward the three a day", async () => {
    const p = await person();
    const win0 = await ask({ userId: p.userId, kind: "daily_brief", businessId: g.businessId, data: { day: "2026-11-12" } });
    expect(win0.body).toMatchObject({ sent: false, reason: "not_started" });
    await g.h.pg.query("update businesses set committed_at = $1 where id = $2", [new Date(Date.now() - 48 * HOURS).toISOString(), g.businessId]);
    const [won] = await g.h.db.insert(s.inboxItems).values({ businessId: g.businessId, type: "customer_won", fromAgentId: g.agentId, subject: "Ada Byron paid for Starter" }).returning({ id: s.inboxItems.id });
    const win = await ask({ userId: p.userId, kind: "win", businessId: g.businessId, data: { inboxItemId: won!.id } });
    expect(win.body, JSON.stringify(win.body)).toMatchObject({ sent: true });
    const [event] = await repos.events.list(g.db, g.businessId, { type: "notify.email_sent", limit: 50 }).then((es) => es.items.filter((e) => (e.payload as { userId: string }).userId === p.userId));
    expect(event!.payload).toMatchObject({ kind: "win", inboxItemId: won!.id, simulated: true, offersAnswer: false });
    // The person's three a day are used up: the brief still goes out.
    await g.deps.rateLimits.hit(notifyPersonDayKey(p.userId), 86_400_000, Date.now());
    await g.deps.rateLimits.hit(notifyPersonDayKey(p.userId), 86_400_000, Date.now());
    await g.deps.rateLimits.hit(notifyPersonDayKey(p.userId), 86_400_000, Date.now());
    // The brief's news is a real outcome (item 10): the Customer Update note alone is not one, the vendor's payment is.
    await g.h.db.insert(s.events).values({ businessId: g.businessId, type: "payment.received", occurredAt: new Date(Date.now() - HOURS), actor: { kind: "webhook", id: "stripe" }, payload: { conversionId: crypto.randomUUID(), amount: { amountMinor: 1_900, currency: "USD" }, firstPayment: true } });
    const day = new Date().toISOString().slice(0, 10);
    const brief = await ask({ userId: p.userId, kind: "daily_brief", businessId: g.businessId, data: { day } });
    expect(brief.body, JSON.stringify(brief.body)).toMatchObject({ sent: true });
    // Once per day.
    expect((await ask({ userId: p.userId, kind: "daily_brief", businessId: g.businessId, data: { day } })).body).toMatchObject({ sent: false, reason: "already_sent" });
    // A kind without the id it needs is refused before anything is read.
    expect((await ask({ userId: p.userId, kind: "run_finished", businessId: g.businessId, data: { day } })).status).toBe(400);
    const { rows } = await g.h.pg.query<{ kind: string; status: string; body_text: string }>("select kind, status, body_text from founder_notifications where user_id = $1 order by kind", [p.userId]);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([["daily_brief", "sent"], ["win", "sent"]]);
    for (const r of rows) expect(r.body_text).not.toMatch(/\/email\/pause\?t=|\/a\/[A-Za-z0-9_-]{20,}/);
  });

  it("only the api and the orchestrator may ask, and a body with anything but ids is refused", async () => {
    const p = await person();
    expect((await ask(about(p), "composer")).status).toBe(403);
    expect((await ask(about(p), null)).status).toBe(401);
    // An address, or words, from the caller are never taken.
    expect((await ask({ ...about(p), email: "attacker@example.com" })).status).toBe(400);
    expect((await ask({ ...about(p), data: { inboxItemId: p.itemId, subject: "Click here" } })).status).toBe(400);
    expect((await ask({ ...about(p), kind: "weekly_summary" })).status).toBe(400);
    expect(sentTo(p.email)).toHaveLength(0);
  });

  it("the morning brief is four sections; What worked lists real outcomes only, and a brief turned off is never sent", async () => {
    await g.h.pg.query("update businesses set committed_at = coalesce(committed_at, $1) where id = $2", [new Date(Date.now() - 48 * HOURS).toISOString(), g.businessId]);
    const p = await person();
    const off = await person();
    await repos.preferences.update(g.db, off.userId, { email: { daily_brief: false } });
    const at = new Date(Date.now() - 2 * HOURS);
    const agent = { kind: "agent", id: g.agentId };
    const stripe = { kind: "webhook", id: "stripe" };
    const simulate = { kind: "system", id: "simulate" };
    const ref = () => crypto.randomUUID();
    await g.h.db.insert(s.events).values([
      { businessId: g.businessId, type: "mail.sent", occurredAt: at, actor: agent, payload: { messageRef: ref(), agentId: g.agentId, channelKey: "email_automation", simulated: false } },
      ...[1, 2, 3].map(() => ({ businessId: g.businessId, type: "mail.sent", occurredAt: at, actor: agent, payload: { messageRef: ref(), agentId: g.agentId, channelKey: "email_automation", simulated: true } })),
      { businessId: g.businessId, type: "payment.received", occurredAt: at, actor: simulate, payload: { conversionId: ref(), amount: { amountMinor: 77_700, currency: "USD" }, firstPayment: true } },
      { businessId: g.businessId, type: "payment.received", occurredAt: at, actor: stripe, payload: { conversionId: ref(), amount: { amountMinor: 4_900, currency: "USD" }, firstPayment: true } },
    ]);
    const day = new Date().toISOString().slice(0, 10);
    expect((await ask({ userId: p.userId, kind: "daily_brief", businessId: g.businessId, data: { day } })).body).toMatchObject({ sent: true });
    const [sent] = sentTo(p.email);
    // The earlier test's real payment is in the window too: two real payments, never the simulated third.
    expect(sent!.subject).toBe("Gateway Test Club: 2 payments came in");
    const text = sent!.text;
    const order = ["WHAT WORKED", "WAITING ON YOU", "WHAT'S NEXT"].map((h) => text.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("A new customer paid $49.00");
    expect(text).toMatch(/- 1 email went out from your project's address/);
    // The simulated payment and the three simulated emails are nowhere.
    expect(text).not.toContain("777");
    expect(text).not.toMatch(/[2-9] emails went out/);
    // Off in the person's preferences: never sent, recorded as such.
    expect((await ask({ userId: off.userId, kind: "daily_brief", businessId: g.businessId, data: { day } })).body.reason).toBe("turned_off");
    expect(sentTo(off.email)).toHaveLength(0);
  });

  it("a follow a shared post brought says which post in What worked; one it did not keeps its own cause; the CRM wall hides both", async () => {
    const p = await person();
    const walled = await person({ role: "member", sectionPermissions: { crm: "none" } });
    const at = new Date(Date.now() - 2 * HOURS);
    const followedBy = { kind: "system", id: "public-page" };
    const [credited, plain] = await g.h.db
      .insert(s.events)
      .values([1, 2].map((i) => ({ businessId: g.businessId, type: "page.followed", occurredAt: at, actor: followedBy, payload: { pageId: null, entityId: crypto.randomUUID(), consentId: crypto.randomUUID(), i } })))
      .returning({ id: s.events.id });
    // The first follow was credited to a team post shared on X (item 8); the second came straight to the page.
    const [asset] = await g.h.db.insert(s.assets).values({ businessId: g.businessId, kind: "post", title: "A post", body: "Gateway Test Club has a page now." }).returning();
    const links = await repos.postLinks.mint(g.db, g.businessId, asset!.id);
    const x = links.find((l) => l.network === "x")!;
    await g.h.db.insert(s.postAttributions).values({ businessId: g.businessId, linkId: x.id, assetId: asset!.id, network: "x", outcomeKind: "follow", outcomeEventId: credited!.id, originId: crypto.randomUUID(), outcomeAt: at });
    expect(plain).toBeTruthy();
    const day = new Date().toISOString().slice(0, 10);
    expect((await ask({ userId: p.userId, kind: "daily_brief", businessId: g.businessId, data: { day } })).body).toMatchObject({ sent: true });
    const text = sentTo(p.email)[0]!.text;
    const credit = text.split("\n").filter((l) => l.includes("A person chose to follow your project"));
    expect(credit).toHaveLength(2);
    expect(credit.filter((l) => /from your post on X, [A-Z][a-z]{2} \d{1,2}\b/.test(l))).toHaveLength(1);
    expect(credit.filter((l) => l.includes("they signed up on your public page and confirmed by email"))).toHaveLength(1);
    // A member walled from Customers sees neither follow, and so no post either.
    await ask({ userId: walled.userId, kind: "daily_brief", businessId: g.businessId, data: { day } });
    for (const m of sentTo(walled.email)) expect(m.text).not.toMatch(/chose to follow|from your post/);
  });
});
