"use client";
import { forwardRef, useId, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { area as d3Area, curveMonotoneX, line as d3Line } from "d3-shape";
import { Info, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  formatCompact,
  formatMoney,
  formatNumber,
  formatPercent,
} from "../../lib/format";
import { ProvenanceChip, type ProvenanceKind } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { Skeleton } from "../foundation/Skeleton";
import { useFormatters } from "../foundation/DateFormatProvider";
import { FitText } from "../foundation/FitText";
import { Tooltip } from "../foundation/Tooltip";
import { PlainFigure } from "../guidance/PlainFigure";
import { Figure } from "./Figure";
import type { MetricDelta, MetricProvenance, MetricValue } from "./types";

export interface MetricTileProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Label caption (label style). */
  label: ReactNode;
  /** Number, money or preformatted string. */
  value: MetricValue | null | undefined;
  /** Number formatting when `value` is a number: "compact" (1.2K), "percent" (0.12 → 12%), "integer", "decimal". */
  format?: "compact" | "percent" | "integer" | "decimal";
  unit?: string;
  delta?: MetricDelta;
  /** A full-width sparkline at the foot of the tile. */
  spark?: readonly number[];
  provenance?: MetricProvenance;
  /** "Forecast" or "Estimate" chip next to the number (DESIGN §10). */
  estimate?: ProvenanceKind;
  /** Secondary line in small style. */
  caption?: ReactNode;
  /**
   * The figure in plain words, under it (PlainFigure, UX plan §6.2): "How many months your cash lasts at today's
   * spending." Hidden when guidance is off. `metricId` reads the line from the definitions map instead.
   */
  plain?: ReactNode;
  metricId?: string;
  loading?: boolean;
  /**
   * Makes the whole tile clickable: a button covers the tile (named by its label and value) and the provenance button
   * sits above it, so no button is ever nested in another.
   */
  onClick?: () => void;
  size?: "md" | "lg";
}

export function formatMetricValue(
  value: MetricValue | null | undefined,
  format: MetricTileProps["format"] = "compact",
): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "object")
    return formatMoney(value, { compact: Math.abs(value.amountMinor) >= 1_000_000 });
  switch (format) {
    case "percent":
      return formatPercent(value, { digits: Math.abs(value) < 0.1 ? 1 : 0 });
    case "integer":
      return formatNumber(value, { maxDigits: 0 });
    case "decimal":
      return formatNumber(value, { maxDigits: 1 });
    default:
      return formatCompact(value);
  }
}

export function deltaTone(delta: MetricDelta): "good" | "bad" | "neutral" {
  if (!Number.isFinite(delta.value) || delta.value === 0 || delta.goodWhen === "neutral")
    return "neutral";
  const up = delta.value > 0;
  const goodUp = (delta.goodWhen ?? "up") === "up";
  return up === goodUp ? "good" : "bad";
}

function deltaParts(delta: MetricDelta): { word: string; body: string; flat: boolean; up: boolean } {
  const up = delta.value > 0;
  const flat = delta.value === 0 || !Number.isFinite(delta.value);
  const abs = Math.abs(delta.value);
  const body = delta.percent
    ? formatPercent(abs, { digits: 1 })
    : abs < 1000
      ? formatNumber(abs, { maxDigits: abs < 10 ? 1 : 0 })
      : formatCompact(abs);
  return { word: flat ? "no change" : up ? "up" : "down", body, flat, up };
}

/** The change in words, as a screen reader hears it: "up 19 vs last week", "no change vs last month". */
export function deltaWords(delta: MetricDelta): string {
  const { word, body, flat } = deltaParts(delta);
  return `${word}${flat ? "" : ` ${body}`}${delta.label ? ` ${delta.label}` : ""}`;
}

/**
 * The change since the last period as a status pill (DESIGN §8): one trend icon and the figure in the delta's own tone,
 * the comparison in the pill ("↗ 439% vs prior week"). The word "up"/"down" is read out with the visible figure and
 * comparison (screen-reader-only text, not an aria-label on a span, which assistive tech ignores), so colour and icon
 * are never the only signal.
 */
export function DeltaBadge({ delta, className, id }: { delta: MetricDelta; className?: string; id?: string }) {
  const tone = deltaTone(delta);
  const { word, body, flat, up } = deltaParts(delta);
  return (
    <span
      className={cn(
        "chip-tone inline-flex h-badge max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-pill border pl-1 pr-1.5 font-body text-small font-medium tabular-nums",
        tone === "good" && "tone-status-good text-status-good",
        tone === "bad" && "tone-status-bad text-status-bad",
        tone === "neutral" && "tone-secondary text-secondary",
        className,
      )}
      id={id}
      data-tone={tone}
      data-delta=""
    >
      <Icon icon={flat ? Minus : up ? TrendingUp : TrendingDown} size={12} strokeWidth={2} />
      <span className="sr-only">{word} </span>
      {/* A flat change reads as "no change": the visible 0 would only repeat it. */}
      <span aria-hidden={flat || undefined}>{flat ? "0" : body}</span>
      {delta.label ? <span className="font-normal opacity-80">{delta.label}</span> : null}
    </span>
  );
}

