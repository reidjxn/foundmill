/**
 * Foundmill's own booking (founder, Nov 22, 2026): free on every plan, for a project whose customers pick a time. One
 * person, any number of services, no booking vendor. The signed-out routes are `publicBooking.*`; the console's are
 * `booking.*`.
 *
 * **Double booking is the one bug that must never ship.** Nothing here decides who gets a slot by reading first: a
 * hold and a move are attempted and the database's exclusion constraint (`bookings_no_overlap`, 0157) refuses the
 * second of two overlapping ones (`repos.booking.hold` / `reschedule` answer null). The slot arithmetic
 * (`@foundmill/shared/booking`) only decides what is offered.
 *
 * - **A visitor** reads the page (`publicBooking`), asks for slots, holds one while filling in the form (the bot check
 *   first, then the caps) and confirms it. Confirming writes, in one transaction on the service connection: the
 *   customer's CRM record, the booking, `booking.confirmed` (actor system `public-booking`), an audit row with no
 *   address, and a short note to the founders. After the commit, best effort: the founder's calendar and the
 *   confirmation email through the gateway. The booking stands whether or not either went through.
 * - **A test booking** (the email is a member's of the project, or results are simulated on this stack) is marked
 *   `test`, its event carries `simulated: true`, and it is never a real outcome nor the "first booking".
 * - **A customer's answers are untrusted text.** They are stored on the booking and shown to the founders in the
 *   console as plain text. They are never sent to a model and never placed in a note, an event or an agent's tool
 *   result.
 * - **The customer's link** (`manage`, `cancel`, `reschedule`, `manageSlots`) carries a signed token of the booking id;
 *   nothing is stored for it. It works until the start time.
 * - **The founders** set booking up (owners, cofounders and admins), turn it on by their own press once the page is
 *   published, and cancel, move or mark a no-show. The team may draft a setup (`booking_setup` on the gateway); it is
 *   never live without the founder.
 */
import { repos, type Booking, type BookingService, type DbTx, type InboxItem, type PublicBookingPage } from "@foundmill/db";
import { AppError, ConflictError, entityMention, followEmailProblem, ForbiddenError, hasSectionAccess, isAdminRole, isValidTimeZone, mockResultsAllowed, pageSlugProblem, pageUrl, platformMailLive, ValidationError } from "@foundmill/shared";
import {
  BOOKING_ERRORS,
  BOOKING_HOLD_MINUTES,
  BOOKING_LIMITS,
  BOOKING_READY_NOTE,
  bookingConsentText,
  bookingTimeLabel,
  isOfferedSlot,
  slotStarts,
  type BookingErrorCode,
  type BookingMailKind,
  type BookingMode,
  type BookingSetupStatus,
  type BookingStatus,
  type BusyRange,
  type WeeklyHours,
} from "@foundmill/shared/booking";
import { bookingLinkSecret, readBookingManageToken } from "@foundmill/connectors";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Context } from "../context";
import { audit, emit, type BusinessContext } from "../trpc";
import { answerNote } from "./answer-note";
import { addCalendarEvent, calendarBusy, calendarConnected } from "./booking-calendar";
import type { DecideItemResult } from "./decide";
import { writeEventRow } from "./events";
import { callerLimitKey, checkFollowTurnstile, followAddressKey, pageShowsMark } from "./pages";
import { RateLimitedError, takeOrThrow } from "./rate-limit";

/** The Turnstile widget action of the public booking form. */
export const BOOKING_TURNSTILE_ACTION = "page_booking";
/** Who writes a visitor's booking events: `isRealOutcome` counts `booking.confirmed` from this actor only. */
export const PUBLIC_BOOKING_ACTOR = { kind: "system", id: "public-booking" } as const;

const DAY = 24 * 60 * 60_000;
/**
 * Signed-out booking, shared by every api replica (`ctx.limits`), in the order the routes take them:
 *   - `perCallerRead` and `perCallerWrite`: by the address the api sees (the web's egress for a page rendered by the
 *     web, so every visitor shares it). Reads and writes have their own windows, so page views and slot lists can never
 *     use up the allowance to hold, book, cancel or move (security review, Nov 22, 2026);
 *   - `closed`: an address that is not a page taking bookings, site-wide, so guesses never spend a real page's budget;
 *   - `holdsPerPageHour` and `holdsPerPageDay`: holds on one page, after the bot check;
 *   - `HOLDS_RUNNING_PER_PAGE`: holds running at once on one page. A script that solves the bot check cannot lock a
 *     project's whole calendar ten minutes at a time; the eleventh visitor in the same ten minutes is asked to try again;
 *   - `bookingsPerPageDay`: bookings made on one page in a day, so a flood cannot fill a month of a project's calendar;
 *   - `changesPerBooking`: cancels and moves through one booking's link in a day (each tells the founders and sends an
 *     email);
 *   - `perEmailPage` and `perEmailAll`: bookings one email address may make a day, on one page and across all of them,
 *     keyed by an HMAC of the address (`followAddressKey`).
 */
export const BOOKING_PUBLIC_LIMITS = {
  perCallerRead: { limit: 600, windowMs: 60_000 },
  perCallerWrite: { limit: 240, windowMs: 60_000 },
  closed: { limit: 60, windowMs: 60_000 },
  holdsPerPageHour: { limit: 60, windowMs: 60 * 60_000 },
  holdsPerPageDay: { limit: 300, windowMs: DAY },
  bookingsPerPageDay: { limit: 40, windowMs: DAY },
  changesPerBooking: { limit: 5, windowMs: DAY },
  perEmailPage: { limit: 3, windowMs: DAY },
  perEmailAll: { limit: 6, windowMs: DAY },
} as const;

