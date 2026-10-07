import { Banknote, Diamond, Flag, Landmark, Rocket, Trophy } from "lucide-react";
import type { MilestoneKind } from "@founder-manager/shared";
import { cn } from "../../../lib/cn";
import { formatDate, formatMoney, formatNumber } from "../../../lib/format";
import { ProvenanceChip } from "../../foundation/Chip";
import { Icon, type IconComponent } from "../../foundation/Icon";
import type { ForecastPoint } from "../types";
import type { DaySummary } from "./geometry";

export const MILESTONE_ICON: Record<MilestoneKind, IconComponent> = {
  customer: Trophy,
  revenue: Trophy,
  trophy: Trophy,
  release: Flag,
  decision: Diamond,
  incorporation: Landmark,
  funding: Banknote,
  launch: Rocket,
};

/** Static class maps so Tailwind emits the department utilities. */
export const DEPT_BG: Record<string, string> = { "dept-1": "bg-dept-1", "dept-2": "bg-dept-2", "dept-3": "bg-dept-3", "dept-4": "bg-dept-4", "dept-5": "bg-dept-5", "dept-6": "bg-dept-6", "dept-7": "bg-dept-7", "dept-8": "bg-dept-8" };
export const DEPT_TEXT: Record<string, string> = { "dept-1": "text-dept-1", "dept-2": "text-dept-2", "dept-3": "text-dept-3", "dept-4": "text-dept-4", "dept-5": "text-dept-5", "dept-6": "text-dept-6", "dept-7": "text-dept-7", "dept-8": "text-dept-8" };

export interface OnThisDayCardProps {
  summary: DaySummary;
  forecastPoint?: ForecastPoint | null;
  currency?: string;
  onOpenJourney?: (conversionId: string) => void;
  className?: string;
}

const KIND_WORD = { signup: "Signup", activation: "Activation", payment: "Payment" } as const;

/** The Ribbon's hover scrubber card (BUILD §11.2 "On this day"). Compact; the click target opens the DayDigest. */
export function OnThisDayCard({ summary, forecastPoint, currency = "EUR", onOpenJourney, className }: OnThisDayCardProps) {
  const p = summary.point;
  const top = summary.departments.filter((d) => d.hours > 0).slice(0, 4);
  const maxHours = top[0]?.hours ?? 1;
  return (
    <div className={cn("surface-overlay w-72 p-3 text-body text-primary", className)} data-on-this-day={summary.day}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-display-sm">{summary.isToday ? "Today" : formatDate(summary.day, "EEE d MMM yyyy")}</span>
        {summary.chapter ? <span className="t-label truncate">{summary.chapter.title ?? summary.chapter.provisionalTitle}</span> : null}
      </div>
      {summary.isFuture ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <ProvenanceChip kind="forecast" />
            <span className="text-small text-secondary">Not yet played</span>
          </div>
          {forecastPoint ? (
            <dl className="grid grid-cols-3 gap-2 tabular-nums">
              <div>
                <dt className="t-label">Base</dt>
                <dd>{formatMoney({ amountMinor: forecastPoint.baseMinor, currency }, { compact: true })}</dd>
              </div>
              <div>
                <dt className="t-label">Upside</dt>
                <dd>{formatMoney({ amountMinor: forecastPoint.upsideMinor, currency }, { compact: true })}</dd>
              </div>
              <div>
                <dt className="t-label">Downside</dt>
                <dd>{formatMoney({ amountMinor: forecastPoint.downsideMinor, currency }, { compact: true })}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-4 gap-2 tabular-nums">
            <div>
              <dt className="t-label">Revenue</dt>
              <dd>{formatMoney({ amountMinor: p?.revenueMinor ?? 0, currency }, { compact: true })}</dd>
            </div>
            <div>
              <dt className="t-label">Signups</dt>
              <dd>{formatNumber(p?.signups ?? 0, { digits: 0 })}</dd>
            </div>
            <div>
              <dt className="t-label">Active</dt>
              <dd>{formatNumber(p?.activations ?? 0, { digits: 0 })}</dd>
            </div>
            <div>
              <dt className="t-label">Paid</dt>
              <dd>{formatNumber(p?.payments ?? 0, { digits: 0 })}</dd>
            </div>
          </dl>
          <div className="mt-2 flex flex-col gap-1">
            <span className="t-label">Agent hours · {formatNumber(p?.totalHours ?? 0, { maxDigits: 1 })}</span>
            {top.length === 0 ? <span className="text-small text-secondary">No agent work recorded</span> : null}
            {top.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-small">
                <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", DEPT_BG[d.dept])} />
                <span className="w-24 truncate text-secondary">{d.name}</span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-panel">
                  <span className={cn("block h-full", DEPT_BG[d.dept])} style={{ width: `${Math.round((d.hours / maxHours) * 100)}%` }} />
                </span>
                <span className="w-9 text-right tabular-nums">{formatNumber(d.hours, { maxDigits: 1 })}h</span>
              </div>
            ))}
          </div>
        </>
      )}
      {summary.milestones.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5">
          {summary.milestones.map((m, i) => (
            <li key={m.id ?? i} className="flex items-center gap-1.5 text-small">
              <Icon icon={MILESTONE_ICON[m.kind]} size="inline" className={m.kind === "customer" || m.kind === "revenue" || m.kind === "trophy" ? "text-gold" : "text-secondary"} />
              <span>{m.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary.conversions.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5 border-t border-subtle pt-2">
          {summary.conversions.slice(0, 3).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-chip px-1 py-0.5 text-left text-small hover:bg-white/6"
                onClick={() => onOpenJourney?.(c.id)}
                data-conversion-id={c.id}
              >
                <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", c.kind === "payment" ? "bg-gold" : c.kind === "activation" ? "border border-primary" : "bg-secondary")} />
                <span className="truncate">{c.entityName ?? KIND_WORD[c.kind]}</span>
                <span className="ml-auto text-secondary">{c.kind === "payment" ? formatMoney({ amountMinor: c.amountMinor, currency: c.currency }) : KIND_WORD[c.kind]}</span>
              </button>
            </li>
          ))}
          {summary.conversions.length > 3 ? <li className="px-1 text-small text-secondary">+{summary.conversions.length - 3} more</li> : null}
        </ul>
      ) : null}
      <p className="mt-2 text-small text-secondary">Click to open the day</p>
    </div>
  );
}
