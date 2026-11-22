/**
 * Booking (founder, Nov 22, 2026): Foundmill's own, free on every plan, for any project whose customers pick a time
 * (tutoring, cleaning, coaching, repairs). One person, any number of services. No booking vendor is set up or named.
 *
 * This file is the pure part, safe in a browser: the shapes, the limits, and the slot arithmetic. Every instant is
 * stored and compared in UTC; the founder's weekly hours are wall-clock minutes in the founder's IANA zone and are
 * turned into instants one calendar day at a time, so a daylight-saving change moves no slot and doubles none: a wall
 * time that does not exist that day (the hour skipped in spring) offers no slot, and one that happens twice (the hour
 * repeated in the fall) offers one, the first. A visitor's own zone only changes how an instant is shown.
 *
 * Double booking is prevented in the database, not here (0161: an exclusion constraint over the busy range of held and
 * confirmed bookings). `slotStarts` decides what is offered; the constraint decides who gets it.
 */
import { isValidTimeZone } from "./time-zone";

export const BOOKING_LIMITS = {
  services: 20,
  serviceName: 80,
  durationMin: { min: 10, max: 480 },
  bufferMin: { min: 0, max: 120 },
  /** How soon before its start a slot can still be booked, in minutes. */
  noticeMin: { min: 0, max: 14 * 24 * 60 },
  daysAhead: { min: 1, max: 180 },
  questions: 3,
  question: 120,
  answer: 500,
  customerName: 80,
  windowsPerDay: 4,
  /** The widest range of days one slots request may ask for. */
  slotRangeDays: 31,
} as const;

/** Minutes between the slot starts offered inside a window of hours. */
export const BOOKING_SLOT_STEP_MIN = 30;
/** How long a slot is held for a visitor who is filling in the form. */
export const BOOKING_HOLD_MINUTES = 10;
/** Hours before a booking that the customer's reminder goes out. */
export const BOOKING_REMINDER_HOURS = 24;