function ProvenanceTip({ p }: { p: MetricProvenance }) {
  const { formatDateTime } = useFormatters();
  return (
    <div className="flex flex-col gap-0.5">
      <span className="t-label">Source</span>
      <span>{p.source}</span>
      {p.query ? <code className="font-mono text-mono text-secondary">{p.query}</code> : null}
      {p.asOf ? <span className="text-secondary">As of {formatDateTime(p.asOf)}</span> : null}
      {p.note ? <span className="text-secondary">{p.note}</span> : null}
    </div>
  );
}

/** The compact copy of a figure that does not fit even at its floor ("£1,234,567.00" → "£1.2M"). */
function compactFallback(value: MetricValue | null | undefined, text: string): string | undefined {
  if (value === null || value === undefined || typeof value === "string") return undefined;
  const compact = typeof value === "object" ? formatMoney(value, { compact: true }) : formatCompact(value);
  return compact === text ? undefined : compact;
}

/**
 * A tile sparkline: the full width of the tile, 20 px tall, a monotone line with a three-stop fill and a haloed dot at
 * "now". Drawn in a 100-unit viewBox stretched to the tile (strokes keep their width), the dot in HTML so it stays
 * round. Colour from currentColor.
 */
export function TileSpark({ data, label, className }: { data: readonly number[]; label?: string; className?: string }) {
  const id = useId();
  const n = data.length;
  if (n < 2) return null;
  let lo = Math.min(...data);
  let hi = Math.max(...data);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (hi === lo) {
    lo -= 0.5;
    hi += 0.5;
  }
  const H = 20;
  const pad = 3;
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  const pts = data.map((v, i) => [x(i), y(v)] as [number, number]);
  const line = d3Line<[number, number]>().curve(curveMonotoneX)(pts) ?? "";
  const area =
    d3Area<[number, number]>()
      .y0(H)
      .curve(curveMonotoneX)(pts) ?? "";
  const last = pts[n - 1] as [number, number];
  const first = data[0];
  const end = data[n - 1];
  return (
    <span role="img" aria-label={label ?? `${n} points, from ${first} to ${end}`} className={cn("relative block h-5 w-full", className)} data-tile-spark="">
      <svg aria-hidden width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="block overflow-visible">
        <defs>
          <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.24} />
            <stop offset="55%" stopColor="currentColor" stopOpacity={0.07} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id}-f)`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        aria-hidden
        className="spark-dot absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: "100%", top: `${(last[1] / H) * 100}%` }}
      />
    </span>
  );
}

/**
 * MetricTile (DESIGN §9, Mission "lg"): a caps data label, a 30 px figure with dimmed raised currency, dimmed decimals
 * and unit, the dashed Estimate / Forecast chip with the word in full, the delta as a tone pill, a caption that wraps
 * (never cut) and a full-width sparkline at the foot. The figure fits its tile: it steps down, then falls back to the
 * compact form ("£1.2M"); it is never clipped. Big numbers never animate digit by digit. The tile is a plain container
 * (a StatusStrip gives it `role="listitem"`); when clickable it holds a covering button.
 */
export const MetricTile = forwardRef<HTMLDivElement, MetricTileProps>(function MetricTile(
  {
    label,
    value,
    format,
    unit,
    delta,
    spark,
    provenance,
    estimate,
    caption,
    plain,
    metricId,
    loading,
    onClick,
    size = "md",
    className,
    ...rest
  },
  ref,
) {
  const text = formatMetricValue(value, format);
  const fallback = compactFallback(value, text);
  const id = useId();
  const tone = delta ? deltaTone(delta) : "neutral";
  const sparkTone = tone === "good" ? "text-status-good" : tone === "bad" ? "text-status-bad" : "text-kit-lift";
  return (
    <div
      ref={ref}
      aria-busy={loading || undefined}
      data-metric-tile
      className={cn(
        "relative flex min-w-0 flex-col gap-1.5 bg-panel px-panel-pad pb-3 pt-2.5 text-left",
        onClick && "cursor-pointer transition-colors duration-hover ease-out hover:bg-white/2",
        className,
      )}
      {...rest}
    >
      {onClick ? (
        <button
          type="button"
          onClick={() => onClick()}
          // Named in plain words: the figure's parts are separate spans, which some readers space out ("€ 1,840 .00").
          // The change is part of the name ("Customers this week 55, up 19 vs last week"): the button covers the tile.
          aria-label={typeof label === "string" || typeof label === "number" ? `${label} ${text}${unit ? ` ${unit}` : ""}${delta ? `, ${deltaWords(delta)}` : ""}` : undefined}
          aria-labelledby={typeof label === "string" || typeof label === "number" ? undefined : `${id}-label ${id}-value${delta ? ` ${id}-delta` : ""}`}
          data-metric-action
          className="absolute inset-0 cursor-pointer focus-ring"
        />
      ) : null}
      <div className="flex min-h-badge items-start gap-1">
        <span id={`${id}-label`} className="t-data min-w-0 flex-1 break-words pt-0.5" data-metric-label>
          {label}
        </span>
        {provenance ? (
          <Tooltip content={<ProvenanceTip p={provenance} />} side="top" align="end">
            {/* A 24 px target (WCAG 2.5.8) above the tile's own button; the negative margins keep the label row's height. */}
            <button
              type="button"
              className="in-data-[phone]:tap-reach relative z-10 -my-1 -mr-1.5 inline-flex size-target shrink-0 items-center justify-center rounded-pill text-tertiary transition-colors duration-hover hover:bg-white/6 hover:text-primary focus-ring"
              aria-label={`Where this number comes from: ${provenance.source}`}
            >
              <Icon icon={Info} size={13} />
            </button>
          </Tooltip>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className={cn("w-2/3", size === "lg" ? "h-10" : "h-8")} />
      ) : (
        <PlainFigure plain={plain} metricId={metricId}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <FitText
              className={cn(size === "lg" ? "t-display-xl" : "t-display-lg", "text-primary")}
              text={unit ? `${text} ${unit}` : text}
              truncate={false}
              fallback={fallback && unit ? `${fallback} ${unit}` : fallback}
              tooltip={false}
            >
              <Figure id={`${id}-value`} value={text} unit={unit} data-value={text} />
            </FitText>
            {estimate ? <ProvenanceChip kind={estimate} className="relative z-10 ml-0.5" /> : null}
            {delta ? <DeltaBadge delta={delta} id={`${id}-delta`} /> : null}
          </div>
        </PlainFigure>
      )}
      {caption ? (
        <span className="line-clamp-2 min-w-0 text-small text-secondary" title={typeof caption === "string" ? caption : undefined} data-metric-caption>
          {caption}
        </span>
      ) : null}
      {spark && spark.length > 1 ? <TileSpark data={spark} className={cn("mt-auto pt-1", sparkTone)} /> : null}
    </div>
  );
});

export const STATUS_STRIP_MAX = 6;

export interface StatusStripProps extends HTMLAttributes<HTMLDivElement> {
  /** Up to six tiles; extra tiles are dropped. */
  tiles: readonly MetricTileProps[];
  /** Grow to fill a flex parent (a widget body) so the sparklines sit on the strip's floor. */
  fill?: boolean;
  /**
   * Wrap two tiles to a row while the strip's container (the shell) is narrower than `page-wide` (a phone), keeping one
   * row at every wider width. Opt in: strips inside widget tiles keep their single row (Today, package 2.1).
   */
  wrap?: boolean;
}

/**
 * A row of ≤ 6 MetricTiles on one plate, separated by hairlines that fade at both ends (Home status strip, Inbox
 * reading pane). Inside a panel pass `rounded-none border-0`.
 */
export function StatusStrip({ tiles, fill, wrap, className, style, ...rest }: StatusStripProps) {
  const shown = tiles.slice(0, STATUS_STRIP_MAX);
  const columns = `repeat(${Math.max(1, shown.length)}, minmax(0, 1fr))`;
  return (
    <div
      role="list"
      className={cn("grid overflow-hidden rounded-md border border-line bg-surface-1", fill && "min-h-0 flex-1", wrap && "grid-cols-2 @page-wide:[grid-template-columns:var(--strip-columns)]", className)}
      style={wrap ? ({ "--strip-columns": columns, ...style } as CSSProperties) : { gridTemplateColumns: columns, ...style }}
      data-wrap={wrap || undefined}
      data-status-strip
      {...rest}
    >
      {shown.map((t, i) => (
        <MetricTile
          key={i}
          role="listitem"
          {...t}
          className={cn("bg-transparent", i > 0 && "strip-divider", wrap && i % 2 === 0 && "@max-page-wide:before:hidden", wrap && i >= 2 && "@max-page-wide:border-t @max-page-wide:border-line", wrap && i === shown.length - 1 && shown.length % 2 === 1 && "@max-page-wide:col-span-2", t.className)}
        />
      ))}
    </div>
  );
}
