"use client";
import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";
import {
  RATING_MAX,
  RATING_MIN,
  ratingBandLabel,
  ratingTone,
  type RatingTone,
} from "../../lib/rating";
import { ScaleLabel, type ScaleLabelProps } from "../guidance/ScaleLabel";
import { SegmentedControl } from "./SegmentedControl";

const TONE_CLASS: Record<RatingTone, string> = {
  "rating-1": "tone-rating-1",
  "rating-2": "tone-rating-2",
  "rating-3": "tone-rating-3",
  "rating-4": "tone-rating-4",
};

/* ---------- anchors (docs/UX_AUDIT_AND_PLAN.md §7.3, A2) ---------- */

export type SkillAnchorKey = "none" | "some" | "solid" | "expert";

export interface SkillAnchor {
  value: SkillAnchorKey;
  /** The one word on the picker. */
  label: string;
  /** The rating the picker sets: the middle of the band. */
  rating: number;
  /** The band in words ("6–10 · could manage with help"), the picker's title and the legend's text. */
  hint: string;
}

/**
 * The four anchors of the 1–20 skill scale, one per band of the rating ramp: a founder who has never rated a skill out
 * of 20 picks a word, and the number follows (3, 8, 13, 18, the middle of each band). Moving the slider afterwards
 * keeps the word in step through `skillAnchorOf`.
 */
export const SKILL_ANCHORS: readonly SkillAnchor[] = [
  { value: "none", label: "None", rating: 3, hint: "1–5 · never done it" },
  { value: "some", label: "Some", rating: 8, hint: "6–10 · could manage with help" },
  { value: "solid", label: "Solid", rating: 13, hint: "11–15 · done it for real" },
  { value: "expert", label: "Expert", rating: 18, hint: "16–20 · done it professionally" },
];

/** The legend shown once above a set of skill sliders. */
export const SKILL_SCALE_LEGEND =
  "1–5 never done it · 6–10 could manage with help · 11–15 done it for real · 16–20 done it professionally";

/** The anchor a rating falls in: 1–5 none, 6–10 some, 11–15 solid, 16–20 expert (the ramp's own bands). */
export function skillAnchorOf(value: number): SkillAnchorKey {
  switch (ratingTone(value)) {
    case "rating-1":
      return "none";
    case "rating-2":
      return "some";
    case "rating-3":
      return "solid";
    default:
      return "expert";
  }
}

/** The rating an anchor sets (the middle of its band). */
export function skillAnchorRating(anchor: SkillAnchorKey): number {
  return SKILL_ANCHORS.find((a) => a.value === anchor)?.rating ?? RATING_MIN;
}

export interface SkillAnchorsProps {
  /** The rating the picker reflects (1–20). */
  value: number;
  /** Called with the anchor's rating (3, 8, 13 or 18). */
  onValueChange?: (value: number) => void;
  disabled?: boolean;
  /** Required: the group's accessible name ("Sales: level"). */
  "aria-label": string;
  className?: string;
}

