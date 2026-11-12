import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CallRoom } from "@/components/calls/CallRoom";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One team call (docs/TEAM_CALL.md §6): the stage while it is live, the wrap-up once it has ended. */
export default async function CallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  if (!UUID_RE.test(callId)) notFound();
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <CallRoom callId={callId} />
    </Suspense>
  );
}
