/**
 * The small block on a project's public page that leads to booking (founder, Nov 22, 2026): "Book a time", up to three
 * services with their length and price, and one link to the open times. Server-safe: no hooks, no handlers.
 */
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { serviceLine } from "./format";
import type { PublicBookingService } from "./types";

export const BOOKING_BLOCK_WORDS = {
  heading: "Book a time",
  link: "See open times",
  more: (n: number) => (n === 1 ? "and 1 more service" : `and ${n} more services`),
} as const;

export interface BookingBlockProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  services: readonly PublicBookingService[];
  /** Where the booking page is. */
  href: string;
  /** The heading's level; 2 on the project page (its title is the h1). */
  headingLevel?: 2 | 3;
}

export function BookingBlock({ services, href, headingLevel = 2, className, ...rest }: BookingBlockProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const shown = services.slice(0, 3);
  return (
    <section data-booking-block="" className={cn("flex min-w-0 flex-col gap-4 rounded-md border border-line bg-panel p-4 @page-wide:p-5", className)} {...rest} aria-label={BOOKING_BLOCK_WORDS.heading}>
      <Heading className="t-title min-w-0 break-words text-primary">{BOOKING_BLOCK_WORDS.heading}</Heading>
      <ul role="list" className="flex min-w-0 flex-col gap-2">
        {shown.map((s) => (
          <li key={s.id} className="t-body min-w-0 break-words text-prose">
            {serviceLine(s)}
          </li>
        ))}
      </ul>
      {services.length > shown.length ? <p className="t-small text-secondary">{BOOKING_BLOCK_WORDS.more(services.length - shown.length)}</p> : null}
      <Button asChild variant="tinted" size="lg" className="min-h-tap self-stretch @page-wide:self-start">
        <a href={href}>{BOOKING_BLOCK_WORDS.link}</a>
      </Button>
    </section>
  );
}