/** Holds that may run at once on one page. */
export const HOLDS_RUNNING_PER_PAGE = 10;

export const bookingLimitKeys = {
  caller: (env: Pick<Context["env"], "SESSION_TOKEN_SECRET">, kind: "read" | "write", address: string) => callerLimitKey(env, `page-booking-${kind}`, address),
  bookingsPerPageDay: (businessId: string) => `page-booking:page:${businessId}:booked`,
  changesPerBooking: (bookingId: string) => `page-booking:change:${bookingId}`,
  closed: "page-booking:closed",
  holdsPerPageHour: (businessId: string) => `page-booking:page:${businessId}:hour`,
  holdsPerPageDay: (businessId: string) => `page-booking:page:${businessId}:day`,
  perEmailPage: (env: Pick<Context["env"], "SESSION_TOKEN_SECRET">, businessId: string, email: string) => `page-booking:addr:${businessId}:${followAddressKey(env, "email", email)}`,
  perEmailAll: (env: Pick<Context["env"], "SESSION_TOKEN_SECRET">, email: string) => `page-booking:addr-all:${followAddressKey(env, "email", email)}`,
} as const;

/** The bot check's two refusals, in booking's own words (the follow form's say "following"). */
export const BOOKING_CHECK_ERRORS = {
  booking_unverified: "We could not check this browser, so nothing is booked yet. Reload the page and try again.",
  booking_unavailable: "Booking is paused for a moment, so nothing is booked yet. Try again in a few minutes.",
} as const;

const STATUS: Record<BookingErrorCode, number> = { booking_closed: 404, booking_slot_taken: 409, booking_slot_gone: 409, booking_hold_expired: 409, booking_name: 400, booking_email: 400, booking_consent: 400, booking_too_late: 409, booking_not_found: 404 };
const refusal = (code: BookingErrorCode) => new AppError(code, BOOKING_ERRORS[code], STATUS[code]);

type PublicContext = Pick<Context, "db" | "limits" | "env" | "gateway" | "log"> & { clientAddress?: string | null };

const NIL_ID = "00000000-0000-0000-0000-000000000000";
const hashOf = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
const iso = (d: Date): string => d.toISOString();

/** Results are simulated on this stack (a development or test stack whose platform mail is a mock): every booking is a test. */
const simulatedHere = (env: Context["env"]): boolean => !platformMailLive(env) && mockResultsAllowed(env.APP_ENV, false);

async function perCaller(ctx: PublicContext, kind: "read" | "write"): Promise<void> {
  if (ctx.clientAddress) await takeOrThrow(ctx.limits, "Booking", [{ key: bookingLimitKeys.caller(ctx.env, kind, ctx.clientAddress), rule: kind === "read" ? BOOKING_PUBLIC_LIMITS.perCallerRead : BOOKING_PUBLIC_LIMITS.perCallerWrite }]);
}

/** The live booking setup of the published page at `slug`, or `booking_closed` (counted against the small `closed` ceiling). */
async function openPage(ctx: PublicContext, slug: string): Promise<PublicBookingPage> {
  const clean = slug.trim().toLowerCase();
  const page = pageSlugProblem(clean) ? null : await repos.booking.publicPage(ctx.db, clean);
  if (!page) {
    await takeOrThrow(ctx.limits, "Booking", [{ key: bookingLimitKeys.closed, rule: BOOKING_PUBLIC_LIMITS.closed }]);
    throw refusal("booking_closed");
  }
  return page;
}

interface SlotSetup {
  businessId: string;
  timeZone: string;
  weeklyHours: WeeklyHours;
  useCalendar: boolean;
}

/**
 * The times nobody can book between `from` and `to`: bookings and running holds, and the founder's calendar when it is
 * switched on and connected. Null when the calendar is on and could not be read: the caller then offers nothing.
 */
async function busyTimes(ctx: Pick<Context, "db" | "gateway" | "log">, setup: SlotSetup, from: Date, to: Date, now: Date, exceptBookingId?: string, fresh = false): Promise<BusyRange[] | null> {
  // A day of margin on each side covers every buffer and the longest appointment.
  const start = new Date(from.getTime() - DAY);
  const end = new Date(to.getTime() + DAY);
  const booked = await repos.booking.busy(ctx.db, setup.businessId, start, end, now, exceptBookingId);
  if (!setup.useCalendar || !(await calendarConnected(ctx.db, setup.businessId))) return booked;
  const calendar = await calendarBusy(ctx, setup.businessId, start, end, { fresh });
  return calendar ? [...booked, ...calendar] : null;
}

async function slotsFor(ctx: Pick<Context, "db" | "gateway" | "log">, setup: SlotSetup, service: BookingService, range: { from: Date; to: Date }, now: Date, exceptBookingId?: string): Promise<string[]> {
  const to = new Date(Math.min(range.to.getTime(), range.from.getTime() + BOOKING_LIMITS.slotRangeDays * DAY));
  if (to < range.from) return [];
  const busy = await busyTimes(ctx, setup, range.from, to, now, exceptBookingId);
  if (!busy) return [];
  return slotStarts({ service, hours: setup.weeklyHours, timeZone: setup.timeZone, busy, now, from: range.from, to }).map(iso);
}

/** Whether `start` is offered right now, with fresh busy times. False too when the calendar could not be read. */
async function offered(ctx: Pick<Context, "db" | "gateway" | "log">, setup: SlotSetup, service: BookingService, start: Date, now: Date, exceptBookingId?: string): Promise<boolean> {
  const busy = await busyTimes(ctx, setup, start, new Date(start.getTime() + service.durationMin * 60_000), now, exceptBookingId, true);
  return !!busy && isOfferedSlot({ service, hours: setup.weeklyHours, timeZone: setup.timeZone, busy, now }, start);
}

