import { Suspense } from "react";
import { CallLobby } from "@/components/calls/CallLobby";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const dynamic = "force-dynamic";

/** Team call lobby (docs/TEAM_CALL.md §6): start a call with the team, and the past calls. A desktop console screen. */
export default function CallsPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <CallLobby />
    </Suspense>
  );
}
