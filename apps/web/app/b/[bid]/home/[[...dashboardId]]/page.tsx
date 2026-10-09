import type { ReactNode } from "react";
import { HomeScreen } from "@/components/home/HomeScreen";
import { pickDashboardId } from "@/components/home/pick-dashboard";
import { Prefetched, createServerPrefetch } from "@/lib/hydrate.server";
import { createServerClient, serverApi } from "@/lib/trpc-server";

export const dynamic = "force-dynamic";

/** /b/[bid]/home[/[dashboardId]] — Home dashboards (BUILD §11.2). */
export default async function HomePage({ params }: { params: Promise<{ bid: string; dashboardId?: string[] }> }) {
  const { bid, dashboardId } = await params;
  const routeId = dashboardId?.[0];
  return (
    <HomeData businessId={bid} routeId={routeId}>
      <HomeScreen dashboardId={routeId} />
    </HomeData>
  );
}

/**
 * Home's first two queries start on the server: `dashboard.list`, and `dashboard.get` for the dashboard the client will
 * pick (the one in the URL, else the active one). Without a dashboard id the list is awaited first (one short API
 * call; the shell is already on screen behind the loading skeleton); `dashboard.get` is handed over still pending.
 * Anything that fails here is simply fetched by the browser as before.
 */
async function HomeData({ businessId, routeId, children }: { businessId: string; routeId: string | undefined; children: ReactNode }) {
  const server = await serverApi();
  if (!server) return <>{children}</>;
  const { queryClient, trpc } = createServerPrefetch(createServerClient(server.auth));
  const list = trpc.dashboard.list.queryOptions({ businessId });
  let id = routeId;
  if (id) void queryClient.prefetchQuery(list);
  else {
    try {
      id = pickDashboardId(undefined, await queryClient.fetchQuery(list));
    } catch {
      return <>{children}</>;
    }
  }
  if (id) void queryClient.prefetchQuery(trpc.dashboard.get.queryOptions({ businessId, dashboardId: id }));
  return <Prefetched queryClient={queryClient}>{children}</Prefetched>;
}
