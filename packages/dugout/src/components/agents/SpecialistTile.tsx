"use client";
import { useState } from "react";
import { FlaskConical, Funnel, ReceiptText, Ship } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatMoney, formatNumber } from "../../lib/format";
import { ratingClass } from "../../lib/rating";
import { Chip, ProvenanceChip } from "../foundation/Chip";
import { useFormatters } from "../foundation/DateFormatProvider";
import { EmptyState } from "../foundation/EmptyState";
import { Icon, type IconComponent } from "../foundation/Icon";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { TileFrame, sessionPill, type TileViewOption } from "./TileFrame";
import type { AgentTileSession, QuoteStatus, RfqStage, SampleStage, Shipment, ShipmentStatus, SpecialistData, SupplierQuote, SampleItem, TileControls, TileTask } from "./types";

export const SPECIALIST_VIEWS: readonly TileViewOption[] = [
  { id: "funnel", label: "RFQ funnel", icon: Funnel },
  { id: "quotes", label: "Quotes", icon: ReceiptText },
  { id: "samples", label: "Samples", icon: FlaskConical },
  { id: "shipments", label: "Shipments", icon: Ship },
];
export type SpecialistView = "funnel" | "quotes" | "samples" | "shipments";

/** Each view's icon and what it counts, for a tile whose view has nothing yet. */
const VIEW_EMPTY: Record<SpecialistView, { icon: IconComponent; noneYet: string; none: string }> = {
  funnel: { icon: Funnel, noneYet: "No RFQs sent yet", none: "no RFQs sent" },
  quotes: { icon: ReceiptText, noneYet: "No quotes in yet", none: "no quotes in" },
  samples: { icon: FlaskConical, noneYet: "No samples requested yet", none: "no samples requested" },
  shipments: { icon: Ship, noneYet: "No shipments booked yet", none: "no freight booked" },
};

/** Does `view` have anything to show? */
export function specialistViewEmpty(view: SpecialistView, data: SpecialistData): boolean {
  if (view === "funnel") return data.rfq.length === 0;
  if (view === "quotes") return data.quotes.length === 0;
  if (view === "samples") return data.samples.length === 0;
  return data.shipments.length === 0;
}

const VIEW_ORDER: readonly SpecialistView[] = ["funnel", "quotes", "samples", "shipments"];

/** The view a specialist tile opens on: the first with something to show, else the RFQ funnel. */
export function defaultSpecialistView(data: SpecialistData): SpecialistView {
  return VIEW_ORDER.find((v) => !specialistViewEmpty(v, data)) ?? "funnel";
}

/** What every view says when a specialist has no supplier records at all (a chemist's stability task never sends an RFQ). */
const NO_RECORDS = { noneYet: "No supplier records yet", none: "no supplier records yet" };

/**
 * The empty line of one specialist tile's view, specific to that tile: what the view is still missing, in the
 * session's own state ("Paused · no RFQs sent"), over the task's brief (its goal, else the agent and the task). A
 * wall of specialist tiles never repeats one generic sentence. With `allEmpty` (nothing in any view, on the view the
 * tile opened on) the line names no view: "In review · no supplier records yet", not an RFQ the specialist never had
 * to send (TPD-23).
 */
export function specialistEmptyCopy(view: SpecialistView, session: Pick<AgentTileSession, "status" | "phase" | "agent" | "task" | "queued">, opts: { allEmpty?: boolean } = {}): { title: string; body: string } {
  const v = opts.allEmpty ? NO_RECORDS : VIEW_EMPTY[view];
  const word = sessionPill(session).word;
  const title = session.status === "running" && !session.queued ? v.noneYet : `${word === "Review" ? "In review" : word} · ${v.none}`;
  const goal = session.task.goal?.trim();
  return { title, body: goal || `${session.agent.name} on ${session.task.title}.` };
}

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

/** What the view shows, under the steps (RFQ and funnel are both new words to most founders). */
export const RFQ_FUNNEL_CAPTION = "RFQ funnel: each request for a quote (RFQ), step by step. The share is how many moved on from the step above.";

