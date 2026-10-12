/** /new/import — Door B: sources → import job → Scouting report (BUILD §11.1, AC-11.1.5). */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ImportScreen } from "@/components/new/import/ImportScreen";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";

export const metadata: Metadata = { title: "Import a business" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fnew%2Fimport");
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  return <ImportScreen viewer={{ email: viewer.email }} />;
}
