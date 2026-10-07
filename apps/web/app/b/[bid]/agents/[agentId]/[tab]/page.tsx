import { SurfacePlaceholder } from "@/components/placeholders/SurfacePlaceholder";

export const dynamic = "force-dynamic";

/** Agent profile: overview | training | autonomy | tools | history | logs (BUILD §6.2). */
export default async function AgentPage({ params }: { params: Promise<{ bid: string; agentId: string; tab: string }> }) {
  const { agentId, tab } = await params;
  return <SurfacePlaceholder surface="agent" detail={`agent ${agentId} · ${tab}`} />;
}
