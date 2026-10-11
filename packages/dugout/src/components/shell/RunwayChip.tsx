import { Calendar, Hourglass, TriangleAlert } from "lucide-react";
import type { Money } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { DATE_FORMATS, formatDate, formatMoney, formatNumber } from "../../lib/format";
import { Icon } from "../foundation/Icon";
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

/** The words for a missing runway figure and why there is none. */
export interface RunwayWords {
  /** "No limit" (cash-flow positive), "Not known yet". */
  value: string;
  /** The reason, shown as the tooltip: "Cash-flow positive, so no limit yet", "Connect a bank to estimate it". */
  caption: string;
}

/** Said when the app passes no words: the runway is not known until a finance source is connected. */
export const RUNWAY_UNKNOWN_WORDS: RunwayWords = { value: "Not known yet", caption: "Runway unknown until a bank or finance source is connected" };

export interface RunwayChipProps {
  /** Today, for the date part. */
  date: Date | string | number;
  /** Months of runway; null when unknown (no bank or finance data yet). */
  runwayMonths: number | null | undefined;
  /**
   * The words when there is no figure, so the chip says what Home's tiles say (the app passes the shared runway
   * wording: "No limit" when cash-flow positive, "Not known yet" with the reason). Defaults to "Not known yet".
   */
  words?: RunwayWords | null;
  /** Cash on hand, shown in the tooltip. */
  cash?: Money;
  /** Runway is derived from a burn model rather than a ledger (DESIGN §10: label non-real numbers). Default true. */
  estimate?: boolean;
  onClick?: () => void;
  className?: string;
}

const TONE_TEXT: Record<RunwayTone, string> = { neutral: "", warn: "text-status-warn", bad: "text-status-bad" };

/**
 * The date + runway chip on the brand slab (DESIGN §8): glass, 34 px — "Oct 9, 2026 · 14 mo" with the dashed "Estimate"
 * tag (a dashed edge always means "not measured"). The runway follows the horizon rule: amber under 9 months, red under
 * 6, with a warning icon and a tinted ring, so the state never rests on color alone. Without a figure it says why in
 * words, the same words as Home's tiles ("No limit", "Not known yet"), with the reason as its tooltip; never a bare dash.
 */
export function RunwayChip({ date, runwayMonths, words, cash, estimate = true, onClick, className }: RunwayChipProps) {
  const tone = runwayTone(runwayMonths);
  const runway = formatRunway(runwayMonths);
  const known = runwayMonths !== null && runwayMonths !== undefined && Number.isFinite(runwayMonths);
  const said = words ?? RUNWAY_UNKNOWN_WORDS;
  const dateText = formatDate(date);
  const dayMonth = formatDate(date, DATE_FORMATS.dayMonth);
  const year = formatDate(date, "yyyy");
  const tip = [
    cash ? `Cash ${formatMoney(cash)}` : null,
    known ? `Runway ${runway}${estimate ? " (Estimate)" : ""}` : said.caption,
    tone === "bad" ? "Under 6 months: the runway horizon is red" : tone === "warn" ? "Under 9 months: the runway horizon is amber" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const label = known ? `${dateText}. Runway ${runway}${estimate ? ", estimate" : ""}${tone === "bad" ? ", critical" : tone === "warn" ? ", low" : ""}` : `${dateText}. Runway: ${said.value}. ${said.caption}`;
  const content = (
    <>
      {/* The date gives way in the top bar's last compaction step; the year goes first (KitBarFit). */}
      <span className="kitbar-date">
        <Icon icon={Calendar} size="inline" />
        <span className="tabular-nums">
          {dayMonth}
          <span className="kitbar-year">, {year}</span>
        </span>
        <span aria-hidden className="opacity-45">
          ·
        </span>
      </span>
      <span className={cn("inline-flex items-center gap-1.5", TONE_TEXT[tone])}>
        <Icon icon={tone === "neutral" ? Hourglass : TriangleAlert} size="inline" className={tone === "neutral" ? undefined : "text-current"} />
        {known ? <span className="tabular-nums">{runway}</span> : <span data-runway-words="">{said.value}</span>}
      </span>
      {estimate && known ? (
        <span className="kitbar-est" title="Estimate">
          Estimate
        </span>
      ) : null}
    </>
  );
  const common = { "aria-label": label, "data-runway-tone": tone, "data-chip": "", className: cn("kitbar-glass", className) };
  return (
    <Tooltip content={tip}>
      {onClick ? (
        <button type="button" onClick={onClick} {...common}>
          {content}
        </button>
      ) : (
        <span role="group" {...common}>
          {content}
        </span>
      )}
    </Tooltip>
  );
}
