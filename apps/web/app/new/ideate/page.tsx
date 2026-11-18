/** /new/ideate — the Ideation Studio (BUILD §11.1 Door A, AC-11.1.2/3). */
import { fitBasisOf } from "@foundmill/config";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { IdeationStudio } from "@/components/new/ideate/IdeationStudio";
import { loadStudioViewer, profileLineOf } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";

export const metadata: Metadata = { title: "Ideation Studio" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function IdeatePage({ searchParams }: Props) {
  // The long profile was just saved over a quick one (WP-14 T2): the Studio says fit was re-rated and offers a fresh set.
  const sharpened = (await searchParams).sharpened === "1";
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fnew%2Fideate");
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  return <IdeationStudio viewer={{ email: viewer.email }} profileLine={profileLineOf(viewer.profile)} constraints={viewer.profile?.constraints ?? []} fitBasis={fitBasisOf(viewer.profile)} sharpened={sharpened} accountId={viewer.userId} />;
}