// ---- the public page ------------------------------------------------------------------------------------------------

export interface PublicBookingView {
  slug: string;
  name: string;
  /** The founder's IANA zone: the hours are wall-clock times there. A visitor's own zone only changes how a time is shown. */
  timeZone: string;
  services: { id: string; name: string; durationMin: number; priceMinor: number | null; currency: string; mode: BookingMode; questions: string[] }[];
  /** The sentence the visitor agrees to, exactly as the booking keeps it. */
  consentText: string;
  /** Whether the page carries the small "Built on" mark. */
  mark: boolean;
}

/**
 * `publicBooking.block`: what the project's public page shows of booking (its services), or null when booking is not
 * open there. Read on every render of a project page, so "not open" is an ordinary answer: it is never counted
 * against the `closed` ceiling, which would let page views shut booking for everyone (security review, Nov 22, 2026).
 */
export async function publicBookingBlock(ctx: PublicContext, input: { slug: string }): Promise<{ services: PublicBookingView["services"] } | null> {
  await perCaller(ctx, "read");
  const clean = input.slug.trim().toLowerCase();
  const page = pageSlugProblem(clean) ? null : await repos.booking.publicPage(ctx.db, clean);
  return page ? { services: page.services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, priceMinor: s.priceMinor, currency: s.currency, mode: s.mode, questions: s.questions })) } : null;
}

export async function publicBooking(ctx: PublicContext, input: { slug: string }): Promise<PublicBookingView> {
  await perCaller(ctx, "read");
  const page = await openPage(ctx, input.slug);
  return {
    slug: page.slug,
    name: page.name,
    timeZone: page.timeZone,
    services: page.services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, priceMinor: s.priceMinor, currency: s.currency, mode: s.mode, questions: s.questions })),
    consentText: bookingConsentText(page.name),
    mark: await pageShowsMark(ctx, await repos.pages.public.planBySlug(ctx.db, page.slug)),
  };
}

export async function publicBookingSlots(ctx: PublicContext, input: { slug: string; serviceId: string; from: Date; to: Date }, now: Date = new Date()): Promise<{ slots: string[] }> {
  await perCaller(ctx, "read");
  const page = await openPage(ctx, input.slug);
  const service = page.services.find((s) => s.id === input.serviceId);
  return { slots: service ? await slotsFor(ctx, page, service, input, now) : [] };
}

/** Turns the follow form's bot-check refusals into booking's own. */
async function checkTurnstile(ctx: PublicContext, token: string | null | undefined): Promise<void> {
  try {
    await checkFollowTurnstile(ctx, token, undefined, BOOKING_TURNSTILE_ACTION);
  } catch (e) {
    if (e instanceof AppError && e.code === "follow_unverified") throw new AppError("booking_unverified", BOOKING_CHECK_ERRORS.booking_unverified, 403);
    if (e instanceof AppError && e.code === "follow_unavailable") throw new AppError("booking_unavailable", BOOKING_CHECK_ERRORS.booking_unavailable, 503);
    throw e;
  }
}

/**
 * `publicBooking.hold`: hold a slot while the visitor fills in the form. In order: the per-caller limit, the bot check
 * (fail closed), the page (else `booking_closed`), the page's hourly and daily caps, the slot re-checked on the server
 * with fresh busy times (`booking_slot_gone`), then the hold itself, which the database refuses when someone else holds
 * or has booked an overlapping time (`booking_slot_taken`). A browser holds one slot at a time: `replaces` gives its
 * earlier hold back first.
 */
export async function holdBookingSlot(ctx: PublicContext, input: { slug: string; serviceId: string; start: Date; turnstile?: string | null; replaces?: string | null }, now: Date = new Date()): Promise<{ holdToken: string; expiresAt: string }> {
  await perCaller(ctx, "write");
  await checkTurnstile(ctx, input.turnstile);
  const page = await openPage(ctx, input.slug);
  await takeOrThrow(ctx.limits, "Booking", [
    { key: bookingLimitKeys.holdsPerPageHour(page.businessId), rule: BOOKING_PUBLIC_LIMITS.holdsPerPageHour },
    { key: bookingLimitKeys.holdsPerPageDay(page.businessId), rule: BOOKING_PUBLIC_LIMITS.holdsPerPageDay },
  ]);
  const service = page.services.find((s) => s.id === input.serviceId);
  if (!service) throw refusal("booking_slot_gone");
  if (input.replaces) {
    // Only this page's own hold: a token of another project's hold changes nothing.
    const earlier = await repos.booking.heldByToken(ctx.db, hashOf(input.replaces), now);
    if (earlier?.businessId === page.businessId) await repos.booking.releaseHold(ctx.db, hashOf(input.replaces));
  }
  if ((await repos.booking.runningHolds(ctx.db, page.businessId, now)) >= HOLDS_RUNNING_PER_PAGE) throw new RateLimitedError("Booking", BOOKING_HOLD_MINUTES * 60_000);
  if (!(await offered(ctx, page, service, input.start, now))) throw refusal("booking_slot_gone");
  const holdToken = randomBytes(32).toString("base64url");
  const held = await repos.booking.hold(ctx.db, page.businessId, { service, start: input.start, holdTokenHash: hashOf(holdToken), test: simulatedHere(ctx.env), now });
  if (!held) throw refusal("booking_slot_taken");
  return { holdToken, expiresAt: iso(held.holdExpiresAt!) };
}

