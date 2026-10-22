"use client";
import { useCallback, useState, type ReactNode } from "react";
import { ParentSize } from "@visx/responsive";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../../lib/cn";
import { formatCompact } from "../../../lib/format";
import { Term } from "../../guidance/Term";

/** Series colours: tokens only. */
export type SeriesTone = "kit" | "kit-secondary" | "good" | "warn" | "bad" | "info" | "gold" | "secondary" | "link" | DeptColourToken;

const TONE_VAR: Record<Exclude<SeriesTone, DeptColourToken>, string> = {
  // The brand lifted towards text-1, so a brand line reads on the dark panel whatever the business's colour.
  kit: "var(--kit-lift)",
  "kit-secondary": "var(--kit-secondary)",
  good: "var(--status-good)",
  warn: "var(--status-warn)",
  bad: "var(--status-bad)",
  info: "var(--status-info)",
  gold: "var(--gold)",
  secondary: "var(--text-secondary)",
  link: "var(--accent-link)",
};

export function toneVar(tone: SeriesTone): string {
  return tone.startsWith("dept-") ? `var(--${tone})` : TONE_VAR[tone as Exclude<SeriesTone, DeptColourToken>];
}

/** Text classes for a tone (legend dots and values). Static map so Tailwind emits them. */
export const TONE_TEXT: Record<SeriesTone, string> = {
  kit: "text-kit-lift",
  "kit-secondary": "text-kit-secondary",
  good: "text-status-good",
  warn: "text-status-warn",
  bad: "text-status-bad",
  info: "text-status-info",
  gold: "text-gold",
  secondary: "text-secondary",
  link: "text-link",
  "dept-1": "text-dept-1",
  "dept-2": "text-dept-2",
  "dept-3": "text-dept-3",
  "dept-4": "text-dept-4",
  "dept-5": "text-dept-5",
  "dept-6": "text-dept-6",
  "dept-7": "text-dept-7",
  "dept-8": "text-dept-8",
};

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export const DEFAULT_MARGIN: ChartMargin = { top: 8, right: 12, bottom: 24, left: 40 };

