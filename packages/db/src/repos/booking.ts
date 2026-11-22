/**
 * Booking (0157; founder, Nov 22, 2026): the project's setup, its services and its bookings. Service connection only
 * for writes: the api writes for a founder after checking the role, and for a visitor through the public route.
 *
 * Double booking is prevented by the table's exclusion constraint (`bookings_no_overlap`), never by a read before the
 * write: `hold` and `reschedule` attempt the write and answer null when Postgres refuses it (SQLSTATE 23P01). A hold
 * that ran out is deleted in the same transaction as the next hold of that project, so it never blocks a slot.
 */
import { BOOKING_HOLD_MINUTES, BOOKING_LIMITS, BOOKING_MODES, busyRangeOf, weeklyHoursProblem, type BusyRange, type WeeklyHours } from "@foundmill/shared/booking";
import { isValidTimeZone, ValidationError } from "@foundmill/shared";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { bookingServices, bookingSettings, bookings, publicBookingPages, type Booking, type BookingAnswer, type BookingService, type BookingSettings } from "../schema/booking";
import { entities } from "../schema";
import { entitiesRepo } from "./entities";
import { Currency, Id, maybeOne, parseInput, sqlState, type Executor } from "./_shared";

const range = (min: number, max: number) => z.number().int().min(min).max(max);

export const BookingServiceInput = z.object({
  /** An existing service to change; absent for a new one. */
  id: Id.optional(),
  name: z.string().trim().min(1).max(BOOKING_LIMITS.serviceName),
  durationMin: range(BOOKING_LIMITS.durationMin.min, BOOKING_LIMITS.durationMin.max),
  bufferBeforeMin: range(BOOKING_LIMITS.bufferMin.min, BOOKING_LIMITS.bufferMin.max).default(0),
  bufferAfterMin: range(BOOKING_LIMITS.bufferMin.min, BOOKING_LIMITS.bufferMin.max).default(0),
  priceMinor: z.number().int().min(0).max(100_000_000).nullable().default(null),
  mode: z.enum(BOOKING_MODES).default("online"),
  minNoticeMin: range(BOOKING_LIMITS.noticeMin.min, BOOKING_LIMITS.noticeMin.max).default(720),
  maxDaysAhead: range(BOOKING_LIMITS.daysAhead.min, BOOKING_LIMITS.daysAhead.max).default(30),
  questions: z.array(z.string().trim().min(1).max(BOOKING_LIMITS.question)).max(BOOKING_LIMITS.questions).default([]),
});
export type BookingServiceInput = z.input<typeof BookingServiceInput>;

export const BookingSetupInput = z.object({
  timeZone: z.string().refine(isValidTimeZone, "Pick a time zone from the list."),
  weeklyHours: z.custom<WeeklyHours>((v) => weeklyHoursProblem(v) === null, { message: "The hours are not valid." }),
  useCalendar: z.boolean().optional(),
  services: z.array(BookingServiceInput).min(1).max(BOOKING_LIMITS.services),
  currency: Currency,
  draftedByAgentId: Id.nullable().optional(),
});
export type BookingSetupInput = z.input<typeof BookingSetupInput>;

const pgRange = (r: BusyRange) => `[${r.start.toISOString()},${r.end.toISOString()})`;
const HOLDING = ["held", "confirmed"] as const;

/** A hold whose time is up (at `now` or before) frees its slot: `heldByToken` and `confirm` no longer accept it. */
const deleteExpiredHolds = (db: Executor, businessId: string, now: Date) => db.delete(bookings).where(and(eq(bookings.businessId, businessId), eq(bookings.status, "held"), lte(bookings.holdExpiresAt, now)));

export interface BookingSetup {
  settings: BookingSettings | null;
  services: BookingService[];
}

/** What a visitor's booking page reads: a live setup of a published page, and its services. */
export interface PublicBookingPage {
  slug: string;
  businessId: string;
  name: string;
  timeZone: string;
  weeklyHours: WeeklyHours;
  useCalendar: boolean;
  services: BookingService[];
}

