"use client";
/**
 * FirstProfileForm: what a new account answers after keeping a card (WP-04 T1; WP-14 T2), then the one "I am 18 or
 * older" box and Continue. One column, from 390 px: every control is at least 44 px tall on a phone.
 *
 *   1. What should your team call you? Required (the caller prefills it).
 *   2. What are you good at, or enjoy? Optional tags: type one and press Enter, or pick a suggestion. The suggestions
 *      set the quick skill ratings (the caller maps them); picking none starts neutral, and the hint says so.
 *   3. How much time can you give? and Where do you live? Optional here; both are asked again, and required, before a
 *      person starts a project (founder's answer A5, 2026-11-17).
 *   4. The "what are you here for" question with its answers (the caller passes them; the first is the default).
 *
 * Pure: values in, `onChange` and `onSubmit` out; the screen saves. Continue checks the two required inputs (the name,
 * and the box when `askAdult`) and says what is missing under each instead of saving.
 */
import { QUICK_PROFILE_TAGS } from "@foundmill/config";
import { ArrowRight, Plus } from "lucide-react";
import { useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { Input } from "../foundation/Input";
import { Field } from "../foundation/Label";
import { RadioCard, RadioGroup } from "../foundation/RadioGroup";
import { StatusPill } from "../foundation/StatusPill";
import { AdultCheck } from "./AdultCheck";

/** The form's own words (the screen, its tests and the e2e spec read them). */
export const FIRST_PROFILE_WORDS = {
  name: "What should your team call you?",
  namePlaceholder: "Your name",
  nameNeeded: "Tell the team what to call you.",
  strengths: "What are you good at, or enjoy?",
  strengthsHint: "Optional. Pick any below, or type your own and press Enter. Pick none and your team starts from a neutral rating for each skill.",
  strengthsPlaceholder: "Add your own",
  time: "How much time can you give?",
  place: "Where do you live?",
  placePlaceholder: "Country",
  laterHint: "Your team needs this before you start a project. Answer now, or then.",
  adultHint: "You confirm this once.",
  adultNeeded: "Confirm that you are 18 or older to continue.",
  submit: "Continue",
} as const;

/** The five suggestions under "What are you good at, or enjoy?": one for each skill the profile rates (WP-14 T2). */
export const FIRST_PROFILE_STRENGTHS: readonly string[] = QUICK_PROFILE_TAGS.map((t) => t.tag);

export interface FirstProfileValues {
  name: string;
  strengths: string[];
  /** One of `lookingForOptions`' values. */
  lookingFor: string;
  /** One of `timeOptions`' values; "" while unanswered. */
  time: string;
  /** Where the person lives, as typed; "" while unanswered. */
  place: string;
}

export interface FirstProfileFormProps {
  values: FirstProfileValues;
  onChange: (values: FirstProfileValues) => void;
  /** Tags offered under the strengths field; one already chosen is not offered again. */
  strengthSuggestions: readonly string[];
  /** The third question and its answers. */
  lookingForQuestion: string;
  lookingForOptions: readonly { value: string; label: string }[];
  /** The answers to "How much time can you give?". */
  timeOptions: readonly { value: string; label: string; description?: string }[];
  /** Countries offered as the person types where they live (free text is accepted too). */
  placeSuggestions?: readonly string[];
  /** What is wrong with the place as typed (a country picked only part of the way); Continue waits while it is set. */
  placeError?: string;
  /** The most tags, and the longest a tag can be. */
  maxTags: number;
  maxTagLength: number;
  /** The "I am 18 or older" box is on the form, and Continue waits for it. */
  askAdult: boolean;
  saving?: boolean;
  /** Why the last save did not go through. */
  error?: ReactNode;
  /** Called only with a name, and with the box ticked when it is asked. `confirmAdult` is true only then. */
  onSubmit: (values: FirstProfileValues & { confirmAdult: boolean }) => void;
  className?: string;
  "data-testid"?: string;
}

/** `tag` added to `tags`: trimmed, cut to `maxLength`, once (case aside), and only while there is room. */
export function addTag(tags: readonly string[], tag: string, max: number, maxLength: number): string[] {
  const clean = tag.trim().slice(0, maxLength).trim();
  if (!clean || tags.length >= max || tags.some((t) => t.toLowerCase() === clean.toLowerCase())) return [...tags];
  return [...tags, clean];
}

export function FirstProfileForm({
  values,
  onChange,
  strengthSuggestions,
  lookingForQuestion,
  lookingForOptions,
  timeOptions,
  placeSuggestions = [],
  placeError,
  maxTags,
  maxTagLength,
  askAdult,
  saving = false,
  error,
  onSubmit,
  className,
  "data-testid": testId = "first-profile",
}: FirstProfileFormProps) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const [adult, setAdult] = useState(false);
  const [draft, setDraft] = useState("");
  const set = <K extends keyof FirstProfileValues>(key: K, value: FirstProfileValues[K]) => onChange({ ...values, [key]: value });
  const nameError = touched && !values.name.trim() ? FIRST_PROFILE_WORDS.nameNeeded : undefined;
  const adultError = touched && askAdult && !adult ? FIRST_PROFILE_WORDS.adultNeeded : undefined;

  const addDraft = () => {
    if (!draft.trim()) return;
    set("strengths", addTag(values.strengths, draft, maxTags, maxTagLength));
    setDraft("");
  };
  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addDraft();
    } else if (e.key === "Backspace" && draft === "" && values.strengths.length > 0) {
      set("strengths", values.strengths.slice(0, -1));
    }
  };
  const offered = strengthSuggestions.filter((s) => s.length <= maxTagLength && !values.strengths.some((t) => t.toLowerCase() === s.toLowerCase()));
  const full = values.strengths.length >= maxTags;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!values.name.trim() || (askAdult && !adult) || placeError) return;
    onSubmit({ ...values, name: values.name.trim(), place: values.place.trim(), confirmAdult: askAdult && adult });
  }

  return (
    <form onSubmit={submit} noValidate className={cn("flex w-full max-w-reading flex-col gap-6", className)} data-testid={testId}>
      <Field htmlFor={`${id}-name`} label={FIRST_PROFILE_WORDS.name} required error={nameError}>
        <Input
          id={`${id}-name`}
          controlSize="xl"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={120}
          autoComplete="name"
          placeholder={FIRST_PROFILE_WORDS.namePlaceholder}
          invalid={Boolean(nameError)}
        />
      </Field>

      <Field htmlFor={`${id}-strengths`} label={FIRST_PROFILE_WORDS.strengths} hint={FIRST_PROFILE_WORDS.strengthsHint}>
        <div className="flex flex-col gap-2">
          {values.strengths.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" role="list" aria-label={`${FIRST_PROFILE_WORDS.strengths} chosen`}>
              {values.strengths.map((t) => (
                <Chip key={t} tone="kit" role="listitem" onRemove={() => set("strengths", values.strengths.filter((v) => v !== t))} removeLabel={`Remove ${t}`}>
                  {t}
                </Chip>
              ))}
            </div>
          ) : null}
          <Input
            id={`${id}-strengths`}
            controlSize="xl"
            value={draft}
            maxLength={maxTagLength}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onTagKey}
            onBlur={addDraft}
            disabled={full}
            placeholder={FIRST_PROFILE_WORDS.strengthsPlaceholder}
          />
          {offered.length > 0 && !full ? (
            <div className="flex flex-wrap gap-2" aria-label={`${FIRST_PROFILE_WORDS.strengths} suggestions`}>
              {offered.map((s) => (
                <Chip key={s} icon={Plus} onClick={() => set("strengths", addTag(values.strengths, s, maxTags, maxTagLength))} className="h-tap @page-wide:h-chip">
                  {s}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      </Field>

      <Field htmlFor={`${id}-time`} label={FIRST_PROFILE_WORDS.time} hint={FIRST_PROFILE_WORDS.laterHint}>
        <RadioGroup id={`${id}-time`} value={values.time} onValueChange={(v) => set("time", v)} aria-label={FIRST_PROFILE_WORDS.time} className="grid-cols-1 @page-wide:grid-cols-2">
          {timeOptions.map((o) => (
            <RadioCard key={o.value} id={`${id}-time-${o.value}`} value={o.value} label={o.label} description={o.description} className="min-h-tap" />
          ))}
        </RadioGroup>
      </Field>

      <Field htmlFor={`${id}-place`} label={FIRST_PROFILE_WORDS.place} hint={FIRST_PROFILE_WORDS.laterHint} error={touched ? placeError : undefined}>
        <Input
          id={`${id}-place`}
          controlSize="xl"
          value={values.place}
          onChange={(e) => set("place", e.target.value)}
          maxLength={80}
          autoComplete="country-name"
          list={`${id}-places`}
          placeholder={FIRST_PROFILE_WORDS.placePlaceholder}
          invalid={touched && Boolean(placeError)}
        />
        <datalist id={`${id}-places`}>
          {placeSuggestions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>

      <Field htmlFor={`${id}-looking`} label={lookingForQuestion}>
        <RadioGroup id={`${id}-looking`} value={values.lookingFor} onValueChange={(v) => set("lookingFor", v)} aria-label={lookingForQuestion} className="grid-cols-1 @page-wide:grid-cols-2">
          {lookingForOptions.map((o) => (
            <RadioCard key={o.value} id={`${id}-looking-${o.value}`} value={o.value} label={o.label} className="min-h-tap" />
          ))}
        </RadioGroup>
      </Field>

      {askAdult ? <AdultCheck checked={adult} onCheckedChange={setAdult} hint={FIRST_PROFILE_WORDS.adultHint} error={adultError} data-testid={`${testId}-adult`} /> : null}

      <div className="flex flex-col gap-3 @page-wide:flex-row @page-wide:items-center @page-wide:justify-between">
        {error ? (
          <StatusPill tone="bad" role="alert">
            {error}
          </StatusPill>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" size="lg" iconRight={ArrowRight} loading={saving} className="min-h-tap w-full @page-wide:w-auto" data-testid={`${testId}-submit`}>
          {FIRST_PROFILE_WORDS.submit}
        </Button>
      </div>
    </form>
  );
}
