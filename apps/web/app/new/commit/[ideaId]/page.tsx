/** /new/commit/[ideaId] — the Commit screen: the name and "Start my project", the rest under More options (BUILD §11.1, AC-11.1.6/7; WP-04 T2). */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DEFAULT_BUSINESS_CURRENCY } from "@foundmill/shared/constants";
import { Suspense } from "react";
import { CommitScreen } from "@/components/new/commit/CommitScreen";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";

export const metadata: Metadata = { title: "Start your project" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CommitPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  if (!UUID_RE.test(ideaId)) notFound();
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect(`/login?next=${encodeURIComponent(`/new/commit/${ideaId}`)}`);
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  // The Commit screen offers the founder's currency; commit stores it on the business (0025). A complete viewer has a profile.
  return (
    <Suspense fallback={null}>
      <CommitScreen ideaId={ideaId} viewer={{ email: viewer.email }} currency={viewer.profile?.currency ?? DEFAULT_BUSINESS_CURRENCY} />
    </Suspense>
  );
}
