/**
 * The idea box's card (founder, 2026-11-13; docs/IDEA_BOX.md; the canvas "Landed"): the one card a visitor gets on the
 * landing page before any sign-up, and again on `/new/card/<ideaId>` once it is theirs. It fills in as the card
 * streams: the name and pitch first, then the stars, then each rating; what has not arrived yet is a skeleton row.
 *
 * Honest by design (founder: "the honest numbers, plus one line on what would raise them"): the overall figure is the
 * mean of what was measured; Founder fit is shown unmeasured ("–") because nothing is known about the visitor yet; and
 * one line names the lowest rating with its evidence, as what would raise the card most. A card the practice model
 * wrote says so.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { clampRating, ratingClass } from "../../lib/rating";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { Chip } from "../foundation/Chip";
import { Skeleton } from "../foundation/Skeleton";
import { StarRating } from "../foundation/StarRating";
import { AttributeBar } from "../journey/concept/AttributeBar";
import { CONCEPT_ATTRIBUTE_HINTS, CONCEPT_ATTRIBUTE_KEYS, CONCEPT_ATTRIBUTE_LABELS, type ConceptAttributeKey } from "../journey/types";

export interface IdeaCardRating {
  key: string;
  value: number;
  evidence: string;
}

export interface IdeaCardData {
  name?: string;
  pitch?: string;
  archetype?: string;
  stars_current?: number;
  stars_potential?: number;
  attributes?: readonly IdeaCardRating[];
}

export interface IdeaCardProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  card: IdeaCardData;
  /** Still streaming: missing parts show as skeletons. */
  drafting?: boolean;
  /** "Just in": the card has just arrived on this page. */
  justIn?: boolean;
  /** The practice model wrote it (mock models): the card says so. */
  sample?: boolean;
  /** Founder fit is measured (the person answered the profile questions): show its value instead of "–". */
  founderFitKnown?: boolean;
  /** Under the ratings; default the founder-fit line. */
  footnote?: ReactNode;
  /** The idea's logo as a checked `data:` URL (an example with a mark of its own); the initials tile otherwise. */
  logo?: string | null;
  /**
   * Fills the width it is given (the landing page's result, founder 2026-11-16: "the card should be wider"): no 360 px
   * cap, and from a 576 px card the ratings sit in a column beside the pitch. Under that it is the usual one column.
   */
  wide?: boolean;
}

/** The words the card prints around the model's own. */
export const IDEA_CARD_WORDS = {
  justIn: "Just in",
  overall: "Overall",
  of20: "of 20",
  firstRead: "First read",
  raise: "What would raise it most",
  unmeasured: "Not measured yet",
  founderFit: "Founder fit comes after three questions about you.",
  sample: "Sample idea: the practice model wrote it, not a real read.",
  drafting: "Your team is shaping it",
} as const;

const isKey = (k: string): k is ConceptAttributeKey => (CONCEPT_ATTRIBUTE_KEYS as readonly string[]).includes(k);
const isArchetype = (a: string | undefined): a is Archetype => !!a && a in ARCHETYPE_LABELS;

/** The ratings that count: every measured one, Founder fit only once it is known. */
export function measuredRatings(card: IdeaCardData, founderFitKnown = false): IdeaCardRating[] {
  return (card.attributes ?? []).filter((a) => isKey(a.key) && (founderFitKnown || a.key !== "founder_fit"));
}

/** The overall figure: the mean of the measured ratings, rounded; null before any arrives. */
export function ideaOverall(card: IdeaCardData, founderFitKnown = false): number | null {
  const m = measuredRatings(card, founderFitKnown);
  return m.length ? Math.round(m.reduce((s, a) => s + a.value, 0) / m.length) : null;
}

/** The lowest measured rating (the first on a tie, in the card's order), or null. */
export function lowestRating(card: IdeaCardData, founderFitKnown = false): IdeaCardRating | null {
  return measuredRatings(card, founderFitKnown).reduce<IdeaCardRating | null>((low, a) => (!low || a.value < low.value ? a : low), null);
}

