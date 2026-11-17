/**
 * /new/ideate/<ideaId> — the Ideation Studio opened on one card (founder, 2026-11-16): where a card kept with "Shape it
 * in the Ideation Studio" lands, the card highlighted, in view and focused. A path, not a query, so a phone's "Email me
 * a link" (`isContinuePath`) carries it to a computer. An id that is not a uuid opens the Studio as it is.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { IdeationStudio } from "@/components/new/ideate/IdeationStudio";
import { loadStudioViewer, profileLineOf } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";

export const metadata: Metadata = { title: "Ideation Studio" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ ideaId: string }> };

export default async function IdeateOnCardPage({ params }: Props) {
  const { ideaId } = await params;
  if (!UUID.test(ideaId)) redirect("/new/ideate");
  const here = `/new/ideate/${ideaId}`;
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect(`/login?next=${encodeURIComponent(here)}`);
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  // The three questions go on to this card in the Studio.
  if (!viewer.complete) redirect(`/onboarding?next=${encodeURIComponent(here)}`);
  return <IdeationStudio viewer={{ email: viewer.email }} profileLine={profileLineOf(viewer.profile)} constraints={viewer.profile?.constraints ?? []} focusIdeaId={ideaId} />;
}
