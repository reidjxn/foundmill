"use client";
import { Calendar, Hourglass, TriangleAlert } from "lucide-react";
import type { Money } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { formatMoney, formatNumber } from "../../lib/format";
import { useFormatters } from "../foundation/DateFormatProvider";
import { Icon } from "../foundation/Icon";
import { Tooltip } from "../foundation/Tooltip";
import { useTerm, type TermDefinition } from "../guidance/GuidanceProvider";
import { KITBAR_BRIEF_CLASS } from "./ModeChip";

export type RunwayTone = "neutral" | "warn" | "bad";

/** DESIGN §8 (runway horizon): neutral, amber under 9 months, red under 6. */
export const RUNWAY_WARN_MONTHS = 9;
export const RUNWAY_BAD_MONTHS = 6;

/**
 * The first tooltip line: the word and what it means, before any figure (docs/UX_AUDIT_AND_PLAN.md §7.7, B8). Inside the
 * app it is the definitions map's own sentence (`runwayTooltipLead(TERMS.runway)`, the business's words applied); this
 * is the line outside a provider. The chip is a button, so its tooltip carries the definition rather than a Term.
 */
export const RUNWAY_TOOLTIP_LEAD = "Runway: how many months your cash lasts";

/** "Runway: how many months your cash lasts at today's spending" from a definition (word + short, the period dropped). */
export function runwayTooltipLead(def: Pick<TermDefinition, "word" | "short"> | undefined): string {
  if (!def) return RUNWAY_TOOLTIP_LEAD;
  const short = def.short.trim().replace(/\.$/, "");
  return `${def.word}: ${short.charAt(0).toLowerCase()}${short.slice(1)}`;
}

/** A figure the chip can show: finite and not negative (cash below zero has no runway to count; the words say so). */
export function isRunwayFigure(months: number | null | undefined): months is number {
  return months !== null && months !== undefined && Number.isFinite(months) && months >= 0;
}

export function runwayTone(months: number | null | undefined): RunwayTone {
  if (!isRunwayFigure(months)) return "neutral";
  if (months < RUNWAY_BAD_MONTHS) return "bad";
  if (months < RUNWAY_WARN_MONTHS) return "warn";
  return "neutral";
}

/** "11 mo", "5.5 mo", "—" */
export function formatRunway(months: number | null | undefined): string {
  if (!isRunwayFigure(months)) return "—";
  return `${formatNumber(months, { maxDigits: months < 10 ? 1 : 0 })} mo`;
}

/** The words for a missing runway figure and why there is none. */
export interface RunwayWords {
  /** "Not running out" (cash-flow positive), "Not known yet", "Cash is below zero". */
  value: string;
  /** The reason, shown in the tooltip: "You earn more than you spend", "Not enough data yet: connect your bank". */
  caption: string;
  /** A short form of the reason the chip carries inline at the widest top-bar step: "connect a bank". */
  brief?: string;
  /** The words describe a worked-out state, not a measured one: the chip keeps its dashed "Estimate" tag. */
  estimate?: boolean;
}

/** Said when the app passes no words: the runway is not known until a finance source is connected. */
export const RUNWAY_UNKNOWN_WORDS: RunwayWords = { value: "Not known yet", caption: "Runway unknown until a bank or finance source is connected", brief: "connect a bank" };

export interface RunwayChipProps {
  /**
   * Today, for the date part. Null leaves the date out: the app passes null until the browser knows the founder's own
   * day, because the server renders in UTC and a US evening is already tomorrow there (a hydration mismatch).
   */
  date: Date | string | number | null;
  /** Months of runway; null when unknown (no bank or finance data yet). A negative figure reads as no figure. */
  runwayMonths: number | null | undefined;
  /**
   * The words when there is no figure, so the chip says what Home's tiles say (the app passes the shared runway
   * wording: "Not running out" when cash-flow positive, "Not known yet" with the reason, "Cash is below zero"). Defaults to
   * "Not known yet".
   */
  words?: RunwayWords | null;
  /** Cash on hand, shown in the tooltip. */
  cash?: Money;
  /** Runway is derived from a burn model rather than a ledger (DESIGN §10: label non-real numbers). Default true. */
  estimate?: boolean;
  onClick?: () => void;
  className?: string;
  /** Draws the date alone: no runway words, no tag. A project with no bank and no payment has no runway to talk about (WP-10 T2). */
  dateOnly?: boolean;
}

const TONE_TEXT: Record<RunwayTone, string> = { neutral: "", warn: "text-status-warn", bad: "text-status-bad" };

