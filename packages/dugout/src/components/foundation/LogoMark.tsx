import type { SVGAttributes } from "react";
import { cn } from "../../lib/cn";

export interface LogoMarkProps extends Omit<SVGAttributes<SVGSVGElement>, "width" | "height"> {
  size?: number;
  /** Accessible name. Decorative when omitted. */
  label?: string;
  /** Single colour (currentColor) or two-tone (accent + current). */
  tone?: "mono" | "duo";
}

/**
 * The app mark: a hexagonal field with an ascending three-step bar — a founder's trajectory,
 * drawn as plain geometry. No letters, no external references.
 */
export function LogoMark({ size = 24, label, tone = "duo", className, ...rest }: LogoMarkProps) {
  const accent = tone === "duo" ? "var(--accent-link)" : "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn("inline-block shrink-0 align-middle", className)}
      {...rest}
    >
      <path d="M16 2 L28 9 L28 23 L16 30 L4 23 L4 9 Z" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" />
      <rect x="9" y="18" width="4" height="6" rx="0.5" fill="currentColor" opacity={0.55} />
      <rect x="14" y="13" width="4" height="11" rx="0.5" fill="currentColor" opacity={0.8} />
      <rect x="19" y="8" width="4" height="16" rx="0.5" fill={accent} />
    </svg>
  );
}
