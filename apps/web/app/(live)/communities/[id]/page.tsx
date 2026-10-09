import type { Metadata } from "next";
import { Suspense } from "react";
import { CommunityScreen } from "@/components/live/CommunityScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const metadata: Metadata = { title: "Community" };
export const dynamic = "force-dynamic";

/** /communities/[id] — one community's feed (posts and replies), members and a post box (BUILD §6.2). */
export default async function CommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <CommunityScreen communityId={id} />
    </Suspense>
  );
}
