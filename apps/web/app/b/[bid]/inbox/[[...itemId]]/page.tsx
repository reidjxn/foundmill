import { Suspense } from "react";
import { InboxScreen } from "@/components/inbox/InboxScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const dynamic = "force-dynamic";

/** /b/[bid]/inbox[/[itemId]] — the Inbox (BUILD §11.3). `?tab=` picks the list tab (All by default). */
export default async function InboxPage({ params }: { params: Promise<{ bid: string; itemId?: string[] }> }) {
  const { itemId } = await params;
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <InboxScreen itemId={itemId?.[0]} />
    </Suspense>
  );
}