/** The tooltip's lines, in order: the word and its meaning, the value with its reason, the horizon note. Exported for tests. */
export function runwayTooltipLines(input: { runwayMonths: number | null | undefined; words?: RunwayWords | null; cash?: Money; estimate?: boolean; lead?: string }): string[] {
  const known = isRunwayFigure(input.runwayMonths);
  const said = input.words ?? RUNWAY_UNKNOWN_WORDS;
  const tone = runwayTone(input.runwayMonths);
  const estimate = input.estimate ?? true;
  const value = known ? `${formatRunway(input.runwayMonths)}${estimate ? " (Estimate)" : ""}` : `${said.value}${said.estimate && estimate ? " (Estimate)" : ""} · ${said.caption}`;
  const cash = input.cash ? `Cash ${formatMoney(input.cash)}` : null;
  const horizon = tone === "bad" ? "Under 6 months: the runway horizon is red" : tone === "warn" ? "Under 9 months: the runway horizon is amber" : null;
  return [input.lead ?? RUNWAY_TOOLTIP_LEAD, [value, cash].filter(Boolean).join(" · "), horizon].filter((l): l is string => Boolean(l));
}

/**
 * The date + runway chip on the brand slab (DESIGN §8): glass, 34 px — "Oct 9, 2026 · 14 mo" (the date in the signed-in
 * person's format: "9 Oct 2026", "2026-10-09"; DateFormatProvider) with the dashed "Estimate"
 * tag (a dashed edge always means "not measured"). The runway follows the horizon rule: amber under 9 months, red under
 * 6, with a warning icon and a tinted ring, so the state never rests on color alone. Without a figure it says why in
 * words, the same words as Home's tiles ("Not running out", "Not known yet", "Cash is below zero"), the short reason inline at
 * the widest top-bar step ("Not known yet · connect a bank") and the whole reason in the tooltip, whose first line says
 * what runway is; never a bare dash.
 */
export function RunwayChip({ date, runwayMonths, words, cash, estimate = true, onClick, className, dateOnly = false }: RunwayChipProps) {
  const tone = runwayTone(runwayMonths);
  const runway = formatRunway(runwayMonths);
  const known = isRunwayFigure(runwayMonths);
  const said = words ?? RUNWAY_UNKNOWN_WORDS;
  const { formatDate, formatDateYearParts } = useFormatters();
  const hasDate = date !== null && date !== undefined;
  const dateText = hasDate ? formatDate(date) : "";
  // The year sits apart so the top bar can drop it first: "Oct 9" + ", 2026", "9 Oct" + " 2026", "2026-" + "10-09".
  const parts = hasDate ? formatDateYearParts(date) : null;
  const lead = runwayTooltipLead(useTerm("runway"));
  const showEstimate = estimate && (known || said.estimate === true);
  // The dashed "Estimate" tag sits inside the chip (a button when clickable), so its definition is the tooltip's last line.
  const estimateDef = useTerm("estimate");
  const lines = runwayTooltipLines({ runwayMonths, words, cash, estimate, lead });
  if (showEstimate && estimateDef) lines.push(`${estimateDef.word}: ${estimateDef.short.charAt(0).toLowerCase()}${estimateDef.short.slice(1)}`);
  const tip = (
    <span className="flex flex-col gap-0.5">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
  if (dateOnly) {
    if (!hasDate) return null;
    return (
      <span role="group" aria-label={dateText} data-chip="" className={cn("kitbar-glass", className)}>
        <span className="kitbar-date">
          <Icon icon={Calendar} size="inline" />
          <span className="tabular-nums" data-testid="kitbar-date">
            {parts?.lead ? <span className="kitbar-year">{parts.lead}</span> : null}
            {parts?.core}
            {parts?.tail ? <span className="kitbar-year">{parts.tail}</span> : null}
          </span>
        </span>
      </span>
    );
  }
  const runwayLabel = known ? `Runway ${runway}${estimate ? ", estimate" : ""}${tone === "bad" ? ", critical" : tone === "warn" ? ", low" : ""}` : `Runway: ${said.value}. ${said.caption}`;
  const label = hasDate ? `${dateText}. ${runwayLabel}` : runwayLabel;
  const content = (
    <>
      {/* The date gives way in the top bar's last compaction step; the year goes first (KitBarFit). */}
      {hasDate ? (
        <span className="kitbar-date">
          <Icon icon={Calendar} size="inline" />
          <span className="tabular-nums" data-testid="kitbar-date">
            {parts?.lead ? <span className="kitbar-year">{parts.lead}</span> : null}
            {parts?.core}
            {parts?.tail ? <span className="kitbar-year">{parts.tail}</span> : null}
          </span>
          <span aria-hidden className="opacity-45">
            ·
          </span>
        </span>
      ) : null}
      <span className={cn("inline-flex items-center gap-1.5", TONE_TEXT[tone])}>
        <Icon icon={tone === "neutral" ? Hourglass : TriangleAlert} size="inline" className={tone === "neutral" ? undefined : "text-current"} />
        {known ? <span className="tabular-nums">{runway}</span> : <span data-runway-words="">{said.value}</span>}
        {/* The short reason, at the widest step only (the tooltip and the label carry the whole reason). */}
        {!known && said.brief ? (
          <span aria-hidden className={cn("font-normal opacity-80", KITBAR_BRIEF_CLASS)} data-runway-brief>
            · {said.brief}
          </span>
        ) : null}
      </span>
      {showEstimate ? (
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
