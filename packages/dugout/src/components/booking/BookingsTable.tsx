"use client";
/**
 * Bookings, in the console (founder, Nov 22, 2026): upcoming and past in a `DataTable` with saved views and the row
 * menu (right-click, Shift+F10 or the visible "..."). Times are in the founder's own zone, named once above the table.
 * A booking with answers has an expander: its rows are the customer's own words, marked as such and shown as plain text.
 * "Cancel" asks first, in a bar above the table that says the customer is told by email; "Move" hands the booking to the
 * parent, which opens the time picker; "Did not show" is for a confirmed booking that has passed. A test booking
 * (made by someone on the project, or in test mode) carries a "Test" pill and is not counted. Presentational.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CircleSlash, UserX } from "lucide-react";
import type { SavedView } from "../data/types";
import { DataTable, type DataTableColumn } from "../data/DataTable";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { SegmentedControl } from "../foundation/SegmentedControl";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import { cn } from "../../lib/cn";
import { whenLabel, zoneNote } from "./format";
import type { BookingStatus, FounderBooking } from "./types";

export const BOOKINGS_TABLE_WORDS = {
  empty: "No bookings yet. When someone books a time on your page, it shows here.",
  upcoming: "Upcoming",
  past: "Past",
  test: "Test",
  testTip: "A booking made by someone on the project, or in test mode. It is not counted.",
  cancel: "Cancel",
  move: "Move",
  noShow: "Did not show",
  confirm: (what: string) => `Cancel ${what}? The customer is told by email.`,
  confirmYes: "Cancel booking",
  confirmNo: "Keep it",
  theirWords: "Customer's words",
  answers: (n: number) => (n === 1 ? "1 answer" : `${n} answers`),
} as const;

const STATUS: Record<BookingStatus, { tone: StatusTone; word: string }> = {
  confirmed: { tone: "good", word: "Confirmed" },
  canceled: { tone: "neutral", word: "Canceled" },
  no_show: { tone: "warn", word: "Did not show" },
  completed: { tone: "neutral", word: "Done" },
};

export type BookingsWhen = "upcoming" | "past";

type Row = { id: string; kind: "booking"; booking: FounderBooking } | { id: string; kind: "answer"; booking: FounderBooking; question: string; answer: string };

export interface BookingsTableProps {
  bookings: readonly FounderBooking[];
  when: BookingsWhen;
  onWhenChange: (when: BookingsWhen) => void;
  /** The founder's IANA zone. */
  timeZone: string;
  onCancel: (id: string) => void;
  onMove: (id: string) => void;
  onNoShow: (id: string) => void;
  /** A member who may only read: the table has no row menu (Cancel, Move and Did not show are for owners and admins). */
  readOnly?: boolean;
  /** The booking whose change is on its way. */
  busyId?: string | null;
  loading?: boolean;
  /** Body height in px. Default 420. */
  height?: number;
  className?: string;
}

const COLUMNS = ["when", "service", "customer", "status"];
const viewsFor = (when: BookingsWhen): SavedView[] => [
  { id: "all", name: "All columns", columns: COLUMNS, sort: [{ id: "when", desc: when === "past" }], filters: [], builtIn: true },
  { id: "short", name: "Time and customer", columns: ["when", "customer", "status"], sort: [{ id: "when", desc: when === "past" }], filters: [], builtIn: true },
];

