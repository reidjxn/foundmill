/**
 * /new/card/<ideaId> — the card a person kept from the landing page's idea box (founder, 2026-11-13; docs/IDEA_BOX.md):
 * where /start sends them right after sign-in, on any screen from 390 px. The card as it is in their deck; then the
 * next step: the three questions about them when the profile is missing (Founder fit is measured after), else building
 * it (Commit). Sharing a card publicly is the network work (`ideaShare.publish`); the page leaves it a slot until then.
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CardKeptView } from "@/components/new/card/CardKeptView";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { serverApi } from "@/lib/trpc-server";

export const metadata: Metadata = { title: "Your card" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ideaId: string }> };

export default async function KeptCardPage({ params }: Props) {
  const { ideaId } = await params;
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect(`/login?next=${encodeURIComponent(`/new/card/${ideaId}`)}`);
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const server = await serverApi();
  if (!server) redirect(`/login?next=${encodeURIComponent(`/new/card/${ideaId}`)}`);
  let idea: Awaited<ReturnType<typeof server.api.idea.get.query>>["idea"];
  try {
    idea = (await server.api.idea.get.query({ ideaId })).idea;
  } catch {
    notFound();
  }
  if (!idea?.current) notFound();
  const attrs = (idea.current.attributes ?? {}) as Record<string, { value: number; evidence?: string }>;
  return (
    <CardKeptView
      ideaId={idea.id}
      viewer={{ email: result.viewer.email }}
      profileComplete={result.viewer.complete}
      card={{
        name: idea.title,
        pitch: idea.pitch,
        archetype: idea.archetype ?? undefined,
        stars_current: Number(idea.current.starsCurrent),
        stars_potential: Number(idea.current.starsPotential),
        attributes: Object.entries(attrs).map(([key, a]) => ({ key, value: a.value, evidence: a.evidence ?? "" })),
      }}
    />
  );
}
