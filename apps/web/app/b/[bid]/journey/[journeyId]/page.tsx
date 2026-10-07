import { SurfacePlaceholder } from "@/components/placeholders/SurfacePlaceholder";

export const dynamic = "force-dynamic";

export default async function JourneyPage({ params }: { params: Promise<{ bid: string; journeyId: string }> }) {
  const { journeyId } = await params;
  return <SurfacePlaceholder surface="journey" detail={`journey ${journeyId}`} />;
}