export function RfqFunnel({ stages }: { stages: readonly RfqStage[] }) {
  if (stages.length === 0) return <EmptyState icon={Funnel}>This fills as requests for quotes go out and suppliers reply.</EmptyState>;
  return (
    <div className="flex flex-col gap-1.5 p-panel-pad">
      <ol className="flex flex-col gap-1.5" aria-label="RFQ funnel">
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
      <p className="text-micro text-tertiary">{RFQ_FUNNEL_CAPTION}</p>
    </div>
  );
}

export function QuoteTable({ quotes }: { quotes: readonly SupplierQuote[] }) {
  if (quotes.length === 0) return <EmptyState icon={ReceiptText}>Quotes appear here once suppliers reply; prices are read from supplier emails.</EmptyState>;
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
                <td className="px-2 text-right tabular-nums">{formatNumber(q.moq, { maxDigits: 0 })}</td>
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
  const { formatDate } = useFormatters();
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
  const { formatDate } = useFormatters();
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

/**
 * Specialist tile (BUILD §11.6): RFQ funnel, quote table, sample tracker and shipment list instead of a terminal. Until
 * the founder picks a view it shows the first one with records (a formulation chemist's samples, a logistics
 * specialist's shipments), and with no records anywhere a line that names no view.
 */
export function SpecialistTile({ session, data, view: viewProp, defaultView, onViewChange, focused, compact, controls, onFocus, onOpenTask, now, className }: SpecialistTileProps) {
  const [viewState, setViewState] = useState<SpecialistView | null>(null);
  const opening = defaultView ?? defaultSpecialistView(data);
  const view = viewProp ?? viewState ?? opening;
  const setView = (v: string) => {
    setViewState(v as SpecialistView);
    onViewChange?.(v as SpecialistView);
  };
  const allEmpty = VIEW_ORDER.every((v) => specialistViewEmpty(v, data));
  const empty = specialistViewEmpty(view, data) ? specialistEmptyCopy(view, session, { allEmpty: allEmpty && !viewProp && viewState === null }) : null;
  return (
    <TileFrame session={session} views={SPECIALIST_VIEWS} view={view} onViewChange={setView} focused={focused} compact={compact} controls={controls} onFocus={onFocus} onOpenTask={onOpenTask} now={now} className={className}>
      <div className="h-full min-h-0 overflow-auto bg-panel [container-type:size]">
        {empty ? (
          // The view's own empty line. The body is a size container: the icon halo and the display-size title appear
          // only when it is tall enough (a full tile), so a short one (the Specialists grid, the focus rail) still
          // shows both lines whole instead of cutting the brief off.
          <div role="status" className="flex min-h-full flex-col items-center justify-center gap-1 px-4 py-2.5 text-center [@container(min-height:190px)]:gap-2" data-specialist-empty={view}>
            <span aria-hidden className="icon-halo hidden size-control-md [@container(min-height:190px)]:inline-flex">
              <Icon icon={VIEW_EMPTY[view].icon} size="default" />
            </span>
            <p className="text-body font-semibold text-balance text-primary [@container(min-height:190px)]:t-display-sm">{empty.title}</p>
            <p className="max-w-sm text-small text-pretty text-secondary">{empty.body}</p>
          </div>
        ) : null}
        {!empty && view === "funnel" ? <RfqFunnel stages={data.rfq} /> : null}
        {!empty && view === "quotes" ? <QuoteTable quotes={data.quotes} /> : null}
        {!empty && view === "samples" ? <SampleTracker samples={data.samples} /> : null}
        {!empty && view === "shipments" ? <ShipmentList shipments={data.shipments} /> : null}
        {view === "quotes" && data.quotes.some((q) => q.status === "accepted") ? (
          <p className="flex items-center gap-1 border-t border-line px-panel-pad py-1.5 text-small text-tertiary">
            <Chip tone="warn">Human gate</Chip> Any purchase order needs the founder's approval.
          </p>
        ) : null}
      </div>
    </TileFrame>
  );
}
