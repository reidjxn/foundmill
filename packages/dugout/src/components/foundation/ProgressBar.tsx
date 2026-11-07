import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type ProgressBarTone = "kit" | "good" | "warn" | "bad" | "gold";

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Where it stands now, on the same scale as `max` (a count, minor units): clamped to 0…max. */
  value: number;
  /** The whole (the goal's target). Default 1. */
  max?: number;
  /** The accessible name ("Goal progress"). */
  label: string;
  /** What a screen reader hears for the value ("4 of 10 paying customers"); default "<pct>%". */
  valueText?: string;
  /** The fill's tone: the brand's lift by default; status tones for on pace, behind and missed; gold once reached. */
  tone?: ProgressBarTone;
  /** 4 px (sm, default) or 6 px (md, a panel's lead figure). */
  size?: "sm" | "md";
}

const TONE: Record<ProgressBarTone, string> = {
  kit: "tone-kit-lift",
  good: "tone-status-good",
  warn: "tone-status-warn",
  bad: "tone-status-bad",
  gold: "tone-gold",
};

/**
 * A linear progress bar (DESIGN §8, Today's goal): a faint track and a round-capped fill in its tone that eases to each
 * new value. role=progressbar with aria-valuemin 0, aria-valuemax `max` and aria-valuenow `value` (clamped), plus the
 * value in words. Color is never the only signal: the figure sits beside it in words. Server-safe.
 */
export function ProgressBar({ value, max = 1, label, valueText, tone = "kit", size = "sm", className, style, ...rest }: ProgressBarProps) {
  const whole = Number.isFinite(max) && max > 0 ? max : 1;
  const now = Math.max(0, Math.min(whole, Number.isFinite(value) ? value : 0));
  const share = now / whole;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={whole}
      aria-valuenow={now}
      aria-valuetext={valueText ?? `${Math.round(share * 100)}%`}
      data-progress-bar=""
      data-size={size}
      data-tone={tone}
      className={cn("progress-track", TONE[tone], className)}
      style={{ ...style, "--progress": share } as CSSProperties}
      {...rest}
    >
      <span data-progress-fill="" aria-hidden />
    </div>
  );
}
