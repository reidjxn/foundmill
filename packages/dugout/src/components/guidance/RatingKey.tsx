/**
 * The rating legend (WP-10 T9): "1–5 Poor · 6–10 Average · 11–15 Good · 16–20 Excellent" with the four ramp swatches,
 * each swatch beside its word, once on any screen that shows a rating. Server-safe.
 */
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const RATING_KEY_WORDS = "1–5 Poor · 6–10 Average · 11–15 Good · 16–20 Excellent";

const BANDS = [
  { range: "1–5", word: "Poor", tone: "bg-rating-1" },
  { range: "6–10", word: "Average", tone: "bg-rating-2" },
  { range: "11–15", word: "Good", tone: "bg-rating-3" },
  { range: "16–20", word: "Excellent", tone: "bg-rating-4" },
] as const;

export interface RatingKeyProps extends HTMLAttributes<HTMLParagraphElement> {
  /** One tight line for a table footer. */
  compact?: boolean;
}

export function RatingKey({ compact, className, ...rest }: RatingKeyProps) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-secondary", compact && "gap-x-2", className)} data-rating-key="" {...rest}>
      {BANDS.map((b) => (
        <span key={b.word} className="inline-flex items-center gap-1.5" data-rating-band={b.word}>
          <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-xs", b.tone)} />
          <span className="tabular-nums">{b.range}</span> {b.word}
        </span>
      ))}
    </p>
  );
}
