/**
 * 0083 — the return loop's tables: founder_presence and founder_visit_days (one person's rows in one business, written
 * by that person through the presence ping) and founder_notifications (written by the notifier with the service role,
 * readable only by the founder it went to, without the email's HTML or the answer token's hash).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { presenceRepo } from "../../repos/presence";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "ret-a");
  B = await createBusinessFixture(h, "ret-b");
});
afterAll(() => h?.close());

const now = new Date("2026-11-10T15:00:00Z");

describe("founder_presence and founder_visit_days", () => {
  it("a member pings their own presence and reads only their own rows", async () => {
    await h.asUser(A.ownerId).run((tx) => presenceRepo.ping(tx, A.businessId, A.ownerId, { now }));
    await h.asUser(A.memberId).run((tx) => presenceRepo.ping(tx, A.businessId, A.memberId, { now }));
    const mine = await h.asUser(A.ownerId).run((tx) => tx.select().from(s.founderPresence));
    expect(mine.map((r) => r.userId)).toEqual([A.ownerId]);
    const days = await h.asUser(A.memberId).run((tx) => tx.select().from(s.founderVisitDays));
    expect(days.map((r) => r.userId)).toEqual([A.memberId]);
  });

  it("nobody writes presence for someone else, or in a business they do not belong to", async () => {
    await expect(h.asUser(A.memberId).run((tx) => tx.insert(s.founderPresence).values({ userId: A.ownerId, businessId: A.businessId, lastSeenAt: now, sessionStartedAt: now }))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(B.ownerId).run((tx) => presenceRepo.ping(tx, A.businessId, B.ownerId, { now }))).rejects.toThrow(RLS_DENIED);
    const moved = await h.asUser(A.memberId).run((tx) => tx.update(s.founderPresence).set({ lastSeenAt: new Date() }).where(eq(s.founderPresence.userId, A.ownerId)).returning());
    expect(moved).toHaveLength(0);
    // A business's owner does not see a member's days either: presence is the person's own.
    expect(await h.asUser(B.ownerId).run((tx) => tx.select().from(s.founderVisitDays).where(eq(s.founderVisitDays.businessId, A.businessId)))).toHaveLength(0);
    // No delete grant.
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.founderPresence).where(eq(s.founderPresence.userId, A.ownerId)))).rejects.toThrow(/permission denied/);
  });

  it("signed-out visitors read nothing", async () => {
    await expect(h.anon().run((tx) => tx.select().from(s.founderPresence))).rejects.toThrow(/permission denied/);
    await expect(h.anon().run((tx) => tx.select().from(s.founderVisitDays))).rejects.toThrow(/permission denied/);
  });
});

describe("founder_notifications", () => {
  const cols = { id: s.founderNotifications.id, userId: s.founderNotifications.userId, subject: s.founderNotifications.subject };

  it("only the founder it went to reads it, and never its HTML or token hash", async () => {
    await h.service().run((tx) =>
      tx.insert(s.founderNotifications).values([
        { userId: A.ownerId, businessId: A.businessId, kind: "daily_brief", dedupeKey: "brief:a", subject: "Your morning brief" },
        { userId: B.ownerId, businessId: B.businessId, kind: "win", dedupeKey: "win:b", subject: "A customer was won", actionItemId: B.inboxItemId, actionOptionId: "a", actionTokenHash: "f".repeat(64), actionExpiresAt: now },
      ]),
    );
    expect((await h.asUser(A.ownerId).run((tx) => tx.select(cols).from(s.founderNotifications))).map((r) => r.subject)).toEqual(["Your morning brief"]);
    expect(await h.asUser(A.memberId).run((tx) => tx.select(cols).from(s.founderNotifications))).toHaveLength(0);
    expect(await h.asUser(A.ownerId).run((tx) => tx.select(cols).from(s.founderNotifications).where(eq(s.founderNotifications.userId, B.ownerId)))).toHaveLength(0);
    await expect(h.asUser(B.ownerId).run((tx) => tx.select({ hash: s.founderNotifications.actionTokenHash }).from(s.founderNotifications))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).run((tx) => tx.select({ html: s.founderNotifications.bodyHtml }).from(s.founderNotifications))).rejects.toThrow(/permission denied/);
  });

  it("app roles write nothing: notifications come from the service", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.founderNotifications).values({ userId: A.ownerId, businessId: A.businessId, kind: "win", dedupeKey: "spoof" }))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.founderNotifications).set({ subject: "x" }).where(eq(s.founderNotifications.userId, A.ownerId)))).rejects.toThrow(/permission denied/);
  });
});