export function BookingsTable({ bookings, when, onWhenChange, timeZone, onCancel, onMove, onNoShow, readOnly = false, busyId = null, loading = false, height = 420, className }: BookingsTableProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [views, setViews] = useState<SavedView[]>(() => viewsFor(when));
  const [active, setActive] = useState<string | null>("all");
  useEffect(() => {
    setViews((v) => (v.every((x) => x.builtIn) ? viewsFor(when) : v));
    setConfirmId(null);
  }, [when]);
  const keep = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (confirmId) keep.current?.focus();
  }, [confirmId]);

  const rows = useMemo<Row[]>(() => bookings.map((booking) => ({ id: booking.id, kind: "booking", booking })), [bookings]);
  const subRows = (r: Row): Row[] | undefined =>
    r.kind === "booking" && r.booking.answers.length ? r.booking.answers.map((a, i) => ({ id: `${r.id}:a${i}`, kind: "answer", booking: r.booking, question: a.question, answer: a.answer })) : undefined;
  const confirming = bookings.find((b) => b.id === confirmId) ?? null;

  const columns: DataTableColumn<Row>[] = [
    { id: "when", header: "When", size: 190, accessorFn: (r) => r.booking.startsAt, meta: { label: "When", filter: false }, cell: ({ row }) => (row.original.kind === "booking" ? whenLabel(row.original.booking.startsAt, timeZone) : null) },
    {
      id: "service",
      header: "Service",
      size: 200,
      accessorFn: (r) => (r.kind === "booking" ? r.booking.serviceName : r.question),
      meta: { label: "Service", filter: false },
      cell: ({ row }) => (row.original.kind === "booking" ? row.original.booking.serviceName : <span className="text-secondary">{row.original.question}</span>),
    },
    {
      id: "customer",
      header: "Customer",
      size: 300,
      meta: { label: "Customer", filter: false, grow: 1 },
      accessorFn: (r) => (r.kind === "booking" ? `${r.booking.customerName} ${r.booking.customerEmail}` : r.answer),
      // Plain text nodes only: what a customer typed is never read as markup.
      cell: ({ row }) =>
        row.original.kind === "booking" ? (
          <span className="truncate">
            {row.original.booking.customerName} <span className="text-secondary">{row.original.booking.customerEmail}</span>
          </span>
        ) : (
          <span className="truncate text-prose">{row.original.answer}</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      size: 190,
      accessorFn: (r) => (r.kind === "booking" ? STATUS[r.booking.status].word : BOOKINGS_TABLE_WORDS.theirWords),
      meta: { label: "Status", filter: false },
      cell: ({ row }) => {
        const r = row.original;
        if (r.kind === "answer") return <Chip tone="neutral">{BOOKINGS_TABLE_WORDS.theirWords}</Chip>;
        const s = STATUS[r.booking.status];
        return (
          <span className="flex items-center gap-1.5">
            <StatusPill tone={s.tone}>{s.word}</StatusPill>
            {r.booking.test ? (
              <Tooltip content={BOOKINGS_TABLE_WORDS.testTip}>
                <Chip tone="info" tabIndex={0} aria-label={`${BOOKINGS_TABLE_WORDS.test}. ${BOOKINGS_TABLE_WORDS.testTip}`}>
                  {BOOKINGS_TABLE_WORDS.test}
                </Chip>
              </Tooltip>
            ) : null}
          </span>
        );
      },
    },
  ];

  const rowActions = (r: Row) => {
    if (readOnly || r.kind !== "booking" || r.booking.status !== "confirmed" || busyId === r.id) return [];
    const id = r.booking.id;
    return when === "upcoming"
      ? [
          { id: "move", label: BOOKINGS_TABLE_WORDS.move, icon: CalendarClock, onSelect: () => onMove(id) },
          { id: "cancel", label: BOOKINGS_TABLE_WORDS.cancel, icon: CircleSlash, variant: "danger" as const, separatorBefore: true, onSelect: () => setConfirmId(id) },
        ]
      : [{ id: "no-show", label: BOOKINGS_TABLE_WORDS.noShow, icon: UserX, onSelect: () => onNoShow(id) }];
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)} data-bookings-table="">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Which bookings"
          size="md"
          value={when}
          onValueChange={onWhenChange}
          options={[
            { value: "upcoming", label: BOOKINGS_TABLE_WORDS.upcoming },
            { value: "past", label: BOOKINGS_TABLE_WORDS.past },
          ]}
        />
        <p className="t-small text-secondary">Times in {zoneNote(timeZone, new Date(bookings[0]?.startsAt ?? Date.UTC(2026, 0, 1)))}</p>
      </div>
      {confirming ? (
        <div role="group" aria-label={BOOKINGS_TABLE_WORDS.cancel} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-panel px-3 py-2" data-booking-confirm="">
          <p className="t-body text-primary">{BOOKINGS_TABLE_WORDS.confirm(`${confirming.serviceName} with ${confirming.customerName} on ${whenLabel(confirming.startsAt, timeZone)}`)}</p>
          <div className="flex items-center gap-2">
            <Button ref={keep} variant="secondary" onClick={() => setConfirmId(null)}>
              {BOOKINGS_TABLE_WORDS.confirmNo}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                onCancel(confirming.id);
                setConfirmId(null);
              }}
            >
              {BOOKINGS_TABLE_WORDS.confirmYes}
            </Button>
          </div>
        </div>
      ) : null}
      <DataTable<Row>
        aria-label={when === "upcoming" ? "Upcoming bookings" : "Past bookings"}
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        getSubRows={subRows}
        subRowsLabel={(_, n) => BOOKINGS_TABLE_WORDS.answers(n)}
        rowLabel={(r) => (r.kind === "booking" ? `${r.booking.serviceName}, ${r.booking.customerName}` : r.question)}
        rowActions={readOnly ? undefined : rowActions}
        views={views}
        activeViewId={active}
        onActiveViewChange={setActive}
        onViewsChange={setViews}
        loading={loading}
        height={height}
        hideFilter
        empty={BOOKINGS_TABLE_WORDS.empty}
        exportFileName="bookings"
      />
    </div>
  );
}
