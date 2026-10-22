/**
 * The word beside a number (docs/UX_AUDIT_AND_PLAN.md §6.2 `ScaleLabel`, principle 4 "every number carries a word").
 * The band pill that lived in SkillSlider (RatingBandPill), promoted so SkillGrid, RatingCell, AttributeBars and
 * channel fit share it: the band word (Poor / Average / Good / Excellent, the product's own words, founder decision
 * 2026-10-20 item 6) in a 22 px pill with a dot in the ramp tone. A /10 average and stars out of 5 map onto the same
 * 1–20 bands. `compact` drops the plate for a 28 px row and keeps the dot and the word. Always shown: the word is
 * information. Server-safe. `FormKey` is the sentence behind the five Form cells, for a Tooltip.
 */
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { ratingBandLabel, ratingTone, toRating20, type RatingScale, type RatingTone } from "../../lib/rating";
import type { FormResult } from "../agents/types";

const TONE_CLASS: Record<RatingTone, string> = {
  "rating-1": "tone-rating-1",
  "rating-2": "tone-rating-2",
  "rating-3": "tone-rating-3",
  "rating-4": "tone-rating-4",
};

export interface ScaleLabelProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** The figure on its scale: 1–20, 0–10 or 0–5 (halves). */
  value: number;
  /** The scale the figure is on (default 20). */
  scale?: RatingScale;
  /** The word alone with its dot, no plate: for 28 px rows. */
  compact?: boolean;
}

/** The band word for a value on any scale: "Good" for 13/20, 7.5/10 or 3.5 of 5. */
export function scaleWord(value: number, scale: RatingScale = 20): ReturnType<typeof ratingBandLabel> {
  return ratingBandLabel(toRating20(value, scale));
}

export function ScaleLabel({ value, scale = 20, compact, className, ...rest }: ScaleLabelProps) {
  const v20 = toRating20(value, scale);
  const tone = ratingTone(v20);
  return (
    <span
      data-scale-label=""
      data-scale={scale}
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 font-body font-medium",
        compact ? "text-small text-secondary" : "chip-plate min-h-chip rounded-pill border py-px pl-2 pr-2.5 text-label text-primary",
        TONE_CLASS[tone],
        className,
      )}
      {...rest}
    >
      <span aria-hidden className="chip-dot" />
      {ratingBandLabel(v20)}
    </span>
  );
}

/** One of an agent's last five task results, or an empty slot. */
export type FormKeyCell = FormResult | null | undefined;

/** The five Form cells in words: "Last 5 tasks: 4 went well, 1 partly, 0 failed"; fewer tasks say so; none: "No tasks yet". */
export function formKeySentence(cells: readonly FormKeyCell[]): string {
  const done = cells.filter((c): c is FormResult => c === "success" || c === "partial" || c === "failure");
  if (!done.length) return "No tasks yet";
  const count = (r: FormResult) => done.filter((c) => c === r).length;
  const head = done.length === 1 ? "Last task" : `Last ${done.length} tasks`;
  return `${head}: ${count("success")} went well, ${count("partial")} partly, ${count("failure")} failed`;
}

export interface FormKeyProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  cells: readonly FormKeyCell[];
}

/** The Form key as an element ("Last 5 tasks: 4 went well, 1 partly, 0 failed"), for a Tooltip's content or a caption. */
export function FormKey({ cells, className, ...rest }: FormKeyProps) {
  return (
    <span className={cn("text-small", className)} data-form-key="" {...rest}>
      {formKeySentence(cells)}
    </span>
  );
}
