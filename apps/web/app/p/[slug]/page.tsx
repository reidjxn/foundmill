/**
 * A project's public page (docs/THESIS_REVIEW.md package 1.1; CLAUDE.md "Foundmill hosts every project's public page at
 * a Foundmill address for free"): `/p/<slug>`, open to anyone signed out (lib/auth/redirects.ts `PUBLIC_PREFIXES`),
 * from 390 px (components/providers/DesktopOnly.tsx `SMALL_SCREEN_PREFIXES`), and the one route search engines may
 * index (the root layout says noindex for everything else). The content is what the founders published, read through
 * the API's public view; an unknown address and a page that is not published are the same not-found. When the
 * founders left "Let people follow this project" on, the page ends with the "Follow" form (package 1.6), which posts to
 * a Server Action (./actions.ts) and works without JavaScript.
 *
 * A project on the free plan carries the small "Built on Foundmill" mark (docs/NETWORK.md F2; founder, 2026-11-12),
 * drawn for whoever is looking: a signed-out visitor gets it as a quiet link and, after following, one more line; a
 * signed-in Foundmill member gets plain words and no link. Both links name this page as where the visitor came from
 * (`?via=p.<slug>`, @foundmill/shared/via). A paid plan shows none of it. Once the founders show a milestone the
 * project has a story (`./story`, `page.story`): the mark and the line after a follow then lead there instead of to the
 * landing page, with the same `via`, and the line's link reads "See how it was made". When the founders turned on their
 * quiz (0105), "Which one is for you?" comes before the Follow form; it posts to ./quiz-actions.ts.
 *
 * An address that carries a shared post's code (`?via=s.<code>`, item 8) sends one beacon once the page has loaded
 * (components/public/PostVisitBeacon.tsx): the post's link counts as visited, so a follow from it can be credited to the
 * post. The same beacon counts the visit for the founders (founder, Nov 25, 2026; packages/shared `page-visits.ts`):
 * nothing on the page changes, and no count is shown to visitors.
 */
import { PublicAppPrompt } from "@/components/shell/PublicAppPrompt";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { BookingBlock, ProjectPage } from "@foundmill/dugout";
import { projectPageJsonLd } from "@foundmill/shared/page-structured-data";
import { builtOnWords, pageDescription, pagePath, pageTitle } from "@foundmill/shared/project-page";
import { FollowProjectForm } from "@/components/public/FollowProjectForm";
import { JsonLd } from "@/components/public/JsonLd";
import { PostVisitBeacon } from "@/components/public/PostVisitBeacon";
import { PageQuizForm } from "@/components/public/PageQuizForm";
import { pageMarkFor } from "@/lib/public-mark.server";
import { publicBookingBlock, publicPageQuiz, publicProjectPage } from "@/lib/public-page.server";

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
    alternates: { canonical: page.url, types: { "text/markdown": `${pagePath(page.slug)}/index.md` } },
    openGraph: { title, description, url: page.url, siteName: APP_NAME, type: "website", locale: "en_US" },
    twitter: { card: "summary_large_image", title, description },
    // Public to anyone with the link; listed for search engines only once it says enough (`pageIsListed`, WP-08 T7).
    robots: { index: page.listed, follow: true, googleBot: { index: page.listed, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  };
}

export default async function PublicProjectPageRoute({ params }: Props) {
  const { slug } = await params;
  const [page, quiz, booking] = await Promise.all([publicProjectPage(slug), publicPageQuiz(slug), publicBookingBlock(slug)]);
  if (!page) notFound();
  // Who is looking decides how the mark is drawn (lib/public-mark.server.ts).
  const { mark, markHref } = await pageMarkFor(page, page.mark);
  const words = builtOnWords(APP_NAME);
  return (
    <>
      <JsonLd data={projectPageJsonLd(page, { origin: new URL(page.url).origin, appName: APP_NAME })} />
      <PostVisitBeacon slug={page.slug} />
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
        mark={mark}
        markHref={markHref}
        booking={booking ? <BookingBlock services={booking.services} href={`${pagePath(page.slug)}/book`} /> : null}
        quiz={quiz ? <PageQuizForm quiz={quiz} followForm={page.followForm && quiz.followForm} /> : null}
        follow={
          page.followForm ? (
            <FollowProjectForm name={page.name} slug={page.slug} builtOn={mark === "visitor" ? { line: words.afterFollow(page.name), linkLabel: page.story ? words.afterFollowStoryLink : words.afterFollowLink, href: markHref } : null} />
          ) : null
        }
      />
      <PublicAppPrompt />
    </>
  );
}
