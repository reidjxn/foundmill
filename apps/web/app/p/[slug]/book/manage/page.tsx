/**
 * The customer's own booking (founder, Nov 22, 2026): `/p/<slug>/book/manage?t=<token>`, the page the link in a booking
 * email opens. Signed out, from 390 px, never indexed. The signed token in `t` is the only credential; the api reads it
 * on every call. A link that is not valid (or has no token) is a real page that says so, not an error. The customer is
 * served by the booking the token names, whatever `<slug>` says. Changes go through ./actions.ts.
 */
import type { Metadata } from "next";
import { SearchX } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { EmptyState } from "@foundmill/dugout";
import { BOOKING_ERRORS } from "@foundmill/shared/booking";
import { pagePath } from "@foundmill/shared/project-page";
import { PublicManageBooking } from "@/components/public/PublicManageBooking";
import { pageMarkFor } from "@/lib/public-mark.server";
import { publicManagedBooking, publicProjectPage } from "@/lib/public-page.server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your booking", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ t?: string | string[] }> };

export default async function ManageBookingRoute({ searchParams }: Props) {
  const raw = (await searchParams).t;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 200) ?? "";
  const booking = token ? await publicManagedBooking(token) : null;
  if (!booking) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas px-gutter" data-testid="booking-not-found">
        <EmptyState
          icon={SearchX}
          title="Your booking"
          actions={
            <a href="/" className="btn-secondary t-action inline-flex min-h-tap items-center rounded-sm px-btn-md text-primary focus-ring">
              {`Go to ${APP_NAME}`}
            </a>
          }
        >
          {BOOKING_ERRORS.booking_not_found}
        </EmptyState>
      </main>
    );
  }
  const page = await publicProjectPage(booking.slug).catch(() => null);
  const { mark, markHref } = page ? await pageMarkFor(page, page.mark) : { mark: "none" as const, markHref: "/" };
  return (
    <PublicManageBooking
      token={token}
      bookHref={`${pagePath(booking.slug)}/book`}
      booking={booking}
      brandPrimary={page?.brandPrimary}
      brandSecondary={page?.brandSecondary}
      logo={page?.logo}
      mark={mark}
      markHref={markHref}
    />
  );
}
