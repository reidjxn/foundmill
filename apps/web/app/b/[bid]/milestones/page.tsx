import type { Metadata } from "next";
import { Suspense } from "react";
import { MilestonesScreen } from "@/components/milestones/MilestonesScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { SCREEN_TITLES } from "@/lib/page-titles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: SCREEN_TITLES.milestones };

/** Milestones (the product word for the trophy cabinet, BUILD §11.4; `/trophies` forwards here). `?share=<key>` opens a card on LIVE. */
export default function MilestonesPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <MilestonesScreen />
    </Suspense>
  );
}
