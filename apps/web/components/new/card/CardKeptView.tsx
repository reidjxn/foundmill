"use client";
/**
 * The kept card's page (app/new/card/[ideaId]): "<name> is yours", the card, and one next step. Works from 390 px.
 *
 * On a small screen the next step (onboarding, or Commit) and "See more directions" open desktop-only pages, so they
 * are not links there: the step says it needs a computer and offers the link by email (`NextStepOnComputer`, WP-03 T3).
 * A stopgap: WP-04 removes it when it rebuilds onboarding, Commit and this next step for small screens.
 */
import Link from "next/link";
import { ArrowRight, Columns2 } from "lucide-react";
import { Button, IdeaCard, isViewportTooSmall, useViewportWidth, type IdeaCardData } from "@foundmill/dugout";
import { StudioFrame } from "@/components/new/StudioFrame";
import { NextStepOnComputer } from "@/components/providers/ContinueLater";

export interface CardKeptViewProps {
  ideaId: string;
  card: IdeaCardData;
  viewer: { email: string | null };
  profileComplete: boolean;
}

export const CARD_KEPT_WORDS = {
  lede: "It is saved in your deck. Your team starts from your words.",
  profileNext: "Answer three questions about you",
  profileWhy: "Founder fit, and the plan your team drafts, come from what you can put in: your time, your money and what you are good at.",
  build: "Start building it",
  more: "See more directions",
} as const;

export function CardKeptView({ ideaId, card, viewer, profileComplete }: CardKeptViewProps) {
  const next = profileComplete ? `/new/commit/${ideaId}` : "/onboarding";
  // WP-03 T3 stopgap (WP-04 deletes it): no link from a phone into a desktop-only page.
  const small = isViewportTooSmall(useViewportWidth());
  return (
    <StudioFrame smallScreen title={<>{card.name} is yours</>} lede={CARD_KEPT_WORDS.lede} viewer={viewer} width="measure">
      <div className="flex flex-col items-center gap-8 pb-12 @page-wide:flex-row @page-wide:items-start" data-testid="card-kept">
        <IdeaCard card={card} founderFitKnown={false} className="shrink-0" />
        <div className="flex w-full min-w-0 flex-col gap-4 @page-wide:pt-2">
          {!profileComplete ? <p className="t-reading text-prose">{CARD_KEPT_WORDS.profileWhy}</p> : null}
          {small ? (
            <NextStepOnComputer path={next} />
          ) : (
            <>
              <Button asChild variant="glass" size="lg" iconRight={ArrowRight} className="min-h-tap w-full @page-wide:w-auto @page-wide:self-start">
                <Link href={next} data-testid="card-kept-next">
                  {profileComplete ? CARD_KEPT_WORDS.build : CARD_KEPT_WORDS.profileNext}
                </Link>
              </Button>
              <Button asChild variant="ghost" icon={Columns2} className="min-h-tap self-start">
                <Link href="/new/ideate">{CARD_KEPT_WORDS.more}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </StudioFrame>
  );
}
