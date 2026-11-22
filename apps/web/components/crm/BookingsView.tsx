"use client";
/**
 * Customers › Bookings (founder, Nov 22, 2026: Foundmill's own booking): the bookings made on the project's public
 * page, upcoming and past, in the design system's `BookingsTable` (saved views, right-click menu), in the business's own
 * time zone. Owners, cofounders and admins cancel, move and mark a booking that did not show (the customer is told by
 * email); every other member reads the table without those actions. "Move" opens a dialog with the open times, in the
 * business's zone, for the booking's service; a refused move (the time was just taken) says so and keeps the dialog
 * open. The list refreshes after each action and when a booking is made, canceled or moved.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookingSlotPicker, BookingsTable, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, useToast, whenLabel, type BookingsWhen, type FounderBooking } from "@foundmill/dugout";
import { businessTimeZone } from "@foundmill/shared/time-zone";
import { useBusinessEvents } from "@foundmill/widgets";
import { useState } from "react";
import { useBusiness } from "@/components/shell/business-context";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

const BOOKING_EVENTS = ["booking.confirmed", "booking.canceled", "booking.rescheduled", "booking.no_show"] as const;
const FIRST_RANGE_DAYS = 28;
const DAY_MS = 86_400_000;

export const BOOKINGS_VIEW_WORDS = {
  title: "Bookings",
  explain: "Bookings made on your public page. Right-click a booking, or press Shift+F10, to move or cancel it.",
  moveTitle: "Move this booking",
  moveDescription: (what: string) => `${what}. The customer is told by email.`,
  moveConfirm: "Move booking",
  moveCancel: "Keep the time",
  moveFailed: "The booking could not be moved.",
} as const;

export function BookingsView() {
  const { businessId, data, isAdmin } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const zone = businessTimeZone(data.business.timeZone);
  const [when, setWhen] = useState<BookingsWhen>("upcoming");
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = useQuery(trpc.booking.list.queryOptions({ businessId, when }));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.booking.pathKey() });
  useBusinessEvents(refresh, BOOKING_EVENTS);

  const fail = (title: string) => (err: unknown) => toast({ title, description: errorMessage(err), tone: "bad" });
  const settle = { onSettled: () => (setBusyId(null), refresh()) };
  const cancel = useMutation(trpc.booking.cancel.mutationOptions({ ...settle, onError: fail("The booking could not be canceled") }));
  const noShow = useMutation(trpc.booking.noShow.mutationOptions({ ...settle, onError: fail("That did not go through") }));

  // --- Move ---------------------------------------------------------------------------------------------------------
  const [moving, setMoving] = useState<FounderBooking | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [until, setUntil] = useState(() => Date.now() + FIRST_RANGE_DAYS * DAY_MS);
  const serviceId = moving?.serviceId;
  const slots = useQuery(trpc.booking.slots.queryOptions({ businessId, serviceId: serviceId ?? "", from: new Date(), to: new Date(until), exceptBookingId: moving?.id }, { enabled: Boolean(moving && serviceId) }));
  const move = useMutation(
    trpc.booking.move.mutationOptions({
      onSuccess: () => {
        setMoving(null);
        refresh();
      },
      // The dialog stays open: the sentence says why, and the times reload without the one that went.
      onError: () => void slots.refetch(),
    }),
  );
  const open = (b: FounderBooking) => {
    setPicked(null);
    setUntil(Date.now() + FIRST_RANGE_DAYS * DAY_MS);
    move.reset();
    setMoving(b);
  };

  const bookings = list.data ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="bookings-view">
      <p className="t-small text-secondary">{BOOKINGS_VIEW_WORDS.explain}</p>
      {list.error ? (
        <p role="alert" className="t-body text-status-bad">
          {errorMessage(list.error)}
        </p>
      ) : null}
      <BookingsTable
        bookings={bookings as FounderBooking[]}
        when={when}
        onWhenChange={setWhen}
        timeZone={zone}
        readOnly={!isAdmin}
        loading={list.isLoading}
        busyId={busyId}
        height={typeof window === "undefined" ? 480 : Math.max(320, window.innerHeight - 360)}
        onCancel={(id) => (setBusyId(id), cancel.mutate({ businessId, bookingId: id }))}
        onNoShow={(id) => (setBusyId(id), noShow.mutate({ businessId, bookingId: id }))}
        onMove={(id) => {
          const b = bookings.find((x) => x.id === id);
          if (b) open(b as FounderBooking);
        }}
      />
      <Dialog open={moving !== null} onOpenChange={(o) => !o && setMoving(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{BOOKINGS_VIEW_WORDS.moveTitle}</DialogTitle>
            <DialogDescription>{moving ? BOOKINGS_VIEW_WORDS.moveDescription(`${moving.serviceName} with ${moving.customerName}, now ${whenLabel(moving.startsAt, zone)}`) : null}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {serviceId ? (
              <BookingSlotPicker slots={slots.data?.slots ?? []} timeZone={zone} loading={slots.isLoading} selected={picked} onPick={setPicked} rangeEnd={new Date(until).toISOString()} onNeedSlots={(r) => setUntil(new Date(r.to).getTime())} />
            ) : null}
            {move.error ? (
              <p role="alert" className="t-body mt-3 text-status-bad" data-testid="booking-move-error">
                {errorMessage(move.error, BOOKINGS_VIEW_WORDS.moveFailed)}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMoving(null)}>
              {BOOKINGS_VIEW_WORDS.moveCancel}
            </Button>
            <Button variant="primary" disabled={!picked || !moving} loading={move.isPending} onClick={() => moving && picked && move.mutate({ businessId, bookingId: moving.id, start: new Date(picked) })}>
              {BOOKINGS_VIEW_WORDS.moveConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
