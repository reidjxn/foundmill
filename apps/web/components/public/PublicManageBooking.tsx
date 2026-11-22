"use client";
/**
 * The customer's own booking page (founder, Nov 22, 2026): the design system's `ManageBooking` with the Server Actions
 * behind it (app/p/[slug]/book/manage/actions.ts). "Pick another time" loads the open times from now to 14 days ahead,
 * "Show later dates" the next range; a change answers in place. After a cancel the page offers a link back to the
 * project's booking page. The customer's zone is the browser's, read after the first render so no time is drawn from
 * the server's guess.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ManageBooking, type BookingPageError, type ManageBookingProps, type ManageBookingResult, type SlotRange } from "@foundmill/dugout";
import { cancelManagedBooking, manageSlots, rescheduleManagedBooking } from "@/app/p/[slug]/book/manage/actions";

const FIRST_RANGE_DAYS = 14;
const DAY_MS = 86_400_000;

type Props = Pick<ManageBookingProps, "booking" | "brandPrimary" | "brandSecondary" | "logo" | "mark" | "markHref"> & { token: string; bookHref: string };

export function PublicManageBooking({ token, bookHref, ...rest }: Props) {
  const [zone, setZone] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [rangeEnd, setRangeEnd] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<BookingPageError | null>(null);
  const [result, setResult] = useState<ManageBookingResult | null>(null);
  const loaded = useRef(false);

  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), []);

  const load = useCallback(
    async (range: SlotRange, replace: boolean) => {
      setLoading(true);
      const answer = await manageSlots({ token, ...range });
      setLoading(false);
      if (!answer.ok) return setError(answer.code);
      setSlots((old) => (replace ? answer.data.slots : [...new Set([...old, ...answer.data.slots])].sort()));
      setRangeEnd(range.to);
    },
    [token],
  );
  const firstRange = (): SlotRange => ({ from: new Date().toISOString(), to: new Date(Date.now() + FIRST_RANGE_DAYS * DAY_MS).toISOString() });
  // The times load when the customer first asks to pick another (the component asks through `onNeedSlots`), and again after a refusal.
  useEffect(() => {
    if (zone && !loaded.current && rest.booking.status === "confirmed" && rest.booking.canChange) {
      loaded.current = true;
      void load(firstRange(), true);
    }
  }, [zone, load, rest.booking.status, rest.booking.canChange]);

  const cancel = async () => {
    setSubmitting(true);
    setError(null);
    const answer = await cancelManagedBooking({ token });
    setSubmitting(false);
    if (answer.ok) setResult({ kind: "canceled" });
    else setError(answer.code);
  };
  const reschedule = async (iso: string) => {
    setSubmitting(true);
    setError(null);
    const answer = await rescheduleManagedBooking({ token, start: iso });
    setSubmitting(false);
    if (answer.ok) return setResult({ kind: "rescheduled", startsAt: answer.data.startsAt });
    setError(answer.code);
    // A time taken or gone since the list was loaded: show the times as they are now.
    if (answer.code === "booking_slot_taken" || answer.code === "booking_slot_gone") void load(firstRange(), true);
  };

  return (
    <>
      <ManageBooking
        {...rest}
        timeZone={zone ?? "UTC"}
        slots={zone ? slots : []}
        slotsLoading={!zone || loading}
        rangeEnd={rangeEnd}
        onNeedSlots={(range) => void load(range, false)}
        onCancel={() => void cancel()}
        onReschedule={(iso) => void reschedule(iso)}
        submitting={submitting}
        error={error}
        result={result}
      />
      {result?.kind === "canceled" ? (
        <p className="mx-auto w-full max-w-reading px-gutter pb-6">
          <a href={bookHref} className="t-body inline-flex min-h-tap items-center rounded-sm text-secondary underline decoration-line-strong underline-offset-4 hover:text-primary focus-ring" data-testid="book-again">
            Book another time
          </a>
        </p>
      ) : null}
    </>
  );
}
