"use server";
/**
 * Booking on a project's public page (founder, Nov 22, 2026): the Server Actions behind the booking page. Each calls
 * the api's signed-out `publicBooking.*` with no bearer and answers `{ ok, data }` or `{ ok: false, code }`, where the
 * code is one the booking page turns into its shared sentence (lib/public-booking.ts); the visitor never reads the
 * api's own message. The api decides everything: the bot check, the hold, the limits and the booking.
 */
import { bookingResult, type BookingActionResult } from "@/lib/public-booking";
import { createApiClient, SERVER_LIMITS } from "@/lib/trpc";

const api = () => createApiClient({ getToken: () => null, fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }), limits: SERVER_LIMITS });

export async function bookingSlots(input: { slug: string; serviceId: string; from: string; to: string }): Promise<BookingActionResult<{ slots: string[] }>> {
  return bookingResult(() => api().publicBooking.slots.query({ slug: input.slug, serviceId: input.serviceId, from: new Date(input.from), to: new Date(input.to) }));
}

export async function holdBookingSlot(input: { slug: string; serviceId: string; start: string; turnstile: string | null; replaces: string | null }): Promise<BookingActionResult<{ holdToken: string; expiresAt: string }>> {
  return bookingResult(() => api().publicBooking.hold.mutate({ slug: input.slug, serviceId: input.serviceId, start: new Date(input.start), turnstile: input.turnstile, replaces: input.replaces }));
}

export async function confirmBookingHold(input: { slug: string; holdToken: string; name: string; email: string; answers: string[]; consent: boolean; website: string; visitorTimeZone: string }): Promise<BookingActionResult<{ startsAt: string; serviceName: string }>> {
  return bookingResult(() => api().publicBooking.confirm.mutate(input));
}
