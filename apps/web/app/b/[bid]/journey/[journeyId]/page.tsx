import type { Metadata } from "next";
import { JourneyScreen } from "@/components/journey/JourneyScreen";
import { SCREEN_TITLES } from "@/lib/page-titles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: SCREEN_TITLES.journey };

/** /b/[bid]/journey/[journeyId] — the Customer Update replay (BUILD §11.4). */
export default async function JourneyPage({ params }: { params: Promise<{ bid: string; journeyId: string }> }) {
  const { journeyId } = await params;
  return <JourneyScreen journeyId={journeyId} />;
}
