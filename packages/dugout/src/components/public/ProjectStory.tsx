/**
 * A project's story (docs/NETWORK.md F2; docs/THESIS_REVIEW.md package 5.3; DESIGN §9f): what anyone sees at
 * `/p/<slug>/story`, signed out, from 390 px. "How ‹name› was built": the milestones the founders chose to show, oldest
 * first, as a short timeline. Each is a date and the milestone's words, and each carries "Verified by Foundmill", an
 * icon and the words together (color is never the only signal). One sentence under the heading says what verified
 * means: the platform recorded each of these when it happened; none was typed in.
 *
 * The same family as the project's page (`ProjectPage`): dark, the brand colors as accents only (the line along the
 * top, the logo tile, the timeline's markers), one column in the 640 px reading measure, laid out from its own width.
 * Every string is a text node. Nothing is counted: a story is dated things that happened, never a tally (founder,
 * Nov 12, 2026).
 *
 * It ends with a link back to the project's page. The foot carries the mark only for a project on the free plan
 * (`mark`, as on `ProjectPage`): for a visitor one small line, "‹name› is built on Foundmill." with the link "Start
 * your own"; for a signed-in member the sentence alone; nothing on a paid plan. "Verified by Foundmill" is the proof,
 * not the mark, and stays on every plan.
 *
 * Server-safe (no hooks, no handlers): the public route renders it as a Server Component.
 */
import type { CSSProperties, HTMLAttributes } from "react";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { builtOnWords } from "@foundmill/shared/project-page";
import { storyWords } from "@foundmill/shared/project-story";
import { cn } from "../../lib/cn";
import { formatDate } from "../../lib/format";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { kitStyle } from "../shell/KitBar";
import type { ProjectPageMark } from "./ProjectPage";

/** One shown milestone: its public words and the day it was reached. */
export interface StoryMilestone {
  id: string;
  key: string;
  label: string;
  achievedAt: Date | string;
}

export interface ProjectStoryProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The project's name. */
  name: string;
  /** Brand colors (hex): accents only. */
  brandPrimary: string;
  brandSecondary: string;
  /** The logo as a checked `data:` URL; the initials mark otherwise. */
  logo?: string | null;
  /** The shown milestones; drawn oldest first whatever order they arrive in. */
  milestones: readonly StoryMilestone[];
  /** The project's public page (`/p/<slug>`). */
  pageHref: string;
  /** Who the foot's "Built on" line is drawn for; "none" leaves it out (a paid plan). Default "visitor". */
  mark?: ProjectPageMark;
  /** Where "Start your own" goes. Default the site root. */
  startHref?: string;
  /** "page" fills the window (the public route); "preview" sits inside a frame. */
  variant?: "page" | "preview";
}

const WORDS = storyWords(APP_NAME);
const BUILT_ON = builtOnWords(APP_NAME);

/** The words the story prints around the project's own. */
export const PROJECT_STORY_WORDS = {
  heading: WORDS.heading,
  verified: WORDS.verified,
  verifiedNote: WORDS.verifiedNote,
  verifiedNoteOne: WORDS.verifiedNoteOne,
  seeProject: WORDS.seeProject,
  seeStory: WORDS.seeStory,
  timeline: WORDS.timeline,
  builtOn: BUILT_ON.foot,
  startOwn: BUILT_ON.afterFollowLink,
} as const;

