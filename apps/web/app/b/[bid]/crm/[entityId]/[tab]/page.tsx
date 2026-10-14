import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { EntityScreen } from "@/components/crm/EntityScreen";
import { isEntityTab } from "@/components/crm/tabs";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { Prefetched, createServerPrefetch } from "@/lib/hydrate.server";
import { entityTitle } from "@/lib/page-titles";
import { createServerClient, serverApi, serverEntity } from "@/lib/trpc-server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ bid: string; entityId: string; tab: string }>;

/** "Activity · Acme Ltd": the entity's name from the same `crm.entity.get` the page hands to the browser. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { bid, entityId, tab } = await params;
  if (!UUID_RE.test(bid) || !UUID_RE.test(entityId)) return { title: entityTitle(null, tab) };
  const got = await serverEntity(bid, entityId).catch(() => null);
  return { title: entityTitle(got?.entity.displayName ?? null, tab) };
}

/** /b/[bid]/crm/[entityId]/[tab] — entity profile: overview | activity | relationships | commercial | documents | notes | journey (BUILD §6.2, §11.12). */
export default async function EntityPage({ params }: { params: Params }) {
  const { bid, entityId, tab } = await params;
  if (!UUID_RE.test(entityId) || !isEntityTab(tab)) notFound();
  return (
    <EntityData businessId={bid} entityId={entityId}>
      <Suspense fallback={<ScreenSkeleton />}>
        <EntityScreen entityId={entityId} tab={tab} />
      </Suspense>
    </EntityData>
  );
}

/**
 * The profile's `crm.entity.get` starts on the server (the call the title above already made) and is handed over, so
 * the browser does not ask again after hydration. A failure is simply fetched by the browser as before.
 */
async function EntityData({ businessId, entityId, children }: { businessId: string; entityId: string; children: ReactNode }) {
  const server = await serverApi();
  if (!server || !UUID_RE.test(businessId)) return <>{children}</>;
  const { queryClient, trpc } = createServerPrefetch(createServerClient(server.auth));
  const options = trpc.crm.entity.get.queryOptions({ businessId, entityId });
  void queryClient.prefetchQuery({
    queryKey: options.queryKey,
    queryFn: async () => {
      const got = await serverEntity(businessId, entityId);
      if (!got) throw new Error("Signed out");
      return got;
    },
  });
  return <Prefetched queryClient={queryClient}>{children}</Prefetched>;
}
