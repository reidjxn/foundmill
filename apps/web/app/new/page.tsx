/**
 * /new — Door A (Ideation Studio) or Door B (Import). The founder profile gate (AC-11.1.1) applies here too: a
 * founder without a profile is sent to /onboarding first, because every concept is drafted within their constraints.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Doors } from "@/components/new/Doors";
import { loadStudioViewer, profileLineOf } from "@/components/new/viewer.server";
import { UnreachablePage } from "@/components/shell/UnreachablePage";

export const metadata: Metadata = { title: "New business" };
export const dynamic = "force-dynamic";

export default async function NewBusinessPage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fnew");
  if (result.kind === "unreachable") return <UnreachablePage message={result.message} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  return <Doors viewer={{ email: viewer.email }} profileLine={profileLineOf(viewer.profile)} businessCount={viewer.businesses.length} />;
}