export interface ConfirmBookingInput {
  slug: string;
  holdToken: string;
  name: string;
  email: string;
  /** One answer per question of the service, in order; an empty one is left out. */
  answers?: string[];
  consent: boolean;
  /** The hidden field: a person never fills it in. */
  website?: string | null;
  /** The visitor's own IANA zone: their emails are written in it. */
  visitorTimeZone?: string | null;
}

const EmailShape = z.email();
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
/** A customer's name inside a note: one line, without the characters markup reserves. */
const nameInNote = (name: string, entityId: string | null): string => (entityId ? entityMention(entityId, name) : name.replace(/[[\]|*_`<>]/g, "").trim() || "A customer");

/** A short Update note to the founders from the Chief of Staff, in the caller's transaction. Never a customer's answers. */
async function founderNote(tx: DbTx, businessId: string, note: { subject: string; body: string; entityId: string | null }): Promise<void> {
  const chief = await repos.agents.chiefOfStaff(tx, businessId);
  await repos.inbox.createItem(tx, businessId, { type: "update", from_agent_id: chief?.id ?? null, subject: note.subject.slice(0, 80), body_md: note.body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: note.entityId ? [note.entityId] : [] });
}

/** Asks the gateway for a booking's email; never fails the caller. */
async function sendBookingMail(ctx: Pick<Context, "gateway" | "log">, businessId: string, bookingId: string, kind: BookingMailKind): Promise<void> {
  try {
    const answer = await ctx.gateway.bookingMail?.({ businessId, bookingId, kind });
    if (answer && !answer.sent) ctx.log.info({ businessId, bookingId, kind, reason: answer.reason }, "booking email not sent");
  } catch (e) {
    ctx.log.warn({ businessId, bookingId, kind, code: e instanceof AppError ? e.code : "unknown" }, "booking email not sent: the gateway did not answer");
  }
}

/**
 * `publicBooking.confirm`: the held slot becomes a booking. The hidden field filled in answers like a success and
 * writes nothing. The name, the email (the follow form's shape rule), the ticked box and the answers are checked, then
 * the per-email limits, then one transaction (see the file's header). A hold that ran out answers
 * `booking_hold_expired` and nothing is written.
 */
export async function confirmBooking(ctx: PublicContext, input: ConfirmBookingInput, now: Date = new Date()): Promise<{ startsAt: string; serviceName: string }> {
  await perCaller(ctx, "write");
  const page = await openPage(ctx, input.slug);
  const tokenHash = hashOf(input.holdToken);
  const hold = await repos.booking.heldByToken(ctx.db, tokenHash, now);
  const service = hold && hold.businessId === page.businessId ? await repos.booking.service(ctx.db, page.businessId, hold.serviceId) : null;
  if (!hold || !service) throw refusal("booking_hold_expired");
  if (typeof input.website === "string" && input.website.trim() !== "") return { startsAt: iso(hold.startsAt), serviceName: service.name };

  const name = oneLine(input.name);
  if (!name || name.length > BOOKING_LIMITS.customerName) throw refusal("booking_name");
  const email = input.email.trim().toLowerCase();
  if (followEmailProblem(email) || !EmailShape.safeParse(email).success) throw refusal("booking_email");
  if (input.consent !== true) throw refusal("booking_consent");
  const given = input.answers ?? [];
  if (given.length > service.questions.length || given.some((a) => a.trim().length > BOOKING_LIMITS.answer)) throw new ValidationError(`An answer can have up to ${BOOKING_LIMITS.answer} characters.`);
  // The customer's own words, kept beside the question they answer: stored and shown to the founders, nothing else.
  const answers = given.flatMap((a, i) => (a.trim() ? [{ question: service.questions[i]!, answer: a.trim() }] : []));
  const visitorTimeZone = isValidTimeZone(input.visitorTimeZone) ? input.visitorTimeZone : null;

  await takeOrThrow(ctx.limits, "Booking", [
    { key: bookingLimitKeys.bookingsPerPageDay(page.businessId), rule: BOOKING_PUBLIC_LIMITS.bookingsPerPageDay },
    { key: bookingLimitKeys.perEmailPage(ctx.env, page.businessId, email), rule: BOOKING_PUBLIC_LIMITS.perEmailPage },
    { key: bookingLimitKeys.perEmailAll(ctx.env, email), rule: BOOKING_PUBLIC_LIMITS.perEmailAll },
  ]);

  // A member of the project booking on its own page is trying it out: a test, like every booking where results are simulated.
  // Both lookups always run, so the answer's timing says nothing about whether the address has an account.
  const memberId = await repos.founders.userIdByEmail(ctx.db, email).catch(() => null);
  const byMember = !!(await repos.memberships.getActive(ctx.db, page.businessId, memberId ?? NIL_ID).catch(() => null));

  const booking = await ctx.db.transaction(async (tx) => {
    const entityId = await repos.booking.customerEntity(tx, page.businessId, { name, email });
    let row = await repos.booking.confirm(tx, page.businessId, { holdTokenHash: tokenHash, customerName: name, customerEmail: email, answers, consentText: bookingConsentText(page.name), visitorTimeZone, entityId, now });
    if (!row) throw refusal("booking_hold_expired");
    if (byMember && !row.test) row = (await repos.booking.markTest(tx, page.businessId, row.id)) ?? row;
    await writeEventRow(tx, { businessId: page.businessId, type: "booking.confirmed", actor: PUBLIC_BOOKING_ACTOR, payload: { bookingId: row.id, serviceId: row.serviceId, entityId, startsAt: iso(row.startsAt), ...(row.test ? { simulated: true as const } : {}) }, entityIds: entityId ? [entityId] : [] });
    await repos.audit.append(tx, page.businessId, { actorKind: "system", actorId: null, action: "booking.confirmed", target: { kind: "booking", id: row.id }, details: { serviceId: row.serviceId, slug: page.slug, test: row.test, newContact: entityId !== null } });
    const when = bookingTimeLabel(row.startsAt, page.timeZone);
    // A known contact is named as the project's records name them, never as the visitor typed.
    const who = nameInNote(entityId ? (await repos.entities.get(tx, page.businessId, entityId)).displayName : name, entityId);
    if (row.test) await founderNote(tx, page.businessId, { subject: `Test booking: ${service.name}`, body: `Test booking: ${service.name}, ${when}, by ${who}. It was made by someone on the project or where results are simulated, so it does not count as a real booking.`, entityId });
    else if ((await repos.booking.realCount(tx, page.businessId)) === 1) await founderNote(tx, page.businessId, { subject: "Customer Update: your first booking", body: `Your first booking: ${service.name}, ${when}, with ${who}. A customer picked a time on your page. They have a confirmation by email and get a reminder the day before.`, entityId });
    else await founderNote(tx, page.businessId, { subject: `New booking: ${service.name}`, body: `New booking: ${service.name}, ${when}, with ${who}.`, entityId });
    return row;
  });

  // After the commit, best effort: the booking stands whether or not these go through.
  if (page.useCalendar) {
    try {
      const eventId = (await calendarConnected(ctx.db, page.businessId)) ? await addCalendarEvent(ctx, page.businessId, { summary: `${service.name} with ${name}`, start: booking.startsAt, end: booking.endsAt, timeZone: page.timeZone }) : null;
      if (eventId) await repos.booking.setCalendarEvent(ctx.db, page.businessId, booking.id, eventId);
    } catch (e) {
      ctx.log.warn({ businessId: page.businessId, bookingId: booking.id, code: e instanceof AppError ? e.code : "unknown" }, "booking: the calendar event was not written");
    }
  }
  await sendBookingMail(ctx, page.businessId, booking.id, "confirmation");
  return { startsAt: iso(booking.startsAt), serviceName: service.name };
}

// ---- changes to a booking (the customer's link and the founders) ------------------------------------------------------

type ChangeContext = Pick<Context, "db" | "gateway" | "log">;
type Changer = { by: "customer" } | { by: "founder"; userId: string };

const actorOf = (who: Changer) => (who.by === "customer" ? PUBLIC_BOOKING_ACTOR : ({ kind: "user", id: who.userId } as const));
const facts = (b: Booking) => ({ bookingId: b.id, serviceId: b.serviceId, entityId: b.entityId, startsAt: iso(b.startsAt), ...(b.test ? { simulated: true as const } : {}) });
const auditChange = (tx: DbTx, b: Booking, who: Changer, action: string, details: Record<string, unknown> = {}) =>
  repos.audit.append(tx, b.businessId, { actorKind: who.by === "customer" ? "system" : "user", actorId: who.by === "customer" ? null : who.userId, action, target: { kind: "booking", id: b.id }, details: { by: who.by, ...details } });
/** The calendar keeps the old event: changing or removing it asks the founder first, and booking never waits on that. */
const calendarLine = (b: Booking): string => (b.calendarEventId ? " Your calendar still shows the earlier event: change or remove it there." : "");

/** Cancel a confirmed booking: the time is free at once, the customer is emailed and the founders get a note. Null when it was not confirmed. */
async function cancelBooking(ctx: ChangeContext, booking: Booking, who: Changer, now: Date): Promise<Booking | null> {
  const [service, setup] = await Promise.all([repos.booking.service(ctx.db, booking.businessId, booking.serviceId), repos.booking.setup(ctx.db, booking.businessId)]);
  const done = await ctx.db.transaction(async (tx) => {
    const row = await repos.booking.cancel(tx, booking.businessId, booking.id, who.by, now);
    if (!row) return null;
    await writeEventRow(tx, { businessId: row.businessId, type: "booking.canceled", actor: actorOf(who), payload: { ...facts(row), by: who.by }, entityIds: row.entityId ? [row.entityId] : [] });
    await auditChange(tx, row, who, "booking.canceled");
    const when = bookingTimeLabel(row.startsAt, setup.settings?.timeZone ?? "UTC");
    const whoName = nameInNote(row.customerName ?? "A customer", row.entityId);
    await founderNote(tx, row.businessId, { subject: `Booking canceled: ${service?.name ?? "a booking"}`, body: `Booking canceled${who.by === "customer" ? " by the customer" : ""}: ${service?.name ?? "a booking"}, ${when}, with ${whoName}. The time is free again.${calendarLine(row)}`, entityId: row.entityId });
    return row;
  });
  if (done) await sendBookingMail(ctx, done.businessId, done.id, "canceled");
  return done;
}

/**
 * Move a confirmed booking to another start. `booking_slot_gone` when the time is not one the service offers (a
 * founder may move inside the notice a visitor must give); `booking_slot_taken` when the database refuses it, and
 * nothing changes.
 */
async function moveBooking(ctx: ChangeContext, booking: Booking, start: Date, who: Changer, now: Date): Promise<Booking> {
  const [service, setup] = await Promise.all([repos.booking.service(ctx.db, booking.businessId, booking.serviceId), repos.booking.setup(ctx.db, booking.businessId)]);
  if (!service || !setup.settings) throw refusal("booking_not_found");
  const rules = who.by === "founder" ? { ...service, minNoticeMin: 0 } : service;
  if (!(await offered(ctx, setup.settings, rules, start, now, booking.id))) throw refusal("booking_slot_gone");
  const zone = setup.settings.timeZone;
  const moved = await ctx.db.transaction(async (tx) => {
    const row = await repos.booking.reschedule(tx, booking.businessId, booking.id, { service, start, now });
    if (!row) return null;
    await writeEventRow(tx, { businessId: row.businessId, type: "booking.rescheduled", actor: actorOf(who), payload: { ...facts(row), by: who.by, previousStartsAt: iso(booking.startsAt) }, entityIds: row.entityId ? [row.entityId] : [] });
    await auditChange(tx, row, who, "booking.rescheduled", { previousStartsAt: iso(booking.startsAt), startsAt: iso(row.startsAt) });
    const whoName = nameInNote(row.customerName ?? "A customer", row.entityId);
    await founderNote(tx, row.businessId, { subject: `Booking moved: ${service.name}`, body: `Booking moved${who.by === "customer" ? " by the customer" : ""}: ${service.name} with ${whoName}, from ${bookingTimeLabel(booking.startsAt, zone)} to ${bookingTimeLabel(row.startsAt, zone)}.${calendarLine(row)}`, entityId: row.entityId });
    return row;
  });
  if (!moved) throw refusal("booking_slot_taken");
  await sendBookingMail(ctx, moved.businessId, moved.id, "rescheduled");
  return moved;
}

// ---- the customer's link ----------------------------------------------------------------------------------------------

export interface ManagedBookingView {
  status: Exclude<BookingStatus, "held">;
  projectName: string;
  slug: string;
  serviceId: string;
  serviceName: string;
  /** ISO UTC instant. */
  startsAt: string;
  durationMin: number;
  mode: BookingMode;
  /** False once the booking started, or when it is no longer confirmed. */
  canChange: boolean;
  /** The founder's IANA zone. */
  timeZone: string;
}

async function managed(ctx: PublicContext, token: string, kind: "read" | "write" = "read") {
  await perCaller(ctx, kind);
  const secret = bookingLinkSecret(ctx.env);
  const id = secret ? readBookingManageToken(secret, token) : null;
  const booking = id ? await repos.booking.getById(ctx.db, id) : null;
  if (!booking || booking.status === "held") throw refusal("booking_not_found");
  const [service, setup, page, business] = await Promise.all([repos.booking.service(ctx.db, booking.businessId, booking.serviceId), repos.booking.setup(ctx.db, booking.businessId), repos.pages.get(ctx.db, booking.businessId), repos.businesses.get(ctx.db, booking.businessId).catch(() => null)]);
  if (!service || !setup.settings || !page || !business) throw refusal("booking_not_found");
  return { booking, service, settings: setup.settings, slug: page.slug, projectName: business.name };
}

const managedView = (m: Awaited<ReturnType<typeof managed>>, booking: Booking, now: Date): ManagedBookingView => ({
  status: booking.status as ManagedBookingView["status"],
  projectName: m.projectName,
  slug: m.slug,
  serviceId: m.service.id,
  serviceName: m.service.name,
  startsAt: iso(booking.startsAt),
  durationMin: m.service.durationMin,
  mode: m.service.mode,
  canChange: booking.status === "confirmed" && booking.startsAt > now,
  timeZone: m.settings.timeZone,
});

export async function manageBooking(ctx: PublicContext, input: { token: string }, now: Date = new Date()): Promise<ManagedBookingView> {
  const m = await managed(ctx, input.token);
  return managedView(m, m.booking, now);
}

/** A customer may cancel or move until the start; after it, or once it is no longer confirmed, `booking_too_late`. */
function assertChangeable(booking: Booking, now: Date): void {
  if (booking.status !== "confirmed" || booking.startsAt <= now) throw refusal("booking_too_late");
}

/** One booking's link may cancel or move it a few times a day: each change tells the founders and sends an email. */
const takeChange = (ctx: PublicContext, bookingId: string) => takeOrThrow(ctx.limits, "Booking", [{ key: bookingLimitKeys.changesPerBooking(bookingId), rule: BOOKING_PUBLIC_LIMITS.changesPerBooking }]);

export async function cancelManagedBooking(ctx: PublicContext, input: { token: string }, now: Date = new Date()): Promise<ManagedBookingView> {
  const m = await managed(ctx, input.token, "write");
  // A second press on a canceled booking shows it as it is.
  if (m.booking.status === "canceled") return managedView(m, m.booking, now);
  assertChangeable(m.booking, now);
  await takeChange(ctx, m.booking.id);
  const done = await cancelBooking(ctx, m.booking, { by: "customer" }, now);
  if (!done) throw refusal("booking_too_late");
  return managedView(m, done, now);
}

export async function rescheduleManagedBooking(ctx: PublicContext, input: { token: string; start: Date }, now: Date = new Date()): Promise<ManagedBookingView> {
  const m = await managed(ctx, input.token, "write");
  assertChangeable(m.booking, now);
  await takeChange(ctx, m.booking.id);
  return managedView(m, await moveBooking(ctx, m.booking, input.start, { by: "customer" }, now), now);
}

/** The times the customer can move to: the same engine, with the booking's own time left out of what is busy. */
export async function manageBookingSlots(ctx: PublicContext, input: { token: string; from: Date; to: Date }, now: Date = new Date()): Promise<{ slots: string[] }> {
  const m = await managed(ctx, input.token);
  if (m.booking.status !== "confirmed" || m.booking.startsAt <= now) return { slots: [] };
  return { slots: await slotsFor(ctx, m.settings, m.service, input, now, m.booking.id) };
}

// ---- the founders -----------------------------------------------------------------------------------------------------

export const BOOKING_ADMIN_MESSAGE = "Owners, cofounders and admins set up and change booking.";
export const BOOKING_LIVE_NEEDS_PAGE = "Publish your project's page first: booking lives on it.";
export const BOOKING_LIVE_NEEDS_SERVICE = "Add at least one service before you turn booking on.";

function assertAdmin(ctx: BusinessContext): void {
  if (!isAdminRole(ctx.role)) throw new ForbiddenError(BOOKING_ADMIN_MESSAGE);
}

export interface BookingSetupView {
  settings: { status: BookingSetupStatus; timeZone: string; weeklyHours: WeeklyHours; useCalendar: boolean; draftedByTeam: boolean; approvedAt: string | null } | null;
  services: { id: string; name: string; durationMin: number; bufferBeforeMin: number; bufferAfterMin: number; priceMinor: number | null; currency: string; mode: BookingMode; minNoticeMin: number; maxDaysAhead: number; questions: string[] }[];
  calendarConnected: boolean;
  pagePublished: boolean;
  /** The booking page's address once the project's page is published, else null. */
  publicUrl: string | null;
}

export async function bookingSetupView(ctx: BusinessContext): Promise<BookingSetupView> {
  const [setup, page, connected] = await ctx.rls(async (tx) => [await repos.booking.setup(tx, ctx.businessId), await repos.pages.get(tx, ctx.businessId), await calendarConnected(tx, ctx.businessId)] as const);
  const s = setup.settings;
  const published = !!page?.published;
  return {
    settings: s ? { status: s.status, timeZone: s.timeZone, weeklyHours: s.weeklyHours, useCalendar: s.useCalendar, draftedByTeam: s.draftedByAgentId !== null, approvedAt: s.approvedAt ? iso(s.approvedAt) : null } : null,
    services: setup.services.map((v) => ({ id: v.id, name: v.name, durationMin: v.durationMin, bufferBeforeMin: v.bufferBeforeMin, bufferAfterMin: v.bufferAfterMin, priceMinor: v.priceMinor, currency: v.currency, mode: v.mode, minNoticeMin: v.minNoticeMin, maxDaysAhead: v.maxDaysAhead, questions: v.questions })),
    calendarConnected: connected,
    pagePublished: published,
    publicUrl: published && page ? `${pageUrl(ctx.env.APP_URL, page.slug)}/book` : null,
  };
}

export interface SaveBookingSetupInput {
  timeZone: string;
  weeklyHours: WeeklyHours;
  useCalendar?: boolean;
  services: { id?: string; name: string; durationMin: number; bufferBeforeMin?: number; bufferAfterMin?: number; priceMinor?: number | null; mode?: BookingMode; minNoticeMin?: number; maxDaysAhead?: number; questions?: string[] }[];
}

/** `booking.save`: the zone, the hours, the calendar switch and the whole list of services. Saving never turns booking on or off. */
export async function saveBookingSetup(ctx: BusinessContext, input: SaveBookingSetupInput): Promise<BookingSetupView> {
  assertAdmin(ctx);
  // The booking tables are the services' to write (0157): the role was checked above.
  await ctx.db.transaction(async (tx) => {
    const saved = await repos.booking.saveSetup(tx, ctx.businessId, { ...input, currency: ctx.business.currency });
    await audit(tx, ctx, { action: "booking.setup_saved", target: { kind: "business", id: ctx.businessId }, details: { services: saved.services.length, useCalendar: saved.settings?.useCalendar ?? false } });
  });
  return bookingSetupView(ctx);
}

/** `booking.setLive`: the founder's own press. Turning on needs a published page and a service; turning off keeps the bookings already made. */
export async function setBookingLive(ctx: BusinessContext, input: { live: boolean }): Promise<BookingSetupView> {
  assertAdmin(ctx);
  if (input.live) {
    const view = await bookingSetupView(ctx);
    if (!view.settings || view.services.length === 0) throw new ConflictError(BOOKING_LIVE_NEEDS_SERVICE, { code: "booking_needs_service" });
    if (!view.pagePublished) throw new ConflictError(BOOKING_LIVE_NEEDS_PAGE, { code: "booking_needs_page" });
  }
  await ctx.db.transaction(async (tx) => {
    const row = await repos.booking.setLive(tx, ctx.businessId, input.live, ctx.userId);
    if (!row) throw new ConflictError(BOOKING_LIVE_NEEDS_SERVICE, { code: "booking_needs_service" });
    await audit(tx, ctx, { action: input.live ? "booking.turned_on" : "booking.turned_off", target: { kind: "business", id: ctx.businessId } });
  });
  return bookingSetupView(ctx);
}

/** A booking as the founders see it. `answers` are the customer's own words: plain text, never instructions. */
export interface FounderBooking {
  id: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: Exclude<BookingStatus, "held">;
  customerName: string;
  customerEmail: string;
  answers: { question: string; answer: string }[];
  test: boolean;
  entityId: string | null;
}

/** `booking.list`: upcoming bookings soonest first, or past ones newest first. A customer record: CRM read. */
export async function listBookings(ctx: BusinessContext, input: { when: "upcoming" | "past" }, now: Date = new Date()): Promise<FounderBooking[]> {
  const rows = await ctx.rls((tx) => repos.booking.list(tx, ctx.businessId, input.when === "upcoming" ? { from: now } : { before: now }));
  return rows.map((b) => ({ id: b.id, serviceId: b.serviceId, serviceName: b.serviceName, startsAt: iso(b.startsAt), endsAt: iso(b.endsAt), status: b.status as FounderBooking["status"], customerName: b.customerName ?? "", customerEmail: b.customerEmail ?? "", answers: b.answers, test: b.test, entityId: b.entityId }));
}

export interface UpcomingBooking {
  id: string;
  serviceName: string;
  startsAt: string;
  customerName: string;
}

/** Today's next confirmed bookings (`today.get`), for a reader with CRM read; empty otherwise. */
export async function upcomingBookingsFor(tx: DbTx, ctx: BusinessContext, now: Date = new Date(), limit = 3): Promise<UpcomingBooking[]> {
  if (!hasSectionAccess(ctx.membership, "crm", "read")) return [];
  const rows = await repos.booking.list(tx, ctx.businessId, { from: now, limit: 50 });
  return rows.filter((b) => b.status === "confirmed").slice(0, limit).map((b) => ({ id: b.id, serviceName: b.serviceName, startsAt: iso(b.startsAt), customerName: b.customerName ?? "" }));
}

/** `booking.slots`: the times a founder can move a booking to (no notice needed), or what a visitor would be offered. */
export async function founderBookingSlots(ctx: BusinessContext, input: { serviceId: string; from: Date; to: Date; exceptBookingId?: string }, now: Date = new Date()): Promise<{ slots: string[] }> {
  const [setup, service] = await ctx.rls(async (tx) => [await repos.booking.setup(tx, ctx.businessId), await repos.booking.service(tx, ctx.businessId, input.serviceId)] as const);
  if (!setup.settings || !service) return { slots: [] };
  return { slots: await slotsFor(ctx, setup.settings, input.exceptBookingId ? { ...service, minNoticeMin: 0 } : service, input, now, input.exceptBookingId) };
}

async function ownBooking(ctx: BusinessContext, bookingId: string): Promise<Booking> {
  const booking = await ctx.rls((tx) => repos.booking.get(tx, ctx.businessId, bookingId));
  if (!booking || booking.status === "held") throw refusal("booking_not_found");
  return booking;
}

/** `booking.cancel`: the time is free at once and the customer is emailed. */
export async function cancelBookingAsFounder(ctx: BusinessContext, input: { bookingId: string }, now: Date = new Date()): Promise<{ ok: true }> {
  assertAdmin(ctx);
  const done = await cancelBooking(ctx, await ownBooking(ctx, input.bookingId), { by: "founder", userId: ctx.userId }, now);
  if (!done) throw new ConflictError("This booking is not confirmed, so there is nothing to cancel.", { code: "booking_not_confirmed" });
  return { ok: true };
}

/** `booking.move`: to another time the service's hours offer; the customer is emailed. A taken time is refused and nothing changes. */
export async function moveBookingAsFounder(ctx: BusinessContext, input: { bookingId: string; start: Date }, now: Date = new Date()): Promise<{ ok: true; startsAt: string }> {
  assertAdmin(ctx);
  const booking = await ownBooking(ctx, input.bookingId);
  if (booking.status !== "confirmed") throw new ConflictError("This booking is not confirmed, so it cannot be moved.", { code: "booking_not_confirmed" });
  const moved = await moveBooking(ctx, booking, input.start, { by: "founder", userId: ctx.userId }, now);
  return { ok: true, startsAt: iso(moved.startsAt) };
}

/** `booking.noShow`: the customer did not come. Only after the start; nobody is emailed. */
export async function markBookingNoShow(ctx: BusinessContext, input: { bookingId: string }, now: Date = new Date()): Promise<{ ok: true }> {
  assertAdmin(ctx);
  const booking = await ownBooking(ctx, input.bookingId);
  await ctx.db.transaction(async (tx) => {
    const row = await repos.booking.markNoShow(tx, ctx.businessId, booking.id, now);
    if (!row) throw new ConflictError("Only a confirmed booking whose time has come can be marked as a no-show.", { code: "booking_not_started" });
    await emit(tx, ctx, { type: "booking.no_show", payload: facts(row), entityIds: row.entityId ? [row.entityId] : [] });
    await audit(tx, ctx, { action: "booking.no_show", target: { kind: "booking", id: row.id } });
  });
  return { ok: true };
}

/**
 * The team's "Booking is ready for you to check" note, decided in-process like the page note: "Check it and turn it
 * on" answers it and the client opens the booking setup; "Later" answers it. Neither turns booking on: that stays the
 * founder's own press in the setup, after checking it.
 */
export async function decideBookingNote(ctx: BusinessContext, item: InboxItem, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  const option = input.chosenOption;
  if (option !== BOOKING_READY_NOTE.options.check && option !== BOOKING_READY_NOTE.options.later) throw new ValidationError(`Choose ${BOOKING_READY_NOTE.checkLabel} or ${BOOKING_READY_NOTE.laterLabel}.`, { itemId: item.id });
  const summary = option === BOOKING_READY_NOTE.options.check ? "Opened the booking setup to check it." : "The booking setup waits until later.";
  const answered = await ctx.rls((tx) => answerNote(tx, ctx, item.id, option, input.freeText, item.fromAgentId, summary, { params: { booking_option: option }, result: { bookingOption: option } }));
  if (!answered) throw new ConflictError("This note was answered a moment ago.", { itemId: item.id, code: "already_decided" });
  return { item: answered.item, decision: answered.decision, plan: answered.plan, evaluations: [], requiresConfirmation: false, executed: [answered.actionId], deferred: [], denied: [], dispatch: null, followUp: null };
}
