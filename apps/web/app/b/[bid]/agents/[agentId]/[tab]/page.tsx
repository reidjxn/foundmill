import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AgentProfileScreen } from "@/components/agents/AgentProfileScreen";
import { isAgentTab } from "@/components/agents/tabs";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { agentTitle } from "@/lib/page-titles";
import { serverDepartments } from "@/lib/trpc-server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ bid: string; agentId: string; tab: string }>;

/** "Training · Mara": the agent's name from the department roster the layout already loaded (one shared call). */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { bid, agentId, tab } = await params;
  if (!UUID_RE.test(bid) || !UUID_RE.test(agentId)) return { title: agentTitle([], agentId, tab) };
  const departments = await serverDepartments(bid).catch(() => null);
  return { title: agentTitle(departments ?? [], agentId, tab) };
}

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