export const BOOKING_MODES = ["online", "in_person"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

/** `held`: a visitor is filling in the form. `confirmed`: booked. The rest free the slot. */
export const BOOKING_STATUSES = ["held", "confirmed", "canceled", "no_show", "completed"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
/** The statuses that keep their slot: nobody else can take an overlapping one. */
export const BOOKING_HOLDING_STATUSES: readonly BookingStatus[] = ["held", "confirmed"];

/** `draft`: set up (by the founder or drafted by the team) and not public. `live`: the founder approved it; visitors can book. */
export const BOOKING_SETUP_STATUSES = ["draft", "live"] as const;
export type BookingSetupStatus = (typeof BOOKING_SETUP_STATUSES)[number];

/** One window of a day's hours, in minutes from midnight in the founder's zone: `{ start: 540, end: 1020 }` is 9:00 AM to 5:00 PM. */
export interface HoursWindow {
  start: number;
  end: number;
}
/** Weekly hours by weekday, "0" (Sunday) to "6" (Saturday). A missing day is a day off. */
export type WeeklyHours = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", HoursWindow[]>>;

export interface BookingServiceShape {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxDaysAhead: number;
}

export interface BusyRange {
  start: Date;
  end: Date;
}

/** Monday to Friday, 9:00 AM to 5:00 PM: where a drafted setup starts when the founder named no hours. */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = Object.freeze({ "1": [{ start: 540, end: 1020 }], "2": [{ start: 540, end: 1020 }], "3": [{ start: 540, end: 1020 }], "4": [{ start: 540, end: 1020 }], "5": [{ start: 540, end: 1020 }] });

/** What is wrong with weekly hours, in words a founder can act on, or null. */
export function weeklyHoursProblem(hours: unknown): string | null {
  if (!hours || typeof hours !== "object" || Array.isArray(hours)) return "Hours are missing.";
  for (const [day, windows] of Object.entries(hours as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(day)) return "A day of the week is not valid.";
    if (!Array.isArray(windows) || windows.length > BOOKING_LIMITS.windowsPerDay) return `A day can have up to ${BOOKING_LIMITS.windowsPerDay} sets of hours.`;
    let last = -1;
    for (const w of windows as HoursWindow[]) {
      if (!w || !Number.isInteger(w.start) || !Number.isInteger(w.end) || w.start < 0 || w.end > 1440 || w.start >= w.end) return "Hours must start before they end, within one day.";
      if (w.start < last) return "Hours on the same day cannot overlap.";
      last = w.end;
    }
  }
  return null;
}

const partsFormat = new Map<string, Intl.DateTimeFormat>();
function wallParts(at: number, timeZone: string): { day: string; minutes: number; weekday: number; asUtc: number } {
  let f = partsFormat.get(timeZone);
  if (!f) {
    // us-english-allow: the parts are read as numbers (the zone's date and minutes from midnight), never shown to a person.
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsFormat.set(timeZone, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(at))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return { day: new Date(asUtc).toISOString().slice(0, 10), minutes: p.hour! * 60 + p.minute!, weekday: new Date(asUtc).getUTCDay(), asUtc };
}

/**
 * The instant a wall-clock time happens on a calendar day in a zone, or null when it does not exist that day (the hour
 * a spring daylight-saving change skips). A time that happens twice (the hour repeated in the fall) gives the first.
 */
export function instantOfWallTime(day: string, minutes: number, timeZone: string): Date | null {
  const wanted = Date.parse(`${day}T00:00:00.000Z`) + minutes * 60_000;
  // A zone changes its offset at most once around a day: the wall time read with the offset a day before and with the
  // offset a day after are the only candidates. The earlier instant that reads back as the wall time wins.
  const offsetAt = (at: number) => wallParts(at, timeZone).asUtc - at;
  const candidates = [wanted - offsetAt(wanted - 86_400_000), wanted - offsetAt(wanted + 86_400_000)].sort((x, y) => x - y);
  for (const candidate of candidates) {
    const p = wallParts(candidate, timeZone);
    if (p.day === day && p.minutes === minutes) return new Date(candidate);
  }
  return null;
}

/** The busy range a booking of the service takes when it starts at `start`: its buffers included. */
export function busyRangeOf(service: Pick<BookingServiceShape, "durationMin" | "bufferBeforeMin" | "bufferAfterMin">, start: Date): BusyRange {
  return { start: new Date(start.getTime() - service.bufferBeforeMin * 60_000), end: new Date(start.getTime() + (service.durationMin + service.bufferAfterMin) * 60_000) };
}

const overlaps = (a: BusyRange, b: BusyRange) => a.start < b.end && b.start < a.end;

export interface SlotInput {
  service: BookingServiceShape;
  hours: WeeklyHours;
  /** The founder's IANA zone: the hours are wall-clock times there. */
  timeZone: string;
  /** Times that cannot be booked: held and confirmed bookings with their buffers, and the founder's calendar. */
  busy: readonly BusyRange[];
  now: Date;
  /** The range asked for; it is narrowed to the service's notice and how far ahead it can be booked. */
  from: Date;
  to: Date;
}

/** The starts a visitor can book, ascending, as UTC instants. */
export function slotStarts(input: SlotInput): Date[] {
  const { service, hours, timeZone, busy, now } = input;
  if (!isValidTimeZone(timeZone)) return [];
  const earliest = Math.max(input.from.getTime(), now.getTime() + service.minNoticeMin * 60_000);
  const latest = Math.min(input.to.getTime(), now.getTime() + service.maxDaysAhead * 86_400_000);
  if (earliest > latest) return [];
  const out: Date[] = [];
  const seen = new Set<number>();
  // Calendar days in the founder's zone that the range touches, with a day of margin on each side for the zone's offset.
  const firstDay = Date.parse(`${wallParts(earliest, timeZone).day}T00:00:00.000Z`) - 86_400_000;
  const lastDay = Date.parse(`${wallParts(latest, timeZone).day}T00:00:00.000Z`) + 86_400_000;
  for (let d = firstDay; d <= lastDay; d += 86_400_000) {
    const day = new Date(d).toISOString().slice(0, 10);
    const windows = hours[String(new Date(d).getUTCDay()) as keyof WeeklyHours] ?? [];
    for (const w of windows) {
      for (let m = w.start; m + service.durationMin <= w.end; m += BOOKING_SLOT_STEP_MIN) {
        const start = instantOfWallTime(day, m, timeZone);
        if (!start) continue;
        const t = start.getTime();
        if (t < earliest || t > latest || seen.has(t)) continue;
        // The appointment must also end inside the window's real time: a slot whose end falls in a skipped hour is kept
        // as long as it fits the window on the clock, which is what the founder's hours mean.
        const range = busyRangeOf(service, start);
        if (busy.some((b) => overlaps(range, b))) continue;
        seen.add(t);
        out.push(start);
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** Whether `start` is a slot the service offers right now: what the server checks before it holds or moves a booking. */
export function isOfferedSlot(input: Omit<SlotInput, "from" | "to">, start: Date): boolean {
  return slotStarts({ ...input, from: start, to: start }).some((s) => s.getTime() === start.getTime());
}

/** "Wed, Oct 7, 3:45 PM" in a zone, with the zone's short name: how an appointment is written to a person. */
export function bookingTimeLabel(at: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
}

/** "9:00 AM" for minutes from midnight. */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "1 hour", "45 minutes", "1 hour 30 minutes". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const mins = m ? `${m} minutes` : "";
  return [hours, mins].filter(Boolean).join(" ") || "0 minutes";
}

/** The sentence a visitor agrees to when they book: what is kept and why. */
export function bookingConsentText(projectName: string): string {
  return `I agree that ${projectName} keeps my name, email and answers to manage this booking and to email me about it.`;
}

/** The team's note once a setup is drafted: the founder checks it and turns it on, or leaves it. */
export const BOOKING_READY_NOTE = {
  key: "booking.ready",
  subject: "Booking is ready for you to check",
  options: { check: "booking_check", later: "booking_later" },
  checkLabel: "Check it and turn it on",
  laterLabel: "Later",
} as const;

/** Whether a note's decision block is the booking note's (its `decision.key`). */
export function isBookingReadyDecision(decision: unknown): boolean {
  return !!decision && typeof decision === "object" && (decision as { key?: unknown }).key === BOOKING_READY_NOTE.key;
}

/** Why a public booking request was refused, as codes the page turns into words. */
export const BOOKING_ERRORS = {
  booking_closed: "Booking is not open on this page.",
  booking_slot_taken: "That time was just taken. Pick another one.",
  booking_slot_gone: "That time is no longer offered. Pick another one.",
  booking_hold_expired: "Your hold on that time ran out. Pick a time again.",
  booking_name: "Add your name.",
  booking_email: "That email address does not look right.",
  booking_consent: "Tick the box to agree before you book.",
  booking_too_late: "It is too close to the start to change this booking online. Reply to your confirmation email instead.",
  booking_not_found: "This booking link is not valid.",
} as const;
export type BookingErrorCode = keyof typeof BOOKING_ERRORS;

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

export const BOOKING_MAIL_KINDS = ["confirmation", "reminder", "canceled", "rescheduled"] as const;
export type BookingMailKind = (typeof BOOKING_MAIL_KINDS)[number];

export interface BookingMailFacts {
  projectName: string;
  serviceName: string;
  /** The appointment in the customer's own zone, as `bookingTimeLabel` writes it. */
  when: string;
  duration: string;
  mode: BookingMode;
  /** The page where the customer cancels or changes the booking in one press. */
  manageUrl: string;
  /** Who canceled, for the cancellation notice. */
  canceledBy?: "customer" | "founder";
  /** The "Built on" line for a project that shows the mark: words only. */
  foot?: string | null;
}

/** The emails a customer gets about their own booking: fixed words around the booking's facts, plain text. */
export const BOOKING_EMAIL = {
  subject(kind: BookingMailKind, f: Pick<BookingMailFacts, "projectName" | "when">): string {
    const name = oneLine(f.projectName);
    if (kind === "confirmation") return `You are booked with ${name}: ${f.when}`;
    if (kind === "reminder") return `Reminder: ${name}, ${f.when}`;
    if (kind === "canceled") return `Your booking with ${name} is canceled`;
    return `Your booking with ${name} moved to ${f.when}`;
  },
  text(kind: BookingMailKind, f: BookingMailFacts): string {
    const name = oneLine(f.projectName);
    const what = `${oneLine(f.serviceName)} (${f.duration}, ${f.mode === "online" ? "online" : "in person"})`;
    const manage = `Cancel or pick another time in one press:\n${f.manageUrl}`;
    const body =
      kind === "confirmation"
        ? `You are booked with ${name}.\n\n${what}\n${f.when}\n\n${manage}`
        : kind === "reminder"
          ? `This is a reminder of your booking with ${name}.\n\n${what}\n${f.when}\n\n${manage}`
          : kind === "canceled"
            ? `Your booking with ${name} is canceled${f.canceledBy === "founder" ? ` by ${name}` : ""}.\n\n${what}\n${f.when}\n\nYou can book another time here:\n${f.manageUrl}`
            : `Your booking with ${name} has a new time.\n\n${what}\n${f.when}\n\n${manage}`;
    return f.foot ? `${body}\n\n${oneLine(f.foot)}` : body;
  },
} as const;
