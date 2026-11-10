/**
 * WeekPlan (Today, founder 2026-11-07: "This week and next"): three to five plain sentences in two groups, what the
 * team did this week and what comes next, built from data (packages/shared today-words.ts) and shown as they are. A
 * planned date carries "(Estimate)" in its own sentence. Server-safe.
 */
import type { ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { Panel } from "../shell/Panel";
import type { GridSpan } from "../shell/types";

export interface WeekPlanProps {
  /** What happened this week. */
  done: readonly string[];
  /** What comes next. */
  next: readonly string[];
  loading?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  /** Shown instead of the sentences (no access, nothing to say yet). */
  empty?: ReactNode;
  span?: GridSpan;
  className?: string;
}

export const WEEK_PLAN_WORDS = { title: "This week and next", done: "This week", next: "Next" } as const;

function Group({ label, sentences, id }: { label: string; sentences: readonly string[]; id: string }) {
  if (sentences.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-week-group={id}>
      <span className="t-data">{label}</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {sentences.map((s, i) => (
          <li key={i} className="t-body text-pretty text-primary">
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeekPlan({ done, next, loading, error, onRetry, empty, span, className }: WeekPlanProps) {
  const nothing = done.length === 0 && next.length === 0;
  return (
    <Panel title={WEEK_PLAN_WORDS.title} span={span} loading={loading} error={error} onRetry={onRetry} empty={!loading && !error && (empty || nothing) ? { icon: CalendarClock, children: empty ?? "The week's work shows here after the first round of work, which starts when you press Continue.", compact: true } : undefined} className={className} data-testid="week-plan">
      <div className="grid grid-cols-2 gap-gutter">
        <Group label={WEEK_PLAN_WORDS.done} sentences={done} id="done" />
        <Group label={WEEK_PLAN_WORDS.next} sentences={next} id="next" />
      </div>
    </Panel>
  );
}
