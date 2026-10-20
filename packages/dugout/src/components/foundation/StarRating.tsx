import type { HTMLAttributes } from "react";
import { Star } from "lucide-react";
import { cn } from "../../lib/cn";

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
   * Show the value after the stars so color is not the only signal: with a potential, the caption "Now 3.5 · could
   * reach 4.5" (UX plan §6.2 ScaleLabel); without one, the value alone.
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

/** The caption under a star pair: "Now 3.5 · could reach 4.5" (or "Now 3.5" with no potential). */
export function starsCaption(value: number, potential?: number): string {
  return potential === undefined ? `Now ${value}` : `Now ${value} · could reach ${potential}`;
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
 * strong-hairline outlines. With `showValue` the number sits after the stars so color is never the only signal
 * (DESIGN §8): a star pair reads "Now 3.5 · could reach 4.5" once, and the tooltip says the same.
 */
export function StarRating({ value, potential, size = 12, label = "Rating", showValue, className, ...rest }: StarRatingProps) {
  const current = fills(value);
  const pot = potential === undefined ? null : fills(potential);
  const text = potential === undefined ? `${label}: ${value} of 5` : `${label}: ${value} of 5, potential ${potential}`;
  const caption = starsCaption(value, potential);
  return (
    <span role="img" aria-label={text} title={potential === undefined ? text : caption} className={cn("inline-flex items-center gap-px align-middle", className)} {...rest}>
      {current.map((f, i) => {
        const outlined = pot ? pot[i] !== "empty" : false;
        return <StarGlyph key={i} fill={f} outlined={outlined} size={size} />;
      })}
      {/* TODO(guided-layer): ScaleLabel owns this caption once the guidance primitives land. */}
      {showValue ? (
        potential === undefined ? (
          <span className="ml-1.5 font-mono text-mono tabular-nums text-tertiary" aria-hidden>
            {value}
          </span>
        ) : (
          <span className="ml-1.5 whitespace-nowrap text-small tabular-nums text-secondary" aria-hidden data-stars-caption>
            {caption}
          </span>
        )
      ) : null}
    </span>
  );
}
