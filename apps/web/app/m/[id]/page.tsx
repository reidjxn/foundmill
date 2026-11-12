/**
 * A milestone's card (docs/NETWORK.md F3; docs/THESIS_REVIEW.md package 5.3; docs/DESIGN.md §9d): `/m/<id>`, one
 * milestone a project's founders chose to show, with its share images (./opengraph-image.tsx, wide; ./story-image, tall).
 * Open to anyone signed out (lib/auth/redirects.ts `PUBLIC_PREFIXES`) and from 390 px (components/providers/
 * DesktopOnly.tsx `SMALL_SCREEN_PREFIXES`). Never indexed (`noindex, follow`): the project's page and its story are
 * what a search finds; the card is what a founder hands to someone. A milestone that is not shown, an unknown id and a
 * project whose page is not public are the same not-found (./not-found.tsx).
 *
 * A milestone about a customer is its words and its date only: nothing the api returns here can name the customer.
 * The foot's "Built on" line follows the project's plan and who is looking, as on the project's page and its story.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { MilestoneCard } from "@foundmill/dugout";
import { pagePath } from "@foundmill/shared/project-page";
import { cardDescription, cardTitle, storyPath } from "@foundmill/shared/project-story";
import { withVia } from "@foundmill/shared/via";
import { getServerAuth } from "@/lib/auth/server";
import { formatDate } from "@/lib/format";
import { publicMilestoneCard } from "@/lib/public-page.server";

// Read on every request: a milestone hidden, or a page taken down, is gone at once.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const card = await publicMilestoneCard(id);
  if (!card) return { title: "Page not found", robots: { index: false, follow: false } };
  const title = cardTitle(card.milestone.label, card.name);
  const description = cardDescription(card.name, formatDate(card.milestone.achievedAt), APP_NAME);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: card.milestone.url },
    openGraph: { title, description, url: card.milestone.url, siteName: APP_NAME, type: "website" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: false, follow: true },
  };
}

export default async function MilestoneCardRoute({ params }: Props) {
  const { id } = await params;
  const card = await publicMilestoneCard(id);
  if (!card) notFound();
  // Who is looking decides how the foot is drawn. A session that cannot be read counts as a visitor.
  const member = card.mark ? (await getServerAuth().catch(() => null)) !== null : false;
  const mark = !card.mark ? "none" : member ? "member" : "visitor";
  return (
    <MilestoneCard
      name={card.name}
      label={card.milestone.label}
      milestoneKey={card.milestone.key}
      achievedAt={card.milestone.achievedAt}
      brandPrimary={card.brandPrimary}
      brandSecondary={card.brandSecondary}
      logo={card.logo}
      pageHref={pagePath(card.slug)}
      storyHref={storyPath(card.slug)}
      mark={mark}
      startHref={withVia("/", { kind: "project_page", ref: card.slug })}
    />
  );
}