const timeOf = (d: Date | string): number => new Date(d).getTime();
const isoOf = (d: Date | string): string | undefined => {
  const t = timeOf(d);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

/** "Verified by Foundmill": the proof beside a milestone, an icon and the words. On every plan. */
export function VerifiedMark({ className }: { className?: string }) {
  return (
    <Chip tone="good" icon={BadgeCheck} className={className} data-verified="">
      {PROJECT_STORY_WORDS.verified}
    </Chip>
  );
}

/** A milestone's day, "Nov 12, 2026", as a `<time>`. */
export function MilestoneDate({ at, className }: { at: Date | string; className?: string }) {
  return (
    <time dateTime={isoOf(at)} className={cn("t-small tabular-nums text-secondary", className)} data-milestone-date="">
      {formatDate(at, "date")}
    </time>
  );
}

/** The foot shared by the story and a card: the mark's one sentence and, for a visitor, its link. Nothing on a paid plan. */
export function BuiltOnFoot({ name, mark, startHref }: { name: string; mark: ProjectPageMark; startHref: string }) {
  if (mark === "none") return null;
  return (
    <footer className="border-t border-line-faint" data-project-mark={mark}>
      <div className="mx-auto flex w-full max-w-reading px-gutter">
        <p className={cn("t-small flex min-h-tap min-w-0 flex-wrap items-center gap-x-1.5 break-words", mark === "visitor" ? "text-secondary" : "text-tertiary")}>
          <span>{PROJECT_STORY_WORDS.builtOn(name)}</span>
          {mark === "visitor" ? (
            <a href={startHref} className="inline-flex min-h-tap items-center rounded-sm text-primary underline decoration-line-strong underline-offset-4 transition-colors duration-hover hover:decoration-current focus-ring">
              {PROJECT_STORY_WORDS.startOwn}
            </a>
          ) : null}
        </p>
      </div>
    </footer>
  );
}

export function ProjectStory({ name, brandPrimary, brandSecondary, logo, milestones, pageHref, mark = "visitor", startHref = "/", variant = "page", className, style, ...rest }: ProjectStoryProps) {
  const rootStyle: CSSProperties = { ...kitStyle({ primary: brandPrimary, secondary: brandSecondary }), ...style };
  const ordered = [...milestones].sort((a, b) => timeOf(a.achievedAt) - timeOf(b.achievedAt));
  return (
    <article
      data-project-story=""
      data-variant={variant}
      className={cn("@container relative flex flex-col bg-canvas text-primary", variant === "page" ? "min-h-dvh" : "min-h-full", className)}
      style={rootStyle}
      {...rest}
    >
      {/* The brand line, as on the project's page: the business's color, never a fill behind text. */}
      <div aria-hidden className="h-1 w-full shrink-0 bg-kit-primary" data-brand-line="" />
      <div className="mx-auto flex w-full max-w-reading min-w-0 flex-1 flex-col gap-8 px-gutter py-10 @page-wide:gap-10 @page-wide:py-16">
        <header className="flex min-w-0 flex-col gap-5">
          <a href={pageHref} className="flex min-h-tap min-w-0 items-center gap-3 self-start rounded-sm transition-colors duration-hover hover:no-underline focus-ring" data-story-project="">
            <BusinessLogo src={logo} name={name} primary={brandPrimary} size={48} title="" />
            <span className="t-display-sm min-w-0 break-words text-primary" data-project-name="">
              {name}
            </span>
          </a>
          <h1 className="t-display-lg min-w-0 text-balance break-words text-primary @page-wide:t-display-xl" data-story-heading="">
            {PROJECT_STORY_WORDS.heading(name)}
          </h1>
          <p className="t-reading min-w-0 break-words text-secondary" data-story-note="">
            {PROJECT_STORY_WORDS.verifiedNote}
          </p>
        </header>

        <ol aria-label={PROJECT_STORY_WORDS.timeline} className="flex min-w-0 flex-col" data-story-timeline="">
          {ordered.map((m) => (
            <li key={m.id} className="group flex min-w-0 gap-4" data-story-milestone={m.key}>
              {/* The rail: a ring in the brand's color for each milestone, and a hairline down to the next one. */}
              <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
                <span className="absolute top-3 bottom-0 w-px bg-line group-last:hidden" />
                <span className="relative mt-1 size-3 rounded-full border-2 border-kit-primary bg-canvas" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col items-start gap-2 pb-8 group-last:pb-0">
                <MilestoneDate at={m.achievedAt} />
                <h2 className="t-display-sm min-w-0 break-words text-primary" data-milestone-label="">
                  {m.label}
                </h2>
                <VerifiedMark />
              </div>
            </li>
          ))}
        </ol>

        <a href={pageHref} className="btn-secondary t-action inline-flex min-h-tap items-center gap-2 self-start rounded-sm px-btn-md text-primary focus-ring" data-story-back="">
          <Icon icon={ArrowLeft} size="inline" />
          {PROJECT_STORY_WORDS.seeProject(name)}
        </a>
      </div>
      <BuiltOnFoot name={name} mark={mark} startHref={startHref} />
    </article>
  );
}
