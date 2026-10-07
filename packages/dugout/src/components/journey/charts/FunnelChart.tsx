import { cn } from "../../../lib/cn";
import { formatNumber, formatPercent } from "../../../lib/format";
import { ProvenanceChip } from "../../foundation/Chip";
import { ChartTooltip, Responsive, toneVar, useChartTooltip, type SeriesTone } from "./common";

export interface FunnelStage {
  label: string;
  value: number;
}

export interface FunnelChartProps {
  stages: FunnelStage[];
  label: string;
  width?: number;
  /** Row height per stage. Default 36. */
  rowHeight?: number;
  tone?: SeriesTone;
  format?: (v: number) => string;
  provenance?: "forecast" | "estimate";
  className?: string;
}

/** Step conversion rates: each stage against the previous and against the first. */
export function funnelRates(stages: readonly FunnelStage[]): Array<{ ofPrevious: number | null; ofFirst: number | null }> {
  const first = stages[0]?.value ?? 0;
  return stages.map((s, i) => {
    const prev = i === 0 ? null : (stages[i - 1]?.value ?? 0);
    return { ofPrevious: prev === null ? null : prev > 0 ? s.value / prev : null, ofFirst: i === 0 ? null : first > 0 ? s.value / first : null };
  });
}

/** Centred horizontal funnel. Width = share of the first stage; every step prints its rate so colour is never the only signal. */
export function FunnelChart({ stages, label, width, rowHeight = 36, tone = "kit", format = (v) => formatNumber(v, { digits: 0 }), provenance, className }: FunnelChartProps) {
  const height = stages.length * rowHeight + 8;
  const rates = funnelRates(stages);
  const first = Math.max(1e-9, stages[0]?.value ?? 0);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Responsive width={width} height={height}>
        {(w) => <FunnelSvg stages={stages} rates={rates} first={first} width={w} height={height} rowHeight={rowHeight} tone={tone} format={format} label={label} />}
      </Responsive>
      {provenance ? (
        <div className="px-1">
          <ProvenanceChip kind={provenance} />
        </div>
      ) : null}
    </div>
  );
}

function FunnelSvg({ stages, rates, first, width, height, rowHeight, tone, format, label }: { stages: FunnelStage[]; rates: ReturnType<typeof funnelRates>; first: number; width: number; height: number; rowHeight: number; tone: SeriesTone; format: (v: number) => string; label: string }) {
  const labelW = Math.min(140, Math.max(80, width * 0.22));
  const rateW = 88;
  const barMax = Math.max(40, width - labelW - rateW - 16);
  const { tip, show, hide } = useChartTooltip<number>();
  const summary = stages.map((s, i) => `${s.label} ${format(s.value)}${rates[i]?.ofPrevious !== null && rates[i]?.ofPrevious !== undefined ? ` (${formatPercent(rates[i]!.ofPrevious as number)} of previous)` : ""}`).join(", ");
  return (
    <>
      <svg width={width} height={height} role="img" aria-label={`${label}. ${summary}`} className="block">
        {stages.map((s, i) => {
          const share = Math.max(0, Math.min(1, s.value / first));
          const w = Math.max(2, share * barMax);
          const x = labelW + (barMax - w) / 2;
          const y = 4 + i * rowHeight;
          const h = rowHeight - 8;
          const r = rates[i];
          return (
            <g key={s.label} data-funnel-stage={s.label} onPointerMove={(e) => show(e.nativeEvent.offsetX, e.nativeEvent.offsetY, i)} onPointerLeave={hide}>
              <text x={labelW - 8} y={y + h / 2} textAnchor="end" dominantBaseline="central" fill="var(--text-primary)" fontFamily="var(--font-body)" fontSize={13}>
                {s.label}
              </text>
              <rect x={x} y={y} width={w} height={h} rx={2} fill={toneVar(tone)} fillOpacity={0.9 - i * (0.5 / Math.max(1, stages.length - 1))} />
              <text x={labelW + barMax / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" fill={share > 0.35 ? "var(--kit-on-primary)" : "var(--text-primary)"} fontFamily="var(--font-display)" fontWeight={600} fontSize={13} className="tabular-nums">
                {format(s.value)}
              </text>
              <text x={labelW + barMax + 8} y={y + h / 2} dominantBaseline="central" fill="var(--text-secondary)" fontFamily="var(--font-body)" fontSize={12} className="tabular-nums">
                {r?.ofPrevious === null || r?.ofPrevious === undefined ? "100%" : `${formatPercent(r.ofPrevious)} · ${formatPercent(r.ofFirst ?? 0)}`}
              </text>
            </g>
          );
        })}
      </svg>
      {tip ? (
        <ChartTooltip x={tip.x} y={tip.y} width={width}>
          <div className="t-label">{stages[tip.datum]?.label}</div>
          <div className="tabular-nums">{format(stages[tip.datum]?.value ?? 0)}</div>
          {rates[tip.datum]?.ofPrevious !== null && rates[tip.datum]?.ofPrevious !== undefined ? <div className="text-secondary">{formatPercent(rates[tip.datum]!.ofPrevious as number)} of the previous step</div> : null}
          {rates[tip.datum]?.ofFirst !== null && rates[tip.datum]?.ofFirst !== undefined ? <div className="text-secondary">{formatPercent(rates[tip.datum]!.ofFirst as number)} of the first</div> : null}
        </ChartTooltip>
      ) : null}
    </>
  );
}
