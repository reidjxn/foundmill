"use client";
import { useId, useMemo } from "react";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { cn } from "../../../lib/cn";
import { formatNumber } from "../../../lib/format";
import { ProvenanceChip } from "../../foundation/Chip";
import { AxisX, AxisY, ChartTooltip, countTicks, DEFAULT_MARGIN, placeTicks, Responsive, signFix, tickWidth, toneVar, useChartTooltip, yAxisMargin, type ChartMargin, type SeriesTone } from "./common";

export interface BarDatum {
  label: string;
  value: number;
  tone?: SeriesTone;
  /** Per-bar provenance (a forecast month in a run of actuals). Drawn hatched-light and listed in the tooltip. */
  provenance?: "forecast" | "estimate";
}

export interface BarChartProps {
  data: BarDatum[];
  label: string;
  width?: number;
  height?: number;
  horizontal?: boolean;
  tone?: SeriesTone;
  format?: (v: number) => string;
  /** Print the value at the end of each bar. */
  showValues?: boolean;
  margin?: Partial<ChartMargin>;
  provenance?: "forecast" | "estimate";
  onSelect?: (datum: BarDatum, index: number) => void;
  className?: string;
}

/** Vertical or horizontal bars (visx Bar). Negative values extend below/left of zero. */
export function BarChart({ data, label, width, height = 160, horizontal, tone = "kit", format = (v) => formatNumber(v, { maxDigits: 1 }), showValues, margin, provenance, onSelect, className }: BarChartProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Responsive width={width} height={height}>
        {(w) => <BarChartSvg data={data} label={label} width={w} height={height} horizontal={horizontal} tone={tone} format={format} showValues={showValues} margin={margin} onSelect={onSelect} />}
      </Responsive>
      {provenance ? (
        <div className="px-1">
          <ProvenanceChip kind={provenance} />
        </div>
      ) : null}
    </div>
  );
}

/** Category labels on a horizontal bar chart: Inter 12 at about 6.6 px a character. */
const CATEGORY_CHAR_PX = 6.6;

