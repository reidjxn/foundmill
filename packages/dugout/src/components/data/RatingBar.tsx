"use client";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import {
  RATING_MAX,
  clampRating,
  ratingBandLabel,
  ratingCells,
  ratingTone,
} from "../../lib/rating";
import { useBuilderView } from "../guidance/BuilderView";
import { ScaleLabel } from "../guidance/ScaleLabel";

/** Lit cells: the ramp colour with a faint glow in its own tone. */
const FILL_CLASS: Record<ReturnType<typeof ratingTone>, string> = {
  "rating-1": "cell-lit bg-rating-1 tone-rating-1",
  "rating-2": "cell-lit bg-rating-2 tone-rating-2",
  "rating-3": "cell-lit bg-rating-3 tone-rating-3",
  "rating-4": "cell-lit bg-rating-4 tone-rating-4",
};
const OUTLINE_CLASS: Record<ReturnType<typeof ratingTone>, string> = {
  "rating-1": "border-rating-1",
  "rating-2": "border-rating-2",
  "rating-3": "border-rating-3",
  "rating-4": "border-rating-4",
};

export interface RatingBarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** 1–20. */
  value: number;
  /** Second value drawn as outlined cells beyond `value` (potential, or a comparison). */
  compare?: number;
  /** Cell height in px. Default 8. */
  cellHeight?: number;
  /** Accessible name prefix: "Planning: 14 of 20, Good". */
  name?: string;
}

/**
 * DESIGN §5: 20 discrete cells (2 px apart), lit cells in the ramp colour for the value with a faint glow, empty cells a
 * faint plate; a comparison outlines the cells between the value and it. With Builder view off (docs/DESIGN.md) the
 * band word alone ("Good"), compact, with its dot: no cells and no figure out of 20.
 */
export function RatingBar({
  value,
  compare,
  cellHeight = 8,
  name,
  className,
  ...rest
}: RatingBarProps) {
  const builder = useBuilderView();
  const v = clampRating(value);
  if (!builder) return <ScaleLabel value={v} compact role="img" aria-label={`${name ? `${name}: ` : ""}${ratingBandLabel(v)}`} data-rating-band="" className={className} />;
  const tone = ratingTone(v);
  const cells = ratingCells(v);
  const c = compare !== undefined ? clampRating(compare) : undefined;
  const label = `${name ? `${name}: ` : ""}${v} of ${RATING_MAX}, ${ratingBandLabel(v)}${c !== undefined ? `, compared with ${c}` : ""}`;
  return (
    <span
      role="img"
      aria-label={label}
      data-rating={v}
      data-tone={tone}
      className={cn("inline-grid w-full min-w-20 grid-cols-20 gap-0.5", className)}
      {...rest}
    >
      {cells.map((filled, i) => {
        const outlined = !filled && c !== undefined && i < c;
        return (
          <span
            key={i}
            aria-hidden
            className={cn(
              "block rounded-xs border",
              filled
                ? cn(FILL_CLASS[tone], "border-transparent")
                : outlined
                  ? cn("bg-transparent", OUTLINE_CLASS[ratingTone(c as number)])
                  : "cell-empty border-transparent",
            )}
            style={{ height: cellHeight }}
          />
        );
      })}
    </span>
  );
}

export interface RatingFigureProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** 1–20. */
  value: number;
}

/**
 * The figure next to a bar: display-sm, ramp color, tabular, weight 600 for 16–20. Forwards `title` and `aria-*` so a
 * host can put the band word on it where there is no room for the pill.
 */
export function RatingFigure({ value, className, ...rest }: RatingFigureProps) {
  const v = clampRating(value);
  const tone = ratingTone(v);
  const TEXT: Record<typeof tone, string> = {
    "rating-1": "text-rating-1",
    "rating-2": "text-rating-2",
    "rating-3": "text-rating-3",
    "rating-4": "text-rating-4 font-semibold",
  };
  return (
    <span className={cn("t-display-sm tabular-nums", TEXT[tone], className)} data-tone={tone} data-rating-figure {...rest}>
      {v}
    </span>
  );
}
