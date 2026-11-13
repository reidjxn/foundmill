/**
 * A milestone's card (docs/NETWORK.md F3; docs/THESIS_REVIEW.md package 5.3; DESIGN §9f): what anyone sees at
 * `/m/<id>`, signed out, from 390 px, for one milestone the project's founders chose to show. The project's logo and
 * name, the milestone's words as the headline, the day it was reached, and "Verified by Foundmill" (an icon and the
 * words) with one sentence saying what that means. Then the ways on: "See ‹name›" to the project's page and, when
 * there is one, the project's story.
 *
 * The same family as the project's page and its story: dark, brand colors as accents only (the line along the top, the
 * logo tile, a rule beside the fact), the 640 px reading measure, every string a text node. A milestone about a
 * customer is its words and date only: nothing here can name the customer. Nothing is counted.
 *
 * The foot carries the mark only for a project on the free plan (`mark`, as on `ProjectStory`); "Verified by Foundmill"
 * stays on every plan.
 *
 * Server-safe (no hooks, no handlers): the public route renders it as a Server Component.
 */
import type { CSSProperties, HTMLAttributes } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "../../lib/cn";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { Icon } from "../foundation/Icon";
import { kitStyle } from "../shell/KitBar";
import type { ProjectPageMark } from "./ProjectPage";
import { BuiltOnFoot, MilestoneDate, PROJECT_STORY_WORDS, VerifiedMark } from "./ProjectStory";

export interface MilestoneCardProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The project's name. */
  name: string;
  /** The milestone's public words: "Page live", "First follower", "First customer". */
  label: string;
  /** The milestone's key, kept on the element for tests and styling hooks. */
  milestoneKey?: string;
  achievedAt: Date | string;
  /** Brand colors (hex): accents only. */
  brandPrimary: string;
  brandSecondary: string;
  /** The logo as a checked `data:` URL; the initials mark otherwise. */
  logo?: string | null;
  /** The project's public page (`/p/<slug>`). */
  pageHref: string;
  /** The project's story (`/p/<slug>/story`); left out when not given. */
  storyHref?: string | null;
  /** Who the foot's "Built on" line is drawn for; "none" leaves it out (a paid plan). Default "visitor". */
  mark?: ProjectPageMark;
  /** Where "Start your own" goes. Default the site root. */
  startHref?: string;
  /** "page" fills the window (the public route); "preview" sits inside a frame. */
  variant?: "page" | "preview";
}

export function MilestoneCard({ name, label, milestoneKey, achievedAt, brandPrimary, brandSecondary, logo, pageHref, storyHref, mark = "visitor", startHref = "/", variant = "page", className, style, ...rest }: MilestoneCardProps) {
  const rootStyle: CSSProperties = { ...kitStyle({ primary: brandPrimary, secondary: brandSecondary }), ...style };
  return (
    <article
      data-milestone-card={milestoneKey ?? ""}
      data-variant={variant}
      className={cn("@container relative flex flex-col bg-canvas text-primary", variant === "page" ? "min-h-dvh" : "min-h-full", className)}
      style={rootStyle}
      {...rest}
    >
      {/* The brand line, as on the project's page: the business's color, never a fill behind text. */}
      <div aria-hidden className="h-1 w-full shrink-0 bg-kit-primary" data-brand-line="" />
      <div className="mx-auto flex w-full max-w-reading min-w-0 flex-1 flex-col gap-8 px-gutter py-10 @page-wide:gap-10 @page-wide:py-16">
        <div className="flex min-w-0 items-center gap-3">
          <BusinessLogo src={logo} name={name} primary={brandPrimary} size={48} title="" />
          <p className="t-display-sm min-w-0 break-words text-primary" data-project-name="">
            {name}
          </p>
        </div>

        {/* The fact: a rule in the brand's color beside it, as beside "Who it is for" on the page. */}
        <section className="flex min-w-0 flex-col items-start gap-4 border-l-2 border-kit-primary pl-4" data-card-fact="">
          <MilestoneDate at={achievedAt} />
          <h1 className="t-display-lg min-w-0 text-balance break-words text-primary @page-wide:t-display-xl" data-milestone-label="">
            {label}
          </h1>
          <div className="flex min-w-0 flex-col items-start gap-2">
            <VerifiedMark />
            <p className="t-small min-w-0 break-words text-secondary" data-card-note="">
              {PROJECT_STORY_WORDS.verifiedNoteOne}
            </p>
          </div>
        </section>

        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <a href={pageHref} className="btn-secondary t-action inline-flex min-h-tap items-center gap-2 rounded-sm px-btn-md text-primary focus-ring" data-card-project="">
            {PROJECT_STORY_WORDS.seeProject(name)}
            <Icon icon={ArrowRight} size="inline" />
          </a>
          {storyHref ? (
            <a href={storyHref} className="t-action inline-flex min-h-tap items-center rounded-sm text-secondary underline decoration-line-strong underline-offset-4 transition-colors duration-hover hover:text-primary focus-ring" data-card-story="">
              {PROJECT_STORY_WORDS.seeStory(name)}
            </a>
          ) : null}
        </div>
      </div>
      <BuiltOnFoot name={name} mark={mark} startHref={startHref} />
    </article>
  );
}
