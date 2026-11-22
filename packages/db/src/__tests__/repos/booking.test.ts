/**
 * Booking (0157; founder, Nov 22, 2026): the setup and its services, the public read, and the bookings themselves.
 * Double booking must be impossible: two visitors racing for one slot get exactly one hold, whatever the starts, because
 * `bookings_no_overlap` decides, never a read before the write. A hold that ran out frees its slot, a canceled booking
 * frees it at once, and one business's bookings never touch another's.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { busyRangeOf, BOOKING_HOLD_MINUTES } from "@foundmill/shared/booking";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbTx } from "../../client";
import { repos, sqlState } from "../../repos";
import * as s from "../../schema";
import type { BookingService } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "../rls/fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let C: BusinessFixture;
let P: BusinessFixture;
/** A's services: an hour with 15 minutes after it, and half an hour with no buffers. */
let lesson: BookingService;
let short: BookingService;
let bLesson: BookingService;
let cLesson: BookingService;

const NOW = new Date("2026-12-01T12:00:00Z");
const HOURS = { "1": [{ start: 540, end: 1020 }], "2": [{ start: 540, end: 1020 }] };
const at = (iso: string) => new Date(iso);
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);
const token = () => `hold-${randomUUID()}`;
/** Runs as the service connection, the way the api and the gateway call these repos. */
const svc = <T>(fn: (tx: DbTx) => Promise<T>) => h.service().run(fn);
const setupInput = (services: { id?: string; name: string; durationMin: number; bufferBeforeMin?: number; bufferAfterMin?: number }[]) => ({ timeZone: "America/New_York", weeklyHours: HOURS, currency: "USD", services });
const hold = (service: BookingService, businessId: string, start: Date, now = NOW) => repos.booking.hold(h.db, businessId, { service, start, holdTokenHash: token(), test: false, now });
const customer = (holdTokenHash: string, now = NOW) => ({ holdTokenHash, customerName: "Ada Lovelace", customerEmail: "ada@example.test", answers: [{ question: "What would you like to learn?", answer: "Algebra." }], consentText: "I agree to be contacted about this booking.", visitorTimeZone: "Europe/London", entityId: null, now });
/** Hold and confirm in one step: a confirmed booking at `start`. */
async function book(service: BookingService, businessId: string, start: Date) {
  const holdTokenHash = token();
  const held = await repos.booking.hold(h.db, businessId, { service, start, holdTokenHash, test: false, now: NOW });
  if (!held) throw new Error("book: the slot was taken");
  const confirmed = await repos.booking.confirm(h.db, businessId, customer(holdTokenHash));
  if (!confirmed) throw new Error("book: the hold did not confirm");
  return confirmed;
}
/** The rows of a business that keep their slot and overlap [from, to). */
const holdingRows = async (businessId: string, from: Date, to: Date) =>
  h.db
    .select({ id: s.bookings.id })
    .from(s.bookings)
    .where(and(eq(s.bookings.businessId, businessId), sql`${s.bookings.status} in ('held', 'confirmed')`, sql`${s.bookings.busy} && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`));

beforeAll(async () => {
  h = await createTestDb();
  [A, B, C, P] = [await createBusinessFixture(h, "book-a"), await createBusinessFixture(h, "book-b"), await createBusinessFixture(h, "book-c"), await createBusinessFixture(h, "book-p")];
  const services = setupInput([
    { name: "Lesson", durationMin: 60, bufferAfterMin: 15 },
    { name: "Short call", durationMin: 30 },
  ]).services;
  const a = await svc((tx) => repos.booking.saveSetup(tx, A.businessId, setupInput(services)));
  [lesson, short] = [a.services[0]!, a.services[1]!];
  bLesson = (await svc((tx) => repos.booking.saveSetup(tx, B.businessId, setupInput(services)))).services[0]!;
  cLesson = (await svc((tx) => repos.booking.saveSetup(tx, C.businessId, setupInput(services)))).services[0]!;
});
afterAll(() => h?.close());

