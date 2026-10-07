import { SurfacePlaceholder } from "@/components/placeholders/SurfacePlaceholder";

export const dynamic = "force-dynamic";

export default async function EntityPage({ params }: { params: Promise<{ bid: string; entityId: string; tab: string }> }) {
  const { entityId, tab } = await params;
  return <SurfacePlaceholder surface="entity" detail={`entity ${entityId} · ${tab}`} />;
}
