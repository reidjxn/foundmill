/**
 * What Foundmill's own email to a person reads (packages 1.5 and 5.1): the notes that wait a day for someone's answer,
 * per person (their own receipt), never in a sample business or for an example visitor; what was sent already (the
 * `notify.email_sent` events, one a day per person within a business); the person's address from auth.users on the
 * service connection only; and the `email` channel of the notification preferences.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifyEmailDayKey, repos, utcDayStart } from "../../repos";
import * as s from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
const NOW = new Date("2026-11-11T15:00:00.000Z");
const HOURS = 3_600_000;
const olderThan = new Date(NOW.getTime() - 24 * HOURS);
const since = new Date(NOW.getTime() - 7 * 24 * HOURS);

beforeAll(async () => {
  r = await setupRepoHarness("notify-email");
}, 120_000);
afterAll(() => r?.close());

async function item(businessId: string, over: Partial<typeof s.inboxItems.$inferInsert> = {}): Promise<string> {
  const [row] = await r.h.db
    .insert(s.inboxItems)
    .values({ businessId, type: "decision", subject: "Which price for the first plan?", createdAt: new Date(NOW.getTime() - 30 * HOURS), ...over })
    .returning({ id: s.inboxItems.id });
  return row!.id;
}

const waitingFor = async (ids: string[]) => (await repos.notifyEmail.waitingAnswers(r.db, { olderThan, since })).filter((w) => ids.includes(w.inboxItemId));

describe("notes that wait for someone's answer", () => {
  it("every member without a receipt, for a decision or a hard stop older than a day and younger than a week", async () => {
    const decision = await item(r.A.businessId);
    const hardStop = await item(r.A.businessId, { type: "warning", blocksContinue: true, subject: "Credits are used up" });
    const choice = await item(r.A.businessId, { type: "warning", decision: { options: [] }, subject: "Pick one" });
    const fresh = await item(r.A.businessId, { createdAt: new Date(NOW.getTime() - 2 * HOURS) });
    const stale = await item(r.A.businessId, { createdAt: new Date(NOW.getTime() - 8 * 24 * HOURS) });
    const update = await item(r.A.businessId, { type: "update", subject: "Shipped" });
    const answered = await item(r.A.businessId, { state: "answered" });
    const archived = await item(r.A.businessId, { state: "archived", archivedAt: NOW });
    const found = await waitingFor([decision, hardStop, choice, fresh, stale, update, answered, archived]);
    expect(new Set(found.map((w) => w.inboxItemId))).toEqual(new Set([decision, hardStop, choice]));
    // Each of the four members of A, with the membership the walls are read from.
    expect(new Set(found.filter((w) => w.inboxItemId === decision).map((w) => w.userId))).toEqual(new Set([r.A.ownerId, r.A.adminId, r.A.memberId, r.A.viewerId]));
    expect(found.find((w) => w.userId === r.A.viewerId)?.membership.role).toBe("viewer");
    expect(found.every((w) => w.businessId === r.A.businessId)).toBe(true);
  });

  it("a person who opened the note on any device is left out; the others still wait", async () => {
    const id = await item(r.A.businessId);
    await repos.inbox.markRead(r.db, r.A.businessId, id, r.A.ownerId);
    const found = await waitingFor([id]);
    expect(found.map((w) => w.userId)).not.toContain(r.A.ownerId);
    expect(found.map((w) => w.userId)).toContain(r.A.adminId);
    expect(await repos.notifyEmail.stillWaiting(r.db, r.A.businessId, id, r.A.ownerId)).toBeNull();
    expect(await repos.notifyEmail.stillWaiting(r.db, r.A.businessId, id, r.A.adminId)).toMatchObject({ id, blocksContinue: false });
    // Another business's id never answers for this one.
    expect(await repos.notifyEmail.stillWaiting(r.db, r.B.businessId, id, r.A.adminId)).toBeNull();
  });

  it("never a sample business, an archived one, or an example visitor", async () => {
    const visitor = await r.h.createUser("visitor@test.local");
    await r.h.db.insert(s.memberships).values({ businessId: r.B.businessId, userId: visitor, role: "viewer", source: "example" });
    const inB = await item(r.B.businessId);
    expect((await waitingFor([inB])).map((w) => w.userId)).not.toContain(visitor);
    await r.h.db.update(s.businesses).set({ isDemo: true }).where(eq(s.businesses.id, r.B.businessId));
    expect(await waitingFor([inB])).toEqual([]);
    await r.h.db.update(s.businesses).set({ isDemo: false, archivedAt: NOW }).where(eq(s.businesses.id, r.B.businessId));
    expect(await waitingFor([inB])).toEqual([]);
    await r.h.db.update(s.businesses).set({ archivedAt: null }).where(eq(s.businesses.id, r.B.businessId));
  });
});

describe("what was sent already", () => {
  it("one event a day per person within a business; counted per business, and per note", async () => {
    const id = await item(r.A.businessId);
    const write = (businessId: string, at: Date, itemId = id) =>
      repos.events.write(r.db, businessId, { type: "notify.email_sent", actor: { kind: "system", id: "notify-email" }, entityIds: [], occurredAt: at, payload: { kind: "decision_waiting", userId: r.A.ownerId, inboxItemId: itemId, messageId: "m", simulated: true }, idempotencyKey: notifyEmailDayKey("decision_waiting", r.A.ownerId, at) });
    const first = await write(r.A.businessId, NOW);
    // The same day again is the same event: a second email that day cannot be recorded.
    expect((await write(r.A.businessId, new Date(NOW.getTime() + HOURS))).id).toBe(first.id);
    await write(r.B.businessId, NOW, await item(r.B.businessId));
    const counts = await repos.notifyEmail.sentSince(r.db, r.A.ownerId, [r.A.businessId, r.B.businessId], utcDayStart(NOW));
    expect([counts.get(r.A.businessId), counts.get(r.B.businessId)]).toEqual([1, 1]);
    expect((await repos.notifyEmail.sentSince(r.db, r.A.adminId, [r.A.businessId], utcDayStart(NOW))).size).toBe(0);
    expect(await repos.notifyEmail.emailedItems(r.db, r.A.businessId, r.A.ownerId, [id, r.A.inboxItemId])).toEqual(new Set([id]));
    // Business B's events never answer for A.
    expect((await repos.notifyEmail.emailedItems(r.db, r.B.businessId, r.A.ownerId, [id])).size).toBe(0);
    expect(notifyEmailDayKey("decision_waiting", r.A.ownerId, NOW)).toBe(`notify.email:decision_waiting:${r.A.ownerId}:2026-11-11`);
  });
});

describe("the person's address and their email switch", () => {
  it("the address comes from auth.users on the service connection, and no signed-in role can read it", async () => {
    const id = await r.h.createUser("Maya@Example.com");
    expect(await r.svc((tx) => repos.founders.emailOf(tx, id))).toBe("maya@example.com");
    expect(await repos.founders.emailOf(r.db, "00000000-0000-4000-8000-00000000abcd")).toBeNull();
    await expect(r.as(id, (tx) => repos.founders.emailOf(tx, id))).rejects.toThrow(/permission denied/);
  });

  it("email kinds are on until turned off, live beside the push kinds, and neither change clears the other", async () => {
    const id = await r.h.createUser("prefs-email@test.local");
    expect((await r.as(id, (tx) => repos.preferences.get(tx, id))).email).toEqual({ decision_waiting: true });
    let p = await r.as(id, (tx) => repos.preferences.update(tx, id, { email: { decision_waiting: false } }));
    expect(p.email).toEqual({ decision_waiting: false });
    expect(p.notifications.decision).toBe(true);
    p = await r.as(id, (tx) => repos.preferences.update(tx, id, { notifications: { customer: false } }));
    expect([p.email.decision_waiting, p.notifications.customer]).toEqual([false, false]);
    p = await r.as(id, (tx) => repos.preferences.update(tx, id, { email: { decision_waiting: true }, notifications: { goal: false } }));
    expect([p.email.decision_waiting, p.notifications.customer, p.notifications.goal]).toEqual([true, false, false]);
    const [stored] = await r.h.db.select({ n: s.accountPreferences.notifications }).from(s.accountPreferences).where(eq(s.accountPreferences.userId, id));
    expect(stored!.n).toEqual({ customer: false, goal: false, email: { decision_waiting: true } });
    // Another account cannot change it (the table's own policy, RLS).
    const other = await r.h.createUser("prefs-other@test.local");
    await r.as(other, (tx) => repos.preferences.update(tx, other, { email: { decision_waiting: false } }));
    expect((await r.as(id, (tx) => repos.preferences.get(tx, id))).email.decision_waiting).toBe(true);
    await expect(repos.preferences.update(r.db, id, { email: {} })).rejects.toThrow();
    await expect(repos.preferences.update(r.db, id, { email: { weekly_summary: false } as never })).rejects.toThrow();
  });
});
