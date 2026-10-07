import { SurfacePlaceholder } from "@/components/placeholders/SurfacePlaceholder";

export const dynamic = "force-dynamic";

/** /b/[bid]/inbox[/[itemId]] — replaced by the Inbox build (BUILD §11.3). */
export default async function InboxPage({ params }: { params: Promise<{ bid: string; itemId?: string[] }> }) {
  const { itemId } = await params;
  return <SurfacePlaceholder surface="inbox" detail={itemId?.[0] ? `item ${itemId[0]}` : undefined} />;
}
