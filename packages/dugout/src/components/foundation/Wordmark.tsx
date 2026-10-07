import type { SVGAttributes } from "react";
import { APP_NAME } from "@foundmill/config";
import { cn } from "../../lib/cn";
import { WORDMARK_HEIGHT, WORDMARK_PATH, WORDMARK_WIDTH } from "../../brand/marks";

export interface WordmarkProps extends Omit<SVGAttributes<SVGSVGElement>, "width" | "height"> {
  /** Cap height in px. The width follows the 10.97 : 1 proportions of the lettering. */
  height?: number;
  /** Accessible name. Defaults to the product name; pass `null` to make it decorative (e.g. next to visible text). */
  label?: string | null;
}

/** Aspect ratio of the wordmark (width ÷ cap height). */
export const WORDMARK_ASPECT = WORDMARK_WIDTH / WORDMARK_HEIGHT;

/**
 * The "FOUNDMILL" wordmark as a single vector path filled with `currentColor`.
 * Use `text-primary` on dark surfaces and `kit-on-primary` inside the kit bar. Minimum height 12 px.
 */
export function Wordmark({ height = 16, label = APP_NAME, className, ...rest }: WordmarkProps) {
  const width = Math.round(height * WORDMARK_ASPECT);
  const a11y = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const };
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`}
      focusable="false"
      className={cn("inline-block shrink-0 align-middle", className)}
      {...a11y}
      {...rest}
    >
      <path d={WORDMARK_PATH} fill="currentColor" />
    </svg>
  );
}
