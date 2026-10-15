import { JourneyScreen } from "@/components/journey/JourneyScreen";

export const dynamic = "force-dynamic";

/** /b/[bid]/journey/[journeyId] — the Customer Update replay (BUILD §11.4). */
export default async function JourneyPage({ params }: { params: Promise<{ bid: string; journeyId: string }> }) {
  const { journeyId } = await params;
  return <JourneyScreen journeyId={journeyId} />;
}
