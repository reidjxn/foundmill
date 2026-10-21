import type { HTMLAttributes } from "react";
import { Star } from "lucide-react";
import { cn } from "../../lib/cn";
import { scaleCaption } from "../../lib/rating";
import { ScaleLabel, scaleWord } from "../guidance/ScaleLabel";

/** The scale stars are on, for `scaleCaption` and `ScaleLabel`. */
export const STARS_SCALE = 5;

export interface StarRatingProps extends HTMLAttributes<HTMLSpanElement> {
  /** Current rating 0–5 in halves. */
  value: number;
  /** Potential rating 0–5; stars above `value` up to `potential` are outlined in gold. */
  potential?: number;
  /** Star size in px (DESIGN §8: 12). */
  size?: number;
  /** Accessible label prefix, e.g. "Current ability". */
  label?: string;
  /**
   * Show the value after the stars so color is not the only signal: the caption "Now 3.5 of 5 · could reach 4.5"
   * (`scaleCaption`, UX plan §6.2 ScaleLabel) and the band word beside it, so the stars carry a word like every other
   * figure; without a potential, the bare figure with its scale, "3.5 of 5", and the word.
   */
  showValue?: boolean;
}

type Fill = "full" | "half" | "empty";

function fills(value: number): Fill[] {
  const v = Math.max(0, Math.min(5, Math.round(value * 2) / 2));
  return Array.from({ length: 5 }, (_, i) => {
    const rem = v - i;
    return rem >= 1 ? "full" : rem >= 0.5 ? "half" : "empty";
  });
}

/** The caption beside a star pair: "Now 3.5 of 5 · could reach 4.5"; a value alone is the figure with its scale, "3.5 of 5" (`scaleCaption`). */
export function starsCaption(value: number, potential?: number): string {
  const figure = `${value} ${scaleCaption(STARS_SCALE)}`;
  return potential === undefined ? figure : `Now ${figure} · could reach ${potential}`;
}

function StarGlyph({ fill, outlined, size }: { fill: Fill; outlined: boolean; size: number }) {
  const common = { size, strokeWidth: 1.5, "aria-hidden": true as const, focusable: "false" as const };
  if (fill === "full") return <Star {...common} className="text-gold" fill="currentColor" />;
  if (fill === "half") {
    return (
      <span className="relative inline-block" style={{ width: size, height: size }}>
        <Star {...common} className={cn("absolute inset-0", outlined ? "text-gold" : "text-line-strong")} fill="none" />
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: size / 2 }}>
          <Star {...common} className="text-gold" fill="currentColor" />
        </span>
      </span>
    );
  }
  return <Star {...common} className={outlined ? "text-gold" : "text-line-strong"} fill="none" />;
}

/**
 * 0–5 stars with halves (BUILD §5.4). Current stars are solid gold, potential stars are outlined gold, empties are
 * strong-hairline outlines. With `showValue` the caption sits after the stars so color is never the only signal
 * (DESIGN §8): a star pair reads "Now 3.5 of 5 · could reach 4.5" once, with the band word (ScaleLabel, the same
 * 1–20 bands behind every scale) beside it, and the tooltip says the same.
 */
export function StarRating({ value, potential, size = 12, label = "Rating", showValue, className, ...rest }: StarRatingProps) {
  const current = fills(value);
  const pot = potential === undefined ? null : fills(potential);
  // The accessible name keeps its shape (ProfileHeader and its hosts read it) and says the ceiling the way the caption does
  // ("could reach"); the band word is the caption's neighbor.
  const text = `${label}: ${value} of ${STARS_SCALE}${potential === undefined ? "" : `, could reach ${potential}`}`;
  const caption = starsCaption(value, potential);
  const band = scaleWord(value, STARS_SCALE);
  return (
    <span role="img" aria-label={text} title={showValue ? caption : `${caption} · ${band}`} className={cn("inline-flex items-center gap-px align-middle", className)} {...rest}>
      {current.map((f, i) => {
        const outlined = pot ? pot[i] !== "empty" : false;
        return <StarGlyph key={i} fill={f} outlined={outlined} size={size} />;
      })}
      {showValue ? (
        <>
          <span className="ml-1.5 whitespace-nowrap text-small tabular-nums text-secondary" aria-hidden data-stars-caption>
            {caption}
          </span>
          <ScaleLabel value={value} scale={STARS_SCALE} compact aria-hidden className="ml-1.5" data-stars-band="" />
        </>
      ) : null}
    </span>
  );
}
