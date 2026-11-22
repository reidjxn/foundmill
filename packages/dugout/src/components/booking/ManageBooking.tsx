"use client";
/**
 * What a customer sees from the link in their confirmation email (founder, Nov 22, 2026): the booking's facts in their
 * own zone and, while it can still be changed, "Cancel this booking" (with its confirm step on the page, never a
 * browser dialog) and "Pick another time". Too close to the start, the page says so and points back to the email.
 * From 390 px; every control a real button at least 44 px tall. Presentational: the parent sends the change and
 * passes back `result`.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { BOOKING_ERRORS, bookingTimeLabel, durationLabel } from "@foundmill/shared/booking";
import { cn } from "../../lib/cn";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { Button } from "../foundation/Button";
import { PROJECT_PAGE_WORDS, type ProjectPageMark } from "../public/ProjectPage";
import { kitStyle } from "../shell/KitBar";
import { BookingSlotPicker } from "./BookingSlotPicker";
import { MODE_LABEL, browserTimeZone } from "./format";
import type { BookingPageError } from "./BookingPage";
import type { ManagedBooking, SlotRange } from "./types";

export const MANAGE_BOOKING_WORDS = {
  title: "Your booking",
  cancel: "Cancel this booking",
  reschedule: "Pick another time",
  confirm: "Cancel this booking? The time goes back to being open.",
  confirmYes: "Yes, cancel it",
  confirmNo: "Keep it",
  back: "Back",
  canceled: "This booking is canceled.",
  changed: "Your booking is moved.",
  passed: "This booking has passed.",
  unavailable: "That did not go through. Try again in a minute.",
} as const;

export type ManageBookingResult = { kind: "canceled" } | { kind: "rescheduled"; startsAt: string };

export interface ManageBookingProps {
  booking: ManagedBooking;
  /** The customer's IANA zone. Default the browser's. */
  timeZone?: string;
  /** Open times for "Pick another time": ISO UTC instants, ascending. */
  slots?: readonly string[];
  slotsLoading?: boolean;
  rangeEnd?: string;
  onNeedSlots?: (range: SlotRange) => void;
  onCancel: () => void;
  onReschedule: (iso: string) => void;
  submitting?: boolean;
  error?: BookingPageError | null;
  /** Set after a change went through. */
  result?: ManageBookingResult | null;
  brandPrimary?: string;
  brandSecondary?: string;
  logo?: string | null;
  mark?: ProjectPageMark;
  markHref?: string;
  variant?: "page" | "preview";
  /** Open on this part (a story, a test). Default the facts and the two actions. */
  initialMode?: ManageBookingMode;
  className?: string;
}

export type ManageBookingMode = "view" | "cancel" | "pick";
type Mode = ManageBookingMode;

