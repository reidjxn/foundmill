import type { Metadata } from "next";
import { Suspense } from "react";
import { CommunitiesScreen } from "@/components/live/CommunitiesScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const metadata: Metadata = { title: "Communities" };
export const dynamic = "force-dynamic";

/** /communities — the communities the founder can see, with join and leave (BUILD §6.2, §11.14). */
export default function CommunitiesPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <CommunitiesScreen />
    </Suspense>
  );
}
