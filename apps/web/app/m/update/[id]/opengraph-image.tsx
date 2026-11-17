/**
 * The wide share image of a shared Customer Update (1200 × 630), for link previews (lib/update-card-image.tsx; the tall
 * one for story posts is ./story-image). A Customer Update that is not shared has no image.
 */
import { notFound } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { CARD_IMAGE_TYPE, CARD_IMAGE_WIDE } from "@/lib/milestone-card-image";
import { publicUpdateCard } from "@/lib/public-page.server";
import { updateCardImage } from "@/lib/update-card-image";

export const size = CARD_IMAGE_WIDE;
export const contentType = CARD_IMAGE_TYPE;
export const alt = `A Customer Update verified by ${APP_NAME}`;
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await publicUpdateCard(id);
  if (!found) notFound();
  return updateCardImage(found, CARD_IMAGE_WIDE);
}
