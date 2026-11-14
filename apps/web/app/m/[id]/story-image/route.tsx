/**
 * The tall share image of a milestone's card (1080 × 1920), for story posts: the same design and the same words as the
 * wide one (../opengraph-image.tsx; lib/milestone-card-image.tsx), at `/m/<id>/story-image`. Signed out like the card
 * (`/m/` is public). A milestone that is not shown, or whose project's page is not public, answers 404 with no image.
 */
import { CARD_IMAGE_TALL, milestoneCardImage } from "@/lib/milestone-card-image";
import { publicMilestoneCard } from "@/lib/public-page.server";

// Read on every request: a milestone hidden, or a page taken down, has no image at once.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const card = await publicMilestoneCard(id);
  if (!card) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  return milestoneCardImage(card, CARD_IMAGE_TALL);
}
