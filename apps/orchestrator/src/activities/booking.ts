/**
 * Booking reminders (founder, Nov 22, 2026; schedule `booking-reminders`, every 15 minutes). For each confirmed
 * booking that starts within `BOOKING_REMINDER_HOURS` and has had no reminder, the pass claims it (one caller wins),
 * then asks the gateway for the email by ids (`POST /v1/platform-mail/booking`, kind `reminder`). The gateway reads
 * the booking again, builds the words and sends from the project's address; no address passes through here.
 *
 * A "not sent" that may pass (the day's cap, the ceiling, the store, not set up yet), or a gateway that did not
 * answer, gives the claim back, so the next pass asks again until the start. Any other answer keeps the claim: the
 * booking changed, the address is suppressed, or the vendor may already have sent it.
 */
import { repos } from "@foundmill/db";
import { BOOKING_REMINDER_HOURS } from "@foundmill/shared/booking";
import type { OrchestratorDeps } from "../deps";
import type { ScheduleResult } from "./types";

/** Gateway answers that a later pass could change. */
export const BOOKING_REMINDER_RETRY_REASONS: ReadonlySet<string> = new Set(["daily_cap", "ceiling", "store", "unconfigured"]);

export function createBookingActivities(deps: OrchestratorDeps) {
  return {
    /** One pass over the bookings whose reminder is due; `touched` is how many reminders were sent. */
    async bookingRemindersSweep(input: { at?: string } = {}): Promise<ScheduleResult> {
      const now = input.at ? new Date(input.at) : deps.clock.now();
      const due = await repos.booking.dueReminders(deps.db, now, new Date(now.getTime() + BOOKING_REMINDER_HOURS * 60 * 60_000));
      const result: ScheduleResult = { businesses: new Set(due.map((b) => b.businessId)).size, touched: 0, eventIds: [], notes: [] };
      for (const booking of due) {
        if (!(await repos.booking.claimReminder(deps.db, booking.id, now))) continue;
        try {
          const answer = await deps.gateway.bookingMail({ businessId: booking.businessId, bookingId: booking.id, kind: "reminder" });
          if (answer.sent) result.touched += 1;
          else if (BOOKING_REMINDER_RETRY_REASONS.has(answer.reason)) await repos.booking.releaseReminder(deps.db, booking.id);
        } catch (err) {
          await repos.booking.releaseReminder(deps.db, booking.id);
          const message = err instanceof Error ? err.message : String(err);
          result.notes.push(`${booking.id}: ${message.slice(0, 160)}`);
          deps.log.warn({ task: "booking-reminders", bookingId: booking.id, err: message.slice(0, 160) }, "a booking reminder was not sent; the next pass asks again");
        }
      }
      return result;
    },
  };
}
