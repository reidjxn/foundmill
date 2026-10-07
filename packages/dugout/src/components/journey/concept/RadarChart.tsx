import { useId } from "react";
import { Group } from "@visx/group";
import { LineRadial } from "@visx/shape";
import { curveLinearClosed } from "@visx/curve";
import { scaleLinear } from "@visx/scale";
import { cn } from "../../../lib/cn";
import { ChartLegend, toneVar, type SeriesTone } from "../charts/common";

export interface RadarAxis {
  key: string;
  label: string;
}

export interface RadarSeries {
  id: string;
  label: string;
  tone: SeriesTone;
  /** One value per axis, in axis order. */
  values: number[];
}

export interface RadarChartProps {
  axes: RadarAxis[];
  series: RadarSeries[];
  /** Scale maximum. Default 20 (the rating ramp). */
  max?: number;
  /** Diameter in px. Default 280. */
  size?: number;
  label: string;
  /** Number of grid rings. Default 4. */
  rings?: number;
  legend?: boolean;
  className?: string;
}

interface RadialPoint {
  angle: number;
  radius: number;
}

/** Polar coordinates for the n-th axis of `count`, starting at the top and going clockwise. */
export function radarAngle(index: number, count: number): number {
  return (index / count) * Math.PI * 2;
}

/** Cartesian point for an axis index and radius (0 at centre). */
export function radarPoint(index: number, count: number, r: number): { x: number; y: number } {
  const a = radarAngle(index, count) - Math.PI / 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/** Compare's radar (BUILD §11.1): one polygon per concept in department colours, axes labelled, rings at quarters. */
export function RadarChart({ axes, series, max = 20, size = 280, label, rings = 4, legend = true, className }: RadarChartProps) {
  const uid = useId();
  const pad = 56;
  const r = Math.max(10, (size - pad * 2) / 2);
  const cx = size / 2;
  const cy = size / 2;
  const n = Math.max(1, axes.length);
  const scale = scaleLinear<number>({ domain: [0, max], range: [0, r] });
  const ringPoints = (level: number): RadialPoint[] => axes.map((_, i) => ({ angle: radarAngle(i, n), radius: scale((max * level) / rings) }));
  const summary = series.map((s) => `${s.label}: ${s.values.map((v, i) => `${axes[i]?.label ?? i} ${v}`).join(", ")}`).join("; ");
  return (
    <figure className={cn("flex flex-col items-center gap-2", className)} data-radar>
      <svg width={size} height={size} role="img" aria-label={`${label}. ${summary}`} className="block overflow-visible">
        <Group left={cx} top={cy}>
          {Array.from({ length: rings }, (_, i) => (
            <LineRadial<RadialPoint> key={i} data={ringPoints(i + 1)} angle={(d) => d.angle} radius={(d) => d.radius} curve={curveLinearClosed} fill={i === rings - 1 ? "var(--bg-panel-alt)" : "none"} fillOpacity={0.5} stroke="var(--line-subtle)" strokeWidth={1} />
          ))}
          {axes.map((a, i) => {
            const end = radarPoint(i, n, r);
            const lab = radarPoint(i, n, r + 16);
            const anchor = Math.abs(lab.x) < 1 ? "middle" : lab.x > 0 ? "start" : "end";
            return (
              <g key={a.key}>
                <line x1={0} y1={0} x2={end.x} y2={end.y} stroke="var(--line-subtle)" strokeWidth={1} />
                <text x={lab.x} y={lab.y} textAnchor={anchor} dominantBaseline="central" fill="var(--text-secondary)" fontFamily="var(--font-display)" fontWeight={600} fontSize={11} letterSpacing="0.06em" style={{ textTransform: "uppercase" }}>
                  {a.label}
                </text>
              </g>
            );
          })}
          {series.map((s) => (
            <g key={s.id} data-radar-series={s.id}>
              <LineRadial<RadialPoint> data={axes.map((_, i) => ({ angle: radarAngle(i, n), radius: scale(Math.max(0, Math.min(max, s.values[i] ?? 0))) }))} angle={(d) => d.angle} radius={(d) => d.radius} curve={curveLinearClosed} fill={toneVar(s.tone)} fillOpacity={0.14} stroke={toneVar(s.tone)} strokeWidth={2} strokeLinejoin="round" />
              {axes.map((_, i) => {
                const p = radarPoint(i, n, scale(Math.max(0, Math.min(max, s.values[i] ?? 0))));
                return <circle key={i} cx={p.x} cy={p.y} r={3} fill={toneVar(s.tone)} stroke="var(--bg-panel)" strokeWidth={1.5} />;
              })}
            </g>
          ))}
          <text x={4} y={-scale(max) - 2} fill="var(--text-secondary)" fontFamily="var(--font-body)" fontSize={10} id={`${uid}-max`}>
            {max}
          </text>
        </Group>
      </svg>
      {legend ? <ChartLegend items={series.map((s) => ({ id: s.id, label: s.label, tone: s.tone }))} /> : null}
    </figure>
  );
}
