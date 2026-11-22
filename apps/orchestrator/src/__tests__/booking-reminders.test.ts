/**
 * The booking reminder pass on PGlite (founder, Nov 22, 2026): a confirmed booking that starts within a day is asked
 * of the gateway once, by ids only; a refusal that may pass gives the claim back so the next pass asks again; one
 * that will not keeps it; a booking further out, a canceled one and one already reminded are left alone.
 */
import { repos } from "@foundmill/db";
import { DEFAULT_WEEKLY_HOURS } from "@foundmill/shared/booking";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBookingActivities } from "../activities/booking";
import type { BookingMailRequest, BookingMailResponse } from "../gateway-client";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
const NOW = new Date("2026-11-23T12:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60_000);
let n = 0;

async function booked(start: Date) {
  const setup = await repos.booking.setup(t.db, t.businessId);
  const tokenHash = createHash("sha256").update(`reminder-${++n}`).digest("hex");
  const held = await repos.booking.hold(t.db, t.businessId, { service: setup.services[0]!, start, holdTokenHash: tokenHash, test: false, now: NOW });
  const booking = await repos.booking.confirm(t.db, t.businessId, { holdTokenHash: tokenHash, customerName: "Dana", customerEmail: `dana${n}@example.com`, answers: [], consentText: "I agree.", visitorTimeZone: null, entityId: null, now: NOW });
  expect(held && booking).toBeTruthy();
  return booking!;
}

function answering(by: (req: BookingMailRequest) => BookingMailResponse | Promise<BookingMailResponse>): BookingMailRequest[] {
  const asked: BookingMailRequest[] = [];
  t.gateway.bookingMail = async (req) => {
    asked.push(req);
    return by(req);
  };
  return asked;
}

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "booking-reminders" });
  await repos.booking.saveSetup(t.db, t.businessId, { timeZone: "UTC", weeklyHours: DEFAULT_WEEKLY_HOURS, services: [{ name: "Lesson", durationMin: 30 }], currency: "USD" });
}, 120_000);
afterAll(() => t?.close());

describe("bookingRemindersSweep", () => {
  it("asks once for a booking that starts within a day, by ids only, and leaves the others alone", async () => {
    const soon = await booked(at(20));
    const later = await booked(at(40));
    const gone = await booked(at(10));
    await repos.booking.cancel(t.db, t.businessId, gone.id, "customer", NOW);
    const asked = answering(() => ({ sent: true, simulated: true }));
    const acts = createBookingActivities(t.deps);
    const first = await acts.bookingRemindersSweep({ at: NOW.toISOString() });
    expect(asked).toEqual([{ businessId: t.businessId, bookingId: soon.id, kind: "reminder" }]);
    expect(first.touched).toBe(1);
    expect(JSON.stringify(asked)).not.toMatch(/@|Dana/);
    // A second pass asks nobody: the reminder is claimed.
    await acts.bookingRemindersSweep({ at: at(0.25).toISOString() });
    expect(asked).toHaveLength(1);
    expect((await repos.booking.get(t.db, t.businessId, later.id))!.reminderSentAt).toBeNull();
  });

  it("gives the claim back after a refusal that may pass or a gateway that did not answer, and keeps it after one that will not", async () => {
    const acts = createBookingActivities(t.deps);
    const capped = await booked(at(5));
    let reason = "daily_cap";
    const asked = answering(() => ({ sent: false, reason }));
    await acts.bookingRemindersSweep({ at: NOW.toISOString() });
    expect((await repos.booking.get(t.db, t.businessId, capped.id))!.reminderSentAt).toBeNull();
    for (reason of ["ceiling", "store", "unconfigured"]) await acts.bookingRemindersSweep({ at: NOW.toISOString() });
    expect(asked.map((a) => a.bookingId)).toEqual([capped.id, capped.id, capped.id, capped.id]);

    answering(() => Promise.reject(new Error("gateway unreachable")));
    const failed = await acts.bookingRemindersSweep({ at: NOW.toISOString() });
    expect(failed.notes).toHaveLength(1);
    expect((await repos.booking.get(t.db, t.businessId, capped.id))!.reminderSentAt).toBeNull();

    const final = answering(() => ({ sent: false, reason: "suppressed" }));
    await acts.bookingRemindersSweep({ at: NOW.toISOString() });
    await acts.bookingRemindersSweep({ at: NOW.toISOString() });
    expect(final).toHaveLength(1);
    expect((await repos.booking.get(t.db, t.businessId, capped.id))!.reminderSentAt).not.toBeNull();
  });
});
