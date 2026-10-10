"use client";
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

/**
 * A step rate in words-ready form: whole percent from 10 %, one decimal below ("6.7%"), and "<1%" for a real but tiny
 * share, so a step that converts is never shown as "0%". Exported for tests and callers.
 */
export function funnelRateText(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  if (rate <= 0) return "0%";
  if (rate < 0.01) return "<1%";
  return rate < 0.1 ? formatPercent(rate) : formatPercent(rate, { digits: 0 });
}

/** "Signups" → "signups", "MQL" stays "MQL": a stage name inside a sentence. */
function inSentence(label: string): string {
  const first = label.split(/\s+/)[0] ?? "";
  if (first.length > 1 && first === first.toUpperCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** The rate line beside a stage: "12% to signups" (the first stage has none). Exported for tests. */
export function funnelStepText(stage: FunnelStage, rate: { ofPrevious: number | null }): string {
  return rate.ofPrevious === null ? "" : `${funnelRateText(rate.ofPrevious)} to ${inSentence(stage.label)}`;
}

/** Inter 13 (stage names) and 12 (rates), Barlow 600 13 (counts): about this many px a character (no DOM to measure). */
const LABEL_CHAR_PX = 7.1;
const RATE_CHAR_PX = 6.6;
const COUNT_CHAR_PX = 7.6;

/**
 * Centred horizontal funnel. Width = share of the first stage. Every step says its rate in words ("12% to signups") in a
 * column as wide as its longest rate, so colour is never the only signal and no rate is cut. A count sits inside its
 * bar when the bar can hold it, otherwise just beside it, never over a hairline.
 */
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
  const steps = stages.map((s, i) => funnelStepText(s, rates[i] ?? { ofPrevious: null }));
  const longestLabel = Math.max(0, ...stages.map((s) => s.label.length * LABEL_CHAR_PX));
  const labelW = Math.round(Math.min(width * 0.3, Math.max(64, longestLabel + 12)));
  const rateW = Math.round(Math.min(width * 0.36, Math.max(0, ...steps.map((t) => t.length * RATE_CHAR_PX)) + 8));
  const barMax = Math.max(40, width - labelW - rateW - 16);
  const { tip, show, hide } = useChartTooltip<number>();
  const summary = stages.map((s, i) => `${s.label} ${format(s.value)}${rates[i]?.ofPrevious !== null && rates[i]?.ofPrevious !== undefined ? ` (${funnelRateText(rates[i]!.ofPrevious as number)} of previous)` : ""}`).join(", ");
  const clip = (text: string, room: number, charPx: number) => (text.length * charPx <= room ? text : `${text.slice(0, Math.max(3, Math.floor(room / charPx) - 1))}…`);
  return (
    <>
      <svg width={width} height={height} role="img" aria-label={`${label}. ${summary}`} className="block">
        {stages.map((s, i) => {
          const share = Math.max(0, Math.min(1, s.value / first));
          const w = Math.max(2, share * barMax);
          const x = labelW + (barMax - w) / 2;
          const y = 4 + i * rowHeight;
          const h = rowHeight - 8;
          const count = format(s.value);
          const countW = count.length * COUNT_CHAR_PX;
          // Inside the bar only when the bar holds the count with room to spare; otherwise beside the bar's right end.
          const inside = w >= countW + 16;
          const stageLabel = clip(s.label, labelW - 8, LABEL_CHAR_PX);
          const step = steps[i] ?? "";
          const stepShown = clip(step, rateW, RATE_CHAR_PX);
          return (
            <g key={s.label} data-funnel-stage={s.label} onPointerMove={(e) => show(e.nativeEvent.offsetX, e.nativeEvent.offsetY, i)} onPointerLeave={hide}>
              <text x={labelW - 8} y={y + h / 2} textAnchor="end" dominantBaseline="central" fill="var(--text-primary)" fontFamily="var(--font-body)" fontSize={13}>
                {stageLabel !== s.label ? <title>{s.label}</title> : null}
                {stageLabel}
              </text>
              <rect x={x} y={y} width={w} height={h} rx={2} fill={toneVar(tone)} fillOpacity={0.9 - i * (0.5 / Math.max(1, stages.length - 1))} />
              <text
                x={inside ? labelW + barMax / 2 : x + w + 6}
                y={y + h / 2}
                textAnchor={inside ? "middle" : "start"}
                dominantBaseline="central"
                fill={inside && share > 0.35 ? "var(--kit-on-primary)" : "var(--text-primary)"}
                fontFamily="var(--font-display)"
                fontWeight={600}
                fontSize={13}
                className="tabular-nums"
                data-funnel-count={inside ? "inside" : "beside"}
              >
                {count}
              </text>
              {step ? (
                <text x={labelW + barMax + 8} y={y + h / 2} dominantBaseline="central" fill="var(--text-secondary)" fontFamily="var(--font-body)" fontSize={12} className="tabular-nums" data-funnel-rate>
                  {stepShown !== step ? <title>{step}</title> : null}
                  {stepShown}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {tip ? (
        <ChartTooltip x={tip.x} y={tip.y} width={width}>
          <div className="t-label">{stages[tip.datum]?.label}</div>
          <div className="tabular-nums">{format(stages[tip.datum]?.value ?? 0)}</div>
          {rates[tip.datum]?.ofPrevious !== null && rates[tip.datum]?.ofPrevious !== undefined ? <div className="text-secondary">{funnelRateText(rates[tip.datum]!.ofPrevious as number)} of the previous step</div> : null}
          {rates[tip.datum]?.ofFirst !== null && rates[tip.datum]?.ofFirst !== undefined ? <div className="text-secondary">{funnelRateText(rates[tip.datum]!.ofFirst as number)} of the first</div> : null}
        </ChartTooltip>
      ) : null}
    </>
  );
}
