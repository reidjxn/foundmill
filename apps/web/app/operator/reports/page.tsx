/**
 * /operator/reports — the platform's review queue for reports of people, profiles and messages (docs/NETWORK.md F21).
 * Desktop only. The api answers not found to anyone outside `OPERATOR_USER_IDS`, and so does this page.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { ReportsQueue } from "@/components/operator/ReportsQueue";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";

export const metadata: Metadata = { title: "Reports", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function OperatorReportsPage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Foperator%2Freports");
  if (result.kind === "unreachable")
    return <ApiErrorPage error={result.error} email={result.email} />;
  return <ReportsQueue viewer={{ email: result.viewer.email }} />;
}
