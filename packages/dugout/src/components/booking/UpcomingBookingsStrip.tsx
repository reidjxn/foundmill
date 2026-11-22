/**
 * Today's bookings, compact (founder, Nov 22, 2026): up to three rows (time in the founder's zone, service, customer)
 * and a "See all" link. Renders nothing when there are none. Server-safe.
 */
import { cn } from "../../lib/cn";
import { clockLabel } from "./format";
import type { FounderBooking } from "./types";

export const UPCOMING_BOOKINGS_WORDS = { title: "Bookings today", seeAll: "See all" } as const;

export interface UpcomingBookingsStripProps {
  bookings: readonly Pick<FounderBooking, "id" | "serviceName" | "startsAt" | "customerName">[];
  /** The founder's IANA zone. */
  timeZone: string;
  /** Where the full list is. */
  href: string;
  className?: string;
}

export function UpcomingBookingsStrip({ bookings, timeZone, href, className }: UpcomingBookingsStripProps) {
  if (bookings.length === 0) return null;
  return (
    <section aria-label={UPCOMING_BOOKINGS_WORDS.title} className={cn("flex min-w-0 flex-col gap-2", className)} data-upcoming-bookings="">
      <div className="flex items-center justify-between gap-3">
        <h2 className="t-label text-secondary">{UPCOMING_BOOKINGS_WORDS.title}</h2>
        <a href={href} className="t-small inline-flex min-h-control-md items-center rounded-sm text-secondary underline decoration-line-strong underline-offset-4 transition-colors duration-hover hover:text-primary focus-ring">
          {UPCOMING_BOOKINGS_WORDS.seeAll}
        </a>
      </div>
      <ul role="list" className="flex flex-col">
        {bookings.slice(0, 3).map((b) => (
          <li key={b.id} className="t-body flex min-w-0 items-baseline gap-3 border-t border-line-faint py-1.5 first:border-t-0">
            <span className="w-20 shrink-0 tabular-nums text-primary">{clockLabel(b.startsAt, timeZone)}</span>
            <span className="min-w-0 flex-1 truncate text-prose">{b.serviceName}</span>
            <span className="min-w-0 max-w-40 truncate text-secondary">{b.customerName}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
