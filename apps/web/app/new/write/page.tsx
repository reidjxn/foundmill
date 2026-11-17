/** /new/write — a phone start without a card (WP-04 T15): a working name and the idea, then Commit. */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WriteIdea } from "@/components/new/WriteIdea";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";

export const metadata: Metadata = { title: "What do you want to build?" };
export const dynamic = "force-dynamic";

export default async function WriteIdeaPage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fnew%2Fwrite");
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  return <WriteIdea viewer={{ email: viewer.email }} />;
}
