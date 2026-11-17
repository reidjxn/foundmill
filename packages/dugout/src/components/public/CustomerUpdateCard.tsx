/**
 * A Customer Update shared as a card (docs/holistic-plan/WP-14-behavior-brief.md T9; DESIGN §9f): what anyone sees at
 * `/m/update/<id>`, signed out, from 390 px, for one Customer Update the project's founders chose to share. The
 * project's logo and name, the day, what happened as the headline ("New customer"), "Verified by Foundmill" with one
 * sentence saying what that means, then the lead channel and the standout agent, and the founders' own line when they
 * wrote one. Then the way on: "See ‹name›" to the project's page.
 *
 * The same family as a milestone's card (`MilestoneCard`): dark, brand colors as accents only, the 640 px reading
 * measure, every string a text node. It has no prop for the customer, the amount or a count, so none can be drawn:
 * the only words about the win beyond the facts are the ones a founder typed (`note`), set apart and named as theirs,
 * because the platform did not record them. The standout agent is always labeled an AI agent.
 *
 * The foot carries the mark by the project's plan (`mark`, as on `MilestoneCard`); "Verified by Foundmill" stays on
 * every plan.
 *
 * Server-safe (no hooks, no handlers): the public route renders it as a Server Component.
 */
import type { CSSProperties, HTMLAttributes } from "react";
import { ArrowRight } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { CHANNEL_META, type ChannelKey } from "@foundmill/shared/constants";
import { UPDATE_CARD_HEADLINE_WORDS, updateCardWords, type UpdateCardHeadline } from "@foundmill/shared/update-cards";
import { cn } from "../../lib/cn";
import { formatDate } from "../../lib/format";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { Icon } from "../foundation/Icon";
import { kitStyle } from "../shell/KitBar";
import type { ProjectPageMark } from "./ProjectPage";
import { BuiltOnFoot, PROJECT_STORY_WORDS, VerifiedMark } from "./ProjectStory";

export interface CustomerUpdateCardProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The project's name. */
  name: string;
  /** What happened: a first payment from this customer, or one from a customer who paid before. */
  headline: UpdateCardHeadline;
  /** The day of the payment, "2026-11-12": a date, never a time. */
  occurredOn: string;
  /** The lead channel's key (`CHANNEL_KEYS`); left out when the win had no measured touch or the key is not known. */
  leadChannelKey?: string | null;
  /** The standout agent's name; left out when no agent worked a touch. */
  standoutAgent?: string | null;
  /** The founders' own line; left out when they wrote none. */
  note?: string | null;
  /** Brand colors (hex): accents only. */
  brandPrimary: string;
  brandSecondary: string;
  /** The logo as a checked `data:` URL; the initials mark otherwise. */
  logo?: string | null;
  /** The project's public page (`/p/<slug>`). */
  pageHref: string;
  /** Who the foot's "Built on" line is drawn for; "none" leaves it out. Default "visitor". */
  mark?: ProjectPageMark;
  /** Where "Start your own" goes. Default the site root. */
  startHref?: string;
  /** "page" fills the window (the public route); "preview" sits inside a frame. */
  variant?: "page" | "preview";
}

export const CUSTOMER_UPDATE_CARD_WORDS = updateCardWords(APP_NAME);

/** The channel's display name, or null for a key the catalog does not hold (the line is then left out). */
export function updateCardChannelLabel(key: string | null | undefined): string | null {
  return key && Object.hasOwn(CHANNEL_META, key) ? CHANNEL_META[key as ChannelKey].label : null;
}

