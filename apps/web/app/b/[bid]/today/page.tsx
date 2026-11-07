import type { ReactNode } from "react";
import { TodayScreen } from "@/components/today/TodayScreen";
import { Prefetched, createServerPrefetch } from "@/lib/hydrate.server";
import { createServerClient, serverApi } from "@/lib/trpc-server";

export const dynamic = "force-dynamic";

/** /b/[bid]/today — Today, the business's front door (founder, 2026-11-07; DESIGN §9). */
export default async function TodayPage({ params }: { params: Promise<{ bid: string }> }) {
  const { bid } = await params;
  return (
    <TodayData businessId={bid}>
      <TodayScreen />
    </TodayData>
  );
}

/**
 * Today's two reads start on the server and are handed over still pending: the goal (`goal.current`) and Needs you,
 * the week and the spend (`today.get`). Both are business procedures any member may read, so neither rejects for a
 * member; anything that fails here is simply fetched by the browser as before.
 */
async function TodayData({ businessId, children }: { businessId: string; children: ReactNode }) {
  const server = await serverApi();
  if (!server) return <>{children}</>;
  const { queryClient, trpc } = createServerPrefetch(createServerClient(server.auth));
  void queryClient.prefetchQuery(trpc.goal.current.queryOptions({ businessId }));
  void queryClient.prefetchQuery(trpc.today.get.queryOptions({ businessId }));
  return <Prefetched queryClient={queryClient}>{children}</Prefetched>;
}
