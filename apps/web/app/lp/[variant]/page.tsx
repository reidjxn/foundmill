/**
 * The landing page's other variants (lib/landing-variant.ts), which proxy.ts serves under `/` to a signed-out visitor
 * whose link, channel or earlier visit chose one; the address stays `/`. Prerendered for each variant and regenerated
 * hourly, like `/` (app/page.tsx), so no variant reads a cookie or asks the API anything. Each names `/` as its
 * canonical address and is never indexed on its own.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { calendarDay } from "@/components/landing/examples/helpers";
import { landingSwitches } from "@/components/landing/flags";
import { homeMetadata } from "@/components/landing/seo";
import { DEFAULT_LANDING_VARIANT, LANDING_VARIANTS, isLandingVariant } from "@/lib/landing-variant";

export const revalidate = 3600;
export const dynamicParams = false;
// Static despite the root layout's cookie reads, like `/` (app/page.tsx).
export const dynamic = "force-static";
export const metadata: Metadata = { ...homeMetadata(landingSwitches(process.env)), robots: { index: false, follow: true } };

export function generateStaticParams(): { variant: string }[] {
  return LANDING_VARIANTS.filter((v) => v !== DEFAULT_LANDING_VARIANT).map((variant) => ({ variant }));
}

export default async function LandingVariantPage({ params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  if (!isLandingVariant(variant) || variant === DEFAULT_LANDING_VARIANT) notFound();
  return <LandingPage variant={variant} switches={landingSwitches(process.env)} renderDay={calendarDay(new Date(), "utc")} />;
}
