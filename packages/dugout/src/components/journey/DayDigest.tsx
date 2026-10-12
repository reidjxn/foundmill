"use client";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { EntityKind } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { FitText } from "../foundation/FitText";
import { formatMoney, formatNumber } from "../../lib/format";
import { Button } from "../foundation/Button";
import { Chip, ProvenanceChip } from "../foundation/Chip";
import { useFormatters } from "../foundation/DateFormatProvider";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { EntityText } from "./EntityText";
import type { DaySummary } from "./ribbon/geometry";
import { DEPT_BG, MILESTONE_ICON } from "./ribbon/OnThisDayCard";

export interface DayDigestProps {
  summary: DaySummary;
  /** Narrated highlights for the day (Composer); [[ent:id|Name]] markup renders as entity links. */
  highlights?: string[];
  /** The business's own currency (ISO 4217): every amount here is formatted in it. */
  currency: string;
  onOpenJourney?: (conversionId: string) => void;
  onOpenEntity?: (id: string) => void;
  entityKinds?: Record<string, EntityKind>;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  onClose?: () => void;
  className?: string;
}

const KIND_WORD = { signup: "Signup", activation: "Activation", payment: "Payment" } as const;

/** The day digest card (BUILD §11.2 "click → day digest"): what the squad did, what happened and what it earned. */
export function DayDigest({ summary, highlights = [], currency, onOpenJourney, onOpenEntity, entityKinds, onPrevDay, onNextDay, onClose, className }: DayDigestProps) {
  const { formatDate, formatTime } = useFormatters();
  const p = summary.point;
  const depts = summary.departments.filter((d) => d.hours > 0);
  const maxHours = depts[0]?.hours ?? 1;
  const payments = summary.conversions.filter((c) => c.kind === "payment");
  return (
    <section className={cn("surface-panel flex w-full max-w-2xl flex-col overflow-hidden", className)} aria-label={`Day digest, ${formatDate(summary.day)}`} data-day-digest={summary.day}>
      <header className="flex h-panel-header items-center gap-2 pl-panel-pad pr-1.5 rule-fade">
        <h2 className="t-title min-w-0 flex-1 truncate text-primary">
          {summary.isToday ? "Today · " : ""}
          {formatDate(summary.day, "longDate")}
          {summary.chapter ? <span className="ml-2 text-secondary">{summary.chapter.title ?? summary.chapter.provisionalTitle}</span> : null}
        </h2>
        {summary.isFuture ? <ProvenanceChip kind="forecast" /> : null}
        {onPrevDay ? <IconButton icon={ChevronLeft} label="Previous day" size="sm" onClick={onPrevDay} /> : null}
        {onNextDay ? <IconButton icon={ChevronRight} label="Next day" size="sm" onClick={onNextDay} /> : null}
        {onClose ? <IconButton icon={X} label="Close" size="sm" onClick={onClose} /> : null}
      </header>
      <div className="grid grid-cols-[1fr_240px] gap-gutter p-panel-pad">
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-4 gap-3">
            {[
              ["Revenue", formatMoney({ amountMinor: p?.revenueMinor ?? 0, currency }, { compact: true })],
              ["Spend", formatMoney({ amountMinor: p?.spendMinor ?? 0, currency }, { compact: true })],
              ["Agent hours", formatNumber(p?.totalHours ?? 0, { maxDigits: 1 })],
              ["Tasks done", formatNumber(p?.tasksDone ?? 0, { digits: 0 })],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="t-data">{k}</dt>
                <dd className="t-display-lg tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="neutral">{p?.signups ?? 0} signups</Chip>
            <Chip tone="info">{p?.activations ?? 0} activations</Chip>
            <Chip tone="gold">{p?.payments ?? 0} payments</Chip>
            <Chip tone="neutral">{p?.decisions ?? 0} decisions</Chip>
          </div>
          {highlights.length > 0 ? (
            <div>
              <span className="t-data">Highlights</span>
              <ul className="mt-1 flex flex-col gap-1">
                {highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span aria-hidden className="mt-2 inline-block size-1 shrink-0 rounded-full bg-secondary" />
                    <EntityText text={h} kinds={entityKinds} onOpenEntity={onOpenEntity} className="t-reading" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {summary.milestones.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {summary.milestones.map((m, i) => (
                <li key={m.id ?? i}>
                  <Chip tone={m.kind === "customer" || m.kind === "revenue" || m.kind === "trophy" ? "gold" : "neutral"} icon={MILESTONE_ICON[m.kind]}>
                    {m.label}
                  </Chip>
                </li>
              ))}
            </ul>
          ) : null}
          {summary.conversions.length > 0 ? (
            <div>
              <span className="t-data">Wins</span>
              <ul className="mt-1 flex flex-col divide-y divide-subtle/50">
                {summary.conversions.slice(0, 8).map((c) => (
                  <li key={c.id} className="flex h-row-compact items-center gap-2">
                    <span className="w-16 shrink-0 whitespace-nowrap font-mono text-mono text-secondary">{formatTime(c.occurredAt)}</span>
                    <Chip tone={c.kind === "payment" ? "gold" : c.kind === "activation" ? "info" : "neutral"}>{KIND_WORD[c.kind]}</Chip>
                    <span className="min-w-0 flex-1 truncate">{c.entityId && c.entityName ? <EntityText text={`[[ent:${c.entityId}|${c.entityName}]]`} kinds={entityKinds} onOpenEntity={onOpenEntity} /> : (c.entityName ?? "Anonymous")}</span>
                    {c.kind === "payment" ? <span className="tabular-nums">{formatMoney({ amountMinor: c.amountMinor, currency: c.currency })}</span> : null}
                    <Button size="sm" variant="ghost" className="px-1.5" onClick={() => onOpenJourney?.(c.id)} aria-label={`Open the Customer Update for ${c.entityName ?? KIND_WORD[c.kind]}`}>
                      Replay
                    </Button>
                  </li>
                ))}
                {summary.conversions.length > 8 ? <li className="py-1 text-small text-secondary">+{summary.conversions.length - 8} more in the round-up</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
        <aside className="flex flex-col gap-2" aria-label="Agent hours by department">
          <span className="t-data">Team</span>
          {depts.length === 0 ? <span className="text-small text-secondary">No agent work recorded.</span> : null}
          {depts.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-small">
              <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", DEPT_BG[d.dept])} />
              <span className="w-24 shrink-0" title={d.name}>
                <FitText minPx={11}>{d.name}</FitText>
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
                <span className={cn("block h-full", DEPT_BG[d.dept])} style={{ width: `${Math.round((d.hours / maxHours) * 100)}%` }} />
              </span>
              <span className="w-10 text-right tabular-nums">{formatNumber(d.hours, { maxDigits: 1 })}h</span>
            </div>
          ))}
          {payments.length > 0 ? (
            <p className="mt-auto flex items-center gap-1 text-small text-secondary">
              <Icon icon={MILESTONE_ICON.customer} size="inline" className="text-gold" />
              {formatMoney({ amountMinor: payments.reduce((s, c) => s + c.amountMinor, 0), currency }, { compact: true })} won today
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
