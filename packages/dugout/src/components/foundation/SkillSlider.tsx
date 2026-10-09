"use client";
import { forwardRef, useCallback, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { RATING_MAX, RATING_MIN, ratingBandLabel, ratingTone, type RatingTone } from "../../lib/rating";

const TONE_CLASS: Record<RatingTone, string> = {
  "rating-1": "tone-rating-1",
  "rating-2": "tone-rating-2",
  "rating-3": "tone-rating-3",
  "rating-4": "tone-rating-4",
};

export interface SkillSliderProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue" | "children"> {
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
}

/**
 * Skill input (DESIGN §8): one control, where the 20 cells *are* the track. Cells 9 px with 3 px gaps, lit in the
 * rating ramp's colour with a faint glow; an 18 px pearl thumb with a ramp-tinted halo springs to the centre of the
 * current cell. A slider in the accessibility tree (role, value, value text "13, Good"). Keys: ← ↓ −1, → ↑ +1,
 * Page Down/Up ∓5, Home/End. Pointer: press or drag on a cell. The colour is never the only signal: pair it with the
 * figure and the band word (RatingBandPill).
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
  const tickList = ticks === false ? [] : (ticks ?? [1, 5, 10, 15, 20]).filter((t) => t >= min && t <= max);
  const tone = ratingTone(v);

  return (
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
      className={cn("skill-slider w-full", TONE_CLASS[tone], className)}
      style={{ "--skill-count": count, "--skill-pos": pos, ...style } as CSSProperties}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e);
        if (disabled || e.defaultPrevented) return;
        const step: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 };
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
});

export interface RatingBandPillProps extends HTMLAttributes<HTMLSpanElement> {
  /** 1–20. */
  value: number;
}

/** The band word for a rating in a pill with a ramp-coloured dot: "Average", "Good", "Excellent" (DESIGN §8 skill input). */
export function RatingBandPill({ value, className, ...rest }: RatingBandPillProps) {
  const tone = ratingTone(value);
  return (
    <span
      data-tone={tone}
      className={cn("chip-plate inline-flex min-h-chip items-center gap-1.5 rounded-pill border py-px pl-2 pr-2.5 font-body text-label font-medium text-primary", TONE_CLASS[tone], className)}
      {...rest}
    >
      <span aria-hidden className="chip-dot" />
      {ratingBandLabel(value)}
    </span>
  );
}
