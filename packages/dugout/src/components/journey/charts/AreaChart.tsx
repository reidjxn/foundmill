"use client";
import { useMemo, type PointerEvent } from "react";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { Area, LinePath } from "@visx/shape";
import { LinearGradient } from "@visx/gradient";
import { cn } from "../../../lib/cn";
import { formatDate, formatNumber } from "../../../lib/format";
import { ProvenanceChip } from "../../foundation/Chip";
import { AxisX, AxisY, ChartLegend, ChartTooltip, countTicks, DEFAULT_MARGIN, extent, nearestIndex, placeTicks, Responsive, signFix, toNumber, toneVar, useChartTooltip, yAxisMargin, type ChartMargin, type SeriesTone } from "./common";
import type { LinePoint } from "./LineChart";

export interface AreaSeries {
  id: string;
  label: string;
  tone: SeriesTone;
  data: LinePoint[];
}

export interface AreaChartProps {
  series: AreaSeries[];
  label: string;
  width?: number;
  height?: number;
  /** Stack the series (x values must align). */
  stacked?: boolean;
  xType?: "time" | "linear";
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  margin?: Partial<ChartMargin>;
  provenance?: "forecast" | "estimate";
  legend?: boolean;
  className?: string;
}

interface StackedPoint {
  x: number;
  y0: number;
  y1: number;
}

/** Gradient-filled areas, optionally stacked (visx Area + LinearGradient). */
export function AreaChart({ series, label, width, height = 160, stacked, xType, yFormat, xFormat, margin, provenance, legend = true, className }: AreaChartProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Responsive width={width} height={height}>
        {(w) => <AreaChartSvg series={series} label={label} width={w} height={height} stacked={stacked} xType={xType} yFormat={yFormat} xFormat={xFormat} margin={margin} />}
      </Responsive>
      {legend || provenance ? (
        <div className="flex items-center gap-3 px-1">
          {legend ? <ChartLegend items={series.map((s) => ({ id: s.id, label: s.label, tone: s.tone }))} /> : null}
          {provenance ? <ProvenanceChip kind={provenance} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function AreaChartSvg({ series, label, width, height, stacked, xType, yFormat = (v) => formatNumber(v, { maxDigits: 1 }), xFormat, margin: marginProp }: Omit<AreaChartProps, "className" | "legend" | "provenance"> & { width: number; height: number }) {
  const top = marginProp?.top ?? DEFAULT_MARGIN.top + 4;
  const bottom = marginProp?.bottom ?? DEFAULT_MARGIN.bottom + 2;
  const innerH = Math.max(1, height - top - bottom);
  const isTime = xType ? xType === "time" : series[0]?.data[0]?.x instanceof Date;
  const stacks = useMemo<StackedPoint[][]>(() => {
    if (!stacked) return series.map((s) => s.data.map((d) => ({ x: toNumber(d.x), y0: 0, y1: d.y })));
    const base = new Map<number, number>();
    return series.map((s) =>
      s.data.map((d) => {
        const x = toNumber(d.x);
        const y0 = base.get(x) ?? 0;
        const y1 = y0 + d.y;
        base.set(x, y1);
        return { x, y0, y1 };
      }),
    );
  }, [series, stacked]);
  const xs = stacks.flatMap((s) => s.map((p) => p.x));
  const xDomain = extent(xs);
  const yMax = Math.max(1e-9, ...stacks.flatMap((s) => s.map((p) => p.y1)));
  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, yMax], range: [innerH, 0], nice: true }), [yMax, innerH]);
  const yValues = series.flatMap((s) => s.data.map((d) => d.y));
  const yTicks = countTicks(yScale.ticks(4), yValues).map((v) => ({ key: String(v), value: v, y: yScale(v), label: signFix(yFormat(v)) }));
  const margin = { top, bottom, left: marginProp?.left ?? yAxisMargin(yTicks.map((t) => t.label)), right: marginProp?.right ?? DEFAULT_MARGIN.right + 4 };
  const innerW = Math.max(1, width - margin.left - margin.right);
  const xScale = useMemo(() => (isTime ? scaleTime<number>({ domain: [new Date(xDomain[0]), new Date(xDomain[1])], range: [0, innerW] }) : scaleLinear<number>({ domain: xDomain, range: [0, innerW] })), [isTime, xDomain[0], xDomain[1], innerW]); // eslint-disable-line react-hooks/exhaustive-deps
  const px = (x: number) => (isTime ? xScale(new Date(x)) : xScale(x)) as number;
  const allX = useMemo(() => Array.from(new Set(xs)).sort((a, b) => a - b), [xs]);
  const allPx = allX.map(px);
  const { tip, show, hide } = useChartTooltip<{ x: number; values: Array<{ id: string; label: string; tone: SeriesTone; y: number | null }> }>();
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    if (allX.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = nearestIndex(allPx, e.clientX - rect.left);
    const x = allX[i] as number;
    show((allPx[i] as number) + margin.left, margin.top + innerH / 2, { x, values: series.map((s) => ({ id: s.id, label: s.label, tone: s.tone, y: s.data.find((d) => toNumber(d.x) === x)?.y ?? null })) });
  };
  const fmtX = xFormat ?? ((v: number) => (isTime ? formatDate(v) : formatNumber(v, { maxDigits: 1 })));
  const rawX = (xScale.ticks(Math.max(2, Math.min(8, Math.floor(innerW / 96)))) as Array<number | Date>).map((v) => toNumber(v));
  const xTicks = placeTicks((isTime ? rawX : countTicks(rawX, xs)).map((v) => ({ key: String(v), x: px(v), label: fmtX(v) })), innerW, { left: margin.left - 4, right: margin.right - 2 });
  return (
    <>
      <svg width={width} height={height} role="img" aria-label={`${label}. ${series.map((s) => `${s.label}: ${s.data.length} points`).join("; ")}${stacked ? ", stacked" : ""}`} className="block overflow-visible">
        <defs>
          {series.map((s) => (
            <LinearGradient key={s.id} id={`ac-${s.id}`} from={toneVar(s.tone)} to={toneVar(s.tone)} fromOpacity={stacked ? 0.55 : 0.28} toOpacity={stacked ? 0.35 : 0.02} vertical />
          ))}
        </defs>
        <Group left={margin.left} top={margin.top}>
          <AxisY ticks={yTicks} width={innerW} />
          <AxisX ticks={xTicks} top={innerH} />
          {stacks.map((pts, i) => {
            const s = series[i] as AreaSeries;
            return (
              <g key={s.id} data-series={s.id}>
                <Area<StackedPoint> data={pts} x={(d) => px(d.x)} y0={(d) => yScale(d.y0)} y1={(d) => yScale(d.y1)} curve={curveMonotoneX} fill={`url(#ac-${s.id})`} stroke="none" />
                <LinePath<StackedPoint> data={pts} x={(d) => px(d.x)} y={(d) => yScale(d.y1)} curve={curveMonotoneX} stroke={toneVar(s.tone)} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })}
          {tip ? <line x1={tip.x - margin.left} x2={tip.x - margin.left} y1={0} y2={innerH} stroke="var(--white)" strokeOpacity={0.35} strokeDasharray="2 3" /> : null}
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
