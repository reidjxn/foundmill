"use client";
import { useMemo } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { cn } from "../../../lib/cn";
import { formatNumber } from "../../../lib/format";
import { ProvenanceChip } from "../../foundation/Chip";
import { AXIS_STROKE, AXIS_TICK_LABEL, ChartTooltip, DEFAULT_MARGIN, Responsive, toneVar, useChartTooltip, type ChartMargin, type SeriesTone } from "./common";

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

function BarChartSvg({ data, label, width, height, horizontal, tone, format, showValues, margin: marginProp, onSelect }: Required<Pick<BarChartProps, "data" | "label" | "height" | "tone" | "format">> & Omit<BarChartProps, "className" | "provenance" | "width"> & { width: number }) {
  const margin = { ...DEFAULT_MARGIN, ...(horizontal ? { left: 96, bottom: 20 } : {}), ...marginProp };
  const innerW = Math.max(1, width - margin.left - margin.right);
  const innerH = Math.max(1, height - margin.top - margin.bottom);
  const labels = data.map((d) => d.label);
  const max = Math.max(0, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const band = useMemo(() => scaleBand<string>({ domain: labels, range: horizontal ? [0, innerH] : [0, innerW], padding: 0.3 }), [labels.join("|"), horizontal, innerW, innerH]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => scaleLinear<number>({ domain: [min, max === min ? min + 1 : max], range: horizontal ? [0, innerW] : [innerH, 0], nice: true }), [min, max, horizontal, innerW, innerH]);
  const { tip, show, hide } = useChartTooltip<BarDatum>();
  const zero = value(0);
  const summary = data.map((d) => `${d.label} ${format(d.value)}${d.provenance ? ` (${d.provenance})` : ""}`).join(", ");
  return (
    <>
      <svg width={width} height={height} role="img" aria-label={`${label}. ${summary}`} className="block overflow-visible">
        <Group left={margin.left} top={margin.top}>
          {horizontal ? (
            <>
              <AxisLeft scale={band} stroke={AXIS_STROKE} tickStroke={AXIS_STROKE} hideTicks hideAxisLine tickLabelProps={{ ...AXIS_TICK_LABEL, fill: "var(--text-primary)", textAnchor: "end", dx: "-0.5em", dy: "0.3em" }} />
              <AxisBottom top={innerH} scale={value} numTicks={4} stroke={AXIS_STROKE} tickStroke={AXIS_STROKE} tickLength={4} tickFormat={(v) => format(Number(v))} tickLabelProps={{ ...AXIS_TICK_LABEL, textAnchor: "middle", dy: "0.25em" }} />
            </>
          ) : (
            <>
              <AxisLeft scale={value} numTicks={4} stroke={AXIS_STROKE} tickStroke={AXIS_STROKE} tickLength={4} tickFormat={(v) => format(Number(v))} tickLabelProps={{ ...AXIS_TICK_LABEL, textAnchor: "end", dx: "-0.25em", dy: "0.3em" }} hideAxisLine />
              {value.ticks(4).map((t) => (
                <line key={t} x1={0} x2={innerW} y1={value(t)} y2={value(t)} stroke={AXIS_STROKE} strokeOpacity={0.5} />
              ))}
              <AxisBottom top={innerH} scale={band} stroke={AXIS_STROKE} tickStroke={AXIS_STROKE} hideTicks tickLabelProps={{ ...AXIS_TICK_LABEL, textAnchor: "middle", dy: "0.25em" }} />
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
            return (
              <g
                key={d.label}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? `${d.label}: ${format(d.value)}` : undefined}
                className={cn(interactive && "cursor-pointer outline-none focus-visible:[&>rect]:stroke-link")}
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
                <Bar x={x} y={y} width={w} height={h} fill={fill} fillOpacity={d.provenance ? 0.45 : 0.9} stroke={d.provenance ? fill : "none"} strokeDasharray={d.provenance ? "3 2" : undefined} rx={1} />
                {showValues ? (
                  <text x={horizontal ? Math.max(zero, v) + 4 : pos + band.bandwidth() / 2} y={horizontal ? pos + band.bandwidth() / 2 : Math.min(zero, v) - 4} textAnchor={horizontal ? "start" : "middle"} dominantBaseline={horizontal ? "central" : undefined} fill="var(--text-primary)" fontFamily="var(--font-body)" fontSize={12} className="tabular-nums">
                    {format(d.value)}
                  </text>
                ) : null}
              </g>
            );
          })}
          {min < 0 ? (horizontal ? <line x1={zero} x2={zero} y1={0} y2={innerH} stroke="var(--text-secondary)" /> : <line x1={0} x2={innerW} y1={zero} y2={zero} stroke="var(--text-secondary)" />) : null}
        </Group>
      </svg>
      {tip ? (
        <ChartTooltip x={tip.x} y={tip.y} width={width}>
          <div className="t-label">{tip.datum.label}</div>
          <div className="flex items-center gap-2 tabular-nums">
            <span>{format(tip.datum.value)}</span>
            {tip.datum.provenance ? <ProvenanceChip kind={tip.datum.provenance} /> : null}
          </div>
        </ChartTooltip>
      ) : null}
    </>
  );
}
