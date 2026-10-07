import type { SVGAttributes } from "react";
import { APP_NAME } from "@foundmill/config";
import { cn } from "../../lib/cn";
import {
  ICON_FRAME,
  MONOGRAM_F_PATH,
  MONOGRAM_HEIGHT,
  MONOGRAM_M_PATH,
  MONOGRAM_WIDTH,
  iconTransform,
} from "../../brand/marks";

export interface LogoMarkProps extends Omit<SVGAttributes<SVGSVGElement>, "width" | "height"> {
  /**
   * Height of the mark in px for the `glyph` variant (the width follows the 2.73 : 1 letter proportions);
   * the side of the square for the `tile` variant.
   */
  size?: number;
  /** Accessible name. Defaults to the product name; pass `null` to make the mark decorative. */
  label?: string | null;
  /**
   * `mono`: both letters in `currentColor`.
   * `duo`: the F in `currentColor`, the M in the kit colour (falls back to the link accent when no kit is set).
   */
  tone?: "mono" | "duo";
  /**
   * `glyph` (default): the FM letters alone on a transparent background.
   * `tile`: the letters in light text on a rounded ink square — for places that need an opaque icon
   * (app launchers, dense chrome). The tile uses `--bg-ink`; the letters use `--text-primary`.
   */
  variant?: "glyph" | "tile";
}

const DUO_FILL = "var(--kit-primary, var(--accent-link))";

/**
 * The product mark: the "FM" monogram cut from the Foundmill wordmark (see `src/brand/marks.ts`).
 * Vector, fill `currentColor`, so it inherits the surrounding text colour and stays crisp at 16 px.
 */
export function LogoMark({
  size = 24,
  label = APP_NAME,
  tone = "mono",
  variant = "glyph",
  className,
  ...rest
}: LogoMarkProps) {
  const mFill = tone === "duo" ? DUO_FILL : "currentColor";
  const a11y = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const };
  const base = cn("inline-block shrink-0 align-middle", className);

  if (variant === "tile") {
    const t = iconTransform(ICON_FRAME, 0.14);
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${ICON_FRAME} ${ICON_FRAME}`}
        focusable="false"
        className={base}
        data-variant="tile"
        {...a11y}
        {...rest}
      >
        <rect width={ICON_FRAME} height={ICON_FRAME} rx={ICON_FRAME * 0.22} fill="var(--bg-ink)" />
        <g transform={`translate(${t.x.toFixed(2)} ${t.y.toFixed(2)}) scale(${t.scale.toFixed(5)})`}>
          <path d={MONOGRAM_F_PATH} fill="var(--text-primary)" />
          <path d={MONOGRAM_M_PATH} fill={tone === "duo" ? DUO_FILL : "var(--text-primary)"} />
        </g>
      </svg>
    );
  }

  const width = Math.round((size * MONOGRAM_WIDTH) / MONOGRAM_HEIGHT);
  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${MONOGRAM_WIDTH} ${MONOGRAM_HEIGHT}`}
      focusable="false"
      className={base}
      data-variant="glyph"
      {...a11y}
      {...rest}
    >
      <path d={MONOGRAM_F_PATH} fill="currentColor" />
      <path d={MONOGRAM_M_PATH} fill={mFill} />
    </svg>
  );
}
