"use server";
/**
 * The customer's own booking link (founder, Nov 22, 2026): the Server Actions behind `/p/<slug>/book/manage?t=<token>`.
 * The signed token is the only credential; the api reads it again on every call. Answers as ../actions.ts does.
 */
import { bookingResult, type BookingActionResult } from "@/lib/public-booking";
import { createApiClient, SERVER_LIMITS } from "@/lib/trpc";

const api = () => createApiClient({ getToken: () => null, fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }), limits: SERVER_LIMITS });

export async function manageSlots(input: { token: string; from: string; to: string }): Promise<BookingActionResult<{ slots: string[] }>> {
  return bookingResult(() => api().publicBooking.manageSlots.query({ token: input.token, from: new Date(input.from), to: new Date(input.to) }));
}

export async function cancelManagedBooking(input: { token: string }): Promise<BookingActionResult<{ status: string }>> {
  return bookingResult(async () => ({ status: (await api().publicBooking.cancel.mutate({ token: input.token })).status }));
}

export async function rescheduleManagedBooking(input: { token: string; start: string }): Promise<BookingActionResult<{ startsAt: string }>> {
  return bookingResult(async () => ({ startsAt: (await api().publicBooking.reschedule.mutate({ token: input.token, start: new Date(input.start) })).startsAt }));
}
