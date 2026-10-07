import { useCallback, useState, type ReactNode } from "react";
import { ParentSize } from "@visx/responsive";
import type { DeptColourToken } from "@founder-manager/shared";
import { cn } from "../../../lib/cn";
import { formatCompact } from "../../../lib/format";

/** Series colours: tokens only. */
export type SeriesTone = "kit" | "kit-secondary" | "good" | "warn" | "bad" | "info" | "gold" | "secondary" | "link" | DeptColourToken;

const TONE_VAR: Record<Exclude<SeriesTone, DeptColourToken>, string> = {
  kit: "var(--kit-primary)",
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
  kit: "text-kit-primary",
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

/** Axis styling shared by every chart: hairline strokes, small text in text-secondary (DESIGN §4). */
export const AXIS_TICK_LABEL = { fill: "var(--text-secondary)", fontFamily: "var(--font-body)", fontSize: 12 } as const;
export const AXIS_STROKE = "var(--line-subtle)";

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
    <div role="status" className="surface-overlay pointer-events-none absolute z-10 min-w-28 px-2 py-1.5 text-small text-primary" style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y - 12) }} data-chart-tooltip>
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
          <span aria-hidden className={cn("inline-block h-0.5 w-3 rounded-full", TONE_TEXT[it.tone], it.dashed ? "border-t border-dashed border-current bg-transparent" : "bg-current")} />
          <span>{it.label}</span>
          {it.dashed ? <span className="t-label">Forecast</span> : null}
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
