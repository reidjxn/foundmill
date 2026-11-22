/**
 * The shapes the booking components receive (founder, Nov 22, 2026: Foundmill's own booking). The api returns exactly
 * these; the components take them as plain props and never fetch.
 */
import type { WeeklyHours } from "@foundmill/shared/booking";

export type BookingMode = "online" | "in_person";
export type BookingStatus = "confirmed" | "canceled" | "no_show" | "completed";

/** A service a visitor can book on a project's public page. `priceMinor` null is free. */
export interface PublicBookingService {
  id: string;
  name: string;
  durationMin: number;
  priceMinor: number | null;
  currency: string;
  mode: BookingMode;
  /** Up to three optional questions the visitor may answer. */
  questions: string[];
}

/** What a customer sees from the link in their confirmation email. */
export interface ManagedBooking {
  status: BookingStatus;
  projectName: string;
  serviceName: string;
  /** ISO UTC instant. */
  startsAt: string;
  durationMin: number;
  mode: BookingMode;
  /** False once it is too close to the start to change online. */
  canChange: boolean;
}

/** A booking as the founder sees it. `answers` are the customer's own words. */
export interface FounderBooking {
  id: string;
  /** The service it was booked for: what a move looks for open times of. */
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  customerName: string;
  customerEmail: string;
  answers: { question: string; answer: string }[];
  /** Made by someone on the project, or in test mode: not counted. */
  test: boolean;
  entityId: string | null;
}

export interface BookingSetupService {
  id?: string;
  name: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  priceMinor: number | null;
  mode: BookingMode;
  minNoticeMin: number;
  maxDaysAhead: number;
  questions: string[];
}

export interface BookingSetupDraft {
  timeZone: string;
  weeklyHours: WeeklyHours;
  useCalendar: boolean;
  services: BookingSetupService[];
}

/** A range of instants (ISO UTC) the parent is asked to load slots for. */
export interface SlotRange {
  from: string;
  to: string;
}
