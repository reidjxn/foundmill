import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EntityScreen } from "@/components/crm/EntityScreen";
import { isEntityTab } from "@/components/crm/tabs";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /b/[bid]/crm/[entityId]/[tab] — entity profile: overview | activity | relationships | commercial | documents | notes | journey (BUILD §6.2, §11.12). */
export default async function EntityPage({ params }: { params: Promise<{ bid: string; entityId: string; tab: string }> }) {
  const { entityId, tab } = await params;
  if (!UUID_RE.test(entityId) || !isEntityTab(tab)) notFound();
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <EntityScreen entityId={entityId} tab={tab} />
    </Suspense>
  );
}
