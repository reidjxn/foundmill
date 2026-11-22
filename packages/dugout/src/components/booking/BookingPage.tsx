"use client";
/**
 * Booking on a project's public page (founder, Nov 22, 2026: Foundmill's own booking, free on every plan; DESIGN §9b).
 * The whole visitor flow as one controlled component, from 390 px, every control a real button, field or label at least
 * 44 px tall: pick a service (skipped when there is one) -> pick a day and a time in the visitor's own zone -> name,
 * email, the service's optional questions and one consent box -> "You are booked."
 *
 * Presentational: the parent fetches slots, places the hold when `onPickSlot` fires (and passes back `holdExpiresAt`, or
 * an `error` code) and sends the form. The component owns only which step is open. A taken, gone or expired time sends
 * the visitor back to the times with the sentence for it. The form carries a hidden field named `website` that a person
 * never fills in, and a slot for the bot check (`turnstile`) above the button. Same look and footer mark as ProjectPage.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { BOOKING_ERRORS, BOOKING_LIMITS, bookingConsentText, bookingTimeLabel, durationLabel } from "@foundmill/shared/booking";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { Button } from "../foundation/Button";
import { Icon } from "../foundation/Icon";
import { Input } from "../foundation/Input";
import { PROJECT_PAGE_WORDS, type ProjectPageMark } from "../public/ProjectPage";
import { kitStyle } from "../shell/KitBar";
import { BookingSlotPicker } from "./BookingSlotPicker";
import { MODE_LABEL, browserTimeZone, clockLabel, dayLabel, priceLabel } from "./format";
import type { PublicBookingService, SlotRange } from "./types";

export type BookingPageError = keyof typeof BOOKING_ERRORS | "unavailable";

export const BOOKING_PAGE_WORDS = {
  title: (name: string) => `Book a time with ${name}`,
  service: "Choose a service",
  time: "Pick a time",
  details: "Your details",
  name: "Your name",
  email: "Your email",
  optional: "optional",
  trap: "Leave this empty",
  submit: "Book this time",
  change: "Pick a different time",
  hold: (until: string) => `We are holding this time for you until ${until}.`,
  done: "You are booked.",
  sent: (email: string) => `We sent a confirmation to ${email} with links to cancel or change it.`,
  unavailable: "Booking is not available right now. Try again in a minute.",
} as const;

/** Codes that mean the time itself is no longer ours: the visitor goes back to pick again. */
const BACK_TO_TIMES: readonly BookingPageError[] = ["booking_slot_taken", "booking_slot_gone", "booking_hold_expired"];

export interface BookingSubmit {
  name: string;
  email: string;
  /** The questions the visitor answered, in order; blank answers are left out. */
  answers: { question: string; answer: string }[];
  consent: boolean;
  /** The hidden field: a person leaves it empty. */
  website: string;
  visitorTimeZone: string;
}

export interface BookingPageProps {
  projectName: string;
  /** Brand colors (hex): accents only, as on the project page. */
  brandPrimary: string;
  brandSecondary: string;
  logo?: string | null;
  /** Who the foot's "Built on" mark is drawn for; the same three values as the project page. Default "visitor". */
  mark?: ProjectPageMark;
  markHref?: string;
  variant?: "page" | "preview";
  services: readonly PublicBookingService[];
  /** The service in use. Left out: the page keeps its own, starting with the only one when there is one. */
  selectedServiceId?: string | null;
  onSelectService: (id: string) => void;
  /** ISO UTC instants, ascending, for the chosen service. */
  slots: readonly string[];
  slotsLoading?: boolean;
  /** The last instant `slots` reaches; "Show later dates" asks from there. */
  rangeEnd?: string;
  onNeedSlots: (range: SlotRange) => void;
  /** The visitor picked a time: the parent places the hold. */
  onPickSlot: (iso: string) => void;
  /** When the hold on the picked time ends (ISO). */
  holdExpiresAt?: string | null;
  onSubmit: (values: BookingSubmit) => void;
  submitting?: boolean;
  error?: BookingPageError | null;
  /** Set once booked. */
  done?: { startsAt: string; email: string } | null;
  /** The bot check's widget, above the button. */
  turnstile?: ReactNode;
  /** The visitor's IANA zone. Default the browser's. */
  visitorTimeZone?: string;
  /** Open on the form with this time already picked (a story, a test, a link back to a held time). */
  initialPicked?: string | null;
  className?: string;
}

type Step = "service" | "time" | "form";

