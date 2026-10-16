/**
 * /new — Create a new business: Door A (Ideation Studio) or Door B (Import), with Back to the business the founder
 * came from. The founder profile gate (AC-11.1.1) applies here too: a
 * founder without a profile is sent to /onboarding first, because every concept is drafted within their constraints.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Doors } from "@/components/new/Doors";
import { loadStudioViewer, profileLineOf } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { pickCurrentBusiness } from "@/lib/auth/current-business";
import { getLastBusinessId } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Create a new business" };
export const dynamic = "force-dynamic";

export default async function NewBusinessPage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fnew");
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  // The business the founder came from (Switch business › Create a new business): the doors offer the way back to it.
  const last = pickCurrentBusiness(await getLastBusinessId(), viewer.businesses);
  return <Doors viewer={{ email: viewer.email }} profileLine={profileLineOf(viewer.profile)} businessCount={viewer.businesses.length} backTo={last ? { id: last.id, name: last.name } : null} />;
}
