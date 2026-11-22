/**
 * Booking on a project's public page (founder, Nov 22, 2026: Foundmill's own booking): `/p/<slug>/book`, open to anyone
 * signed out and from 390 px (like the project page it belongs to). Rendered from the api's public view
 * (`publicBooking.get`); a project whose booking is not live, or whose page is not public, is the same not-found.
 * The flow itself (times, hold, details, "You are booked.") is the client wrapper (components/public/PublicBookingFlow.tsx).
 * Not indexed: a booking page is a form, not something to find in search.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicBookingFlow } from "@/components/public/PublicBookingFlow";
import { PublicAppPrompt } from "@/components/shell/PublicAppPrompt";
import { pageMarkFor } from "@/lib/public-mark.server";
import { publicBookingSetup, publicProjectPage } from "@/lib/public-page.server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const booking = await publicBookingSetup(slug).catch(() => null);
  return { title: booking ? `Book a time with ${booking.name}` : "Page not found", robots: { index: false, follow: false } };
}

export default async function PublicBookingRoute({ params }: Props) {
  const { slug } = await params;
  const [booking, page] = await Promise.all([publicBookingSetup(slug), publicProjectPage(slug)]);
  if (!booking || !page) notFound();
  const { mark, markHref } = await pageMarkFor(page, booking.mark);
  return (
    <>
      <PublicBookingFlow slug={booking.slug} projectName={booking.name} brandPrimary={page.brandPrimary} brandSecondary={page.brandSecondary} logo={page.logo} mark={mark} markHref={markHref} services={booking.services} />
      <PublicAppPrompt />
    </>
  );
}
