import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AgentProfileScreen } from "@/components/agents/AgentProfileScreen";
import { isAgentTab } from "@/components/agents/tabs";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ bid: string; agentId: string; tab: string }>;

/** /b/[bid]/agents/[agentId]/[tab] — agent profile: overview | training | autonomy | tools | history | logs (BUILD §6.2, §11.10). Anything else renders ./not-found.tsx. */
export default async function AgentPage({ params }: { params: Params }) {
  const { agentId, tab } = await params;
  if (!UUID_RE.test(agentId) || !isAgentTab(tab)) notFound();
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <AgentProfileScreen agentId={agentId} tab={tab} />
    </Suspense>
  );
}
