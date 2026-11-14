/**
 * services/push/email-pass.ts: who Foundmill emails about a note that waits for their answer (packages 1.5 and 5.1). A
 * note that needs an answer, 24 hours to 7 days old, or 30 minutes after the person left when it holds up the team's
 * work (founder 2026-11-12), unopened by the person; a member who can read the Inbox,
 * not an example visitor, in a business that is not a sample; their switch on; never twice about one note, at most one a
 * day per business and three a day in all (the briefs not counted). The api sends ids only; a gateway that sends nothing right now ends the pass.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { businesses, inboxItems, memberships, notifyEmailDayKey, repos } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GatewayNotifyEmailRequest, GatewayNotifyEmailResult } from "../services/gateway";
import { notifyEmailEnabled, runNotifyEmailPass } from "../services/push/email-pass";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const NOW = new Date("2026-11-11T15:00:00.000Z");
const HOURS = 3_600_000;
let asked: GatewayNotifyEmailRequest[] = [];
let answer: (input: GatewayNotifyEmailRequest) => Promise<GatewayNotifyEmailResult>;

/** What the real gateway records after a send: one event per person and UTC day within the business. */
async function recordSent(request: GatewayNotifyEmailRequest, at = NOW): Promise<GatewayNotifyEmailResult> {
  if (request.kind === "founder_notice") return { sent: false, reason: "not_founder", message: "" };
  const input = request;
  const event = await repos.events.write(hz.db, input.businessId, { type: "notify.email_sent", actor: { kind: "system", id: "notify-email" }, entityIds: [], occurredAt: at, payload: { kind: input.kind, userId: input.userId, inboxItemId: input.data.inboxItemId, messageId: "m", simulated: true, notificationId: randomUUID(), offersAnswer: false }, idempotencyKey: notifyEmailDayKey(input.kind, input.userId, at) });
  return { sent: true, simulated: true, eventId: event.id };
}

const pass = () => runNotifyEmailPass({ db: hz.db, log: hz.deps.log, gateway: { ...hz.deps.gateway, notifyEmail: async (input) => (asked.push(input), answer(input)) } }, NOW);

async function note(businessId: string, over: Partial<typeof inboxItems.$inferInsert> = {}): Promise<string> {
  const [row] = await hz.db.insert(inboxItems).values({ businessId, type: "decision", subject: "Which price for the first plan?", createdAt: new Date(NOW.getTime() - 30 * HOURS), ...over }).returning({ id: inboxItems.id });
  return row!.id;
}
const clearNotes = async () => {
  await hz.db.delete(inboxItems).where(eq(inboxItems.businessId, hz.A.businessId));
  await hz.db.delete(inboxItems).where(eq(inboxItems.businessId, hz.B.businessId));
};

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "notify-email-pass" });
}, 120_000);
afterAll(() => hz.close());
beforeEach(async () => {
  asked = [];
  answer = (input) => recordSent(input);
  await clearNotes();
  // Each case starts on a day with nothing sent yet.
  await hz.h.pg.query("delete from outbox where event_id in (select id from events where type = 'notify.email_sent')");
  await hz.h.pg.query("delete from events where type = 'notify.email_sent'");
});

