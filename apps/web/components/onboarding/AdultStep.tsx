"use client";
/**
 * The one step a person whose account has no "I am 18 or older" on record sees, once, the next time they arrive
 * (CLAUDE.md: 18 or older for the whole product, confirmed once at sign-up; the api's `adult_confirmations`, 0100).
 * It is for people who were here before sign-up asked, and for a profile whose save did not record it. Every signed-in
 * page that needs a profile sends such a person to /onboarding, which shows this instead of the form.
 *
 * `founder.adult.confirm` records it (the database sets the time; a second call writes nothing), then the person goes
 * on to `/`, which picks their project or their home again. Works from 390 px (`WorksOnSmallScreens`): a person who
 * opens /home on a phone is asked here and goes straight back.
 */
import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { APP_NAME } from "@foundmill/config";
import { AdultCheck, Button, StatusPill } from "@foundmill/dugout";
import { BrandFrame } from "@/components/shell/BrandFrame";
import { WorksOnSmallScreens } from "@/components/providers/DesktopOnly";
import { useTRPC } from "@/lib/trpc-react";
import { errorMessage } from "@/lib/trpc";

/** What the step says: plain, the age named, said once. */
export const ADULT_STEP_WORDS = {
  title: "Before you continue",
  body: `${APP_NAME} is for people 18 or older. Confirm it once and we won't ask again.`,
  needed: "Tick the box to continue.",
  next: "Continue",
} as const;

export interface AdultStepProps {
  /** Where to go once confirmed; `/` (the start: a project, or the person's home) by default. */
  next?: string;
}

export function AdultStep({ next = "/" }: AdultStepProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [tried, setTried] = useState(false);
  const confirm = useMutation(
    trpc.founder.adult.confirm.mutationOptions({
      onSuccess: () => {
        router.replace(next);
        router.refresh();
      },
    }),
  );
  const go = () => {
    setTried(true);
    if (checked) confirm.mutate({ confirm: true });
  };
  return (
    <BrandFrame title={ADULT_STEP_WORDS.title} smallScreen>
      <WorksOnSmallScreens />
      <form
        className="flex flex-col gap-4"
        data-testid="adult-step"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <p className="text-body text-primary">{ADULT_STEP_WORDS.body}</p>
        <AdultCheck checked={checked} onCheckedChange={setChecked} disabled={confirm.isPending || confirm.isSuccess} error={tried && !checked ? ADULT_STEP_WORDS.needed : undefined} data-testid="adult-step-check" />
        {confirm.error ? (
          <StatusPill tone="bad" role="alert">
            {errorMessage(confirm.error)}
          </StatusPill>
        ) : null}
        <Button type="submit" variant="primary" size="lg" className="min-h-tap" icon={ArrowRight} loading={confirm.isPending || confirm.isSuccess} data-testid="adult-step-continue">
          {ADULT_STEP_WORDS.next}
        </Button>
      </form>
    </BrandFrame>
  );
}
