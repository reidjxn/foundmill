/**
 * booking.* — the console's side of Foundmill's own booking (founder, Nov 22, 2026; services/booking.ts) — and
 * publicBooking.* — the signed-out routes behind `/p/<slug>/book` and the link in a customer's emails.
 *
 * - `booking.get`, `booking.slots`: any member (the setup is not a secret; the public page shows it once live).
 * - `booking.list`: members with CRM read: a booking is a customer record.
 * - `booking.save`, `booking.setLive`, `booking.cancel`, `booking.move`, `booking.noShow`: owners, cofounders and
 *   admins; audited. Turning booking on is the founder's own press and needs a published page and a service.
 * - `publicBooking.get`, `slots`: anyone; a live setup on a published page only, else `booking_closed`.
 * - `publicBooking.hold`: anyone with a valid Turnstile token (`page_booking`); the database decides who gets a slot.
 * - `publicBooking.confirm`: turns a running hold into a booking.
 * - `publicBooking.manage`, `manageSlots`, `cancel`, `reschedule`: the customer's signed link; until the start time.
 */
import { BOOKING_LIMITS, BOOKING_MODES } from "@foundmill/shared/booking";
import { boundedRecord, FOLLOW_EMAIL_MAX, PAGE_SLUG_MAX } from "@foundmill/shared";
import type { WeeklyHours } from "@foundmill/shared/booking";
import { z } from "zod";
import {
  bookingSetupView,
  cancelBookingAsFounder,
  cancelManagedBooking,
  confirmBooking,
  founderBookingSlots,
  holdBookingSlot,
  listBookings,
  manageBooking,
  manageBookingSlots,
  markBookingNoShow,
  moveBookingAsFounder,
  publicBooking,
  publicBookingBlock,
  publicBookingSlots,
  rescheduleManagedBooking,
  saveBookingSetup,
  setBookingLive,
} from "../services/booking";
import { adminProcedure, businessProcedure, Id, publicProcedure, router, sectionRead } from "../trpc";

const Slug = z.string().max(PAGE_SLUG_MAX * 2);
const Instant = z.coerce.date();
const Token = z.string().min(1).max(200);

const ServiceInput = z.object({
  id: Id.optional(),
  name: z.string().max(BOOKING_LIMITS.serviceName * 2),
  durationMin: z.number().int(),
  bufferBeforeMin: z.number().int().optional(),
  bufferAfterMin: z.number().int().optional(),
  priceMinor: z.number().int().nullable().optional(),
  mode: z.enum(BOOKING_MODES).optional(),
  minNoticeMin: z.number().int().optional(),
  maxDaysAhead: z.number().int().optional(),
  questions: z.array(z.string().max(BOOKING_LIMITS.question * 2)).max(BOOKING_LIMITS.questions).optional(),
});
/** The setup as the client sends it; the repository's schema checks every limit and says what is wrong. */
const SetupInput = z.object({
  timeZone: z.string().max(64),
  weeklyHours: boundedRecord(7, z.record(z.string().max(1), z.array(z.object({ start: z.number().int(), end: z.number().int() })).max(BOOKING_LIMITS.windowsPerDay))).transform((v) => v as WeeklyHours),
  useCalendar: z.boolean().optional(),
  services: z.array(ServiceInput).max(BOOKING_LIMITS.services),
});

export const bookingRouter = router({
  get: businessProcedure.query(({ ctx }) => bookingSetupView(ctx)),
  save: adminProcedure.input(SetupInput).mutation(({ ctx, input }) => saveBookingSetup(ctx, input)),
  setLive: adminProcedure.input(z.object({ live: z.boolean() })).mutation(({ ctx, input }) => setBookingLive(ctx, input)),
  list: sectionRead("crm").input(z.object({ when: z.enum(["upcoming", "past"]).default("upcoming") })).query(({ ctx, input }) => listBookings(ctx, input)),
  slots: businessProcedure.input(z.object({ serviceId: Id, from: Instant, to: Instant, exceptBookingId: Id.optional() })).query(({ ctx, input }) => founderBookingSlots(ctx, input)),
  cancel: adminProcedure.input(z.object({ bookingId: Id })).mutation(({ ctx, input }) => cancelBookingAsFounder(ctx, input)),
  move: adminProcedure.input(z.object({ bookingId: Id, start: Instant })).mutation(({ ctx, input }) => moveBookingAsFounder(ctx, input)),
  noShow: adminProcedure.input(z.object({ bookingId: Id })).mutation(({ ctx, input }) => markBookingNoShow(ctx, input)),
});

export const publicBookingRouter = router({
  get: publicProcedure.input(z.object({ slug: Slug })).query(({ ctx, input }) => publicBooking(ctx, input)),
  /** The project page's booking block: the services, or null when booking is not open there. */
  block: publicProcedure.input(z.object({ slug: Slug })).query(({ ctx, input }) => publicBookingBlock(ctx, input)),
  slots: publicProcedure.input(z.object({ slug: Slug, serviceId: Id, from: Instant, to: Instant })).query(({ ctx, input }) => publicBookingSlots(ctx, input)),
  hold: publicProcedure.input(z.object({ slug: Slug, serviceId: Id, start: Instant, turnstile: z.string().max(4096).nullish(), replaces: Token.nullish() })).mutation(({ ctx, input }) => holdBookingSlot(ctx, input)),
  confirm: publicProcedure
    .input(
      z.object({
        slug: Slug,
        holdToken: Token,
        name: z.string().max(BOOKING_LIMITS.customerName * 4),
        email: z.string().max(FOLLOW_EMAIL_MAX * 2),
        /** The customer's own words: stored and shown to the founders, never anything else. */
        answers: z.array(z.string().max(BOOKING_LIMITS.answer * 4)).max(BOOKING_LIMITS.questions).default([]),
        consent: z.boolean(),
        website: z.string().max(500).nullish(),
        visitorTimeZone: z.string().max(64).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => confirmBooking(ctx, input)),
  manage: publicProcedure.input(z.object({ token: Token })).query(({ ctx, input }) => manageBooking(ctx, input)),
  manageSlots: publicProcedure.input(z.object({ token: Token, from: Instant, to: Instant })).query(({ ctx, input }) => manageBookingSlots(ctx, input)),
  cancel: publicProcedure.input(z.object({ token: Token })).mutation(({ ctx, input }) => cancelManagedBooking(ctx, input)),
  reschedule: publicProcedure.input(z.object({ token: Token, start: Instant })).mutation(({ ctx, input }) => rescheduleManagedBooking(ctx, input)),
});
