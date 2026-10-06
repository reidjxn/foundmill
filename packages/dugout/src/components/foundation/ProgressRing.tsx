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
  /** Ring colour via currentColor; default inherits. Track is the hairline token. */
  tone?: "current" | "kit" | "good" | "warn" | "bad" | "gold";
}

const TONE: Record<NonNullable<ProgressRingProps["tone"]>, string> = {
  current: "",
  kit: "text-kit-primary",
  good: "text-status-good",
  warn: "text-status-warn",
  bad: "text-status-bad",
  gold: "text-gold",
};

/** A circular progress indicator. Exposes role=progressbar with aria-valuenow (percent). */
export function ProgressRing({ value, indeterminate, size = 16, strokeWidth = 2, label = "Progress", tone = "current", className, ...rest }: ProgressRingProps) {
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
      className={cn("inline-block shrink-0 align-middle", TONE[tone], v === undefined && "animate-spin", className)}
      {...rest}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-subtle" strokeWidth={strokeWidth} />
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
        className="transition-[stroke-dasharray] duration-panel ease-dugout"
      />
    </svg>
  );
}
