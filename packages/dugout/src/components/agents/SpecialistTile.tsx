"use client";
import { useState } from "react";
import { FlaskConical, Funnel, ReceiptText, Ship } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatDate, formatMoney } from "../../lib/format";
import { ratingClass } from "../../lib/rating";
import { Chip, ProvenanceChip } from "../foundation/Chip";
import { EmptyState } from "../foundation/EmptyState";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { TileFrame, type TileViewOption } from "./TileFrame";
import type { AgentTileSession, QuoteStatus, RfqStage, SampleStage, Shipment, ShipmentStatus, SpecialistData, SupplierQuote, SampleItem, TileControls, TileTask } from "./types";

export const SPECIALIST_VIEWS: readonly TileViewOption[] = [
  { id: "funnel", label: "RFQ funnel", icon: Funnel },
  { id: "quotes", label: "Quotes", icon: ReceiptText },
  { id: "samples", label: "Samples", icon: FlaskConical },
  { id: "shipments", label: "Shipments", icon: Ship },
];
export type SpecialistView = "funnel" | "quotes" | "samples" | "shipments";

const QUOTE_TONE: Record<QuoteStatus, { tone: StatusTone; word: string }> = {
  received: { tone: "neutral", word: "Received" },
  shortlisted: { tone: "info", word: "Shortlisted" },
  negotiating: { tone: "warn", word: "Negotiating" },
  rejected: { tone: "bad", word: "Rejected" },
  accepted: { tone: "good", word: "Accepted" },
};
const SAMPLE_STAGES: SampleStage[] = ["requested", "shipped", "received", "testing", "approved", "rejected"];
const SAMPLE_WORD: Record<SampleStage, string> = { requested: "Requested", shipped: "Shipped", received: "Received", testing: "Testing", approved: "Approved", rejected: "Rejected" };
const SHIPMENT_TONE: Record<ShipmentStatus, { tone: StatusTone; word: string }> = {
  quoted: { tone: "neutral", word: "Quoted" },
  booked: { tone: "info", word: "Booked" },
  in_transit: { tone: "info", word: "In transit" },
  customs: { tone: "warn", word: "Customs" },
  delivered: { tone: "good", word: "Delivered" },
  delayed: { tone: "bad", word: "Delayed" },
};

/** Conversion between consecutive funnel stages, as "41 of 64 (64%)". */
export function rfqFunnelRates(stages: readonly RfqStage[]): Array<{ stage: RfqStage; rate: number | null; widthPct: number }> {
  const top = stages[0]?.count ?? 0;
  return stages.map((stage, i) => {
    const prev = i === 0 ? null : stages[i - 1]!.count;
    const rate = prev === null ? null : prev > 0 ? stage.count / prev : 0;
    return { stage, rate, widthPct: top > 0 ? Math.max(4, (stage.count / top) * 100) : 0 };
  });
}

export function RfqFunnel({ stages }: { stages: readonly RfqStage[] }) {
  if (stages.length === 0) return <EmptyState icon={Funnel}>The funnel fills as RFQs go out and suppliers reply.</EmptyState>;
  return (
    <ol className="flex flex-col gap-1.5 p-panel-pad" aria-label="RFQ funnel">
      {rfqFunnelRates(stages).map(({ stage, rate, widthPct }) => (
        <li key={stage.id} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2 text-small">
          <span className="truncate text-secondary">{stage.label}</span>
          <span className="relative h-5 overflow-hidden rounded-xs bg-white/6">
            <span className="absolute inset-y-0 left-0 rounded-xs bg-kit-lift/60" style={{ width: `${widthPct}%` }} aria-hidden />
            <span className="relative px-1.5 font-mono text-mono leading-5 text-primary tabular-nums">{stage.count}</span>
          </span>
          <span className="text-right text-secondary tabular-nums">{rate === null ? "—" : `${Math.round(rate * 100)}%`}</span>
        </li>
      ))}
    </ol>
  );
}

