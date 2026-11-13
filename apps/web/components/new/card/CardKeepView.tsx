"use client";
/**
 * The keep step (app/new/card/keep): "Keep <name>?", the card, the words it was drafted from, "Keep this card" and
 * "Not mine". Works from 390 px.
 */
import { Check, X } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button, IdeaCard, type IdeaCardData } from "@foundmill/dugout";
import { IDEA_CLAIM_PARAM } from "@foundmill/shared";
import { StudioFrame } from "@/components/new/StudioFrame";

export interface CardKeepPreview {
  card: IdeaCardData & { name: string };
  prompt: string;
  interest: string | null;
  sample: boolean;
  source: "browser" | "link" | "waitlist";
}

export const CARD_KEEP_WORDS = {
  lede: "This is the card from the home page. Keep it and it goes in your deck, where your team starts from your words.",
  fromWords: "Drafted from",
  fromInterest: "Drafted from the interest",
  keep: "Keep this card",
  notMine: "Not mine",
} as const;

function KeepButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="glass" size="lg" icon={Check} loading={pending} className="min-h-tap w-full @page-wide:w-auto" data-testid="card-keep">
      {CARD_KEEP_WORDS.keep}
    </Button>
  );
}

export function CardKeepView({ preview, claim, viewer, keepAction, notMineAction }: { preview: CardKeepPreview; claim: string | null; viewer: { email: string | null }; keepAction: (form: FormData) => Promise<void>; notMineAction: () => Promise<void> }) {
  return (
    <StudioFrame smallScreen title={<>Keep {preview.card.name}?</>} lede={CARD_KEEP_WORDS.lede} viewer={viewer} width="measure">
      <div className="flex flex-col items-center gap-8 pb-12 @page-wide:flex-row @page-wide:items-start" data-testid="card-keep-step">
        <IdeaCard card={preview.card} sample={preview.sample} className="shrink-0" />
        <div className="flex w-full min-w-0 flex-col gap-4 @page-wide:pt-2">
          <p className="t-body text-secondary" data-testid="card-keep-words">
            {preview.prompt ? (
              <>
                {CARD_KEEP_WORDS.fromWords}: <span className="text-primary">“{preview.prompt}”</span>
              </>
            ) : (
              <>
                {CARD_KEEP_WORDS.fromInterest} <span className="text-primary">{preview.interest}</span>
              </>
            )}
          </p>
          <form action={keepAction}>
            {claim ? <input type="hidden" name={IDEA_CLAIM_PARAM} value={claim} /> : null}
            <KeepButton />
          </form>
          <form action={notMineAction}>
            <Button type="submit" variant="ghost" icon={X} className="min-h-tap" data-testid="card-not-mine">
              {CARD_KEEP_WORDS.notMine}
            </Button>
          </form>
        </div>
      </div>
    </StudioFrame>
  );
}
