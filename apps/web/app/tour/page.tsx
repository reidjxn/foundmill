/**
 * `/tour` (founder, 2026-11-15): the earlier landing page, for the second reader (an investor, the press, an
 * experienced founder), with its example businesses running. Linked from `/`'s footer from 1280 px; desktop, like the
 * console (under 1280 px it asks for a larger window). Never indexed. Prerendered and regenerated hourly, like `/`.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TourPage } from "@/components/landing/TourPage";
import { TOUR_ENABLED } from "@/components/landing/flags";
import { calendarDay } from "@/components/landing/examples/helpers";

export const revalidate = 3600;
export const dynamic = "force-static";
export const metadata: Metadata = { title: "How the team works", robots: { index: false, follow: true } };

export default function TourRoute() {
  if (!TOUR_ENABLED) notFound();
  return <TourPage renderDay={calendarDay(new Date(), "utc")} />;
}