/** "2026-11-12" as that calendar day wherever the page is rendered (never shifted by a time zone), or null. */
export function updateCardDay(occurredOn: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(occurredOn);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function CustomerUpdateCard({ name, headline, occurredOn, leadChannelKey, standoutAgent, note, brandPrimary, brandSecondary, logo, pageHref, mark = "visitor", startHref = "/", variant = "page", className, style, ...rest }: CustomerUpdateCardProps) {
  const rootStyle: CSSProperties = { ...kitStyle({ primary: brandPrimary, secondary: brandSecondary }), ...style };
  // A full page is the document's one main landmark; a preview sits inside the console's own <main>, as an article.
  const Root = variant === "page" ? "div" : "article";
  const Body = variant === "page" ? "main" : "div";
  const day = updateCardDay(occurredOn);
  const channel = updateCardChannelLabel(leadChannelKey);
  const agent = standoutAgent?.trim() || null;
  const words = note?.trim() || null;
  return (
    <Root
      data-update-card={headline}
      data-variant={variant}
      className={cn("@container relative flex flex-col bg-canvas text-primary", variant === "page" ? "min-h-dvh" : "min-h-full", className)}
      style={rootStyle}
      {...rest}
    >
      <div aria-hidden className="h-1 w-full shrink-0 bg-kit-primary" data-brand-line="" />
      <Body className="mx-auto flex w-full max-w-reading min-w-0 flex-1 flex-col gap-8 px-gutter py-10 @page-wide:gap-10 @page-wide:py-16">
        <div className="flex min-w-0 items-center gap-3">
          <BusinessLogo src={logo} name={name} primary={brandPrimary} size={48} title="" />
          <p className="t-display-sm min-w-0 break-words text-primary" data-project-name="">
            {name}
          </p>
        </div>

        {/* The fact: a rule in the brand's color beside it, as on a milestone's card. */}
        <section className="flex min-w-0 flex-col items-start gap-4 border-l-2 border-kit-primary pl-4" data-card-fact="">
          {day ? (
            <time dateTime={occurredOn} className="t-small tabular-nums text-secondary" data-update-date="">
              {formatDate(day, "date")}
            </time>
          ) : null}
          <h1 className="t-display-lg min-w-0 text-balance break-words text-primary @page-wide:t-display-xl" data-update-headline="">
            {UPDATE_CARD_HEADLINE_WORDS[headline]}
          </h1>
          <div className="flex min-w-0 flex-col items-start gap-2">
            <VerifiedMark />
            <p className="t-small min-w-0 break-words text-secondary" data-card-note="">
              {CUSTOMER_UPDATE_CARD_WORDS.verifiedNote}
            </p>
          </div>
          {channel || agent ? (
            <dl className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-3 @page-wide:grid-cols-2" data-update-facts="">
              {channel ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="t-label text-tertiary">{CUSTOMER_UPDATE_CARD_WORDS.leadChannel}</dt>
                  <dd className="t-body min-w-0 break-words text-primary" data-update-channel="">
                    {channel}
                  </dd>
                </div>
              ) : null}
              {agent ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="t-label text-tertiary">{CUSTOMER_UPDATE_CARD_WORDS.standoutAgent}</dt>
                  <dd className="t-body min-w-0 break-words text-primary" data-update-agent="">
                    {agent} <span className="text-secondary">({CUSTOMER_UPDATE_CARD_WORDS.aiAgent})</span>
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>

        {/* The founders' own words, apart from what the platform recorded and named as theirs. */}
        {words ? (
          <figure className="flex min-w-0 flex-col gap-1" data-update-note="">
            <figcaption className="t-label text-tertiary">{CUSTOMER_UPDATE_CARD_WORDS.noteFrom(name)}</figcaption>
            <blockquote className="t-body min-w-0 break-words text-secondary">{words}</blockquote>
          </figure>
        ) : null}

        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <a href={pageHref} className="btn-secondary t-action inline-flex min-h-tap items-center gap-2 rounded-sm px-btn-md text-primary focus-ring" data-card-project="">
            {PROJECT_STORY_WORDS.seeProject(name)}
            <Icon icon={ArrowRight} size="inline" />
          </a>
        </div>
      </Body>
      <BuiltOnFoot name={name} mark={mark} startHref={startHref} />
    </Root>
  );
}