/** The four-word picker (None / Some / Solid / Expert) that sets a skill's number; the pressed word follows the value. */
export function SkillAnchors({
  value,
  onValueChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: SkillAnchorsProps) {
  return (
    <SegmentedControl<SkillAnchorKey>
      aria-label={ariaLabel}
      value={skillAnchorOf(value)}
      onValueChange={(k) => onValueChange?.(skillAnchorRating(k))}
      options={SKILL_ANCHORS.map((a) => ({
        value: a.value,
        label: a.label,
        title: a.hint,
        disabled,
      }))}
      className={cn("w-fit", className)}
      data-skill-anchors=""
    />
  );
}

/* ---------- the slider ---------- */

export interface SkillSliderProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue" | "children"
> {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  /** Default 1. */
  min?: number;
  /** Default 20: one cell per step. */
  max?: number;
  disabled?: boolean;
  /** Mono ticks under the cells. Default 1, 5, 10, 15, 20 (within min–max); false for none. */
  ticks?: number[] | false;
  /** Shown over the thumb while the slider has keyboard focus. Default "← → to adjust"; false for none. */
  hint?: ReactNode | false;
  /**
   * The four-word picker (None / Some / Solid / Expert) above the cells (UX plan §7.3, A2): a word sets the number
   * (3 / 8 / 13 / 18) and the slider stays the display. `className` then goes on the wrapper that holds both.
   */
  anchors?: boolean;
  /** The picker's accessible name; defaults to the slider's own label followed by ": level". */
  anchorsLabel?: string;
}

/**
 * Skill input (DESIGN §8): one control, where the 20 cells *are* the track. Cells 9 px with 3 px gaps, lit in the
 * rating ramp's colour with a faint glow; an 18 px pearl thumb with a ramp-tinted halo springs to the centre of the
 * current cell. A slider in the accessibility tree (role, value, value text "13, Good"). Keys: ← ↓ −1, → ↑ +1,
 * Page Down/Up ∓5, Home/End. Pointer: press or drag on a cell. The colour is never the only signal: pair it with the
 * figure and the band word (ScaleLabel). With `anchors`, a four-word picker sits above the cells and sets the number.
 */
export const SkillSlider = forwardRef<HTMLDivElement, SkillSliderProps>(function SkillSlider(
  {
    value,
    defaultValue,
    onValueChange,
    min = RATING_MIN,
    max = RATING_MAX,
    disabled,
    ticks,
    hint = "← → to adjust",
    anchors,
    anchorsLabel,
    className,
    style,
    onKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    ...rest
  },
  ref,
) {
  const [own, setOwn] = useState(defaultValue ?? min);
  const [dragging, setDragging] = useState(false);
  const count = Math.max(1, max - min + 1);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const v = clamp(value ?? own);
  const pos = v - min + 1;
  const root = useRef<HTMLDivElement | null>(null);
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      root.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  const commit = (n: number) => {
    const next = clamp(n);
    if (next === v) return;
    if (value === undefined) setOwn(next);
    onValueChange?.(next);
  };
  const fromPointer = (clientX: number) => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const i = Math.floor(((clientX - rect.left) / rect.width) * count);
    commit(min + Math.min(count - 1, Math.max(0, i)));
  };
  const tickList =
    ticks === false ? [] : (ticks ?? [1, 5, 10, 15, 20]).filter((t) => t >= min && t <= max);
  const tone = ratingTone(v);

  const slider = (
    <div
      ref={setRefs}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={v}
      aria-valuetext={`${v}, ${ratingBandLabel(v)}`}
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      data-skill-slider=""
      data-tone={tone}
      data-dragging={dragging || undefined}
      className={cn("skill-slider w-full", TONE_CLASS[tone], anchors ? undefined : className)}
      style={{ "--skill-count": count, "--skill-pos": pos, ...style } as CSSProperties}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e);
        if (disabled || e.defaultPrevented) return;
        const step: Record<string, number> = {
          ArrowRight: 1,
          ArrowUp: 1,
          ArrowLeft: -1,
          ArrowDown: -1,
          PageUp: 5,
          PageDown: -5,
        };
        if (e.key in step) commit(v + (step[e.key] as number));
        else if (e.key === "Home") commit(min);
        else if (e.key === "End") commit(max);
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        onPointerDown?.(e);
        if (disabled || e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.currentTarget.focus({ preventScroll: true });
        setDragging(true);
        fromPointer(e.clientX);
      }}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
        onPointerMove?.(e);
        if (dragging) fromPointer(e.clientX);
      }}
      onPointerUp={(e: PointerEvent<HTMLDivElement>) => {
        onPointerUp?.(e);
        setDragging(false);
      }}
      onLostPointerCapture={() => setDragging(false)}
      {...rest}
    >
      <div aria-hidden className="skill-cells">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="skill-cell" data-on={i < pos || undefined} />
        ))}
      </div>
      <span aria-hidden className="skill-thumb" />
      {tickList.length ? (
        <div aria-hidden className="skill-ticks">
          {tickList.map((t) => (
            <span key={t} style={{ "--tick": t - min + 1 } as CSSProperties}>
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {hint ? (
        <span aria-hidden className="skill-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
  if (!anchors) return slider;
  const sliderLabel = typeof rest["aria-label"] === "string" ? rest["aria-label"] : null;
  return (
    <div data-skill-input="" className={cn("flex min-w-0 flex-col gap-2", className)}>
      <SkillAnchors
        value={v}
        onValueChange={commit}
        disabled={disabled}
        aria-label={anchorsLabel ?? (sliderLabel ? `${sliderLabel}: level` : "Level")}
      />
      {slider}
    </div>
  );
});

/**
 * The band word for a rating in a pill with a ramp-coloured dot: "Average", "Good", "Excellent" (DESIGN §8 skill input).
 * Promoted to the guided layer's `ScaleLabel` (UX plan §6.2), which every rating shares; this name stays for the
 * slider's own callers and the stories. `value` is 1–20.
 */
export type RatingBandPillProps = ScaleLabelProps;
export const RatingBandPill = ScaleLabel;
