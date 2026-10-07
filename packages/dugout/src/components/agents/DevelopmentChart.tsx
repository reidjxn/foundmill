import { useId, useMemo } from "react";
import { scaleLinear, scaleTime } from "d3-scale";
import { curveMonotoneX, line as d3Line } from "d3-shape";
import type { DeptColourToken } from "@founder-manager/shared";
import { cn } from "../../lib/cn";
import { deptColourVar } from "../../lib/colour";
import { formatDate } from "../../lib/format";
import type { SkillHistorySeries, TrainingSessionMark } from "./types";

export interface DevelopmentChartProps {
  series: readonly SkillHistorySeries[];
  sessions?: readonly TrainingSessionMark[];
  /** Department colour; series differ by opacity and dash so colour is never the only signal. */
  dept: DeptColourToken;
  width?: number;
  height?: number;
  className?: string;
  "aria-label"?: string;
}

const DASHES = ["", "6 3", "2 3", "8 3 2 3"];
const OPACITIES = [1, 0.8, 0.65, 0.5];

export function chartDomain(series: readonly SkillHistorySeries[], sessions: readonly TrainingSessionMark[]): [Date, Date] {
  const times = [...series.flatMap((s) => s.points.map((p) => Date.parse(p.at))), ...sessions.map((s) => Date.parse(s.at))].filter(Number.isFinite);
  if (times.length === 0) return [new Date(0), new Date(1)];
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  return [new Date(lo), new Date(hi === lo ? lo + 86_400_000 : hi)];
}

/** Skill history lines in the department colour with training sessions as diamonds (DESIGN §9 Agent profile). */
export function DevelopmentChart({ series, sessions = [], dept, width = 640, height = 220, className, "aria-label": ariaLabel = "Development chart" }: DevelopmentChartProps) {
  const id = useId();
  const margin = { top: 20, right: 16, bottom: 28, left: 28 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const colour = deptColourVar(dept);
  const [t0, t1] = useMemo(() => chartDomain(series, sessions), [series, sessions]);
  const x = scaleTime().domain([t0, t1]).range([0, innerW]);
  const y = scaleLinear().domain([1, 20]).range([innerH, 0]);
  const gen = d3Line<{ at: string; value: number }>()
    .x((p) => x(new Date(p.at)))
    .y((p) => y(p.value))
    .curve(curveMonotoneX);
  const ticks = x.ticks(Math.max(2, Math.floor(innerW / 110)));
  return (
    <figure className={cn("m-0 flex min-w-0 flex-col gap-2", className)} data-development-chart>
      <div className="overflow-x-auto">
        <svg width={width} height={height} role="img" aria-labelledby={`${id}-title`} className="block">
          <title id={`${id}-title`}>{ariaLabel}</title>
          <g transform={`translate(${margin.left} ${margin.top})`}>
            {[5, 10, 15, 20].map((v) => (
              <g key={v} transform={`translate(0 ${y(v)})`}>
                <line x1={0} x2={innerW} className="stroke-subtle" strokeDasharray={v === 20 ? undefined : "2 3"} />
                <text x={-6} y={3} textAnchor="end" className="fill-secondary font-mono text-[10px] tabular-nums">
                  {v}
                </text>
              </g>
            ))}
            {ticks.map((t) => (
              <text key={t.getTime()} x={x(t)} y={innerH + 18} textAnchor="middle" className="fill-secondary font-body text-[11px]">
                {formatDate(t, "d MMM")}
              </text>
            ))}
            {sessions.map((s) => {
              const sx = x(new Date(s.at));
              return (
                <g key={s.at} transform={`translate(${sx} 0)`} data-session={s.promoted ? "promoted" : "discarded"}>
                  <line y1={0} y2={innerH} className="stroke-subtle" strokeDasharray="3 3" />
                  <rect x={-5} y={-11} width={10} height={10} transform="rotate(45 0 -6)" className={s.promoted ? "fill-gold" : "fill-panel stroke-gold"} strokeWidth={1.5}>
                    <title>{`${formatDate(s.at)}: ${s.label} (${s.promoted ? "promoted" : "discarded"})`}</title>
                  </rect>
                </g>
              );
            })}
            {series.map((s, i) => (
              <g key={s.skillId} data-series={s.skillId}>
                <path d={gen(s.points) ?? ""} fill="none" stroke={colour} strokeOpacity={OPACITIES[i % OPACITIES.length]} strokeWidth={2} strokeDasharray={DASHES[i % DASHES.length] || undefined} strokeLinecap="round" />
                {s.points.map((p) => (
                  <circle key={p.at} cx={x(new Date(p.at))} cy={y(p.value)} r={2.5} fill={colour} fillOpacity={OPACITIES[i % OPACITIES.length]}>
                    <title>{`${s.name}: ${p.value} on ${formatDate(p.at)}`}</title>
                  </circle>
                ))}
              </g>
            ))}
          </g>
        </svg>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-secondary">
        {series.map((s, i) => (
          <span key={s.skillId} className="inline-flex items-center gap-1.5">
            <svg width={22} height={8} aria-hidden>
              <line x1={1} x2={21} y1={4} y2={4} stroke={colour} strokeOpacity={OPACITIES[i % OPACITIES.length]} strokeWidth={2} strokeDasharray={DASHES[i % DASHES.length] || undefined} />
            </svg>
            {s.name}
            <span className="tabular-nums text-primary">{s.points[s.points.length - 1]?.value ?? "—"}</span>
          </span>
        ))}
        {sessions.length ? (
          <span className="inline-flex items-center gap-1.5">
            <svg width={10} height={10} aria-hidden>
              <rect x={1} y={1} width={8} height={8} transform="rotate(45 5 5)" className="fill-gold" />
            </svg>
            Training session (filled: promoted)
          </span>
        ) : null}
      </figcaption>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Skill</th>
            <th scope="col">Date</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {series.flatMap((s) =>
            s.points.map((p) => (
              <tr key={`${s.skillId}-${p.at}`}>
                <td>{s.name}</td>
                <td>{formatDate(p.at)}</td>
                <td>{p.value}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </figure>
  );
}
