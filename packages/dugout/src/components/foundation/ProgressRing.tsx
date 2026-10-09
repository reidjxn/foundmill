import type { SVGAttributes } from "react";
import { cn } from "../../lib/cn";

export interface ProgressRingProps extends Omit<SVGAttributes<SVGSVGElement>, "width" | "height"> {
  /** 0–1. Omit (or pass undefined with `indeterminate`) for an indeterminate spinner. */
  value?: number;
  indeterminate?: boolean;
  /** Diameter in px (DESIGN §8 agent tile: 16). */
  size?: number;
  strokeWidth?: number;
  label?: string;
  /** Ring colour via currentColor; default inherits. The track is a strong hairline. */
  tone?: "current" | "kit" | "good" | "warn" | "bad" | "gold";
  /** A soft glow in the ring's colour: for a running process (a light source), never a static figure. */
  glow?: boolean;
}

const TONE: Record<NonNullable<ProgressRingProps["tone"]>, string> = {
  current: "",
  kit: "text-kit-lift",
  good: "text-status-good",
  warn: "text-status-warn",
  bad: "text-status-bad",
  gold: "text-gold",
};

/**
 * A circular progress indicator (DESIGN §8): a strong-hairline track, a round-capped arc in its tone that eases to each
 * new value. Exposes role=progressbar with aria-valuenow (percent). Under reduced motion the indeterminate arc rests.
 * Server-safe.
 */
export function ProgressRing({ value, indeterminate, size = 16, strokeWidth = 2, label = "Progress", tone = "current", glow, className, ...rest }: ProgressRingProps) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const v = indeterminate || value === undefined ? undefined : Math.max(0, Math.min(1, value));
  const dash = v === undefined ? c * 0.3 : c * v;
  const pct = v === undefined ? undefined : Math.round(v * 100);
  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={pct === undefined ? "Working" : `${pct}%`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      data-glow={glow || undefined}
      className={cn("inline-block shrink-0 align-middle", TONE[tone], v === undefined && "animate-spin", glow && "progress-glow", className)}
      {...rest}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-line-strong" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="progress-arc"
      />
    </svg>
  );
}
