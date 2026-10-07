/** /new/commit/[ideaId] — the Commit screen: name, crest and brand colours, modes, archetype, "Take charge" (BUILD §11.1, AC-11.1.6/7). */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { CommitScreen } from "@/components/new/commit/CommitScreen";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { UnreachablePage } from "@/components/shell/UnreachablePage";

export const metadata: Metadata = { title: "Commit" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CommitPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  if (!UUID_RE.test(ideaId)) notFound();
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect(`/login?next=${encodeURIComponent(`/new/commit/${ideaId}`)}`);
  if (result.kind === "unreachable") return <UnreachablePage message={result.message} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  return (
    <Suspense fallback={null}>
      <CommitScreen ideaId={ideaId} viewer={{ email: viewer.email }} currency={viewer.profile?.currency ?? "EUR"} />
    </Suspense>
  );
}
