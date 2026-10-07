/**
 * Timeline view of the roadmap (BUILD §11.5 "board + timeline"): one row per scheduled item, a bar from target start
 * to target end tinted by computed status, month ticks along the top and a glowing Today line. Undated items are
 * listed under the chart so nothing disappears when a date is missing. Dates in Later are estimates and say so.
 */
import { CalendarOff } from "lucide-react";
import { Chip, Icon, ProvenanceChip, StatusPill, cn, formatDate } from "@foundmill/dugout";
import { HORIZON_LABEL, computeRoadmapStatus, type RoadmapStatusKey } from "../roadmap-status";
import type { RoadmapRow } from "../types";
import { barSpan, timelineScale } from "./board";

const BAR_CLASS: Record<RoadmapStatusKey, string> = {
  done: "bg-status-good/70",
  blocked: "bg-status-bad/70",
  at_risk: "bg-status-warn/70",
  in_progress: "bg-kit-primary/80",
  awaiting_acceptance: "bg-status-info/70",
  planned: "bg-secondary/40",
};

export function Timeline({ items, today = new Date(), onOpen }: { items: readonly RoadmapRow[]; today?: Date; onOpen: (item: RoadmapRow) => void }) {
  const scheduled = items.filter((i) => i.targetStart || i.targetEnd).slice().sort((a, b) => (a.targetStart ?? a.targetEnd ?? "").localeCompare(b.targetStart ?? b.targetEnd ?? ""));
  const undated = items.filter((i) => !i.targetStart && !i.targetEnd);
  const scale = timelineScale(scheduled, today);
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

  return (
    <div className="flex flex-col gap-3" data-roadmap-timeline>
      <div className="grid grid-cols-[16rem_1fr]">
        <div className="t-label flex h-6 items-end pb-1">Item</div>
        <div className="relative h-6 border-b border-subtle" aria-hidden>
          {scale.ticks.map((t) => (
            <span key={t.label + t.at} className="t-label absolute bottom-1 -translate-x-1/2 whitespace-nowrap" style={{ left: pct(t.at) }}>
              {t.label}
            </span>
          ))}
          {scale.today !== null ? (
            <span className="t-label absolute bottom-1 -translate-x-1/2 whitespace-nowrap text-kit-primary" style={{ left: pct(scale.today) }}>
              Today
            </span>
          ) : null}
        </div>
        {scheduled.map((item) => {
          const span = barSpan(item, scale);
          const status = computeRoadmapStatus(item, today);
          return (
            <div key={item.id} className="contents">
              <button type="button" onClick={() => onOpen(item)} className="flex h-row-comfortable min-w-0 items-center gap-2 border-b border-subtle/50 pr-2 text-left outline-none hover:bg-white/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link">
                <span className="min-w-0 flex-1 truncate text-body-strong text-primary">{item.title}</span>
                <Chip tone="neutral">{HORIZON_LABEL[item.horizon]}</Chip>
              </button>
              <div className="relative h-row-comfortable border-b border-subtle/50" role="img" aria-label={`${item.title}: ${item.targetStart ? formatDate(item.targetStart) : "no start"} to ${item.targetEnd ? formatDate(item.targetEnd) : "no end"}, ${status.word}`}>
                {scale.ticks.map((t) => (
                  <span key={t.at} className="absolute inset-y-0 border-l border-subtle/50" style={{ left: pct(t.at) }} aria-hidden />
                ))}
                {scale.today !== null ? <span data-today-line className="absolute inset-y-0 w-px bg-kit-primary" style={{ left: pct(scale.today), boxShadow: "0 0 8px var(--kit-primary)" }} aria-hidden /> : null}
                {span ? (
                  <span
                    data-bar={item.id}
                    className={cn("absolute top-2 flex h-[18px] items-center gap-1 overflow-hidden rounded-chip px-1.5 text-small text-primary", BAR_CLASS[status.key])}
                    style={{ left: pct(span.left), width: pct(span.width) }}
                    title={`${item.title} · ${status.word}`}
                  >
                    <Icon icon={status.icon} size={12} />
                    <span className="truncate">{status.word}</span>
                    {item.horizon === "later" ? <ProvenanceChip kind="estimate" className="h-4" /> : null}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-small text-secondary">
        Today is the glowing line. Bars take the colour of the computed status; items in Later carry an <StatusPill tone="neutral">Estimate</StatusPill> chip because their dates are not commitments.
      </p>
      {undated.length ? (
        <section aria-label="Unscheduled items" className="flex flex-col gap-1">
          <h3 className="t-label flex items-center gap-1">
            <Icon icon={CalendarOff} size="inline" /> Unscheduled · {undated.length}
          </h3>
          <ul className="flex flex-wrap gap-1">
            {undated.map((item) => (
              <li key={item.id}>
                <Chip tone="neutral" onClick={() => onOpen(item)} title="Edit to set target dates">
                  {item.title} <span className="ml-1 text-secondary">{HORIZON_LABEL[item.horizon]}</span>
                </Chip>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
