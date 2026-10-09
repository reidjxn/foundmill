import type { Metadata } from "next";
import { Suspense } from "react";
import { NetworkScreen } from "@/components/live/NetworkScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const metadata: Metadata = { title: "Network" };
export const dynamic = "force-dynamic";

/** /network — connections, requests, message threads and profile visibility (BUILD §6.2, §11.14). */
export default function NetworkPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <NetworkScreen />
    </Suspense>
  );
}
