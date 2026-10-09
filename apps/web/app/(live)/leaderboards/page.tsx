import type { Metadata } from "next";
import { Suspense } from "react";
import { LeaderboardsScreen } from "@/components/live/LeaderboardsScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const metadata: Metadata = { title: "Leaderboards" };
export const dynamic = "force-dynamic";

/** /leaderboards — every board, with the current business's position on each (BUILD §6.2, §11.14). */
export default function LeaderboardsPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <LeaderboardsScreen />
    </Suspense>
  );
}
