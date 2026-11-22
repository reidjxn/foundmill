"use client";
/**
 * A row of days and, under it, the times of the chosen day, in the visitor's own zone (founder, Nov 22, 2026). Used by
 * the booking page and by "Pick another time". Every control is a real button at least 44 px tall. It says which zone
 * the times are shown in, and asks the parent for later dates; it fetches nothing.
 */
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Spinner } from "../foundation/Spinner";
import { clockLabel, groupByDay, zoneNote } from "./format";
import type { SlotRange } from "./types";

export const SLOT_PICKER_WORDS = {
  empty: "No times are open in the next few weeks.",
  later: "Show later dates",
  loading: "Looking for open times",
  days: "Day",
  times: (day: string) => `Open times on ${day}`,
  zone: (note: string) => `Times shown in ${note}`,
} as const;

/** How far past the end of what is loaded "Show later dates" asks for, in days. */
const LATER_DAYS = 14;

export interface BookingSlotPickerProps {
  /** ISO UTC instants, ascending. */
  slots: readonly string[];
  /** The visitor's IANA zone. */
  timeZone: string;
  loading?: boolean;
  /** The time that was picked, marked in the list. */
  selected?: string | null;
  onPick: (iso: string) => void;
  /** The last instant slots were loaded to; "Show later dates" asks from there. Default the last slot. */
  rangeEnd?: string;
  onNeedSlots?: (range: SlotRange) => void;
  className?: string;
}

export function BookingSlotPicker({ slots, timeZone, loading = false, selected = null, onPick, rangeEnd, onNeedSlots, className }: BookingSlotPickerProps) {
  const days = useMemo(() => groupByDay(slots, timeZone), [slots, timeZone]);
  const [chosen, setChosen] = useState<string | null>(null);
  const day = days.find((d) => d.key === chosen) ?? days.find((d) => selected && d.times.includes(selected)) ?? days[0];
  const later = () => {
    if (!onNeedSlots) return;
    const from = new Date(rangeEnd ?? slots[slots.length - 1] ?? Date.now());
    onNeedSlots({ from: from.toISOString(), to: new Date(from.getTime() + LATER_DAYS * 86_400_000).toISOString() });
  };
  const zone = SLOT_PICKER_WORDS.zone(zoneNote(timeZone, new Date(slots[0] ?? Date.UTC(2026, 0, 1))));
  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)} data-booking-slots="" aria-busy={loading || undefined}>
      <p className="t-small text-secondary" data-booking-zone="">
        {zone}
      </p>
      {days.length === 0 && !loading ? (
        <p className="t-body text-secondary" data-booking-empty="">
          {SLOT_PICKER_WORDS.empty}
        </p>
      ) : null}
      {day ? (
        <>
          <div role="group" aria-label={SLOT_PICKER_WORDS.days} className="-mx-gutter flex min-w-0 gap-2 overflow-x-auto px-gutter pb-1">
            {days.map((d) => (
              <Button key={d.key} variant="secondary" size="lg" className="min-h-tap shrink-0" active={d.key === day.key} aria-pressed={d.key === day.key} onClick={() => setChosen(d.key)}>
                {d.label}
              </Button>
            ))}
          </div>
          <ul role="list" aria-label={SLOT_PICKER_WORDS.times(day.label)} className="grid min-w-0 grid-cols-3 gap-2 @page-wide:grid-cols-4" data-booking-times="">
            {day.times.map((iso) => (
              <li key={iso} className="min-w-0">
                <Button variant="secondary" size="lg" className="min-h-tap w-full" active={iso === selected} aria-pressed={iso === selected} onClick={() => onPick(iso)}>
                  {clockLabel(iso, timeZone)}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {loading ? (
        <p role="status" className="t-small flex items-center gap-2 text-secondary">
          <Spinner decorative />
          {SLOT_PICKER_WORDS.loading}
        </p>
      ) : null}
      {onNeedSlots ? (
        <Button variant="ghost" size="lg" className="min-h-tap self-start" onClick={later} disabled={loading}>
          {SLOT_PICKER_WORDS.later}
        </Button>
      ) : null}
    </div>
  );
}