/** Axis styling shared by every chart: hairline strokes, mono 11 px ticks in text-3 (DESIGN §4: nothing smaller). */
export const AXIS_TICK_LABEL = { fill: "var(--text-3)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500 } as const;
export const AXIS_STROKE = "var(--line)";
/** Gridlines: hairlines at 4.5 % white. */
export const GRID_STROKE = "var(--line-faint)";

/** Tick labels are JetBrains Mono 11: about 6.7 px a character (no DOM to measure while laying out). */
export const TICK_CHAR_PX = 6.7;
export const tickWidth = (label: string) => label.length * TICK_CHAR_PX;

/** A real minus sign on negative figures: "-£5K" → "−£5K", "£-5K" → "−£5K". */
export function signFix(label: string): string {
  return label.replace(/^-/, "−").replace(/^([^\d\s−-]+)-/, "−$1");
}

/** The margin a y axis needs for its widest label, plus the tick and a gap (never less than `min`). */
export function yAxisMargin(labels: readonly string[], min = 24): number {
  return Math.max(min, Math.ceil(Math.max(0, ...labels.map(tickWidth)) + 14));
}

/** Integer ticks only when every value is a whole number (counts never show "0.5"). */
export function countTicks(ticks: readonly number[], values: readonly number[]): number[] {
  return values.every((v) => Number.isInteger(v)) ? ticks.filter((t) => Number.isInteger(t)) : [...ticks];
}

export interface PlacedTick {
  key: string;
  x: number;
  label: string;
  anchor: "start" | "middle" | "end";
  showLabel: boolean;
}

/**
 * Lay x tick labels out so none is clipped and none overlaps: a label that would cross the plot's edge (plus the
 * margin beside it) is anchored to its tick on the inside, and one that would touch the label before it is skipped
 * (its tick mark stays). With `every`, only every n-th label is a candidate (even thinning for bands).
 */
export function placeTicks(ticks: ReadonlyArray<{ key: string; x: number; label: string }>, innerW: number, room: { left: number; right: number }, opts: { gap?: number; every?: number } = {}): PlacedTick[] {
  const gap = opts.gap ?? 12;
  const every = Math.max(1, opts.every ?? 1);
  let lastRight = -Infinity;
  return ticks.map((t, i) => {
    const w = tickWidth(t.label);
    let anchor: PlacedTick["anchor"] = "middle";
    let left = t.x - w / 2;
    let right = t.x + w / 2;
    if (left < -room.left) {
      anchor = "start";
      left = t.x;
      right = t.x + w;
    } else if (right > innerW + room.right) {
      anchor = "end";
      left = t.x - w;
      right = t.x;
    }
    const showLabel = i % every === 0 && left >= lastRight + gap && right <= innerW + room.right + 0.5;
    if (showLabel) lastRight = right;
    return { key: t.key, x: t.x, label: t.label, anchor, showLabel };
  });
}

/** A bottom axis from placed ticks: 4 px tick marks and mono labels, nothing clipped. */
export function AxisX({ ticks, top, tickMarks = true }: { ticks: readonly PlacedTick[]; top: number; tickMarks?: boolean }) {
  return (
    <g data-axis="x" transform={`translate(0 ${top})`}>
      {ticks.map((t) => (
        <g key={t.key}>
          {tickMarks ? <line x1={t.x} x2={t.x} y1={0} y2={4} stroke={AXIS_STROKE} /> : null}
          {t.showLabel ? (
            <text x={t.x} y={17} textAnchor={t.anchor} className="chart-tick">
              {t.label}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  );
}

/** A left axis: labels right-aligned 8 px from the plot, with full-width gridlines (the zero line a little stronger). */
export function AxisY({ ticks, width, zero }: { ticks: ReadonlyArray<{ key: string; y: number; label: string; value: number }>; width: number; zero?: boolean }) {
  return (
    <g data-axis="y">
      {ticks.map((t) => (
        <g key={t.key}>
          <line x1={0} x2={width} y1={t.y + 0.5} y2={t.y + 0.5} stroke={zero && t.value === 0 ? AXIS_STROKE : GRID_STROKE} />
          <text x={-8} y={t.y} dy="0.32em" textAnchor="end" className="chart-tick">
            {t.label}
          </text>
        </g>
      ))}
    </g>
  );
}

export const compactTick = (v: number | { valueOf(): number }) => formatCompact(Number(v));

export interface TooltipState<T> {
  x: number;
  y: number;
  datum: T;
}

/** Tiny tooltip state hook; positions are container-relative pixels. */
export function useChartTooltip<T>() {
  const [tip, setTip] = useState<TooltipState<T> | null>(null);
  const show = useCallback((x: number, y: number, datum: T) => setTip({ x, y, datum }), []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export interface ChartTooltipProps {
  x: number;
  y: number;
  /** Container width, to flip near the right edge. */
  width: number;
  children: ReactNode;
}

/** Overlay surface positioned near the pointer. Pointer-events none so hover stays stable. */
export function ChartTooltip({ x, y, width, children }: ChartTooltipProps) {
  const flip = x + 180 > width;
  return (
    <div role="status" className="surface-overlay pointer-events-none absolute z-10 min-w-32 px-2.5 py-2 text-small text-primary" style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y - 12) }} data-chart-tooltip>
      {children}
    </div>
  );
}

export interface LegendItem {
  id: string;
  label: string;
  tone: SeriesTone;
  dashed?: boolean;
}

export function ChartLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-secondary", className)} aria-label="Legend">
      {items.map((it) => (
        <li key={it.id} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("inline-block w-3.5 rounded-full", TONE_TEXT[it.tone], it.dashed ? "h-0 border-t-2 border-dashed border-current" : "h-0.5 bg-current")} />
          <span>{it.label}</span>
          {/* A dashed line is not measured: say so, unless its label already does. */}
          {it.dashed && !/forecast|estimate|plan/i.test(it.label) ? (
            <Term id="forecast" always className="est-chip">
              Forecast
            </Term>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export interface ResponsiveProps {
  width?: number;
  height: number;
  className?: string;
  children: (width: number) => ReactNode;
}

/** Fixed width when given, else the parent's width (visx ParentSize). */
export function Responsive({ width, height, className, children }: ResponsiveProps) {
  if (width !== undefined) return <div className={cn("relative", className)} style={{ width, height }}>{children(width)}</div>;
  return (
    // A real initial width so the first paint (SSR, tests, hidden tabs) is a chart; the observer corrects it at once.
    <ParentSize debounceTime={50} ignoreDimensions={["height", "top", "left"]} initialSize={{ width: 600, height }} className={cn("relative", className)} style={{ width: "100%", height }}>
      {({ width: w }) => (w > 0 ? children(Math.floor(w)) : null)}
    </ParentSize>
  );
}

/** Nearest index in a sorted array of x pixel positions. */
export function nearestIndex(xs: readonly number[], x: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs((xs[i] as number) - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function toNumber(x: number | Date): number {
  return x instanceof Date ? x.getTime() : x;
}

/** Extent with a sensible fallback for empty or flat data. */
export function extent(values: readonly number[], pad = 0): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) return [lo - (lo === 0 ? 1 : Math.abs(lo) * 0.1), hi + (hi === 0 ? 1 : Math.abs(hi) * 0.1)];
  const span = hi - lo;
  return [lo - span * pad, hi + span * pad];
}
