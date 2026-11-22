/**
 * Booking on a project's public page (founder, Nov 22, 2026), the part of the Server Actions that needs no network:
 * which sentence an api refusal becomes, and the answer shape the client wrappers read. The visitor never reads the
 * api's own message: a code the page knows maps to its shared sentence (`BOOKING_ERRORS`), anything else to
 * "Booking is not available right now".
 */
import type { BookingPageError } from "@foundmill/dugout";
import { BOOKING_ERRORS } from "@foundmill/shared/booking";
import { appErrorCode } from "./trpc";

/** What a booking Server Action answers: the value, or the code the component turns into words. */
export type BookingActionResult<T> = { ok: true; data: T } | { ok: false; code: BookingPageError };

/** The component's error code for an api refusal. */
export function bookingErrorCode(err: unknown): BookingPageError {
  const code = appErrorCode(err);
  return code && Object.hasOwn(BOOKING_ERRORS, code) ? (code as keyof typeof BOOKING_ERRORS) : "unavailable";
}

/** Runs one api call and turns a refusal into `{ ok: false, code }`. */
export async function bookingResult<T>(call: () => Promise<T>): Promise<BookingActionResult<T>> {
  try {
    return { ok: true, data: await call() };
  } catch (err) {
    return { ok: false, code: bookingErrorCode(err) };
  }
}
