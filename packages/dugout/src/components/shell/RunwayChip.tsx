import { Calendar, Hourglass, TriangleAlert } from "lucide-react";
import type { Money } from "@founder-manager/shared";
import { cn } from "../../lib/cn";
import { formatDate, formatMoney, formatNumber } from "../../lib/format";
import { Chip, type ChipTone } from "../foundation/Chip";
import { Tooltip } from "../foundation/Tooltip";

export type RunwayTone = "neutral" | "warn" | "bad";

/** DESIGN §8 (runway horizon): neutral, amber under 9 months, red under 6. */
export const RUNWAY_WARN_MONTHS = 9;
export const RUNWAY_BAD_MONTHS = 6;

export function runwayTone(months: number | null | undefined): RunwayTone {
  if (months === null || months === undefined || !Number.isFinite(months)) return "neutral";
  if (months < RUNWAY_BAD_MONTHS) return "bad";
  if (months < RUNWAY_WARN_MONTHS) return "warn";
  return "neutral";
}

/** "11 mo", "5.5 mo", "—" */
export function formatRunway(months: number | null | undefined): string {
  if (months === null || months === undefined || !Number.isFinite(months)) return "—";
  return `${formatNumber(months, { maxDigits: months < 10 ? 1 : 0 })} mo`;
}

export interface RunwayChipProps {
  /** Today, for the date part. */
  date: Date | string | number;
  /** Months of runway; null when unknown (no bank or finance data yet). */
  runwayMonths: number | null | undefined;
  /** Cash on hand, shown in the tooltip. */
  cash?: Money;
  /** Runway is derived from a burn model rather than a ledger (DESIGN §10: label non-real numbers). Default true. */
  estimate?: boolean;
  onClick?: () => void;
  className?: string;
}

const TONE_CLASS: Record<RunwayTone, ChipTone> = { neutral: "ink", warn: "warn", bad: "bad" };

/** Date + runway chip for the kit bar: "7 Oct 2026 · Runway 11 mo". The tone follows the runway horizon rule. */
export function RunwayChip({ date, runwayMonths, cash, estimate = true, onClick, className }: RunwayChipProps) {
  const tone = runwayTone(runwayMonths);
  const runway = formatRunway(runwayMonths);
  const dateText = formatDate(date);
  const tip = [
    cash ? `Cash ${formatMoney(cash)}` : null,
    runwayMonths === null || runwayMonths === undefined ? "Runway unknown until a bank or finance source is connected" : `Runway ${runway}${estimate ? " (Estimate)" : ""}`,
    tone === "bad" ? "Under 6 months: the runway horizon is red" : tone === "warn" ? "Under 9 months: the runway horizon is amber" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Tooltip content={tip}>
      <Chip
        tone={TONE_CLASS[tone]}
        icon={tone === "neutral" ? Calendar : TriangleAlert}
        onClick={onClick}
        className={cn("gap-1.5", className)}
        aria-label={`${dateText}. Runway ${runway}${estimate ? ", estimate" : ""}${tone === "bad" ? ", critical" : tone === "warn" ? ", low" : ""}`}
        data-runway-tone={tone}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="tabular-nums">{dateText}</span>
          <span aria-hidden className="opacity-50">
            ·
          </span>
          <span className="inline-flex items-center gap-0.5 tabular-nums">
            <Hourglass size={11} strokeWidth={1.75} aria-hidden focusable="false" />
            {runway}
          </span>
          {estimate && runwayMonths !== null && runwayMonths !== undefined ? (
            <span className="rounded-chip border border-current px-0.5 text-label leading-none opacity-70" title="Estimate">
              Est.
            </span>
          ) : null}
        </span>
      </Chip>
    </Tooltip>
  );
}
