"use client";
/**
 * WriteIdeaForm: a phone start without a card (WP-04 T15). Two fields, a working name and the idea in the person's
 * own words, and "Shape it". One column from 390 px; the button is 44 px tall and full width until `page-wide`.
 *
 * Pure: values in, `onChange` and `onSubmit` out; the screen writes the idea (`idea.write`) and goes to Commit. "Shape
 * it" checks both fields and says what is missing under each instead of sending.
 */
import { ArrowRight } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Input } from "../foundation/Input";
import { Field } from "../foundation/Label";
import { StatusPill } from "../foundation/StatusPill";
import { Textarea } from "../foundation/Textarea";

/** The form's own words (the screen, its tests and the e2e spec read them). */
export const WRITE_IDEA_WORDS = {
  title: "What do you want to build?",
  lede: "One sentence is enough.",
  name: "A working name",
  nameHint: "You can change it when you start.",
  nameNeeded: "Give it a working name.",
  pitch: "Your idea, in your words",
  pitchHint: "Who it is for and what it does. Your team builds from these words.",
  pitchNeeded: "Say your idea in a sentence.",
  submit: "Shape it",
} as const;

/** The limits `idea.write` takes. */
export const WRITE_IDEA_LIMITS = { name: 60, pitch: 4000 } as const;

export interface WriteIdeaValues {
  name: string;
  pitch: string;
}

export interface WriteIdeaFormProps {
  values: WriteIdeaValues;
  onChange: (values: WriteIdeaValues) => void;
  /** Called only with both fields filled, trimmed. */
  onSubmit: (values: WriteIdeaValues) => void;
  busy?: boolean;
  /** Why the last try did not go through. */
  error?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function WriteIdeaForm({ values, onChange, onSubmit, busy = false, error, className, "data-testid": testId = "write-idea" }: WriteIdeaFormProps) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const nameError = touched && !values.name.trim() ? WRITE_IDEA_WORDS.nameNeeded : undefined;
  const pitchError = touched && !values.pitch.trim() ? WRITE_IDEA_WORDS.pitchNeeded : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (busy || !values.name.trim() || !values.pitch.trim()) return;
    onSubmit({ name: values.name.trim(), pitch: values.pitch.trim() });
  }

  return (
    <form onSubmit={submit} noValidate className={cn("flex w-full max-w-reading flex-col gap-6", className)} data-testid={testId}>
      <Field htmlFor={`${id}-name`} label={WRITE_IDEA_WORDS.name} hint={WRITE_IDEA_WORDS.nameHint} required error={nameError}>
        <Input id={`${id}-name`} controlSize="xl" value={values.name} onChange={(e) => onChange({ ...values, name: e.target.value })} maxLength={WRITE_IDEA_LIMITS.name} invalid={Boolean(nameError)} data-testid={`${testId}-name`} />
      </Field>
      <Field htmlFor={`${id}-pitch`} label={WRITE_IDEA_WORDS.pitch} hint={WRITE_IDEA_WORDS.pitchHint} required error={pitchError}>
        <Textarea id={`${id}-pitch`} value={values.pitch} onChange={(e) => onChange({ ...values, pitch: e.target.value })} rows={5} maxLength={WRITE_IDEA_LIMITS.pitch} aria-invalid={pitchError ? true : undefined} data-testid={`${testId}-pitch`} />
      </Field>
      {error ? (
        <StatusPill tone="bad" role="alert" className="self-start">
          {error}
        </StatusPill>
      ) : null}
      <div className="flex">
        <Button type="submit" variant="primary" size="lg" iconRight={ArrowRight} loading={busy} className="min-h-tap w-full @page-wide:w-auto" data-testid={`${testId}-submit`}>
          {WRITE_IDEA_WORDS.submit}
        </Button>
      </div>
    </form>
  );
}
