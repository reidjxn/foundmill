/**
 * Double booking, on real connections (0157; founder, Nov 22, 2026: "the one bug that must never ship"). This file
 * sits with the tenancy suites so CI's "Real Postgres" job runs it, where the harness holds a pool of connections and
 * the holds below really arrive at the same time. On PGlite (one connection) they run one after another and the same
 * assertions hold: `bookings_no_overlap` decides either way, never a read before the write.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import type { BookingService } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let lesson: BookingService;
const NOW = new Date("2026-12-01T12:00:00Z");
const VISITORS = 8;
const ROUNDS = 15;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "book-race");
  const setup = await repos.booking.saveSetup(h.db, A.businessId, { timeZone: "America/New_York", weeklyHours: { "1": [{ start: 540, end: 1020 }] }, currency: "USD", services: [{ name: "Math tutoring", durationMin: 60, bufferAfterMin: 15 }] });
  lesson = setup.services[0]!;
}, 120_000);
afterAll(async () => h.close());

describe("many visitors press the same time at once", () => {
  it(`gives the slot to exactly one of ${VISITORS}, ${ROUNDS} times over, and only that one can confirm`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const start = new Date(Date.parse("2027-04-01T14:00:00Z") + round * 86_400_000);
      const tokens = Array.from({ length: VISITORS }, () => `race-${randomUUID()}`);
      // Half ask for the same start; the rest for starts that overlap it by a few minutes on either side.
      const starts = tokens.map((_, i) => new Date(start.getTime() + (i % 2 === 0 ? 0 : (i - 4) * 10 * 60_000)));
      const held = await Promise.all(tokens.map((holdTokenHash, i) => repos.booking.hold(h.db, A.businessId, { service: lesson, start: starts[i]!, holdTokenHash, test: false, now: NOW })));
      const winners = held.filter((b) => b !== null);
      expect(winners, `round ${round}`).toHaveLength(1);

      // Everyone tries to confirm with their own token at once: only the holder's works.
      const confirmed = await Promise.all(tokens.map((holdTokenHash) => repos.booking.confirm(h.db, A.businessId, { holdTokenHash, customerName: "Ada Lovelace", customerEmail: "ada@example.test", answers: [], consentText: "I agree.", visitorTimeZone: null, entityId: null, now: NOW })));
      expect(confirmed.filter((b) => b !== null), `round ${round}`).toHaveLength(1);

      const from = new Date(start.getTime() - 3 * 3_600_000);
      const to = new Date(start.getTime() + 3 * 3_600_000);
      const rows = (await h.db.select().from(s.bookings).where(and(eq(s.bookings.businessId, A.businessId), inArray(s.bookings.status, ["held", "confirmed"])))).filter((b) => b.startsAt >= from && b.startsAt <= to);
      expect(rows.map((b) => b.status), `round ${round}`).toEqual(["confirmed"]);
    }
  });

  it("two customers moving their bookings onto the same free time at once: one moves, the other stays where it was", async () => {
    const book = async (start: Date) => {
      const holdTokenHash = `move-${randomUUID()}`;
      await repos.booking.hold(h.db, A.businessId, { service: lesson, start, holdTokenHash, test: false, now: NOW });
      return (await repos.booking.confirm(h.db, A.businessId, { holdTokenHash, customerName: "Ada Lovelace", customerEmail: "ada@example.test", answers: [], consentText: "I agree.", visitorTimeZone: null, entityId: null, now: NOW }))!;
    };
    const first = await book(new Date("2027-06-01T14:00:00Z"));
    const second = await book(new Date("2027-06-01T17:00:00Z"));
    const target = new Date("2027-06-02T14:00:00Z");
    const moved = await Promise.all([first, second].map((b) => repos.booking.reschedule(h.db, A.businessId, b.id, { service: lesson, start: target, now: NOW })));
    expect(moved.filter((b) => b !== null)).toHaveLength(1);
    const after = await Promise.all([first, second].map((b) => repos.booking.get(h.db, A.businessId, b.id)));
    expect(after.map((b) => b!.startsAt.toISOString()).sort()).toHaveLength(2);
    expect(after.filter((b) => b!.startsAt.getTime() === target.getTime())).toHaveLength(1);
  });
});
