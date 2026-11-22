"use client";
/**
 * The two answers a person's team needs before they take charge (founder's answer A5, 2026-11-17; WP-14 T2 step 6):
 * how much time they can give and where they live. The first profile asks both and lets a person go on without; here
 * a person whose profile lacks either is asked for exactly the ones missing, and Start waits for them. The answers
 * ride on the same press (`idea.commit` saves them to the profile before anything is created).
 */
import type { TakeChargeNeed } from "@foundmill/config";
import { Field, Input, Panel, RadioCard, RadioGroup } from "@foundmill/dugout";
import { COUNTRIES, TIME_OPTIONS, partialCountry, partialCountryMessage } from "@/components/onboarding/profile-form";

export const ABOUT_YOU_WORDS = {
  title: "Two things your team needs first",
  lede: "Your team plans the work around the time you have and the place you live. You can change both later in your profile.",
  time: "How much time can you give?",
  place: "Where do you live?",
  timeNeeded: "Pick how much time you can give.",
  placeNeeded: "Tell your team where you live.",
} as const;

export interface AboutYouValues {
  timeCommitment: string;
  residence: string;
}
export const EMPTY_ABOUT_YOU: AboutYouValues = { timeCommitment: "", residence: "" };

/** What is wrong with the answers asked for: nothing for an answer the profile already has. */
export function aboutYouErrors(missing: readonly TakeChargeNeed[], values: AboutYouValues): Partial<Record<TakeChargeNeed, string>> {
  const errors: Partial<Record<TakeChargeNeed, string>> = {};
  if (missing.includes("timeCommitment") && !values.timeCommitment) errors.timeCommitment = ABOUT_YOU_WORDS.timeNeeded;
  if (missing.includes("residence")) {
    const partial = partialCountry(values.residence);
    if (!values.residence.trim()) errors.residence = ABOUT_YOU_WORDS.placeNeeded;
    else if (partial.length) errors.residence = partialCountryMessage(partial);
  }
  return errors;
}

/** The answers as `idea.commit` takes them: only the ones asked for. */
export function aboutYouInput(missing: readonly TakeChargeNeed[], values: AboutYouValues): { timeCommitment?: string; residence?: string } {
  return {
    ...(missing.includes("timeCommitment") && values.timeCommitment ? { timeCommitment: values.timeCommitment } : {}),
    ...(missing.includes("residence") && values.residence.trim() ? { residence: values.residence.trim() } : {}),
  };
}

export interface AboutYouProps {
  /** Which of the two the profile lacks; the panel renders nothing when it lacks neither. */
  missing: readonly TakeChargeNeed[];
  values: AboutYouValues;
  onChange: (values: AboutYouValues) => void;
  /** Show what is missing (after a press of Start). */
  touched: boolean;
}

export function AboutYou({ missing, values, onChange, touched }: AboutYouProps) {
  if (missing.length === 0) return null;
  const errors = touched ? aboutYouErrors(missing, values) : {};
  return (
    <Panel title={ABOUT_YOU_WORDS.title} data-testid="commit-about-you">
      <div className="flex flex-col gap-4">
        <p className="text-small text-pretty text-secondary">{ABOUT_YOU_WORDS.lede}</p>
        {missing.includes("timeCommitment") ? (
          <Field htmlFor="commit-time" label={ABOUT_YOU_WORDS.time} required error={errors.timeCommitment}>
            <RadioGroup id="commit-time" value={values.timeCommitment} onValueChange={(v) => onChange({ ...values, timeCommitment: v })} aria-label={ABOUT_YOU_WORDS.time} className="grid-cols-1 @page-wide:grid-cols-2">
              {TIME_OPTIONS.map((o) => (
                <RadioCard key={o.value} id={`commit-time-${o.value}`} value={o.value} label={o.label} description={o.description} className="min-h-tap" />
              ))}
            </RadioGroup>
          </Field>
        ) : null}
        {missing.includes("residence") ? (
          <Field htmlFor="commit-residence" label={ABOUT_YOU_WORDS.place} required error={errors.residence}>
            <Input
              id="commit-residence"
              controlSize="lg"
              value={values.residence}
              onChange={(e) => onChange({ ...values, residence: e.target.value })}
              maxLength={80}
              autoComplete="country-name"
              list="commit-residence-list"
              placeholder="Country"
              invalid={Boolean(errors.residence)}
            />
            <datalist id="commit-residence-list">
              {COUNTRIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        ) : null}
      </div>
    </Panel>
  );
}
