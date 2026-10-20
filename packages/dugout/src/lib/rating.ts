/** Rating ramp helpers (BUILD §5.1, DESIGN §5): 1–5 red, 6–10 amber, 11–15 light green, 16–20 bold green. */

export type RatingTone = "rating-1" | "rating-2" | "rating-3" | "rating-4";

export const RATING_MIN = 1;
export const RATING_MAX = 20;

/** Clamp to the 1–20 scale and round to an integer. */
export function clampRating(value: number): number {
  if (!Number.isFinite(value)) return RATING_MIN;
  return Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(value)));
}

/** Token name for a 1–20 rating. */
export function ratingTone(value: number): RatingTone {
  const v = clampRating(value);
  if (v <= 5) return "rating-1";
  if (v <= 10) return "rating-2";
  if (v <= 15) return "rating-3";
  return "rating-4";
}

/** `var(--rating-n)` for inline styles and SVG fills. */
export function ratingVar(value: number): string {
  return `var(--${ratingTone(value)})`;
}

/** Tailwind classes for a rating figure: ramp colour, tabular digits, weight 600 for 16–20. */
export function ratingClass(value: number, opts: { background?: boolean } = {}): string {
  const tone = ratingTone(value);
  const bold = tone === "rating-4" ? " font-semibold" : "";
  if (opts.background) return `bg-${tone} text-base${bold}`;
  return `text-${tone} tabular-nums${bold}`;
}

/** Words for the four bands, for tooltips and screen readers. */
export function ratingBandLabel(value: number): "Poor" | "Average" | "Good" | "Excellent" {
  switch (ratingTone(value)) {
    case "rating-1":
      return "Poor";
    case "rating-2":
      return "Average";
    case "rating-3":
      return "Good";
    default:
      return "Excellent";
  }
}

/** Fill pattern for a 20-cell skill bar: `true` for filled cells. */
export function ratingCells(value: number): boolean[] {
  const v = clampRating(value);
  return Array.from({ length: RATING_MAX }, (_, i) => i < v);
}

/**
 * The scales a number is shown on (UX plan §5 "every number carries a word"): the 1–20 attribute, a /10 average, and
 * stars out of 5. Every scale maps onto the 1–20 ramp for its band word and tone.
 */
export type RatingScale = 20 | 10 | 5;

/** The caption beside a figure on a scale: "/20", "/10", "of 5". */
export function scaleCaption(scale: RatingScale): "/20" | "/10" | "of 5" {
  switch (scale) {
    case 10:
      return "/10";
    case 5:
      return "of 5";
    default:
      return "/20";
  }
}

/** A value on any scale as its 1–20 rating (7.5/10 → 15, 3.5 of 5 → 14), clamped and rounded. */
export function toRating20(value: number, scale: RatingScale = 20): number {
  return clampRating(value * (RATING_MAX / scale));
}
