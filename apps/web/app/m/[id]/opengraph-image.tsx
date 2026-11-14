/**
 * The wide share image of a milestone's card (1200 × 630), for link previews: the milestone's words, the project's
 * name, the day it was reached and "Verified by Foundmill" on the project's own brand colors, with "Built on Foundmill"
 * small in the corner for a project on the free plan only (lib/milestone-card-image.tsx; the tall one for story posts is
 * ./story-image). A milestone that is not shown has no image.
 */
import { notFound } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { CARD_IMAGE_TYPE, CARD_IMAGE_WIDE, milestoneCardImage } from "@/lib/milestone-card-image";
import { publicMilestoneCard } from "@/lib/public-page.server";

export const size = CARD_IMAGE_WIDE;
export const contentType = CARD_IMAGE_TYPE;
export const alt = `A milestone verified by ${APP_NAME}`;
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await publicMilestoneCard(id);
  if (!card) notFound();
  return milestoneCardImage(card, CARD_IMAGE_WIDE);
}
