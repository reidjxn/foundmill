import type { CSSProperties, HTMLAttributes } from "react";
import { isLogoDataUrl } from "@foundmill/shared/logo";
import { cn } from "../../lib/cn";
import { isHexColour, kitOnPrimary } from "../../lib/colour";
import { initials } from "../../lib/format";

export const LOGO_SIZES = [20, 24, 32, 48, 64, 96] as const;
export type LogoSize = (typeof LOGO_SIZES)[number];

export interface BusinessLogoProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children" | "title"> {
  /**
   * The business's logo as a `data:` URL (what `business.logo.get` returns, or a checked preview). It is only ever an
   * `<img src>`; anything that is not a base64 PNG, JPEG, WebP or SVG data URL is ignored and the initials mark is drawn.
   */
  src?: string | null;
  /** The business name: the initials of the fallback mark and the accessible name. */
  name: string;
  /** Brand primary (hex): the fill of the fallback mark. */
  primary: string;
  /** One or two letters instead of the name's initials. */
  monogram?: string;
  /** Pixel size of the square. Default 32. */
  size?: LogoSize | number;
  /** Accessible name; "" makes the logo decorative. Default "<name> logo". */
  title?: string;
}

/** Corner radius of the logo tile: 22 % of its side (7 px at 32, the top bar's tile), never under 3 px (DESIGN §8 "Logo"). */
export function logoRadius(size: number): number {
  return Math.max(3, Math.round(size * 0.22));
}

/** The fallback letters: the name's initials (1–2), or "·" for an empty name. */
export function logoInitials(name: string, monogram?: string): string {
  const raw = (monogram ?? initials(name)).trim().toUpperCase();
  return Array.from(raw).slice(0, 2).join("") || "·";
}

/**
 * The business's logo (DESIGN §8 "Logo"). With a stored logo it is an `<img>` of the data URL on a white tile, clipped
 * to the logo square; without one it is the neutral mark: a lit tile in the brand's primary colour (a soft white gloss
 * at the top falling to a shade at the foot) with the business's initials in the computed on-primary colour (APCA
 * Lc ≥ 75). Never a shield. An inner ring (a 15 % white hairline and a 22 % top light) keeps it apart from a surface of
 * the same colour (the top bar). Pure, so Server Components can render it.
 */
export function BusinessLogo({ src, name, primary, monogram, size = 32, title, className, style, ...rest }: BusinessLogoProps) {
  const label = title ?? `${name || "Business"} logo`;
  const decorative = label === "";
  const radius = logoRadius(size);
  const image = isLogoDataUrl(src) ? src : null;
  const fill = isHexColour(primary) ? primary : "var(--kit-primary)";
  const ink = isHexColour(primary) ? kitOnPrimary(primary) : "var(--kit-on-primary)";
  const letters = logoInitials(name, monogram);
  const box: CSSProperties = { width: size, height: size, borderRadius: radius, ...style };
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      data-logo={image ? "image" : "initials"}
      className={cn("relative inline-flex shrink-0 overflow-hidden align-middle", image ? "bg-white" : null, className)}
      style={box}
      {...rest}
    >
      {image ? (
        <img src={image} alt="" width={size} height={size} draggable={false} className="block size-full object-contain" />
      ) : (
        <>
          <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden className="block">
            <rect width="96" height="96" fill={fill} />
            <text
              x="48"
              y="49"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="var(--font-display), 'Barlow Semi Condensed', system-ui, sans-serif"
              fontWeight={600}
              fontSize={letters.length > 1 ? 40 : 48}
              letterSpacing="-0.5"
              fill={ink}
            >
              {letters}
            </text>
          </svg>
          <span aria-hidden className="logo-gloss" data-logo-gloss="" />
        </>
      )}
      <span aria-hidden className="logo-ring" data-logo-ring="" />
    </span>
  );
}
