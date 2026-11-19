/**
 * The public gallery at `/explore` (docs/holistic-plan/LAUNCH_EVALUATION.md Session 10): the projects whose founders
 * chose to be listed, newest first, as cards that open each project's page. Signed out, from 390 px, in the same dark
 * family as the project's page: brand colors are accents only (the line along a card's top, the logo tile). Every
 * string is a text node. A project is here only by its own founders' choice and only while its page is live; nothing
 * is counted or ranked.
 *
 * Server-safe (no hooks, no handlers): the public route renders it as a Server Component.
 */
import type { CSSProperties, HTMLAttributes } from "react";
import { ArrowRight } from "lucide-react";
import { PAGE_STAGE_LABELS, type PageStage } from "@foundmill/shared/project-page";
import { cn } from "../../lib/cn";
import { formatDate } from "../../lib/format";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { kitStyle } from "../shell/KitBar";

export interface ExploreProject {
  /** The page's address: the card links to `/p/<slug>`. */
  slug: string;
  name: string;
  /** The project's one-line pitch. */
  pitch: string;
  stage: PageStage;
  /** Brand colors (hex): accents only. */
  brandPrimary: string;
  brandSecondary: string;
  /** When the page went live. */
  publishedAt: Date | string;
}

export interface ExploreGalleryProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  projects: readonly ExploreProject[];
  /** Where "Start your own" goes. Default the site root. */
  startHref?: string;
}

/** The words of the gallery, in one place (the e2e spec and the unit test read them). */
export const EXPLORE_WORDS = {
  title: "Explore",
  intro: "Projects whose founders chose to show them here, newest first.",
  empty: "No project is listed yet. Founders choose this for their own page, in the project's Public page tab.",
  published: (on: string) => `Live ${on}`,
  startYours: "Start your own",
} as const;

export function ExploreGallery({ projects, startHref = "/", className, ...rest }: ExploreGalleryProps) {
  return (
    <div data-explore="" className={cn("@container relative flex min-h-dvh flex-col bg-canvas text-primary", className)} {...rest}>
      <main className="mx-auto flex w-full max-w-reading min-w-0 flex-1 flex-col gap-8 px-gutter py-10 @page-wide:py-16">
        <header className="flex min-w-0 flex-col gap-3">
          <h1 className="t-display-lg min-w-0 text-balance break-words text-primary">{EXPLORE_WORDS.title}</h1>
          <p className="t-reading text-prose">{EXPLORE_WORDS.intro}</p>
        </header>
        {projects.length ? (
          <ul className="flex min-w-0 flex-col gap-4" data-explore-list="">
            {projects.map((p) => {
              const style: CSSProperties = kitStyle({ primary: p.brandPrimary, secondary: p.brandSecondary });
              return (
                <li key={p.slug} style={style} data-explore-project={p.slug}>
                  <a href={`/p/${p.slug}`} className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line bg-surface text-primary transition-colors duration-hover hover:border-line-strong focus-ring">
                    <span aria-hidden className="h-1 w-full shrink-0 bg-kit-primary" />
                    <span className="flex min-w-0 flex-col gap-3 p-4">
                      <span className="flex min-w-0 items-center gap-3">
                        <BusinessLogo name={p.name} primary={p.brandPrimary} size={40} title="" />
                        <span className="t-heading min-w-0 break-words text-primary">{p.name}</span>
                      </span>
                      <span className="t-reading min-w-0 break-words text-prose">{p.pitch}</span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <Chip tone="kit">{PAGE_STAGE_LABELS[p.stage]}</Chip>
                        <span className="t-small text-secondary">{EXPLORE_WORDS.published(formatDate(p.publishedAt, "date"))}</span>
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="t-body text-secondary" data-explore-empty="">
            {EXPLORE_WORDS.empty}
          </p>
        )}
        <a href={startHref} className="btn-secondary t-action inline-flex min-h-tap items-center gap-2 self-start rounded-sm px-btn-md text-primary focus-ring" data-explore-start="">
          {EXPLORE_WORDS.startYours}
          <Icon icon={ArrowRight} size="inline" />
        </a>
      </main>
    </div>
  );
}