export function ManageBooking({
  booking,
  timeZone,
  slots = [],
  slotsLoading = false,
  rangeEnd,
  onNeedSlots,
  onCancel,
  onReschedule,
  submitting = false,
  error = null,
  result = null,
  brandPrimary,
  brandSecondary,
  logo,
  mark = "visitor",
  markHref = "/",
  variant = "page",
  initialMode = "view",
  className,
}: ManageBookingProps) {
  const id = useId();
  const zone = timeZone ?? browserTimeZone();
  const [mode, setMode] = useState<Mode>(initialMode);
  const keep = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (mode === "cancel") keep.current?.focus();
  }, [mode]);

  const canceled = booking.status === "canceled" || result?.kind === "canceled";
  const startsAt = result?.kind === "rescheduled" ? result.startsAt : booking.startsAt;
  const active = booking.status === "confirmed" && !canceled;
  const errorText = error ? (error === "unavailable" ? MANAGE_BOOKING_WORDS.unavailable : BOOKING_ERRORS[error]) : null;
  const Root = variant === "page" ? "div" : "article";
  const Body = variant === "page" ? "main" : "div";
  const style: CSSProperties | undefined = brandPrimary && brandSecondary ? kitStyle({ primary: brandPrimary, secondary: brandSecondary }) : undefined;

  return (
    <Root data-manage-booking="" data-variant={variant} className={cn("@container relative flex flex-col bg-canvas text-primary", variant === "page" ? "min-h-dvh" : "min-h-full", className)} style={style}>
      {style ? <div aria-hidden className="h-1 w-full shrink-0 bg-kit-primary" /> : null}
      <Body className="mx-auto flex w-full max-w-reading min-w-0 flex-1 flex-col gap-6 px-gutter py-10 @page-wide:py-16">
        <header className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {brandPrimary ? <BusinessLogo src={logo} name={booking.projectName} primary={brandPrimary} size={48} title="" /> : null}
            <p className="t-display-sm min-w-0 break-words text-primary">{booking.projectName}</p>
          </div>
          <h1 className="t-display-lg min-w-0 text-balance break-words text-primary">{MANAGE_BOOKING_WORDS.title}</h1>
        </header>

        <section aria-labelledby={`${id}-facts`} className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-panel p-4 @page-wide:p-5" data-booking-facts="">
          <h2 id={`${id}-facts`} className="t-title min-w-0 break-words text-primary">
            {booking.serviceName}
          </h2>
          <p className="t-body text-prose">{bookingTimeLabel(new Date(startsAt), zone)}</p>
          <p className="t-small text-secondary">
            {durationLabel(booking.durationMin)} · {MODE_LABEL[booking.mode]}
          </p>
        </section>

        <div role="status" data-booking-state="">
          {canceled ? <p className="t-body text-primary">{MANAGE_BOOKING_WORDS.canceled}</p> : null}
          {result?.kind === "rescheduled" ? <p className="t-body text-primary">{MANAGE_BOOKING_WORDS.changed}</p> : null}
          {!canceled && !active ? <p className="t-body text-secondary">{MANAGE_BOOKING_WORDS.passed}</p> : null}
        </div>
        <div role="alert">{errorText ? <p className="t-body text-status-bad">{errorText}</p> : null}</div>

        {active && !result && !booking.canChange ? <p className="t-body text-secondary">{BOOKING_ERRORS.booking_too_late}</p> : null}

        {active && booking.canChange && result?.kind !== "rescheduled" ? (
          <div className="flex min-w-0 flex-col gap-4" data-booking-actions="">
            {mode === "view" ? (
              <div className="flex min-w-0 flex-col gap-2 @page-wide:flex-row">
                <Button variant="tinted" size="lg" className="min-h-tap" onClick={() => setMode("pick")}>
                  {MANAGE_BOOKING_WORDS.reschedule}
                </Button>
                <Button variant="secondary" size="lg" className="min-h-tap" onClick={() => setMode("cancel")}>
                  {MANAGE_BOOKING_WORDS.cancel}
                </Button>
              </div>
            ) : null}
            {mode === "cancel" ? (
              <div role="group" aria-label={MANAGE_BOOKING_WORDS.cancel} className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-panel p-4" data-booking-confirm="">
                <p className="t-body text-primary">{MANAGE_BOOKING_WORDS.confirm}</p>
                <div className="flex min-w-0 flex-col gap-2 @page-wide:flex-row">
                  <Button ref={keep} variant="secondary" size="lg" className="min-h-tap" onClick={() => setMode("view")}>
                    {MANAGE_BOOKING_WORDS.confirmNo}
                  </Button>
                  <Button variant="danger" size="lg" className="min-h-tap" loading={submitting} onClick={onCancel}>
                    {MANAGE_BOOKING_WORDS.confirmYes}
                  </Button>
                </div>
              </div>
            ) : null}
            {mode === "pick" ? (
              <section aria-label={MANAGE_BOOKING_WORDS.reschedule} className="flex min-w-0 flex-col gap-4" data-booking-pick="">
                <h2 className="t-title text-primary">{MANAGE_BOOKING_WORDS.reschedule}</h2>
                <BookingSlotPicker slots={slots} timeZone={zone} loading={slotsLoading || submitting} onPick={onReschedule} rangeEnd={rangeEnd} onNeedSlots={onNeedSlots} />
                <Button variant="ghost" size="lg" className="min-h-tap self-start" onClick={() => setMode("view")}>
                  {MANAGE_BOOKING_WORDS.back}
                </Button>
              </section>
            ) : null}
          </div>
        ) : null}
      </Body>
      {mark === "none" ? null : (
        <footer className="border-t border-line-faint" data-project-mark={mark}>
          <div className="mx-auto flex w-full max-w-reading px-gutter">
            {mark === "visitor" ? (
              <a href={markHref} className="mark-arrive t-body inline-flex min-h-tap items-center rounded-sm text-secondary transition-colors duration-hover hover:text-primary focus-ring">
                {PROJECT_PAGE_WORDS.builtOn}
              </a>
            ) : (
              <p className="t-small flex min-h-tap items-center text-tertiary">{PROJECT_PAGE_WORDS.builtOn}</p>
            )}
          </div>
        </footer>
      )}
    </Root>
  );
}