export const bookingRepo = {
  async setup(db: Executor, businessId: string): Promise<BookingSetup> {
    const [settings, services] = await Promise.all([
      db.select().from(bookingSettings).where(eq(bookingSettings.businessId, businessId)).limit(1),
      db.select().from(bookingServices).where(and(eq(bookingServices.businessId, businessId), isNull(bookingServices.archivedAt))).orderBy(asc(bookingServices.position), asc(bookingServices.createdAt)),
    ]);
    return { settings: maybeOne(settings), services };
  },

  /**
   * Save the setup: the zone, the hours and the whole list of services (one named by `id` is changed, one without is
   * added, one left out is archived: a booking keeps pointing at its service). A new setup starts as a draft; saving
   * never turns booking on or off.
   */
  async saveSetup(db: Executor, businessId: string, input: BookingSetupInput): Promise<BookingSetup> {
    const v = parseInput(BookingSetupInput, input, "booking setup");
    return db.transaction(async (tx) => {
      await tx
        .insert(bookingSettings)
        .values({ businessId, timeZone: v.timeZone, weeklyHours: v.weeklyHours, useCalendar: v.useCalendar ?? false, draftedByAgentId: v.draftedByAgentId ?? null })
        .onConflictDoUpdate({ target: bookingSettings.businessId, set: { timeZone: v.timeZone, weeklyHours: v.weeklyHours, ...(v.useCalendar === undefined ? {} : { useCalendar: v.useCalendar }) } });
      const existing = await tx.select({ id: bookingServices.id }).from(bookingServices).where(and(eq(bookingServices.businessId, businessId), isNull(bookingServices.archivedAt)));
      const known = new Set(existing.map((s) => s.id));
      const kept = new Set<string>();
      for (const [position, s] of v.services.entries()) {
        const values = { name: s.name, durationMin: s.durationMin, bufferBeforeMin: s.bufferBeforeMin, bufferAfterMin: s.bufferAfterMin, priceMinor: s.priceMinor, currency: v.currency, mode: s.mode, minNoticeMin: s.minNoticeMin, maxDaysAhead: s.maxDaysAhead, questions: s.questions, position };
        if (s.id) {
          if (!known.has(s.id)) throw new ValidationError("A service in this setup is not one of the project's.", { serviceId: s.id });
          await tx.update(bookingServices).set(values).where(and(eq(bookingServices.businessId, businessId), eq(bookingServices.id, s.id)));
          kept.add(s.id);
        } else {
          await tx.insert(bookingServices).values({ businessId, ...values });
        }
      }
      const dropped = [...known].filter((id) => !kept.has(id));
      if (dropped.length) await tx.update(bookingServices).set({ archivedAt: new Date() }).where(and(eq(bookingServices.businessId, businessId), inArray(bookingServices.id, dropped)));
      return bookingRepo.setup(tx, businessId);
    });
  },

  /** The founder turns booking on (`live`, with who and when) or off (`draft`; bookings already made stay). Null without a setup. */
  async setLive(db: Executor, businessId: string, live: boolean, userId: string, now = new Date()): Promise<BookingSettings | null> {
    const set = live ? { status: "live" as const, approvedBy: userId, approvedAt: now } : { status: "draft" as const };
    return maybeOne(await db.update(bookingSettings).set(set).where(eq(bookingSettings.businessId, businessId)).returning());
  },

  async setUseCalendar(db: Executor, businessId: string, on: boolean): Promise<BookingSettings | null> {
    return maybeOne(await db.update(bookingSettings).set({ useCalendar: on }).where(eq(bookingSettings.businessId, businessId)).returning());
  },

  async publicPage(db: Executor, slug: string): Promise<PublicBookingPage | null> {
    const page = maybeOne(await db.select().from(publicBookingPages).where(eq(publicBookingPages.slug, slug)).limit(1));
    if (!page) return null;
    const services = await db.select().from(bookingServices).where(and(eq(bookingServices.businessId, page.businessId), isNull(bookingServices.archivedAt))).orderBy(asc(bookingServices.position), asc(bookingServices.createdAt));
    if (services.length === 0) return null;
    return { ...page, services };
  },

  /** The times nobody can book between `from` and `to`: confirmed bookings and holds still running, with their buffers. */
  async busy(db: Executor, businessId: string, from: Date, to: Date, now = new Date(), exceptBookingId?: string): Promise<BusyRange[]> {
    const rows = await db
      .select({ id: bookings.id, start: sql<Date>`lower(${bookings.busy})`.mapWith(bookings.startsAt), end: sql<Date>`upper(${bookings.busy})`.mapWith(bookings.startsAt), status: bookings.status, holdExpiresAt: bookings.holdExpiresAt })
      .from(bookings)
      .where(and(eq(bookings.businessId, businessId), inArray(bookings.status, [...HOLDING]), sql`${bookings.busy} && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`));
    return rows.filter((r) => r.id !== exceptBookingId && (r.status !== "held" || (r.holdExpiresAt !== null && r.holdExpiresAt > now))).map((r) => ({ start: r.start, end: r.end }));
  },

  /**
   * Hold a slot for a visitor who is filling in the form. Null when someone else holds or has booked an overlapping
   * time: the constraint decides, so two visitors racing for one slot get exactly one hold.
   */
  async hold(db: Executor, businessId: string, input: { service: BookingService; start: Date; holdTokenHash: string; test: boolean; now?: Date }): Promise<Booking | null> {
    const now = input.now ?? new Date();
    const busy = busyRangeOf(input.service, input.start);
    try {
      return await db.transaction(async (tx) => {
        await deleteExpiredHolds(tx, businessId, now);
        const [row] = await tx
          .insert(bookings)
          .values({ businessId, serviceId: input.service.id, status: "held", startsAt: input.start, endsAt: new Date(input.start.getTime() + input.service.durationMin * 60_000), busy: pgRange(busy), holdExpiresAt: new Date(now.getTime() + BOOKING_HOLD_MINUTES * 60_000), holdTokenHash: input.holdTokenHash, test: input.test })
          .returning();
        return row!;
      });
    } catch (err) {
      if (sqlState(err) === "23P01") return null;
      throw err;
    }
  },

  /** How many holds are running on the project right now. */
  async runningHolds(db: Executor, businessId: string, now = new Date()): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.businessId, businessId), eq(bookings.status, "held"), gt(bookings.holdExpiresAt, now)));
    return row?.n ?? 0;
  },

  /** A hold still running, by the token the visitor's browser keeps. */
  async heldByToken(db: Executor, holdTokenHash: string, now = new Date()): Promise<Booking | null> {
    return maybeOne(await db.select().from(bookings).where(and(eq(bookings.holdTokenHash, holdTokenHash), eq(bookings.status, "held"), gt(bookings.holdExpiresAt, now))).limit(1));
  },

  /** Turn a running hold into a booking. Null when the hold ran out or was already used. */
  async confirm(db: Executor, businessId: string, input: { holdTokenHash: string; customerName: string; customerEmail: string; answers: BookingAnswer[]; consentText: string; visitorTimeZone: string | null; entityId: string | null; now?: Date }): Promise<Booking | null> {
    const now = input.now ?? new Date();
    return maybeOne(
      await db
        .update(bookings)
        .set({ status: "confirmed", holdExpiresAt: null, holdTokenHash: null, customerName: input.customerName, customerEmail: input.customerEmail, answers: input.answers, consentText: input.consentText, visitorTimeZone: input.visitorTimeZone, entityId: input.entityId, confirmedAt: now })
        .where(and(eq(bookings.businessId, businessId), eq(bookings.holdTokenHash, input.holdTokenHash), eq(bookings.status, "held"), gt(bookings.holdExpiresAt, now)))
        .returning(),
    );
  },

  /** Give a hold back before it runs out (the visitor picked another time). */
  async releaseHold(db: Executor, holdTokenHash: string): Promise<void> {
    await db.delete(bookings).where(and(eq(bookings.holdTokenHash, holdTokenHash), eq(bookings.status, "held")));
  },

  async get(db: Executor, businessId: string, bookingId: string): Promise<Booking | null> {
    return maybeOne(await db.select().from(bookings).where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId))).limit(1));
  },

  /**
   * A booking of any business by its id. Service connection only: the customer's manage link carries an HMAC of the
   * booking id, which the api checks before this lookup, so nothing of the link is stored.
   */
  async getById(db: Executor, bookingId: string): Promise<Booking | null> {
    return maybeOne(await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1));
  },

  async service(db: Executor, businessId: string, serviceId: string): Promise<BookingService | null> {
    return maybeOne(await db.select().from(bookingServices).where(and(eq(bookingServices.businessId, businessId), eq(bookingServices.id, serviceId))).limit(1));
  },

  /** Cancel a confirmed booking: its slot is free at once. Null when it was not confirmed. */
  async cancel(db: Executor, businessId: string, bookingId: string, by: "customer" | "founder", now = new Date()): Promise<Booking | null> {
    return maybeOne(await db.update(bookings).set({ status: "canceled", canceledAt: now, canceledBy: by }).where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId), eq(bookings.status, "confirmed"))).returning());
  },

  /** Move a confirmed booking to another start. Null when the new time overlaps another booking or hold (the constraint decides) or it was not confirmed. */
  async reschedule(db: Executor, businessId: string, bookingId: string, input: { service: BookingService; start: Date; now?: Date }): Promise<Booking | null> {
    try {
      return await db.transaction(async (tx) => {
        // A hold that ran out must not block the new time, as in `hold`.
        await deleteExpiredHolds(tx, businessId, input.now ?? new Date());
        return maybeOne(
          await tx
            .update(bookings)
            .set({ startsAt: input.start, endsAt: new Date(input.start.getTime() + input.service.durationMin * 60_000), busy: pgRange(busyRangeOf(input.service, input.start)), reminderSentAt: null })
            .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId), eq(bookings.status, "confirmed")))
            .returning(),
        );
      });
    } catch (err) {
      if (sqlState(err) === "23P01") return null;
      throw err;
    }
  },

  /** The customer did not come (the founder says so, after the start). */
  async markNoShow(db: Executor, businessId: string, bookingId: string, now = new Date()): Promise<Booking | null> {
    return maybeOne(await db.update(bookings).set({ status: "no_show" }).where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId), eq(bookings.status, "confirmed"), lte(bookings.startsAt, now))).returning());
  },

  async setCalendarEvent(db: Executor, businessId: string, bookingId: string, calendarEventId: string | null): Promise<void> {
    await db.update(bookings).set({ calendarEventId }).where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)));
  },

  /** The project's bookings (never a hold), soonest first from `from`, or the newest past ones. */
  async list(db: Executor, businessId: string, filter: { from?: Date; before?: Date; limit?: number } = {}): Promise<(Booking & { serviceName: string })[]> {
    const rows = await db
      .select({ booking: bookings, serviceName: bookingServices.name })
      .from(bookings)
      .innerJoin(bookingServices, eq(bookingServices.id, bookings.serviceId))
      .where(and(eq(bookings.businessId, businessId), inArray(bookings.status, ["confirmed", "canceled", "no_show", "completed"]), filter.from ? gte(bookings.startsAt, filter.from) : undefined, filter.before ? lt(bookings.startsAt, filter.before) : undefined))
      .orderBy(filter.before && !filter.from ? desc(bookings.startsAt) : asc(bookings.startsAt))
      .limit(Math.min(filter.limit ?? 100, 500));
    return rows.map((r) => ({ ...r.booking, serviceName: r.serviceName }));
  },

  /** How many real bookings the project has had: confirmed (or kept) and not a test. */
  async realCount(db: Executor, businessId: string): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.businessId, businessId), inArray(bookings.status, ["confirmed", "no_show", "completed"]), eq(bookings.test, false)));
    return row?.n ?? 0;
  },

  /** Confirmed bookings, of any project, that start before `until` and have had no reminder. Service connection (the reminder pass). */
  async dueReminders(db: Executor, now: Date, until: Date, limit = 200): Promise<Booking[]> {
    return db.select().from(bookings).where(and(eq(bookings.status, "confirmed"), isNull(bookings.reminderSentAt), gt(bookings.startsAt, now), lte(bookings.startsAt, until))).orderBy(asc(bookings.startsAt)).limit(limit);
  },

  /** Claim a booking's reminder: true for the one caller that may send it. */
  async claimReminder(db: Executor, bookingId: string, now = new Date()): Promise<boolean> {
    const rows = await db.update(bookings).set({ reminderSentAt: now }).where(and(eq(bookings.id, bookingId), eq(bookings.status, "confirmed"), isNull(bookings.reminderSentAt))).returning({ id: bookings.id });
    return rows.length === 1;
  },

  // --- added for the api ---

  /**
   * The CRM record of a customer who booked, found by email or created as a lead under the customer's own name, the
   * way `repos.followers.record` does for a follower: an existing contact is left as it is; a record whose deletion
   * was requested, a contact the founder archived and a suppressed address get no record (null), and the booking
   * stands without one. A booking is not marketing consent: no lawful basis is written.
   */
  async customerEntity(db: Executor, businessId: string, input: { name: string; email: string }): Promise<string | null> {
    const email = input.email.trim().toLowerCase();
    await db.execute(sql`select pg_advisory_xact_lock(hashtext('fm.booking_customer'), hashtext(${`${businessId}:${email}`}))`);
    const known = await entitiesRepo.findByIdentifier(db, businessId, "email", email);
    if (known) return known.deletionRequestedAt ? null : known.id;
    const archived = await db.select({ id: entities.id }).from(entities).where(and(eq(entities.businessId, businessId), isNotNull(entities.archivedAt), isNull(entities.mergedIntoId), sql`lower(${entities.identifiers} ->> 'email') = ${email}`)).limit(1);
    if (archived.length) return null;
    const lead = await entitiesRepo.upsertLead(db, businessId, { kind: "person", displayName: input.name, email, source: "booking", lawfulBasis: null, ownerAgentId: null });
    return lead.entity?.id ?? null;
  },

  /** Mark a booking as a test (a member of the project booked on its own page): it is never a real outcome. */
  async markTest(db: Executor, businessId: string, bookingId: string): Promise<Booking | null> {
    return maybeOne(await db.update(bookings).set({ test: true }).where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId))).returning());
  },

  /** Give a reminder's claim back when its email was not sent for a reason that may pass: the next pass asks again. */
  async releaseReminder(db: Executor, bookingId: string): Promise<void> {
    await db.update(bookings).set({ reminderSentAt: null }).where(and(eq(bookings.id, bookingId), eq(bookings.status, "confirmed")));
  },

  /**
   * The ids of the events booking wrote to the founder's calendar, for bookings in any status: the bookings table is
   * the truth for those times, so the calendar's copy (which may be stale after a cancel or a move) is not read as busy.
   */
  async calendarEventIds(db: Executor, businessId: string): Promise<string[]> {
    const rows = await db.select({ id: bookings.calendarEventId }).from(bookings).where(and(eq(bookings.businessId, businessId), isNotNull(bookings.calendarEventId))).orderBy(desc(bookings.startsAt)).limit(2000);
    return rows.flatMap((r) => (r.id ? [r.id] : []));
  },
};