export function BookingPage({
  projectName,
  brandPrimary,
  brandSecondary,
  logo,
  mark = "visitor",
  markHref = "/",
  variant = "page",
  services,
  selectedServiceId,
  onSelectService,
  slots,
  slotsLoading = false,
  rangeEnd,
  onNeedSlots,
  onPickSlot,
  holdExpiresAt,
  onSubmit,
  submitting = false,
  error = null,
  done = null,
  turnstile,
  visitorTimeZone,
  initialPicked = null,
  className,
}: BookingPageProps) {
  const id = useId();
  const zone = visitorTimeZone ?? browserTimeZone();
  const [own, setOwn] = useState<string | null>(services.length === 1 ? services[0]!.id : null);
  const serviceId = selectedServiceId ?? own;
  const service = services.find((s) => s.id === serviceId) ?? null;
  const [step, setStep] = useState<Step>(initialPicked ? "form" : services.length === 1 || service ? "time" : "service");
  const [picked, setPicked] = useState<string | null>(initialPicked);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (error && BACK_TO_TIMES.includes(error)) {
      setStep("time");
      setPicked(null);
    }
  }, [error]);

  // Move focus to the new step's heading, so a keyboard or screen-reader visitor lands where the page went.
  const heading = useRef<HTMLHeadingElement | null>(null);
  const first = useRef(true);
  const shown: Step | "done" = done ? "done" : step;
  useEffect(() => {
    if (first.current) first.current = false;
    else heading.current?.focus();
  }, [shown]);

  const choose = (sid: string) => {
    setOwn(sid);
    setStep("time");
    onSelectService(sid);
  };
  const pick = (iso: string) => {
    setPicked(iso);
    setStep("form");
    onPickSlot(iso);
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!service) return;
    const data = new FormData(e.currentTarget);
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      answers: service.questions.map((question, i) => ({ question, answer: (answers[i] ?? "").trim() })).filter((a) => a.answer),
      consent,
      website: String(data.get("website") ?? ""),
      visitorTimeZone: zone,
    });
  };

  const Root = variant === "page" ? "div" : "article";
  const Body = variant === "page" ? "main" : "div";
  const errorText = error ? (error === "unavailable" ? BOOKING_PAGE_WORDS.unavailable : BOOKING_ERRORS[error]) : null;
  const alert = (
    <div role="alert" data-booking-error="">
      {errorText ? <p className="t-body text-status-bad">{errorText}</p> : null}
    </div>
  );
  const stepTitle = (text: string) => (
    <h2 ref={heading} tabIndex={-1} className="t-title min-w-0 break-words text-primary focus:outline-none">
      {text}
    </h2>
  );
  const facts = (s: PublicBookingService) => `${durationLabel(s.durationMin)} · ${priceLabel(s.priceMinor, s.currency)} · ${MODE_LABEL[s.mode]}`;
  const rootStyle: CSSProperties = kitStyle({ primary: brandPrimary, secondary: brandSecondary });

  return (
    <Root data-booking-page="" data-variant={variant} data-step={shown} className={cn("@container relative flex flex-col bg-canvas text-primary", variant === "page" ? "min-h-dvh" : "min-h-full", className)} style={rootStyle}>
      <div aria-hidden className="h-1 w-full shrink-0 bg-kit-primary" />
      <Body className="mx-auto flex w-full max-w-reading min-w-0 flex-1 flex-col gap-6 px-gutter py-10 @page-wide:py-16">
        <header className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BusinessLogo src={logo} name={projectName} primary={brandPrimary} size={48} title="" />
            <p className="t-display-sm min-w-0 break-words text-primary">{projectName}</p>
          </div>
          <h1 className="t-display-lg min-w-0 text-balance break-words text-primary">{BOOKING_PAGE_WORDS.title(projectName)}</h1>
        </header>

        {shown === "service" ? (
          <section aria-label={BOOKING_PAGE_WORDS.service} className="flex min-w-0 flex-col gap-3" data-booking-step="service">
            {stepTitle(BOOKING_PAGE_WORDS.service)}
            <ul role="list" className="flex min-w-0 flex-col gap-2">
              {services.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => choose(s.id)} className="flex min-h-tap w-full min-w-0 flex-col gap-1 rounded-md border border-line bg-panel p-4 text-left transition-colors duration-hover hover:border-line-strong focus-ring">
                    <span className="t-body min-w-0 break-words font-medium text-primary">{s.name}</span>
                    <span className="t-small text-secondary">{facts(s)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {shown === "time" && service ? (
          <section className="flex min-w-0 flex-col gap-4" data-booking-step="time" aria-label={BOOKING_PAGE_WORDS.time}>
            {stepTitle(BOOKING_PAGE_WORDS.time)}
            <p className="t-body min-w-0 break-words text-secondary">
              {service.name} · {facts(service)}
            </p>
            {services.length > 1 ? (
              <Button variant="ghost" size="lg" className="min-h-tap self-start" onClick={() => setStep("service")}>
                Choose another service
              </Button>
            ) : null}
            {alert}
            <BookingSlotPicker slots={slots} timeZone={zone} loading={slotsLoading} selected={picked} onPick={pick} rangeEnd={rangeEnd} onNeedSlots={onNeedSlots} />
          </section>
        ) : null}

        {shown === "form" && service && picked ? (
          <form onSubmit={submit} className="flex min-w-0 flex-col gap-4 rounded-md border border-line bg-panel p-4 @page-wide:p-5" data-booking-step="form" aria-label={BOOKING_PAGE_WORDS.details}>
            {stepTitle(BOOKING_PAGE_WORDS.details)}
            <p className="t-body min-w-0 break-words text-primary" data-booking-chosen="">
              {service.name} · {dayLabel(picked, zone)}, {clockLabel(picked, zone)}
            </p>
            <Button type="button" variant="ghost" size="lg" className="min-h-tap self-start" onClick={() => setStep("time")}>
              {BOOKING_PAGE_WORDS.change}
            </Button>
            {holdExpiresAt ? (
              <p className="t-small text-secondary" data-booking-hold="">
                {BOOKING_PAGE_WORDS.hold(clockLabel(holdExpiresAt, zone))}
              </p>
            ) : null}
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${id}-name`} className="t-label text-secondary">
                {BOOKING_PAGE_WORDS.name}
              </label>
              <Input id={`${id}-name`} name="name" required autoComplete="name" maxLength={BOOKING_LIMITS.customerName} controlSize="xl" wrapperClassName="min-h-tap" value={name} onChange={(e) => setName(e.target.value)} invalid={error === "booking_name"} />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${id}-email`} className="t-label text-secondary">
                {BOOKING_PAGE_WORDS.email}
              </label>
              <Input id={`${id}-email`} name="email" type="email" inputMode="email" required autoComplete="email" controlSize="xl" wrapperClassName="min-h-tap" value={email} onChange={(e) => setEmail(e.target.value)} invalid={error === "booking_email"} />
            </div>
            {service.questions.map((q, i) => (
              <div key={i} className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={`${id}-q${i}`} className="t-label text-secondary">
                  {q} <span className="text-tertiary">({BOOKING_PAGE_WORDS.optional})</span>
                </label>
                <Input id={`${id}-q${i}`} name={`q${i}`} maxLength={BOOKING_LIMITS.answer} controlSize="xl" wrapperClassName="min-h-tap" value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => Object.assign([...a], { [i]: e.target.value }))} />
              </div>
            ))}
            <label htmlFor={`${id}-consent`} className="flex min-h-tap cursor-pointer items-start gap-3 py-1">
              <span className="relative mt-0.5 inline-grid size-check shrink-0 place-items-center">
                <input
                  id={`${id}-consent`}
                  name="consent"
                  type="checkbox"
                  required
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  aria-invalid={error === "booking_consent" || undefined}
                  className="check-box peer absolute inset-0 m-0 size-check appearance-none rounded-xs focus-ring"
                />
                <Icon icon={Check} size={12} strokeWidth={2.75} className="pointer-events-none relative hidden text-ink peer-checked:inline-flex" />
              </span>
              <span className="t-body min-w-0 break-words text-prose">{bookingConsentText(projectName)}</span>
            </label>
            {/* Out of sight and out of the tab order: a person never fills it in. */}
            <div aria-hidden="true" className="sr-only">
              <label htmlFor={`${id}-trap`}>{BOOKING_PAGE_WORDS.trap}</label>
              <input id={`${id}-trap`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
            </div>
            {alert}
            {turnstile ? <div className="min-w-0 max-w-full overflow-hidden" data-booking-widget="">{turnstile}</div> : null}
            <Button type="submit" variant="tinted" size="lg" className="min-h-tap self-stretch @page-wide:self-start" loading={submitting}>
              {BOOKING_PAGE_WORDS.submit}
            </Button>
          </form>
        ) : null}

        {shown === "done" && done ? (
          <section className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-panel p-4 @page-wide:p-5" data-booking-step="done" aria-label={BOOKING_PAGE_WORDS.done}>
            <h2 ref={heading} tabIndex={-1} className="t-title text-primary focus:outline-none">
              {BOOKING_PAGE_WORDS.done}
            </h2>
            <p role="status" className="t-body min-w-0 break-words text-primary">
              {service ? `${service.name} · ` : ""}
              {bookingTimeLabel(new Date(done.startsAt), zone)}
            </p>
            <p className="t-body min-w-0 break-words text-secondary">{BOOKING_PAGE_WORDS.sent(done.email)}</p>
          </section>
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