export function QuoteTable({ quotes }: { quotes: readonly SupplierQuote[] }) {
  if (quotes.length === 0) return <EmptyState icon={ReceiptText}>Quotes appear here once suppliers reply; prices are extracted through the quarantined reader.</EmptyState>;
  const sorted = quotes.slice().sort((a, b) => b.score - a.score);
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-small">
        <thead className="table-head sticky top-0">
          <tr className="t-data h-control-sm">
            <th scope="col" className="px-2 text-left font-semibold">Supplier</th>
            <th scope="col" className="px-2 text-right font-semibold">Unit</th>
            <th scope="col" className="px-2 text-right font-semibold">MOQ</th>
            <th scope="col" className="px-2 text-right font-semibold">Lead</th>
            <th scope="col" className="px-2 text-right font-semibold">Score</th>
            <th scope="col" className="px-2 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((q) => {
            const s = QUOTE_TONE[q.status];
            return (
              <tr key={q.id} className="h-7 border-b hairline-50 last:border-b-0 hover:bg-white/4">
                <td className="truncate px-2 text-primary">
                  {q.supplier}
                  {q.country ? <span className="ml-1 text-secondary">{q.country}</span> : null}
                </td>
                <td className="px-2 text-right tabular-nums">{formatMoney(q.unitPrice)}</td>
                <td className="px-2 text-right tabular-nums">{q.moq.toLocaleString("en-GB")}</td>
                <td className="px-2 text-right tabular-nums">{q.leadTimeDays} d</td>
                <td className={cn("px-2 text-right", ratingClass(q.score))}>{q.score}</td>
                <td className="px-2">
                  <StatusPill tone={s.tone}>{s.word}</StatusPill>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SampleTracker({ samples }: { samples: readonly SampleItem[] }) {
  if (samples.length === 0) return <EmptyState icon={FlaskConical}>Sample requests show here with their stage and expected arrival.</EmptyState>;
  return (
    <ul className="flex flex-col divide-y divide-subtle/50" aria-label="Sample tracker">
      {samples.map((s) => {
        const idx = SAMPLE_STAGES.indexOf(s.stage);
        const bad = s.stage === "rejected";
        return (
          <li key={s.id} className="flex flex-col gap-1 px-panel-pad py-2 text-small">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-primary">{s.supplier}</span>
              <StatusPill tone={bad ? "bad" : s.stage === "approved" ? "good" : s.stage === "testing" ? "warn" : "info"}>{SAMPLE_WORD[s.stage]}</StatusPill>
              {s.etaAt ? <span className="text-secondary">ETA {formatDate(s.etaAt)}</span> : null}
            </div>
            <ol className="flex gap-0.5" aria-label={`${s.supplier} stages`}>
              {SAMPLE_STAGES.filter((st) => st !== "rejected").map((st, i) => (
                <li key={st} aria-label={`${SAMPLE_WORD[st]}${i <= idx ? ", reached" : ""}`} className={cn("h-1.5 flex-1 rounded-xs", i <= idx ? (bad ? "bg-status-bad" : "bg-status-good") : "cell-empty")} />
              ))}
            </ol>
            {s.note ? <p className="text-secondary">{s.note}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ShipmentList({ shipments }: { shipments: readonly Shipment[] }) {
  if (shipments.length === 0) return <EmptyState icon={Ship}>Freight quotes and bookings appear here with carrier, route and landed cost.</EmptyState>;
  return (
    <ul className="flex flex-col divide-y divide-subtle/50" aria-label="Shipments">
      {shipments.map((sh) => {
        const s = SHIPMENT_TONE[sh.status];
        return (
          <li key={sh.id} className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 px-panel-pad py-2 text-small">
            <span className="font-mono text-mono text-primary">{sh.ref}</span>
            <StatusPill tone={s.tone}>{s.word}</StatusPill>
            <span className="text-secondary">
              {sh.carrier} · {sh.from} → {sh.to}
            </span>
            <span className="text-right text-secondary tabular-nums">{sh.etaAt ? `ETA ${formatDate(sh.etaAt)}` : ""}</span>
            {sh.cost ? (
              <span className="col-span-2 inline-flex items-center gap-1 tabular-nums">
                {formatMoney(sh.cost)} landed <ProvenanceChip kind="estimate" />
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export interface SpecialistTileProps {
  session: AgentTileSession;
  data: SpecialistData;
  view?: SpecialistView;
  defaultView?: SpecialistView;
  onViewChange?: (view: SpecialistView) => void;
  focused?: boolean;
  compact?: boolean;
  controls?: TileControls;
  onFocus?: (sessionId: string) => void;
  onOpenTask?: (task: TileTask) => void;
  now?: Date;
  className?: string;
}

/** Specialist tile (BUILD §11.6): RFQ funnel, quote table, sample tracker and shipment list instead of a terminal. */
export function SpecialistTile({ session, data, view: viewProp, defaultView = "funnel", onViewChange, focused, compact, controls, onFocus, onOpenTask, now, className }: SpecialistTileProps) {
  const [viewState, setViewState] = useState<SpecialistView>(defaultView);
  const view = viewProp ?? viewState;
  const setView = (v: string) => {
    setViewState(v as SpecialistView);
    onViewChange?.(v as SpecialistView);
  };
  return (
    <TileFrame session={session} views={SPECIALIST_VIEWS} view={view} onViewChange={setView} focused={focused} compact={compact} controls={controls} onFocus={onFocus} onOpenTask={onOpenTask} now={now} className={className}>
      <div className="h-full min-h-0 overflow-auto bg-panel">
        {view === "funnel" ? <RfqFunnel stages={data.rfq} /> : null}
        {view === "quotes" ? <QuoteTable quotes={data.quotes} /> : null}
        {view === "samples" ? <SampleTracker samples={data.samples} /> : null}
        {view === "shipments" ? <ShipmentList shipments={data.shipments} /> : null}
        {view === "quotes" && data.quotes.some((q) => q.status === "accepted") ? (
          <p className="flex items-center gap-1 border-t border-line px-panel-pad py-1.5 text-small text-tertiary">
            <Chip tone="warn">Human gate</Chip> Any purchase order needs the founder's approval.
          </p>
        ) : null}
      </div>
    </TileFrame>
  );
}
