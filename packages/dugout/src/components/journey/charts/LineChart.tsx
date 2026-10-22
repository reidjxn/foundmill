"use client";
import { useMemo, type PointerEvent } from "react";
import { curveLinear, curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { cn } from "../../../lib/cn";
import { formatNumber } from "../../../lib/format";
import { ProvenanceChip } from "../../foundation/Chip";
import { useFormatters } from "../../foundation/DateFormatProvider";
import { AxisX, AxisY, ChartLegend, ChartTooltip, countTicks, DEFAULT_MARGIN, extent, nearestIndex, placeTicks, Responsive, signFix, toNumber, toneVar, useChartTooltip, yAxisMargin, type ChartMargin, type SeriesTone } from "./common";

export interface LinePoint {
  x: number | Date;
  y: number;
}

export interface LineSeries {
  id: string;
  label: string;
  tone: SeriesTone;
  data: LinePoint[];
  /** Dashed stroke: forecast and other non-real values (legend says "Forecast"). */
  dashed?: boolean;
  /** Fill under the line (12 % → 0 gradient). */
  area?: boolean;
}

export interface LineChartProps {
  series: LineSeries[];
  /** Accessible name for the chart. */
  label: string;
  width?: number;
  height?: number;
  /** "time" formats x as dates; "linear" as numbers. Default: time when the first x is a Date. */
  xType?: "time" | "linear";
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  yDomain?: [number, number];
  /** Y axis from zero (default true). */
  zeroBased?: boolean;
  margin?: Partial<ChartMargin>;
  /** Straight segments instead of a monotone curve. */
  linear?: boolean;
  /** Provenance chip shown with the legend. */
  provenance?: "forecast" | "estimate";
  /** Highlighted x value (a vertical guide), e.g. Today. */
  markX?: number | Date;
  markLabel?: string;
  legend?: boolean;
  className?: string;
}

/** Lines over time or an index (visx). Hover shows every series at the nearest x; tokens only. */
export function LineChart({ series, label, width, height = 160, xType, yFormat, xFormat, yDomain, zeroBased = true, margin: marginProp, linear, provenance, markX, markLabel, legend = true, className }: LineChartProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Responsive width={width} height={height}>
        {(w) => <LineChartSvg series={series} label={label} width={w} height={height} xType={xType} yFormat={yFormat} xFormat={xFormat} yDomain={yDomain} zeroBased={zeroBased} margin={marginProp} linear={linear} markX={markX} markLabel={markLabel} />}
      </Responsive>
      {legend || provenance ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          {legend ? <ChartLegend items={series.map((s) => ({ id: s.id, label: s.label, tone: s.tone, dashed: s.dashed }))} /> : null}
          {provenance ? <ProvenanceChip kind={provenance} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function LineChartSvg({ series, label, width, height, xType, yFormat = (v) => formatNumber(v, { maxDigits: 1 }), xFormat, yDomain, zeroBased, margin: marginProp, linear, markX, markLabel }: Required<Pick<LineChartProps, "series" | "label" | "height">> & Omit<LineChartProps, "className" | "legend" | "provenance"> & { width: number }) {
  const { formatDate } = useFormatters();
  const isTime = xType ? xType === "time" : series[0]?.data[0]?.x instanceof Date;
  const xs = useMemo(() => series.flatMap((s) => s.data.map((d) => toNumber(d.x))), [series]);
  const ys = useMemo(() => series.flatMap((s) => s.data.map((d) => d.y)), [series]);
  // The y scale depends only on the height, so its labels are known before the left margin is chosen: the margin is
  // as wide as the widest label ("−£400K" never loses its "£").
  const top = marginProp?.top ?? DEFAULT_MARGIN.top + 4;
  const bottom = marginProp?.bottom ?? DEFAULT_MARGIN.bottom + 2;
  const innerH = Math.max(1, height - top - bottom);
  const xDomain = extent(xs);
  const yExt = yDomain ?? extent(ys, 0.05);
  const yDom: [number, number] = zeroBased ? [Math.min(0, yExt[0]), Math.max(yExt[1], 0)] : yExt;
  const yScale = useMemo(() => scaleLinear<number>({ domain: yDom, range: [innerH, 0], nice: true }), [yDom[0], yDom[1], innerH]); // eslint-disable-line react-hooks/exhaustive-deps
  const yTicks = countTicks(yScale.ticks(4), ys).map((v) => ({ key: String(v), value: v, y: yScale(v), label: signFix(yFormat(v)) }));
  const margin = { top, bottom, left: marginProp?.left ?? yAxisMargin(yTicks.map((t) => t.label)), right: marginProp?.right ?? DEFAULT_MARGIN.right + 4 };
  const innerW = Math.max(1, width - margin.left - margin.right);
  const xScale = useMemo(() => (isTime ? scaleTime<number>({ domain: [new Date(xDomain[0]), new Date(xDomain[1])], range: [0, innerW] }) : scaleLinear<number>({ domain: xDomain, range: [0, innerW] })), [isTime, xDomain[0], xDomain[1], innerW]); // eslint-disable-line react-hooks/exhaustive-deps
  const px = (x: number | Date) => (isTime ? xScale(new Date(toNumber(x))) : xScale(toNumber(x))) as number;
  const { tip, show, hide } = useChartTooltip<{ x: number; values: Array<{ id: string; label: string; tone: SeriesTone; y: number | null }> }>();
  // Hover: nearest x across the union of x values.
  const allX = useMemo(() => Array.from(new Set(xs)).sort((a, b) => a - b), [xs]);
  const allPx = useMemo(() => allX.map((x) => px(x)), [allX, innerW, isTime]); // eslint-disable-line react-hooks/exhaustive-deps
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    if (allX.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const i = nearestIndex(allPx, lx);
    const x = allX[i] as number;
    const values = series.map((s) => ({ id: s.id, label: s.label, tone: s.tone, y: s.data.find((d) => toNumber(d.x) === x)?.y ?? null }));
    show((allPx[i] as number) + margin.left, margin.top + innerH / 2, { x, values });
  };
  const fmtX = xFormat ?? ((v: number) => (isTime ? formatDate(v) : formatNumber(v, { maxDigits: 1 })));
  const rawX = (xScale.ticks(Math.max(2, Math.min(8, Math.floor(innerW / 96)))) as Array<number | Date>).map((v) => toNumber(v));
  const xTicks = placeTicks(
    (isTime ? rawX : countTicks(rawX, xs)).map((v) => ({ key: String(v), x: px(v), label: fmtX(v) })),
    innerW,
    { left: margin.left - 4, right: margin.right - 2 },
  );
  const curve = linear ? curveLinear : curveMonotoneX;
  const summary = series.map((s) => `${s.label}: ${s.data.length} points${s.data.length ? `, latest ${yFormat(s.data[s.data.length - 1]!.y)}` : ""}`).join("; ");
  const glowId = `lc-glow-${series.map((s) => s.id).join("-")}`;
  return (
    <>
      <svg width={width} height={height} role="img" aria-label={`${label}. ${summary}`} className="block overflow-visible">
        <defs>
          {series.filter((s) => s.area).map((s) => (
            <linearGradient key={s.id} id={`lc-${s.id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={toneVar(s.tone)} stopOpacity={0.24} />
              <stop offset="0.55" stopColor={toneVar(s.tone)} stopOpacity={0.07} />
              <stop offset="1" stopColor={toneVar(s.tone)} stopOpacity={0} />
            </linearGradient>
          ))}
          <filter id={glowId} x="-5%" y="-30%" width="110%" height="160%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <Group left={margin.left} top={margin.top}>
          <AxisY ticks={yTicks} width={innerW} zero={yDom[0] < 0} />
          <AxisX ticks={xTicks} top={innerH} />
          {series.map((s) =>
            s.area ? <AreaClosed key={`a-${s.id}`} data={s.data} x={(d) => px(d.x)} y={(d) => yScale(d.y)} yScale={yScale} curve={curve} fill={`url(#lc-${s.id})`} stroke="none" /> : null,
          )}
          {/* Real lines glow over a blurred under-stroke; forecasts stay plain and dashed. */}
          {series.map((s) =>
            s.dashed ? null : <LinePath key={`g-${s.id}`} data={s.data} x={(d) => px(d.x)} y={(d) => yScale(d.y)} curve={curve} stroke={toneVar(s.tone)} strokeOpacity={0.4} strokeWidth={4.5} filter={`url(#${glowId})`} strokeLinecap="round" strokeLinejoin="round" aria-hidden />,
          )}
          {series.map((s) => (
            <LinePath key={s.id} data={s.data} x={(d) => px(d.x)} y={(d) => yScale(d.y)} curve={curve} stroke={toneVar(s.tone)} strokeOpacity={s.dashed ? 0.85 : 1} strokeWidth={s.dashed ? 1.5 : 1.75} strokeDasharray={s.dashed ? "4 4" : undefined} strokeLinecap="round" strokeLinejoin="round" data-series={s.id} />
          ))}
          {markX !== undefined ? (
            <g data-mark>
              <line x1={px(markX)} x2={px(markX)} y1={0} y2={innerH} stroke="var(--kit-lift)" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="2 3" />
              {markLabel ? (
                <text x={px(markX) + 6} y={10} className="t-data" fill="var(--text-3)" fontSize={11} letterSpacing="0.09em">
                  {markLabel.toUpperCase()}
                </text>
              ) : null}
            </g>
          ) : null}
          {tip ? (
            <g>
              <line x1={tip.x - margin.left} x2={tip.x - margin.left} y1={0} y2={innerH} stroke="var(--white)" strokeOpacity={0.35} strokeDasharray="2 3" />
              {tip.datum.values.map((v) => (v.y === null ? null : <circle key={v.id} cx={tip.x - margin.left} cy={yScale(v.y)} r={3.5} fill={toneVar(v.tone)} stroke="var(--surface-1)" strokeWidth={2} />))}
            </g>
          ) : null}
          <rect x={0} y={0} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerLeave={hide} />
        </Group>
      </svg>
      {tip ? (
        <ChartTooltip x={tip.x} y={tip.y} width={width}>
          <div className="t-data mb-0.5">{fmtX(tip.datum.x)}</div>
          {tip.datum.values.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-3 tabular-nums">
              <span className="text-secondary">{v.label}</span>
              <span>{v.y === null ? "—" : signFix(yFormat(v.y))}</span>
            </div>
          ))}
        </ChartTooltip>
      ) : null}
    </>
  );
}
