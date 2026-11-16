/** /new/ideate — the Ideation Studio (BUILD §11.1 Door A, AC-11.1.2/3). */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { IdeationStudio } from "@/components/new/ideate/IdeationStudio";
import { loadStudioViewer, profileLineOf } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";

export const metadata: Metadata = { title: "Ideation Studio" };
export const dynamic = "force-dynamic";

export default async function IdeatePage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fnew%2Fideate");
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  // The three questions go on to the Studio (a card kept with "Shape it in the Ideation Studio" keeps its thread).
  if (!viewer.complete) redirect("/onboarding?next=%2Fnew%2Fideate");
  return <IdeationStudio viewer={{ email: viewer.email }} profileLine={profileLineOf(viewer.profile)} constraints={viewer.profile?.constraints ?? []} />;
}
