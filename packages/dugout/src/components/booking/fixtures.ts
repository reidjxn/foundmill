/** Fixed data for the booking stories and tests: November 23 to 27, 2026, in fixed zones, so nothing moves with the day they run. */
import { DEFAULT_WEEKLY_HOURS } from "@foundmill/shared/booking";
import type { BookingSetupDraft, FounderBooking, ManagedBooking, PublicBookingService } from "./types";

export const BOOKING_SERVICES: PublicBookingService[] = [
  { id: "svc-clean", name: "Standard clean", durationMin: 120, priceMinor: 9000, currency: "USD", mode: "in_person", questions: ["Anything we should know about the home?", "Do you have pets?"] },
  { id: "svc-deep", name: "Deep clean", durationMin: 240, priceMinor: 16000, currency: "USD", mode: "in_person", questions: [] },
  { id: "svc-intro", name: "Intro call", durationMin: 30, priceMinor: null, currency: "USD", mode: "online", questions: ["What would you like help with?"] },
];

/** Open times, ascending, in UTC. In Chicago (CST, UTC-6) the first is Mon, Nov 23 at 9:00 AM; the third is Mon, Nov 23 at 8:00 PM. */
export const BOOKING_SLOTS: string[] = [
  "2026-11-23T15:00:00Z",
  "2026-11-23T15:30:00Z",
  "2026-11-24T02:00:00Z",
  "2026-11-24T15:00:00Z",
  "2026-11-24T16:00:00Z",
  "2026-11-24T21:00:00Z",
  "2026-11-25T16:30:00Z",
  "2026-11-25T20:00:00Z",
  "2026-11-26T15:00:00Z",
  "2026-11-27T15:00:00Z",
  "2026-11-27T19:30:00Z",
];

export const BOOKING_ZONE = "America/Chicago";
export const BOOKING_HELD_SLOT = "2026-11-24T21:00:00Z";
/** Ten minutes after the hold was placed at 3:45 PM Chicago time on Mon, Nov 23. */
export const BOOKING_HOLD_ENDS = "2026-11-23T21:55:00Z";

export const MANAGED_BOOKING: ManagedBooking = {
  status: "confirmed",
  projectName: "Northwind Cleaning",
  serviceName: "Standard clean",
  startsAt: "2026-11-24T21:00:00Z",
  durationMin: 120,
  mode: "in_person",
  canChange: true,
};

export const FOUNDER_BOOKINGS: FounderBooking[] = [
  {
    id: "b1",
    serviceId: "s1",
    serviceName: "Standard clean",
    startsAt: "2026-11-23T20:00:00Z",
    endsAt: "2026-11-23T22:00:00Z",
    status: "confirmed",
    customerName: "Ana Lopez",
    customerEmail: "ana@example.com",
    answers: [
      { question: "Anything we should know about the home?", answer: "Second floor, the buzzer is broken. Please knock." },
      { question: "Do you have pets?", answer: "One cat, she is shy." },
    ],
    test: false,
    entityId: null,
  },
  { id: "b2", serviceId: "s1", serviceName: "Intro call", startsAt: "2026-11-24T16:00:00Z", endsAt: "2026-11-24T16:30:00Z", status: "confirmed", customerName: "Ben Carter", customerEmail: "ben@example.com", answers: [], test: false, entityId: null },
  { id: "b3", serviceId: "s1", serviceName: "Deep clean", startsAt: "2026-11-25T15:00:00Z", endsAt: "2026-11-25T19:00:00Z", status: "confirmed", customerName: "Test customer", customerEmail: "me@example.com", answers: [], test: true, entityId: null },
  { id: "b4", serviceId: "s1", serviceName: "Standard clean", startsAt: "2026-11-27T19:30:00Z", endsAt: "2026-11-27T21:30:00Z", status: "canceled", customerName: "Dee Okafor", customerEmail: "dee@example.com", answers: [], test: false, entityId: null },
];

export const PAST_BOOKINGS: FounderBooking[] = [
  { id: "p1", serviceId: "s1", serviceName: "Standard clean", startsAt: "2026-11-16T20:00:00Z", endsAt: "2026-11-16T22:00:00Z", status: "confirmed", customerName: "Ana Lopez", customerEmail: "ana@example.com", answers: [], test: false, entityId: null },
  { id: "p2", serviceId: "s1", serviceName: "Intro call", startsAt: "2026-11-12T16:00:00Z", endsAt: "2026-11-12T16:30:00Z", status: "completed", customerName: "Cy Nakamura", customerEmail: "cy@example.com", answers: [], test: false, entityId: null },
  { id: "p3", serviceId: "s1", serviceName: "Deep clean", startsAt: "2026-11-10T15:00:00Z", endsAt: "2026-11-10T19:00:00Z", status: "no_show", customerName: "Eli Brandt", customerEmail: "eli@example.com", answers: [], test: false, entityId: null },
];

export const BOOKING_SETUP_DRAFT: BookingSetupDraft = {
  timeZone: "America/Chicago",
  weeklyHours: { ...DEFAULT_WEEKLY_HOURS, "6": [{ start: 600, end: 840 }] },
  useCalendar: false,
  services: [
    { id: "svc-clean", name: "Standard clean", durationMin: 120, bufferBeforeMin: 15, bufferAfterMin: 15, priceMinor: 9000, mode: "in_person", minNoticeMin: 1440, maxDaysAhead: 60, questions: ["Anything we should know about the home?"] },
    { id: "svc-intro", name: "Intro call", durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0, priceMinor: null, mode: "online", minNoticeMin: 120, maxDaysAhead: 30, questions: [] },
  ],
};

export const TIME_ZONES = ["America/Chicago", "America/Denver", "America/Los_Angeles", "America/New_York", "Europe/Berlin", "Europe/London", "UTC"];
