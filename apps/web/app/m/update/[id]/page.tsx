/**
 * A Customer Update shared as a card (docs/holistic-plan/WP-14-behavior-brief.md T9; docs/DESIGN.md §9f):
 * `/m/update/<id>`, one Customer Update a project's founders chose to share, with its share images
 * (./opengraph-image.tsx, wide; ./story-image, tall). Under `/m/`, so it is open to anyone signed out
 * (lib/auth/redirects.ts `PUBLIC_PREFIXES`) and works from 390 px (components/providers/DesktopOnly.tsx
 * `SMALL_SCREEN_PREFIXES`) by the rules a milestone's card already has. Never indexed (`noindex, follow`).
 *
 * The id is the card's own, not the Customer Update's. A card that was never made, one the founders stopped sharing
 * and a project whose page is not public are the same not-found (./not-found.tsx). Nothing the api returns here can
 * name the customer or the amount; the only free text is the founders' own line, printed as text. The foot's "Built
 * on" line follows the project's plan and who is looking, as on a milestone's card.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { CustomerUpdateCard, updateCardDay } from "@foundmill/dugout";
import { pagePath } from "@foundmill/shared/project-page";
import { updateCardDescription, updateCardTitle } from "@foundmill/shared/update-cards";
import { withVia } from "@foundmill/shared/via";
import { PublicAppPrompt } from "@/components/shell/PublicAppPrompt";
import { getServerAuth } from "@/lib/auth/server";
import { formatDate } from "@/lib/format";
import { publicUpdateCard } from "@/lib/public-page.server";

// Read on every request: a card the founders stopped sharing, or a page taken down, is gone at once.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const found = await publicUpdateCard(id);
  if (!found) return { title: "Page not found", robots: { index: false, follow: false } };
  const day = updateCardDay(found.card.occurredOn);
  const title = updateCardTitle(found.card.headline, found.name);
  const description = updateCardDescription(found.name, day ? formatDate(day) : found.card.occurredOn, APP_NAME);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: found.card.url },
    openGraph: { title, description, url: found.card.url, siteName: APP_NAME, type: "website" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: false, follow: true },
  };
}

export default async function CustomerUpdateCardRoute({ params }: Props) {
  const { id } = await params;
  const found = await publicUpdateCard(id);
  if (!found) notFound();
  // Who is looking decides how the foot is drawn. A session that cannot be read counts as a visitor.
  const member = found.mark ? (await getServerAuth().catch(() => null)) !== null : false;
  const mark = !found.mark ? "none" : member ? "member" : "visitor";
  return (
    <>
      <CustomerUpdateCard
        name={found.name}
        headline={found.card.headline}
        occurredOn={found.card.occurredOn}
        leadChannelKey={found.card.leadChannelKey}
        standoutAgent={found.card.standoutAgent}
        note={found.card.note}
        brandPrimary={found.brandPrimary}
        brandSecondary={found.brandSecondary}
        logo={found.logo}
        pageHref={pagePath(found.slug)}
        mark={mark}
        startHref={withVia("/", { kind: "project_page", ref: found.slug })}
      />
      <PublicAppPrompt />
    </>
  );
}
