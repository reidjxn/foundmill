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

/** Axis labels: Inter 11 at about 6.2 px a character, wrapped to two lines of at most 14 characters where they can. */
const LABEL_CHAR_PX = 6.2;
const LABEL_LINE = 14;
export function wrapRadarLabel(label: string): string[] {
  if (label.length <= LABEL_LINE) return [label];
  const words = label.split(/\s+/);
  let first = "";
  for (const w of words) {
    const next = first ? `${first} ${w}` : w;
    if (next.length > LABEL_LINE && first) break;
    first = next;
  }
  const rest = label.slice(first.length).trim();
  return rest ? [first, rest] : [first];
}

/**
 * Compare's radar (BUILD §11.1): one polygon per concept in department colours, axes labelled, rings at quarters. The
 * labels stay inside the figure: they wrap to two lines and the drawing widens to hold the longest one, so nothing is
 * printed outside its panel.
 */
export function RadarChart({ axes, series, max = 20, size = 280, label, rings = 4, legend = true, className }: RadarChartProps) {
  const uid = useId();
  const pad = 56;
  const r = Math.max(10, (size - pad * 2) / 2);
  const n = Math.max(1, axes.length);
  const wrapped = axes.map((a) => wrapRadarLabel(a.label));
  // Room for the labels on every side: the widest line horizontally, two lines vertically.
  const labelGap = 14;
  let halfW = r + labelGap;
  let halfH = r + labelGap;
  axes.forEach((_, i) => {
    const lines = wrapped[i] ?? [];
    const w = Math.max(0, ...lines.map((l) => l.length * LABEL_CHAR_PX));
    const p = radarPoint(i, n, r + labelGap);
    const anchor = Math.abs(p.x) < 1 ? "middle" : p.x > 0 ? "start" : "end";
    const ext = anchor === "middle" ? w / 2 : w;
    halfW = Math.max(halfW, Math.abs(p.x) + ext + 4);
    halfH = Math.max(halfH, Math.abs(p.y) + lines.length * 13 + 4);
  });
  const width = Math.ceil(Math.max(size, halfW * 2));
  const height = Math.ceil(Math.max(size, halfH * 2));
  const cx = width / 2;
  const cy = height / 2;
  const scale = scaleLinear<number>({ domain: [0, max], range: [0, r] });
  const ringPoints = (level: number): RadialPoint[] => axes.map((_, i) => ({ angle: radarAngle(i, n), radius: scale((max * level) / rings) }));
  const summary = series.map((s) => `${s.label}: ${s.values.map((v, i) => `${axes[i]?.label ?? i} ${v}`).join(", ")}`).join("; ");
  return (
    <figure className={cn("flex max-w-full flex-col items-center gap-2", className)} data-radar>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}. ${summary}`} className="block h-auto max-w-full">
        <Group left={cx} top={cy}>
          {Array.from({ length: rings }, (_, i) => (
            <LineRadial<RadialPoint> key={i} data={ringPoints(i + 1)} angle={(d) => d.angle} radius={(d) => d.radius} curve={curveLinearClosed} fill={i === rings - 1 ? "var(--white)" : "none"} fillOpacity={0.025} stroke="var(--line)" strokeWidth={1} />
          ))}
          {axes.map((a, i) => {
            const end = radarPoint(i, n, r);
            const lab = radarPoint(i, n, r + labelGap);
            const anchor = Math.abs(lab.x) < 1 ? "middle" : lab.x > 0 ? "start" : "end";
            const lines = wrapped[i] ?? [a.label];
            // Labels above the centre grow upwards, below it downwards, so a two-line label never crosses the radar.
            const firstDy = lab.y < -1 ? -(lines.length - 1) * 13 : lab.y > 1 ? 0 : -((lines.length - 1) * 13) / 2;
            return (
              <g key={a.key}>
                <line x1={0} y1={0} x2={end.x} y2={end.y} stroke="var(--line)" strokeWidth={1} />
                <text x={lab.x} y={lab.y + firstDy} textAnchor={anchor} dominantBaseline="central" fill="var(--text-2)" fontFamily="var(--font-body)" fontWeight={500} fontSize={11}>
                  <title>{a.label}</title>
                  {lines.map((l, k) => (
                    <tspan key={k} x={lab.x} dy={k === 0 ? 0 : 13}>
                      {l}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
          {series.map((s) => (
            <g key={s.id} data-radar-series={s.id}>
              <LineRadial<RadialPoint> data={axes.map((_, i) => ({ angle: radarAngle(i, n), radius: scale(Math.max(0, Math.min(max, s.values[i] ?? 0))) }))} angle={(d) => d.angle} radius={(d) => d.radius} curve={curveLinearClosed} fill={toneVar(s.tone)} fillOpacity={0.14} stroke={toneVar(s.tone)} strokeWidth={1.75} strokeLinejoin="round" />
              {axes.map((_, i) => {
                const p = radarPoint(i, n, scale(Math.max(0, Math.min(max, s.values[i] ?? 0))));
                return <circle key={i} cx={p.x} cy={p.y} r={3} fill={toneVar(s.tone)} stroke="var(--surface-1)" strokeWidth={1.5} />;
              })}
            </g>
          ))}
          {/* The scale's top value, just inside the outer ring beside the first axis: never on the first axis's label,
              which sits above the ring. A halo keeps it legible where a polygon's edge crosses it. */}
          <text x={4} y={-scale(max) + 4} dominantBaseline="hanging" className="chart-tick" id={`${uid}-max`} paintOrder="stroke" stroke="var(--surface-1)" strokeWidth={3} strokeLinejoin="round" data-radar-max>
            {max}
          </text>
        </Group>
      </svg>
      {legend ? <ChartLegend items={series.map((s) => ({ id: s.id, label: s.label, tone: s.tone }))} /> : null}
    </figure>
  );
}
