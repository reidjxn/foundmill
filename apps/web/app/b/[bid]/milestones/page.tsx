import { Suspense } from "react";
import { MilestonesScreen } from "@/components/milestones/MilestonesScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const dynamic = "force-dynamic";

/** Milestones (the product word for the trophy cabinet, BUILD §11.4; `/trophies` forwards here). `?share=<key>` opens a card on LIVE. */
export default function MilestonesPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <MilestonesScreen />
    </Suspense>
  );
}
