/**
 * The landing page on another example business than the default (`/?example=glitchwick`, which proxy.ts serves from
 * here; the address stays as the visitor typed it). Prerendered for each business and regenerated hourly, like `/`
 * (app/page.tsx); the business is loaded on the server and passed down whole, so the first paint and hydration agree.
 */
import { notFound } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { DEFAULT_EXAMPLE_ID, EXAMPLE_IDS, isExampleId, loadExample } from "@/components/landing/examples";
import { calendarDay } from "@/components/landing/examples/helpers";

export const revalidate = 3600;
export const dynamicParams = false;
// Static despite the root layout's cookie reads, like `/` (app/page.tsx).
export const dynamic = "force-static";

export function generateStaticParams(): { id: string }[] {
  return EXAMPLE_IDS.filter((id) => id !== DEFAULT_EXAMPLE_ID).map((id) => ({ id }));
}

export default async function ExampleLandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isExampleId(id) || id === DEFAULT_EXAMPLE_ID) notFound();
  return <LandingPage initialExample={await loadExample(id)} renderDay={calendarDay(new Date(), "utc")} />;
}
