/**
 * A project's story (docs/NETWORK.md F2; docs/THESIS_REVIEW.md package 5.3; docs/DESIGN.md §9f): `/p/<slug>/story`,
 * "How ‹name› was built". The milestones the founders chose to show, oldest first, each one recorded by the platform
 * when it happened. Open to anyone signed out and from 390 px, like the project's page it hangs under (`/p/` is in
 * `PUBLIC_PREFIXES` and `SMALL_SCREEN_PREFIXES`), and indexable only while it exists: an unknown address, a page that
 * is not public and a page that shows no milestone are the same not-found as the project's page (../not-found.tsx).
 *
 * The foot's "Built on" line follows the project's plan and who is looking, as on the page: a signed-out visitor to a
 * project on the free plan gets the sentence and the link "Start your own" (naming the project as where they came
 * from, `?via=p.<slug>`); a signed-in member gets the sentence alone; a paid plan shows none of it. "Verified by
 * Foundmill" is the proof, not the mark, and is on every plan.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { ProjectStory } from "@foundmill/dugout";
import { pagePath } from "@foundmill/shared/project-page";
import { storyDescription, storyTitle } from "@foundmill/shared/project-story";
import { withVia } from "@foundmill/shared/via";
import { getServerAuth } from "@/lib/auth/server";
import { publicProjectStory } from "@/lib/public-page.server";

// Read on every request: a milestone hidden, or a page taken down, is gone at once.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const story = await publicProjectStory(slug);
  if (!story) return { title: "Page not found", robots: { index: false, follow: false } };
  const title = storyTitle(story.name);
  const description = storyDescription(story.name, APP_NAME);
  // A share image file belongs to its own segment only, so the story names the project page's (../opengraph-image.tsx).
  const image = { url: `${story.pageUrl}/opengraph-image`, width: 1200, height: 630, alt: title };
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: story.storyUrl },
    openGraph: { title, description, url: story.storyUrl, siteName: APP_NAME, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    robots: { index: true, follow: true },
  };
}

export default async function ProjectStoryRoute({ params }: Props) {
  const { slug } = await params;
  const story = await publicProjectStory(slug);
  if (!story) notFound();
  // Who is looking decides how the foot is drawn. A session that cannot be read counts as a visitor.
  const member = story.mark ? (await getServerAuth().catch(() => null)) !== null : false;
  const mark = !story.mark ? "none" : member ? "member" : "visitor";
  return (
    <ProjectStory
      name={story.name}
      brandPrimary={story.brandPrimary}
      brandSecondary={story.brandSecondary}
      logo={story.logo}
      milestones={story.milestones}
      pageHref={pagePath(story.slug)}
      mark={mark}
      startHref={withVia("/", { kind: "project_page", ref: story.slug })}
    />
  );
}
