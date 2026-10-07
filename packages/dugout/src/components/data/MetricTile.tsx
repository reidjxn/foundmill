import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Info, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  formatCompact,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
} from "../../lib/format";
import { ProvenanceChip, type ProvenanceKind } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { Skeleton } from "../foundation/Skeleton";
import { Sparkline } from "../foundation/Sparkline";
import { Tooltip } from "../foundation/Tooltip";
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
  /** 48 px sparkline under the number. */
  spark?: readonly number[];
  provenance?: MetricProvenance;
  /** "Forecast" or "Estimate" chip next to the number (DESIGN §10). */
  estimate?: ProvenanceKind;
  /** Secondary line in small style. */
  caption?: ReactNode;
  loading?: boolean;
  /** Tile becomes a button. */
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

export function DeltaBadge({ delta, className }: { delta: MetricDelta; className?: string }) {
  const tone = deltaTone(delta);
  const up = delta.value > 0;
  const flat = delta.value === 0 || !Number.isFinite(delta.value);
  const abs = Math.abs(delta.value);
  const body = delta.percent
    ? formatPercent(abs, { digits: 1 })
    : abs < 1000
      ? formatNumber(abs, { maxDigits: abs < 10 ? 1 : 0 })
      : formatCompact(abs);
  const word = flat ? "no change" : up ? "up" : "down";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-small tabular-nums",
        tone === "good" && "text-status-good",
        tone === "bad" && "text-status-bad",
        tone === "neutral" && "text-secondary",
        className,
      )}
      aria-label={`${word} ${flat ? "" : body}${delta.label ? ` ${delta.label}` : ""}`.trim()}
      data-tone={tone}
    >
      <Icon icon={flat ? Minus : up ? TrendingUp : TrendingDown} size={12} />
      <span aria-hidden>
        {flat ? "—" : up ? "▲" : "▼"} {flat ? "0" : body}
      </span>
      {delta.label ? <span className="text-secondary">{delta.label}</span> : null}
    </span>
  );
}

function ProvenanceTip({ p }: { p: MetricProvenance }) {
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

/**
 * MetricTile (DESIGN §9): display-lg figure, label caption, delta with an arrow, 48 px sparkline, provenance on hover,
 * Forecast/Estimate chip when the number is not real. Big numbers never animate digit by digit.
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
    loading,
    onClick,
    size = "md",
    className,
    ...rest
  },
  ref,
) {
  const text = formatMetricValue(value, format);
  const Comp = (onClick ? "button" : "div") as "div";
  return (
    <Comp
      ref={ref}
      {...(onClick ? { type: "button" } : {})}
      onClick={onClick ? () => onClick() : undefined}
      aria-busy={loading || undefined}
      data-metric-tile
      className={cn(
        "flex min-w-0 flex-col justify-between gap-1 bg-panel p-panel-pad text-left",
        onClick &&
          "cursor-pointer transition-colors duration-micro ease-dugout hover:bg-panel-alt focus-visible:outline-2",
        className,
      )}
      {...rest}
    >
      <div className="flex items-center gap-1">
        <span className="t-label min-w-0 flex-1 truncate">{label}</span>
        {provenance ? (
          <Tooltip content={<ProvenanceTip p={provenance} />} side="top" align="end">
            <button
              type="button"
              className="inline-flex size-4 items-center justify-center rounded-chip text-secondary hover:text-primary focus-visible:outline-2"
              aria-label={`Where this number comes from: ${provenance.source}`}
            >
              <Icon icon={Info} size={12} />
            </button>
          </Tooltip>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className={cn("w-2/3", size === "lg" ? "h-10" : "h-7")} />
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={cn(size === "lg" ? "t-display-xl" : "t-display-lg", "text-primary")}
            data-value={text}
          >
            {text}
            {unit ? <span className="ml-0.5 text-display-sm text-secondary">{unit}</span> : null}
          </span>
          {estimate ? <ProvenanceChip kind={estimate} /> : null}
          {delta ? <DeltaBadge delta={delta} /> : null}
        </div>
      )}
      {(spark && spark.length > 1) || caption ? (
        <div className="flex items-end justify-between gap-2">
          {caption ? (
            <span className="min-w-0 truncate text-small text-secondary">{caption}</span>
          ) : (
            <span />
          )}
          {spark && spark.length > 1 ? (
            <Sparkline data={spark} width={48} height={16} className="text-kit-primary" fill />
          ) : null}
        </div>
      ) : null}
    </Comp>
  );
});

export const STATUS_STRIP_MAX = 6;

export interface StatusStripProps extends HTMLAttributes<HTMLDivElement> {
  /** Up to six tiles; extra tiles are dropped. */
  tiles: readonly MetricTileProps[];
}

/** A row of ≤ 6 MetricTiles with 1 px hairline gaps (Home status strip, Inbox reading pane). */
export function StatusStrip({ tiles, className, ...rest }: StatusStripProps) {
  const shown = tiles.slice(0, STATUS_STRIP_MAX);
  return (
    <div
      role="list"
      className={cn(
        "grid gap-px overflow-hidden rounded-panel border border-subtle bg-subtle",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${Math.max(1, shown.length)}, minmax(0, 1fr))` }}
      data-status-strip
      {...rest}
    >
      {shown.map((t, i) => (
        <MetricTile key={i} role="listitem" {...t} />
      ))}
    </div>
  );
}