export function IdeaCard({ card, drafting = false, justIn = false, sample = false, founderFitKnown = false, footnote, logo, wide = false, className, ...rest }: IdeaCardProps) {
  const name = card.name?.trim() || "";
  const ratings = new Map((card.attributes ?? []).filter((a) => isKey(a.key)).map((a) => [a.key as ConceptAttributeKey, a]));
  const overall = ideaOverall(card, founderFitKnown);
  const complete = !drafting && ratings.size >= CONCEPT_ATTRIBUTE_KEYS.length;
  const low = complete ? lowestRating(card, founderFitKnown) : null;
  return (
    <article
      aria-label={name ? `${name}: rated idea` : "Rated idea"}
      aria-busy={drafting || undefined}
      data-idea-card=""
      data-drafting={drafting || undefined}
      data-wide={wide || undefined}
      className={cn("@container surface-panel glow-brand flex w-full flex-col overflow-hidden text-left", !wide && "max-w-[22.5rem]", className)}
      {...rest}
    >
      <header className={cn("flex items-start gap-3 border-b border-line px-4 pb-3 pt-4", wide && "@xl:gap-4 @xl:px-6 @xl:pb-4 @xl:pt-5")}>
        {name ? <BusinessLogo src={logo} name={name} primary="#3a87ff" size={40} title="" /> : <Skeleton className="size-10 shrink-0 rounded-md" />}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            {name ? (
              <h2 className="t-display-sm min-w-0 flex-1 truncate text-primary" data-idea-name="">
                {name}
              </h2>
            ) : (
              <Skeleton className="h-5 w-40" />
            )}
            {justIn && complete ? (
              <Chip tone="good" className="shrink-0">
                {IDEA_CARD_WORDS.justIn}
              </Chip>
            ) : null}
          </div>
          {isArchetype(card.archetype) ? <span className="t-small text-secondary">{ARCHETYPE_LABELS[card.archetype]}</span> : <Skeleton className="h-3 w-24" />}
          {card.stars_current !== undefined ? (
            <StarRating value={card.stars_current} potential={card.stars_potential} size={13} showValue label="Stars" className="flex-wrap gap-y-1 [&_svg]:shrink-0" />
          ) : (
            <Skeleton className="h-3 w-32" />
          )}
        </div>
      </header>
      {/* Wide: the pitch, the overall figure and what would raise it on the left; the ratings on the right. */}
      <div className={cn("flex flex-col gap-3 px-4 py-3", wide && "@xl:grid @xl:grid-cols-2 @xl:content-start @xl:gap-x-8 @xl:gap-y-4 @xl:px-6 @xl:py-5")}>
        {card.pitch ? (
          <p className={cn("t-body text-pretty text-prose", wide && "@xl:col-start-1 @xl:text-reading")} data-idea-pitch="">
            {card.pitch}
          </p>
        ) : (
          <div className={cn("flex flex-col gap-1.5", wide && "@xl:col-start-1")}>
            <Skeleton index={0} />
            <Skeleton index={1} />
            <Skeleton index={2} className="w-2/3" />
          </div>
        )}
        <div className={cn("flex items-baseline gap-2", wide && "@xl:col-start-1")} data-idea-overall="">
          <span className="t-data text-tertiary">{IDEA_CARD_WORDS.overall}</span>
          {overall !== null ? <b className={cn("t-display-sm tabular-nums", ratingClass(clampRating(overall)))}>{overall}</b> : <Skeleton className="h-4 w-6" />}
          <span className="t-small text-tertiary">{IDEA_CARD_WORDS.of20}</span>
          <Chip tone="neutral" className="ml-auto">
            {IDEA_CARD_WORDS.firstRead}
          </Chip>
        </div>
        <ol className={cn("flex flex-col gap-1", wide && "@xl:col-start-2 @xl:row-span-4 @xl:row-start-1")} aria-label="Ratings" data-idea-ratings="">
          {CONCEPT_ATTRIBUTE_KEYS.map((key, i) => {
            const label = CONCEPT_ATTRIBUTE_LABELS[key];
            if (key === "founder_fit" && !founderFitKnown) {
              return (
                <li key={key} className="flex items-center gap-2" data-idea-rating={key} data-unmeasured="">
                  <span className="t-small min-w-0 flex-1 truncate text-primary">{label}</span>
                  <span className="t-small text-tertiary" title={IDEA_CARD_WORDS.unmeasured}>
                    –
                  </span>
                </li>
              );
            }
            const r = ratings.get(key);
            return (
              <li key={key} data-idea-rating={key} data-arrived={r ? "" : undefined}>
                {r ? <AttributeBar label={label} value={clampRating(r.value)} evidence={[{ text: r.evidence }]} hint={CONCEPT_ATTRIBUTE_HINTS[key]} attributeKey={key} /> : <Skeleton index={i} className="h-4" label={undefined} />}
              </li>
            );
          })}
        </ol>
        {low ? (
          <p className={cn("t-small text-pretty text-secondary", wide && "@xl:col-start-1")} data-idea-raise="">
            <span className="text-primary">{IDEA_CARD_WORDS.raise}:</span> {CONCEPT_ATTRIBUTE_LABELS[low.key as ConceptAttributeKey]}, now {low.value} of 20. {low.evidence}
          </p>
        ) : null}
        {sample ? (
          <p className={cn("t-small text-status-warn", wide && "@xl:col-start-1")} data-idea-sample="">
            {IDEA_CARD_WORDS.sample}
          </p>
        ) : null}
      </div>
      <footer className={cn("t-small border-t border-line px-4 py-2.5 text-tertiary", wide && "@xl:px-6")}>{drafting ? IDEA_CARD_WORDS.drafting : (footnote ?? (founderFitKnown ? null : IDEA_CARD_WORDS.founderFit))}</footer>
    </article>
  );
}
