import type { Metadata } from "next";
import { Suspense } from "react";
import { LeaderboardScreen } from "@/components/live/LeaderboardScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

/** /leaderboards/[boardId] — one board's entries: position, movement, logo, the ranked metric, form (BUILD §6.2). */
export default async function LeaderboardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <LeaderboardScreen boardId={boardId} />
    </Suspense>
  );
}
