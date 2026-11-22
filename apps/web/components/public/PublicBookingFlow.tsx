"use client";
/**
 * The booking page's flow (founder, Nov 22, 2026): the design system's `BookingPage` with the Server Actions behind it
 * (app/p/[slug]/book/actions.ts). It owns the state the page needs: which service, the slots loaded so far, the hold
 * on the picked time and the answer after booking.
 *
 * The visitor's zone is read from the browser after the first render, and no time is drawn until it is known, so the
 * server's HTML and the browser's never disagree about a time. Slots start at now to 14 days ahead; "Show later dates"
 * asks for the next range. Picking a time places a hold (the bot check, Turnstile action `page_booking`, runs first:
 * lib/turnstile.ts gives the mock token when no site key is set) and passes the earlier hold back as `replaces`. A refusal
 * becomes the component's `error` code; a time that was taken or is gone also reloads the times.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BookingPage, type BookingPageError, type BookingPageProps, type BookingSubmit, type SlotRange } from "@foundmill/dugout";
import { confirmBookingHold, bookingSlots, holdBookingSlot } from "@/app/p/[slug]/book/actions";
import { turnstileToken } from "@/lib/turnstile";
import { publicEnv } from "@/lib/env";

const FIRST_RANGE_DAYS = 14;
const DAY_MS = 86_400_000;
const TOKEN_TIMEOUT_MS = 15_000;
export const BOOKING_TURNSTILE_ACTION = "page_booking";

type Hold = { token: string; expiresAt: string };
type Props = Pick<BookingPageProps, "projectName" | "brandPrimary" | "brandSecondary" | "logo" | "mark" | "markHref" | "services"> & { slug: string };

export function PublicBookingFlow({ slug, services, ...page }: Props) {
  const siteKey = publicEnv().turnstileSiteKey;
  const widget = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(services.length === 1 ? services[0]!.id : null);
  const [slots, setSlots] = useState<string[]>([]);
  const [rangeEnd, setRangeEnd] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [hold, setHold] = useState<Hold | null>(null);
  const holding = useRef<Promise<Hold | null> | null>(null);
  const [error, setError] = useState<BookingPageError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ startsAt: string; email: string } | null>(null);
  // The latest request wins: a slow answer for an earlier service or range never replaces a newer one.
  const ticket = useRef(0);

  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), []);

  const load = useCallback(
    async (id: string, range: SlotRange, replace: boolean) => {
      const mine = ++ticket.current;
      setLoading(true);
      const result = await bookingSlots({ slug, serviceId: id, ...range });
      if (mine !== ticket.current) return;
      setLoading(false);
      if (!result.ok) return setError(result.code);
      setSlots((old) => (replace ? result.data.slots : [...new Set([...old, ...result.data.slots])].sort()));
      setRangeEnd(range.to);
    },
    [slug],
  );
  const firstRange = (): SlotRange => ({ from: new Date().toISOString(), to: new Date(Date.now() + FIRST_RANGE_DAYS * DAY_MS).toISOString() });

  useEffect(() => {
    if (zone && serviceId) void load(serviceId, firstRange(), true);
  }, [zone, serviceId, load]);

  const pick = (iso: string) => {
    if (!serviceId) return;
    setError(null);
    const placing = (async (): Promise<Hold | null> => {
      const token = await turnstileToken(siteKey, widget.current, TOKEN_TIMEOUT_MS, BOOKING_TURNSTILE_ACTION);
      if (!token) return void setError("unavailable"), null;
      const result = await holdBookingSlot({ slug, serviceId, start: iso, turnstile: token, replaces: hold?.token ?? null });
      if (!result.ok) {
        setHold(null);
        setError(result.code);
        if (result.code === "booking_slot_taken" || result.code === "booking_slot_gone") void load(serviceId, firstRange(), true);
        return null;
      }
      const placed = { token: result.data.holdToken, expiresAt: result.data.expiresAt };
      setHold(placed);
      return placed;
    })();
    holding.current = placing;
  };

  const submit = async (values: BookingSubmit) => {
    const placed = await holding.current;
    if (!placed) return setError((e) => e ?? "booking_hold_expired");
    const service = services.find((s) => s.id === serviceId);
    setSubmitting(true);
    setError(null);
    const result = await confirmBookingHold({
      slug,
      holdToken: placed.token,
      name: values.name,
      email: values.email,
      // One answer per question, in the service's order (blank ones stay blank).
      answers: (service?.questions ?? []).map((q) => values.answers.find((a) => a.question === q)?.answer ?? ""),
      consent: values.consent,
      website: values.website,
      visitorTimeZone: values.visitorTimeZone,
    });
    setSubmitting(false);
    if (result.ok) return setDone({ startsAt: result.data.startsAt, email: values.email });
    if (result.code === "booking_hold_expired" || result.code === "booking_slot_taken" || result.code === "booking_slot_gone") setHold(null);
    setError(result.code);
  };

  return (
    <>
      <BookingPage
        {...page}
        services={services}
        selectedServiceId={serviceId}
        onSelectService={setServiceId}
        // Nothing is drawn as a time until the browser's zone is known.
        slots={zone ? slots : []}
        slotsLoading={!zone || loading}
        rangeEnd={rangeEnd}
        onNeedSlots={(range) => serviceId && void load(serviceId, range, false)}
        onPickSlot={pick}
        holdExpiresAt={hold?.expiresAt ?? null}
        onSubmit={(values) => void submit(values)}
        submitting={submitting}
        error={error}
        done={done}
        visitorTimeZone={zone ?? "UTC"}
      />
      {/* Where the invisible bot check renders if it ever needs the visitor (it mounts before the form does). */}
      <div ref={widget} className="fixed inset-x-0 bottom-0 flex justify-center" />
    </>
  );
}