function BarChartSvg({ data, label, width, height, horizontal, tone, format: rawFormat, showValues, margin: marginProp, onSelect }: Required<Pick<BarChartProps, "data" | "label" | "height" | "tone" | "format">> & Omit<BarChartProps, "className" | "provenance" | "width"> & { width: number }) {
  // Money and counts with a real minus ("−£5K"); every label reserves its own room, so none is ever clipped.
  const format = (v: number) => signFix(rawFormat(v));
  const labels = data.map((d) => d.label);
  const values = data.map((d) => d.value);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const top = marginProp?.top ?? DEFAULT_MARGIN.top + (showValues && !horizontal ? 14 : 4);
  const bottom = marginProp?.bottom ?? DEFAULT_MARGIN.bottom + 2;
  const innerHFor = (b: number) => Math.max(1, height - top - b);
  // Printed values under negative bars need room of their own: the value scale stops short of the axis, so the lowest
  // label sits between its bar and the month labels instead of on them.
  const negRoom = showValues && !horizontal && min < 0 ? 18 : 0;
  // Vertical: the value scale depends only on the height; its labels set the left margin.
  const valueV = scaleLinear<number>({ domain: [min, max === min ? min + 1 : max], range: [Math.max(1, innerHFor(bottom) - negRoom), 0], nice: true });
  const vTicks = countTicks(valueV.ticks(4), values);
  const widestCategory = Math.max(0, ...labels.map((l) => l.length * CATEGORY_CHAR_PX));
  const left = marginProp?.left ?? (horizontal ? Math.min(Math.round(width * 0.4), Math.ceil(widestCategory + 14)) : yAxisMargin(vTicks.map((t) => format(t))));
  const right = marginProp?.right ?? (horizontal && showValues ? Math.ceil(Math.max(0, ...values.map((v) => tickWidth(format(v)))) + 10) : DEFAULT_MARGIN.right + 4);
  const margin = { top, bottom, left, right };
  const innerW = Math.max(1, width - margin.left - margin.right);
  const innerH = innerHFor(bottom);
  const band = useMemo(() => scaleBand<string>({ domain: labels, range: horizontal ? [0, innerH] : [0, innerW], padding: 0.32 }), [labels.join("|"), horizontal, innerW, innerH]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => scaleLinear<number>({ domain: [min, max === min ? min + 1 : max], range: horizontal ? [0, innerW] : [Math.max(1, innerH - negRoom), 0], nice: true }), [min, max, horizontal, innerW, innerH, negRoom]);
  const { tip, show, hide } = useChartTooltip<BarDatum>();
  const sheenId = `bar-sheen-${useId().replace(/:/g, "")}`;
  const zero = value(0);
  const summary = data.map((d) => `${d.label} ${format(d.value)}${d.provenance ? ` (${d.provenance})` : ""}`).join(", ");
  // Category labels under vertical bars: thinned evenly so they never print over each other.
  const step = band.step();
  const every = horizontal ? 1 : Math.max(1, Math.ceil((Math.max(0, ...labels.map(tickWidth)) + 10) / Math.max(1, step)));
  const xTicks = horizontal
    ? placeTicks(countTicks(value.ticks(4), values).map((v) => ({ key: String(v), x: value(v), label: format(v) })), innerW, { left: margin.left - 4, right: margin.right - 2 })
    : placeTicks(labels.map((l) => ({ key: l, x: (band(l) ?? 0) + band.bandwidth() / 2, label: l })), innerW, { left: margin.left - 4, right: margin.right - 2 }, { every, gap: 8 });
  // Value labels over vertical bars all or none: when one would not fit over its bar, none is printed (a chart with
  // one bar unlabelled reads as a missing value); the tooltip always has every value.
  const valuesFit = horizontal || data.every((d) => tickWidth(format(d.value)) + 4 <= step);
  return (
    <>
      {/* Selectable bars are buttons, so the chart is a named group then; a plain chart is one image. */}
      <svg width={width} height={height} role={onSelect ? "group" : "img"} aria-label={`${label}. ${summary}`} className="block overflow-visible">
        <defs>
          <linearGradient id={sheenId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--white)" stopOpacity={0.18} />
            <stop offset="0.4" stopColor="var(--white)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Group left={margin.left} top={margin.top}>
          {horizontal ? (
            <>
              {band.domain().map((l) => {
                const room = margin.left - 10;
                const fits = l.length * CATEGORY_CHAR_PX <= room;
                const shown = fits ? l : `${l.slice(0, Math.max(3, Math.floor(room / CATEGORY_CHAR_PX) - 1))}…`;
                return (
                  <text key={l} x={-10} y={(band(l) ?? 0) + band.bandwidth() / 2} dy="0.32em" textAnchor="end" fill="var(--text-1)" fontFamily="var(--font-body)" fontSize={12}>
                    {fits ? null : <title>{l}</title>}
                    {shown}
                  </text>
                );
              })}
              {xTicks.map((t) => (
                <line key={t.key} x1={t.x} x2={t.x} y1={0} y2={innerH} stroke="var(--line-faint)" />
              ))}
              <AxisX ticks={xTicks} top={innerH} />
            </>
          ) : (
            <>
              <AxisY ticks={countTicks(value.ticks(4), values).map((v) => ({ key: String(v), value: v, y: value(v), label: format(v) }))} width={innerW} zero={min < 0} />
              <AxisX ticks={xTicks} top={innerH} tickMarks={false} />
            </>
          )}
          {data.map((d, i) => {
            const fill = toneVar(d.tone ?? tone);
            const pos = band(d.label) ?? 0;
            const v = value(d.value);
            const x = horizontal ? Math.min(zero, v) : pos;
            const y = horizontal ? pos : Math.min(zero, v);
            const w = horizontal ? Math.abs(v - zero) : band.bandwidth();
            const h = horizontal ? band.bandwidth() : Math.abs(zero - v);
            const interactive = !!onSelect;
            const negative = d.value < 0;
            return (
              <g
                key={d.label}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? `${d.label}: ${format(d.value)}` : undefined}
                className={cn(interactive && "cursor-pointer outline-none focus-visible:[&>rect]:stroke-accent")}
                onClick={() => onSelect?.(d, i)}
                onKeyDown={(e) => {
                  if (interactive && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onSelect?.(d, i);
                  }
                }}
                onPointerMove={(e) => {
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  show(e.clientX - rect.left, e.clientY - rect.top, d);
                }}
                onPointerLeave={hide}
                data-bar={d.label}
              >
                <Bar x={x} y={y} width={w} height={h} fill={fill} fillOpacity={d.provenance ? 0.4 : 0.92} stroke={d.provenance ? fill : "none"} strokeDasharray={d.provenance ? "3 2" : undefined} rx={2} />
                {!d.provenance && h > 3 && w > 3 ? <rect x={x} y={y} width={w} height={h} rx={2} fill={`url(#${sheenId})`} pointerEvents="none" aria-hidden /> : null}
                {showValues && valuesFit ? (
                  <text
                    x={horizontal ? Math.max(zero, v) + 6 : pos + band.bandwidth() / 2}
                    y={horizontal ? pos + band.bandwidth() / 2 : negative ? Math.max(zero, v) + 14 : Math.min(zero, v) - 6}
                    textAnchor={horizontal ? "start" : "middle"}
                    dominantBaseline={horizontal ? "central" : undefined}
                    className="chart-tick"
                    fill="var(--text-1)"
                  >
                    {format(d.value)}
                  </text>
                ) : null}
              </g>
            );
          })}
          {min < 0 ? (horizontal ? <line x1={zero} x2={zero} y1={0} y2={innerH} stroke="var(--line-strong)" /> : <line x1={0} x2={innerW} y1={zero} y2={zero} stroke="var(--line-strong)" />) : null}
        </Group>
      </svg>
      {tip ? (
        <ChartTooltip x={tip.x} y={tip.y} width={width}>
          <div className="t-data mb-0.5">{tip.datum.label}</div>
          <div className="flex items-center gap-2 tabular-nums">
            {tip.datum.provenance ? <ProvenanceChip kind={tip.datum.provenance}>{format(tip.datum.value)}</ProvenanceChip> : <span>{format(tip.datum.value)}</span>}
          </div>
        </ChartTooltip>
      ) : null}
    </>
  );
}