describe("the notify email pass", () => {
  it("asks for every member who can read the Inbox and has not opened the note, with ids only", async () => {
    const id = await note(hz.A.businessId);
    await repos.inbox.markRead(hz.db, hz.A.businessId, id, hz.A.ownerId);
    await hz.db.update(memberships).set({ sectionPermissions: { inbox: "none" } }).where(eq(memberships.userId, hz.A.memberId));
    await repos.preferences.update(hz.db, hz.A.adminId, { email: { decision_waiting: false } });
    try {
      const r = await pass();
      expect(asked).toEqual([{ userId: hz.A.viewerId, kind: "decision_waiting", businessId: hz.A.businessId, data: { inboxItemId: id } }]);
      expect(r.sent).toBe(1);
      // Never about the same note twice, nor a second note of the same business the same day.
      const older = await note(hz.A.businessId, { createdAt: new Date(NOW.getTime() - 40 * HOURS), subject: "Older one" });
      asked = [];
      await pass();
      // The owner, who opened the first note, has not opened this one; the viewer had today's email for A already.
      expect(asked).toEqual([{ userId: hz.A.ownerId, kind: "decision_waiting", businessId: hz.A.businessId, data: { inboxItemId: older } }]);
      asked = [];
      await pass();
      expect(asked).toEqual([]);
    } finally {
      await hz.db.update(memberships).set({ sectionPermissions: {} }).where(eq(memberships.userId, hz.A.memberId));
      await repos.preferences.update(hz.db, hz.A.adminId, { email: { decision_waiting: true } });
    }
  });

  it("only notes that ask for an answer, a day to a week old", async () => {
    await note(hz.B.businessId, { type: "update", subject: "Shipped" });
    await note(hz.B.businessId, { createdAt: new Date(NOW.getTime() - 3 * HOURS) });
    await note(hz.B.businessId, { createdAt: new Date(NOW.getTime() - 9 * 24 * HOURS) });
    await note(hz.B.businessId, { state: "answered" });
    await pass();
    expect(asked).toEqual([]);
    const hardStop = await note(hz.B.businessId, { type: "warning", blocksContinue: true, subject: "Credits are used up" });
    await pass();
    expect(asked.filter((a) => a.userId === hz.B.ownerId).map((a) => a.data.inboxItemId)).toEqual([hardStop]);
  });

  it("never about a sample business, and never to an example visitor", async () => {
    const visitor = await hz.h.createUser("visitor-notify@test.local");
    await hz.db.insert(memberships).values({ businessId: hz.A.businessId, userId: visitor, role: "viewer", source: "example" });
    await note(hz.A.businessId, { createdAt: new Date(NOW.getTime() - 50 * HOURS) });
    await pass();
    expect(asked.map((a) => a.userId)).not.toContain(visitor);
    asked = [];
    await clearNotes();
    await hz.db.update(businesses).set({ isDemo: true }).where(eq(businesses.id, hz.B.businessId));
    try {
      await note(hz.B.businessId, { createdAt: new Date(NOW.getTime() - 50 * HOURS) });
      await pass();
      expect(asked).toEqual([]);
    } finally {
      await hz.db.update(businesses).set({ isDemo: false }).where(eq(businesses.id, hz.B.businessId));
    }
  });

  it("at most three a day per person across businesses", async () => {
    const person = hz.B.adminId;
    // Three already sent today, about other businesses the person belongs to.
    const others: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const b = await repos.businesses.create(hz.db, { name: `Other ${i}` });
      await hz.db.insert(memberships).values({ businessId: b.id, userId: person, role: "owner" });
      others.push(b.id);
      await recordSent({ userId: person, kind: "decision_waiting", businessId: b.id, data: { inboxItemId: await note(b.id) } });
    }
    await note(hz.B.businessId, { createdAt: new Date(NOW.getTime() - 50 * HOURS) });
    await pass();
    expect(asked.map((a) => a.userId)).not.toContain(person);
    expect(asked.map((a) => a.userId)).toContain(hz.B.ownerId);
  });

  it("a note that holds up the team's work, 30 minutes after the person left; never while they are here", async () => {
    const held = await note(hz.B.businessId, { blocksContinue: true, createdAt: new Date(NOW.getTime() - 45 * 60_000), subject: "Approve the launch post?" });
    await repos.presence.ping(hz.db, hz.B.businessId, hz.B.adminId, { now: new Date(NOW.getTime() - 10 * 60_000) });
    await pass();
    const about = asked.filter((a) => a.data.inboxItemId === held).map((a) => a.userId);
    expect(about).toContain(hz.B.ownerId);
    expect(about).not.toContain(hz.B.adminId);
    // A note that holds nothing up waits the day.
    asked = [];
    await clearNotes();
    await note(hz.B.businessId, { createdAt: new Date(NOW.getTime() - 45 * 60_000) });
    await pass();
    expect(asked).toEqual([]);
  });

  it("the morning brief and the weekly review count toward no limit", async () => {
    const person = hz.B.ownerId;
    for (const kind of ["daily_brief", "weekly_review", "daily_brief"] as const) {
      const b = await repos.businesses.create(hz.db, { name: `Brief ${kind} ${randomUUID().slice(0, 4)}` });
      await hz.db.insert(memberships).values({ businessId: b.id, userId: person, role: "owner" });
      await recordSent({ userId: person, kind, businessId: b.id, data: {} as { inboxItemId: string } });
    }
    await note(hz.B.businessId, { createdAt: new Date(NOW.getTime() - 50 * HOURS) });
    await pass();
    expect(asked.map((a) => a.userId)).toContain(person);
  });

  it("stops when the gateway says nothing can go out now, and moves on after a per-person refusal", async () => {
    await note(hz.A.businessId);
    answer = async () => ({ sent: false, reason: "off", message: "Email from Foundmill is not switched on here, so nothing was sent." });
    const r = await pass();
    expect(asked).toHaveLength(1);
    expect(r).toMatchObject({ sent: 0, stopped: true, notSent: { off: 1 } });
    asked = [];
    answer = async () => ({ sent: false, reason: "not_waiting", message: "x" });
    const r2 = await pass();
    expect(asked.length).toBeGreaterThan(1);
    expect(r2.stopped).toBe(false);
    asked = [];
    answer = async () => {
      throw new Error("gateway down");
    };
    expect((await pass()).failed).toBe(1);
    expect(asked).toHaveLength(1);
  });

  it("is on only where platform mail is configured, and NOTIFY_EMAIL=off turns it off", () => {
    expect(notifyEmailEnabled({ NOTIFY_EMAIL: "on", PLATFORM_MAIL_DOMAIN: undefined })).toBe(false);
    expect(notifyEmailEnabled({ NOTIFY_EMAIL: "on", PLATFORM_MAIL_DOMAIN: "mail.foundmill.test" })).toBe(true);
    expect(notifyEmailEnabled({ NOTIFY_EMAIL: "off", PLATFORM_MAIL_DOMAIN: "mail.foundmill.test" })).toBe(false);
  });
});
