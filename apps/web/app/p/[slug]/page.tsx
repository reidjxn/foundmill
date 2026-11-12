/**
 * A project's public page (docs/THESIS_REVIEW.md package 1.1; CLAUDE.md "Foundmill hosts every project's public page at
 * a Foundmill address for free"): `/p/<slug>`, open to anyone signed out (lib/auth/redirects.ts `PUBLIC_PREFIXES`),
 * from 390 px (components/providers/DesktopOnly.tsx `SMALL_SCREEN_PREFIXES`), and the one route search engines may
 * index (the root layout says noindex for everything else). The content is what the founders published, read through
 * the API's public view; an unknown address and a page that is not published are the same not-found. When the
 * founders left "Let people follow this project" on, the page ends with the "Follow" form (package 1.6), which posts to
 * a Server Action (./actions.ts) and works without JavaScript.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { ProjectPage } from "@foundmill/dugout";
import { pageDescription, pageTitle } from "@foundmill/shared/project-page";
import { FollowProjectForm } from "@/components/public/FollowProjectForm";
import { publicProjectPage } from "@/lib/public-page.server";

// Read on every request: a page taken down is gone at once, and changes show as soon as they are published.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await publicProjectPage(slug);
  if (!page) return { title: "Page not found", robots: { index: false, follow: false } };
  const title = pageTitle(page.name, page.pitch);
  const description = pageDescription(page.about, page.pitch);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: page.url },
    openGraph: { title, description, url: page.url, siteName: APP_NAME, type: "website" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function PublicProjectPageRoute({ params }: Props) {
  const { slug } = await params;
  const page = await publicProjectPage(slug);
  if (!page) notFound();
  return (
    <ProjectPage
      name={page.name}
      pitch={page.pitch}
      about={page.about}
      forWhom={page.forWhom}
      stage={page.stage}
      publishedAt={page.publishedAt}
      brandPrimary={page.brandPrimary}
      brandSecondary={page.brandSecondary}
      logo={page.logo}
      founderNames={page.founderNames}
      homeHref="/"
      follow={page.followForm ? <FollowProjectForm name={page.name} slug={page.slug} /> : null}
    />
  );
}
