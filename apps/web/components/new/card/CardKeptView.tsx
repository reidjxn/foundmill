"use client";
/**
 * The kept card's page (app/new/card/[ideaId]): "<name> is yours", the card, and one next step. Works from 390 px.
 *
 * The next step is the three questions about the person when the profile is missing (`/onboarding?next=` this card's
 * Commit, so the card keeps its thread; WP-04 T1), else Commit. Both work on a phone (Commit since WP-04 T2). "See
 * more directions" opens the studio, which is still desktop-only, so a small screen is not offered it.
 */
import Link from "next/link";
import { ArrowRight, Columns2 } from "lucide-react";
import { Button, IdeaCard, isViewportTooSmall, useViewportWidth, type IdeaCardData } from "@foundmill/dugout";
import { StudioFrame } from "@/components/new/StudioFrame";

export interface CardKeptViewProps {
  ideaId: string;
  card: IdeaCardData;
  viewer: { email: string | null };
  profileComplete: boolean;
}

export const CARD_KEPT_WORDS = {
  lede: "It is saved in your account. Your team starts from your own words.",
  profileNext: "Three quick things about you",
  profileWhy: "So your team knows what to call you and what you like doing. It takes under a minute.",
  build: "Start building it",
  more: "See more directions",
} as const;

export function CardKeptView({ ideaId, card, viewer, profileComplete }: CardKeptViewProps) {
  const build = `/new/commit/${ideaId}`;
  const next = profileComplete ? build : `/onboarding?next=${build}`;
  // No link from a phone into a desktop-only page (WP-03 T3): the studio.
  const small = isViewportTooSmall(useViewportWidth());
  return (
    <StudioFrame smallScreen title={<>{card.name} is yours</>} lede={CARD_KEPT_WORDS.lede} viewer={viewer} width="measure">
      <div className="flex flex-col items-center gap-8 pb-12 @page-wide:flex-row @page-wide:items-start" data-testid="card-kept">
        <IdeaCard card={card} founderFitKnown={false} className="shrink-0" />
        <div className="flex w-full min-w-0 flex-col gap-4 @page-wide:pt-2">
          {!profileComplete ? <p className="t-reading text-prose">{CARD_KEPT_WORDS.profileWhy}</p> : null}
          <Button asChild variant="glass" size="lg" iconRight={ArrowRight} className="min-h-tap w-full @page-wide:w-auto @page-wide:self-start">
            <Link href={next} data-testid="card-kept-next">
              {profileComplete ? CARD_KEPT_WORDS.build : CARD_KEPT_WORDS.profileNext}
            </Link>
          </Button>
          {small ? null : (
            <Button asChild variant="ghost" icon={Columns2} className="min-h-tap self-start">
              <Link href="/new/ideate">{CARD_KEPT_WORDS.more}</Link>
            </Button>
          )}
        </div>
      </div>
    </StudioFrame>
  );
}
