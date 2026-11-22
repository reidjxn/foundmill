"use client";
/**
 * Product › Public page › "Booking" (founder, Nov 22, 2026: Foundmill's own booking, free on every plan; apps/api
 * services/booking.ts): the hours, the services and the calendar switch of the project's own booking, and the founder's
 * press to turn it on. Booking lives on the public page at `<page address>/book`, so it needs a published page.
 *
 * Owners, cofounders and admins edit, save and turn it on or off (`canEdit`, the same gate as publishing the page);
 * everyone else reads it. With no setup yet the panel offers one button, "Set up booking", which opens the form with
 * weekday hours, the project's time zone and one empty service. The team's draft (`draftedByTeam`) is checked here, and
 * the Today note's "Check it and turn it on" opens this panel (`?panel=booking`, which scrolls to it).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Copy } from "lucide-react";
import { BookingSetupForm, Button, Panel, type BookingSetupDraft } from "@foundmill/dugout";
import { DEFAULT_WEEKLY_HOURS, type WeeklyHours } from "@foundmill/shared/booking";
import { timeZoneNames } from "@foundmill/shared/time-zone";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { errorMessage } from "./shared";

/** `booking.get` as the panel reads it (apps/api services/booking.ts `BookingSetupView`). */
export interface BookingSetupResponse {
  settings: { status: "draft" | "live"; timeZone: string; weeklyHours: WeeklyHours; useCalendar: boolean; draftedByTeam: boolean; approvedAt: string | null } | null;
  services: (BookingSetupDraft["services"][number] & { id: string; currency: string })[];
  calendarConnected: boolean;
  pagePublished: boolean;
  publicUrl: string | null;
}

export const BOOKING_PANEL_WORDS = {
  title: "Booking",
  empty: "Let people book a time with you from your public page. You choose the hours and what you offer.",
  setUp: "Set up booking",
  address: "Booking address",
  copy: "Copy link",
  copied: "Link copied",
  readOnly: "An owner or an admin of this project can set up booking.",
} as const;

const blankService = (): BookingSetupDraft["services"][number] => ({ name: "", durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0, priceMinor: null, mode: "online", minNoticeMin: 1440, maxDaysAhead: 60, questions: [] });

const draftOf = (d: BookingSetupResponse): BookingSetupDraft => ({
  timeZone: d.settings?.timeZone ?? "UTC",
  weeklyHours: d.settings?.weeklyHours ?? { ...DEFAULT_WEEKLY_HOURS },
  useCalendar: d.settings?.useCalendar ?? false,
  services: d.services.map(({ currency: _currency, ...s }) => s),
});

export function BookingPanel({ canEdit }: { canEdit: boolean }) {
  const { mutate, currency, timeZone } = useWidgetData();
  const view = useWidgetQuery<BookingSetupResponse>("booking.get", {});
  useBusinessEvents(() => view.refetch(), ["page.published", "page.unpublished"]);
  const data = view.data;
  const [starting, setStarting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const zones = useMemo(() => timeZoneNames(), []);

  // `?panel=booking` (the Today note's one tap) brings this panel into view once it has loaded.
  const linked = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("panel") === "booking";
  useEffect(() => {
    if (linked && data) ref.current?.scrollIntoView?.({ block: "start" });
  }, [linked, Boolean(data)]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      view.refetch();
    } catch (err) {
      setError(errorMessage(err as Error));
    } finally {
      setPending(false);
    }
  };
  const copy = async () => {
    if (!data?.publicUrl) return;
    try {
      await navigator.clipboard.writeText(data.publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The link could not be copied. Select the address and copy it instead.");
    }
  };

  const hasSetup = Boolean(data && (data.settings || data.services.length));
  const draft: BookingSetupDraft | null = data ? (hasSetup ? draftOf(data) : { timeZone: timeZone ?? "UTC", weeklyHours: { ...DEFAULT_WEEKLY_HOURS }, useCalendar: false, services: [blankService()] }) : null;
  const live = data?.settings?.status === "live";

  return (
    <Panel
      ref={ref}
      title={BOOKING_PANEL_WORDS.title}
      span={12}
      loading={view.isLoading}
      error={view.error ? view.error.message : undefined}
      onRetry={view.refetch}
      empty={data && !hasSetup && !starting ? { icon: CalendarClock, children: BOOKING_PANEL_WORDS.empty, action: canEdit ? { label: BOOKING_PANEL_WORDS.setUp, onClick: () => setStarting(true) } : undefined } : undefined}
      data-testid="booking-panel"
    >
      {data && draft && (hasSetup || starting) ? (
        <div className="flex flex-col gap-3">
          {!canEdit ? <p className="t-body text-secondary">{BOOKING_PANEL_WORDS.readOnly}</p> : null}
          {live && data.publicUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-label text-secondary">{BOOKING_PANEL_WORDS.address}</span>
              <span className="t-mono min-w-0 break-all text-primary" data-testid="booking-url">
                {data.publicUrl}
              </span>
              <Button size="sm" icon={Copy} onClick={() => void copy()}>
                {copied ? BOOKING_PANEL_WORDS.copied : BOOKING_PANEL_WORDS.copy}
              </Button>
            </div>
          ) : null}
          {/* A disabled fieldset turns off every button and field inside it, for a member who may only read. */}
          <fieldset disabled={!canEdit} className="contents">
            <BookingSetupForm
              // A fresh form whenever the saved setup changes: its own copy of the draft starts from what was saved.
              key={JSON.stringify([draft, live])}
              draft={draft}
              status={live ? "live" : "draft"}
              liveSince={data.settings?.approvedAt ?? null}
              timeZones={zones}
              currency={currency}
              calendarConnected={data.calendarConnected}
              pagePublished={data.pagePublished}
              draftedByTeam={data.settings?.draftedByTeam ?? false}
              saving={pending}
              error={error}
              onSave={(next) => void run(() => mutate("booking.save", { ...next }))}
              onSetLive={(on) => void run(() => mutate("booking.setLive", { live: on }))}
            />
          </fieldset>
        </div>
      ) : null}
    </Panel>
  );
}
