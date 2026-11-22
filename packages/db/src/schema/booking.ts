/**
 * 0157 — Foundmill's own booking (founder, Nov 22, 2026): the project's setup, its services, and its bookings (a held
 * slot is a booking in status `held`). Members read; only the services write. `bookings_no_overlap` (an exclusion
 * constraint in the SQL) is what prevents a double booking.
 */
import { BOOKING_MODES, BOOKING_SETUP_STATUSES, BOOKING_STATUSES, type WeeklyHours } from "@foundmill/shared/booking";
import { sql } from "drizzle-orm";
import { boolean, char, customType, index, integer, jsonb, pgTable, pgView, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { archivedAt, id, minor, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { entities } from "./crm";

/** `tstzrange`, read and written as its text form (`["2026-11-23 15:45:00+00","2026-11-23 17:15:00+00")`). */
const tstzrange = customType<{ data: string; driverData: string }>({ dataType: () => "tstzrange" });

export const bookingSettings = pgTable("booking_settings", {
  id: id(),
  businessId: businessId().unique("booking_settings_business_id_key"),
  status: text("status", { enum: BOOKING_SETUP_STATUSES }).notNull().default("draft"),
  timeZone: text("time_zone").notNull(),
  weeklyHours: jsonb("weekly_hours").$type<WeeklyHours>().notNull().default(sql`'{}'::jsonb`),
  useCalendar: boolean("use_calendar").notNull().default(false),
  draftedByAgentId: uuid("drafted_by_agent_id"),
  approvedBy: uuid("approved_by"),
  approvedAt: tstz("approved_at"),
  ...timestamps(),
});
export type BookingSettings = typeof bookingSettings.$inferSelect;

export const bookingServices = pgTable(
  "booking_services",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    durationMin: integer("duration_min").notNull(),
    bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
    bufferAfterMin: integer("buffer_after_min").notNull().default(0),
    /** As shown, in minor units; null is free. Showing a price takes no payment. */
    priceMinor: minor("price_minor"),
    currency: char("currency", { length: 3 }).notNull(),
    mode: text("mode", { enum: BOOKING_MODES }).notNull().default("online"),
    minNoticeMin: integer("min_notice_min").notNull().default(720),
    maxDaysAhead: integer("max_days_ahead").notNull().default(30),
    questions: jsonb("questions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    position: integer("position").notNull().default(0),
    archivedAt: archivedAt(),
    ...timestamps(),
  },
  (t) => [index("booking_services_business_id_idx").on(t.businessId, t.position)],
);
export type BookingService = typeof bookingServices.$inferSelect;

/** One answer to a question the founder asks: the customer's own words, untrusted content. */
export interface BookingAnswer {
  question: string;
  answer: string;
}

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    businessId: businessId(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => bookingServices.id, { onDelete: "restrict" }),
    status: text("status", { enum: BOOKING_STATUSES }).notNull(),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    /** The appointment with the service's buffers: what nobody else may overlap (`bookings_no_overlap`). */
    busy: tstzrange("busy").notNull(),
    holdExpiresAt: tstz("hold_expires_at"),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    answers: jsonb("answers").$type<BookingAnswer[]>().notNull().default(sql`'[]'::jsonb`),
    consentText: text("consent_text"),
    visitorTimeZone: text("visitor_time_zone"),
    holdTokenHash: text("hold_token_hash"),
    /** Never a real outcome: made by a member of the project on its own page, or where results are simulated. */
    test: boolean("test").notNull().default(false),
    calendarEventId: text("calendar_event_id"),
    reminderSentAt: tstz("reminder_sent_at"),
    confirmedAt: tstz("confirmed_at"),
    canceledAt: tstz("canceled_at"),
    canceledBy: text("canceled_by", { enum: ["customer", "founder", "system"] }),
    ...timestamps(),
  },
  (t) => [
    index("bookings_business_starts_idx").on(t.businessId, t.startsAt),
    index("bookings_service_id_idx").on(t.serviceId),
    index("bookings_entity_id_idx").on(t.entityId),
    uniqueIndex("bookings_hold_token_hash_key").on(t.holdTokenHash).where(sql`${t.holdTokenHash} is not null`),
    index("bookings_reminder_due_idx").on(t.startsAt).where(sql`${t.status} = 'confirmed' and ${t.reminderSentAt} is null`),
  ],
);
export type Booking = typeof bookings.$inferSelect;

/**
 * What a visitor's booking page reads (the service connection's only): a live setup of a page that is public, built on
 * `public_project_pages` so what is public is decided in one place.
 */
export const publicBookingPages = pgView("public_booking_pages", {
  slug: text("slug").notNull(),
  businessId: uuid("business_id").notNull(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull(),
  weeklyHours: jsonb("weekly_hours").$type<WeeklyHours>().notNull(),
  useCalendar: boolean("use_calendar").notNull(),
}).existing();
