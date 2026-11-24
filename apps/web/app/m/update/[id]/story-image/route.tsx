/**
 * The tall share image of a shared Customer Update (1080 × 1920), for story posts: the same design and the same words
 * as the wide one (../opengraph-image.tsx; lib/update-card-image.tsx), at `/m/update/<id>/story-image`. A Customer
 * Update that is not shared, or whose project's page is not public, answers 404 with no image.
 */
import { CARD_IMAGE_TALL } from "@/lib/milestone-card-image";
import { publicUpdateCard } from "@/lib/public-page.server";
import { updateCardImage } from "@/lib/update-card-image";

// Read on every request: a card the founders stopped sharing has no image at once.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const found = await publicUpdateCard(id);
  if (!found) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  return updateCardImage(found, CARD_IMAGE_TALL);
}