describe("the setup", () => {
  it("is created as a draft with its services; saving again changes the named ones, adds the new ones and archives the ones left out", async () => {
    const first = await svc((tx) => repos.booking.saveSetup(tx, P.businessId, setupInput([{ name: "Tutoring", durationMin: 60 }, { name: "Trial lesson", durationMin: 30 }])));
    expect(first.settings).toMatchObject({ status: "draft", timeZone: "America/New_York", weeklyHours: HOURS, useCalendar: false, approvedAt: null });
    expect(first.services.map((x) => [x.name, x.position, x.currency])).toEqual([["Tutoring", 0, "USD"], ["Trial lesson", 1, "USD"]]);
    const [tutoring, trial] = first.services;

    const second = await svc((tx) => repos.booking.saveSetup(tx, P.businessId, setupInput([{ id: tutoring!.id, name: "Math tutoring", durationMin: 90 }, { name: "Exam prep", durationMin: 45 }])));
    expect(second.settings?.id).toBe(first.settings?.id);
    expect(second.settings?.status).toBe("draft");
    expect(second.services.map((x) => [x.name, x.durationMin])).toEqual([["Math tutoring", 90], ["Exam prep", 45]]);
    expect(second.services[0]!.id).toBe(tutoring!.id);
    const [archived] = await h.db.select().from(s.bookingServices).where(eq(s.bookingServices.id, trial!.id));
    expect(archived!.archivedAt).not.toBeNull();
  });

  it("refuses a service id that is not one of the project's", async () => {
    await expect(svc((tx) => repos.booking.saveSetup(tx, P.businessId, setupInput([{ id: lesson.id, name: "Stolen", durationMin: 60 }])))).rejects.toThrow(/not one of the project's/);
  });

  it("records who turned booking on and when, and turning it off keeps the record", async () => {
    const live = await svc((tx) => repos.booking.setLive(tx, P.businessId, true, P.ownerId, NOW));
    expect(live).toMatchObject({ status: "live", approvedBy: P.ownerId, approvedAt: NOW });
    const off = await svc((tx) => repos.booking.setLive(tx, P.businessId, false, P.ownerId, NOW));
    expect(off).toMatchObject({ status: "draft", approvedBy: P.ownerId });
    expect(await svc((tx) => repos.booking.setLive(tx, randomUUID(), true, P.ownerId, NOW))).toBeNull();
  });

  it("reads publicly only as a live setup on a published page", async () => {
    const slug = "book-p-tutoring";
    await h.db.update(s.businesses).set({ committedAt: at("2026-10-01T00:00:00Z") }).where(eq(s.businesses.id, P.businessId));
    // A draft setup on an unpublished page, then a live setup on an unpublished page: nothing.
    expect(await svc((tx) => repos.booking.publicPage(tx, slug))).toBeNull();
    await svc((tx) => repos.booking.setLive(tx, P.businessId, true, P.ownerId, NOW));
    expect(await svc((tx) => repos.booking.publicPage(tx, slug))).toBeNull();
    // A published page with a draft setup: nothing.
    await svc((tx) => repos.pages.publish(tx, P.businessId, { content: { pitch: "Math tutoring", about: "One to one.", forWhom: "", stage: "building", showFounders: false, followForm: false }, slug, userId: P.ownerId }));
    await svc((tx) => repos.booking.setLive(tx, P.businessId, false, P.ownerId, NOW));
    expect(await svc((tx) => repos.booking.publicPage(tx, slug))).toBeNull();
    // Live on a published page: the page and its services, never an archived one.
    await svc((tx) => repos.booking.setLive(tx, P.businessId, true, P.ownerId, NOW));
    const page = await svc((tx) => repos.booking.publicPage(tx, slug));
    expect(page).toMatchObject({ slug, businessId: P.businessId, name: "BOOK-P", timeZone: "America/New_York", weeklyHours: HOURS, useCalendar: false });
    expect(page!.services.map((x) => x.name)).toEqual(["Math tutoring", "Exam prep"]);
    expect(await svc((tx) => repos.booking.publicPage(tx, "no-such-page"))).toBeNull();
  });
});

describe("two visitors racing for one slot", () => {
  // Each round takes its own day, so rounds never collide with each other.
  const day = (round: number) => at(`2027-02-${String(1 + round).padStart(2, "0")}T14:00:00Z`);

  async function race(businessId: string, first: { service: BookingService; start: Date }, second: { service: BookingService; start: Date }) {
    const results = await Promise.all([hold(first.service, businessId, first.start), hold(second.service, businessId, second.start)]);
    return results.filter((r) => r !== null);
  }

  it("gives exactly one of them the hold, for the same start, overlapping starts, and starts that collide only through the buffers", async () => {
    for (let round = 0; round < 20; round++) {
      const start = day(round);
      // The same start.
      expect(await race(A.businessId, { service: lesson, start }, { service: lesson, start }), `round ${round}: same start`).toHaveLength(1);
      expect(await holdingRows(A.businessId, start, plus(start, 75)), `round ${round}: same start`).toHaveLength(1);

      // Overlapping starts, two hours later: 4:00 PM and 4:30 PM.
      const overlap = plus(start, 120);
      expect(await race(A.businessId, { service: lesson, start: overlap }, { service: short, start: plus(overlap, 30) }), `round ${round}: overlapping`).toHaveLength(1);
      expect(await holdingRows(A.businessId, overlap, plus(overlap, 75)), `round ${round}: overlapping`).toHaveLength(1);

      // Only the buffer collides: the lesson ends at 7:00 PM and keeps 15 minutes after it; the call starts at 7:10 PM.
      const buffered = plus(start, 240);
      expect(await race(A.businessId, { service: lesson, start: buffered }, { service: short, start: plus(buffered, 70) }), `round ${round}: buffer`).toHaveLength(1);
      expect(await holdingRows(A.businessId, buffered, plus(buffered, 100)), `round ${round}: buffer`).toHaveLength(1);
    }
  });

  it("lets two starts that only touch both be held", async () => {
    const start = at("2027-03-01T14:00:00Z");
    const results = await Promise.all([hold(short, A.businessId, start), hold(short, A.businessId, plus(start, 30))]);
    expect(results.every((r) => r !== null)).toBe(true);
  });
});

describe("a hold that ran out", () => {
  it("does not block the slot, and is gone once the next hold is taken", async () => {
    const start = at("2027-03-02T14:00:00Z");
    const old = await hold(lesson, A.businessId, start, NOW);
    expect(old).toMatchObject({ status: "held", holdExpiresAt: plus(NOW, BOOKING_HOLD_MINUTES) });
    expect(await hold(lesson, A.businessId, start, plus(NOW, 5))).toBeNull();
    const next = await hold(lesson, A.businessId, start, plus(NOW, 11));
    expect(next).not.toBeNull();
    expect(await h.db.select().from(s.bookings).where(eq(s.bookings.id, old!.id))).toHaveLength(0);
    expect(await holdingRows(A.businessId, start, plus(start, 75))).toEqual([{ id: next!.id }]);
  });
});

describe("confirming and canceling", () => {
  it("turns a running hold into a confirmed booking, with the customer and without the hold token", async () => {
    const start = at("2027-03-03T14:00:00Z");
    const holdTokenHash = token();
    await repos.booking.hold(h.db, A.businessId, { service: lesson, start, holdTokenHash, test: false, now: NOW });
    expect(await repos.booking.heldByToken(h.db, holdTokenHash, NOW)).not.toBeNull();
    const booked = await repos.booking.confirm(h.db, A.businessId, customer(holdTokenHash, plus(NOW, 2)));
    expect(booked).toMatchObject({ status: "confirmed", holdExpiresAt: null, holdTokenHash: null, customerName: "Ada Lovelace", customerEmail: "ada@example.test", visitorTimeZone: "Europe/London", confirmedAt: plus(NOW, 2) });
    expect(booked!.answers).toEqual([{ question: "What would you like to learn?", answer: "Algebra." }]);
    // The token is used up.
    expect(await repos.booking.confirm(h.db, A.businessId, customer(holdTokenHash))).toBeNull();
  });

  it("confirms nothing for a hold that ran out, an unknown token, or another business's hold", async () => {
    const start = at("2027-03-04T14:00:00Z");
    const holdTokenHash = token();
    await repos.booking.hold(h.db, A.businessId, { service: lesson, start, holdTokenHash, test: false, now: NOW });
    expect(await repos.booking.confirm(h.db, B.businessId, customer(holdTokenHash))).toBeNull();
    expect(await repos.booking.confirm(h.db, A.businessId, customer(holdTokenHash, plus(NOW, 11)))).toBeNull();
    expect(await repos.booking.confirm(h.db, A.businessId, customer(token()))).toBeNull();
  });

  it("keeps a confirmed booking's time from anyone else until it is canceled", async () => {
    const start = at("2027-03-05T14:00:00Z");
    const booked = await book(lesson, A.businessId, start);
    // Long after any hold would have run out, the confirmed booking still blocks.
    expect(await hold(lesson, A.businessId, start, plus(NOW, 60 * 24))).toBeNull();
    const canceled = await repos.booking.cancel(h.db, A.businessId, booked.id, "customer", plus(NOW, 5));
    expect(canceled).toMatchObject({ status: "canceled", canceledBy: "customer", canceledAt: plus(NOW, 5) });
    expect(await repos.booking.cancel(h.db, A.businessId, booked.id, "founder")).toBeNull();
    expect(await hold(lesson, A.businessId, start)).not.toBeNull();
  });
});

describe("rescheduling", () => {
  it("moves a confirmed booking, refuses a taken time and leaves the booking as it was, and may overlap its own old time", async () => {
    const start = at("2027-03-08T14:00:00Z");
    const booked = await book(lesson, A.businessId, start);
    await svc((tx) => repos.booking.claimReminder(tx, booked.id, NOW));

    const moved = await repos.booking.reschedule(h.db, A.businessId, booked.id, { service: lesson, start: plus(start, 180), now: NOW });
    expect(moved).toMatchObject({ startsAt: plus(start, 180), endsAt: plus(start, 240), reminderSentAt: null });

    const other = await book(short, A.businessId, start);
    expect(await repos.booking.reschedule(h.db, A.businessId, booked.id, { service: lesson, start: plus(start, 15), now: NOW })).toBeNull();
    expect(await repos.booking.get(h.db, A.businessId, booked.id)).toMatchObject({ startsAt: plus(start, 180), status: "confirmed" });

    // Half an hour later overlaps only its own old time.
    expect(await repos.booking.reschedule(h.db, A.businessId, booked.id, { service: lesson, start: plus(start, 210), now: NOW })).toMatchObject({ startsAt: plus(start, 210) });
    expect(await repos.booking.get(h.db, A.businessId, other.id)).toMatchObject({ startsAt: start, status: "confirmed" });
  });

  it("moves onto a time that only a hold that ran out still holds", async () => {
    const start = at("2027-03-09T14:00:00Z");
    const booked = await book(lesson, A.businessId, start);
    await hold(lesson, A.businessId, plus(start, 180), NOW);
    expect(await repos.booking.reschedule(h.db, A.businessId, booked.id, { service: lesson, start: plus(start, 180), now: plus(NOW, 5) })).toBeNull();
    expect(await repos.booking.reschedule(h.db, A.businessId, booked.id, { service: lesson, start: plus(start, 180), now: plus(NOW, 11) })).toMatchObject({ startsAt: plus(start, 180) });
  });
});

describe("busy times", () => {
  it("are the confirmed bookings and running holds with their buffers, never a hold that ran out or a canceled booking", async () => {
    const from = at("2027-04-05T00:00:00Z");
    const to = at("2027-04-06T00:00:00Z");
    // A hold taken 20 minutes before `NOW` has run out by then; nothing deletes it before the busy read.
    const expired = await hold(cLesson, C.businessId, at("2027-04-05T09:00:00Z"), plus(NOW, -20));
    const confirmed = await book(cLesson, C.businessId, at("2027-04-05T14:00:00Z"));
    const running = await hold(cLesson, C.businessId, at("2027-04-05T16:00:00Z"), NOW);
    const canceled = await book(cLesson, C.businessId, at("2027-04-05T18:00:00Z"));
    await repos.booking.cancel(h.db, C.businessId, canceled.id, "founder", NOW);
    expect(expired).not.toBeNull();
    // One outside the window.
    await book(cLesson, C.businessId, at("2027-04-07T14:00:00Z"));

    const busy = await repos.booking.busy(h.db, C.businessId, from, to, NOW);
    const asTimes = (ranges: { start: Date; end: Date }[]) => ranges.map((r) => [r.start.getTime(), r.end.getTime()]).sort((x, y) => x[0]! - y[0]!);
    const expected = [busyRangeOf(cLesson, confirmed.startsAt), busyRangeOf(cLesson, running!.startsAt)];
    expect(busy.every((r) => r.start instanceof Date && r.end instanceof Date)).toBe(true);
    expect(asTimes(busy)).toEqual(asTimes(expected));
    expect(asTimes(await repos.booking.busy(h.db, C.businessId, from, to, NOW, confirmed.id))).toEqual(asTimes([expected[1]!]));
    // Another business's window is its own.
    expect(await repos.booking.busy(h.db, B.businessId, from, to, NOW)).toEqual([]);
  });
});

describe("reminders", () => {
  it("lists the confirmed bookings due a reminder, and only one claim of a reminder wins", async () => {
    const start = at("2027-05-03T14:00:00Z");
    const booked = await book(lesson, A.businessId, start);
    const due = await repos.booking.dueReminders(h.db, plus(start, -24 * 60), plus(start, 60));
    expect(due.map((d) => d.id)).toContain(booked.id);
    const claims = await Promise.all([repos.booking.claimReminder(h.db, booked.id, NOW), repos.booking.claimReminder(h.db, booked.id, NOW)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await repos.booking.dueReminders(h.db, plus(start, -24 * 60), plus(start, 60))).map((d) => d.id)).not.toContain(booked.id);
  });
});

describe("another business", () => {
  it("books the same time freely, and A's id reads, cancels and moves nothing of B's", async () => {
    const start = at("2027-06-07T14:00:00Z");
    await book(lesson, A.businessId, start);
    const bBooked = await book(bLesson, B.businessId, start);
    expect(await repos.booking.get(h.db, A.businessId, bBooked.id)).toBeNull();
    expect(await repos.booking.cancel(h.db, A.businessId, bBooked.id, "founder")).toBeNull();
    expect(await repos.booking.reschedule(h.db, A.businessId, bBooked.id, { service: lesson, start: plus(start, 180), now: NOW })).toBeNull();
    expect(await repos.booking.get(h.db, B.businessId, bBooked.id)).toMatchObject({ status: "confirmed", startsAt: start });
    expect(await repos.booking.getById(h.db, bBooked.id)).toMatchObject({ businessId: B.businessId });
  });

  it("is refused as the service of a booking: a booking points at a service of its own business", async () => {
    const err = await hold(bLesson, A.businessId, at("2027-06-08T14:00:00Z")).catch((e: unknown) => e);
    expect(sqlState(err)).toBe("23514");
    expect(String((err as Error).cause)).toMatch(/a booking belongs to a service of its own business/);
  });
});
