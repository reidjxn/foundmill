/**
 * FirstWeekTimeline (Today, founder's report Phase 3 group K "A first week that explains itself"): "Your first week" as
 * three steps (Day 1, Days 2–3, Week 1) in a row. Each step says its state (done, now, next) with a check, a lit dot or
 * a plain ring, its date (the real day for a done step, an Estimate window for the rest), what the team does and what
 * the founder will be asked. The words come from packages/shared first-week.ts as they are; nothing here is hard-coded
 * progress. Read-only: a list, with `aria-current="step"` on the step under way. Server-safe.
 */
import { Check, Circle, CircleDot } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { Panel } from "../shell/Panel";
import type { GridSpan } from "../shell/types";

export type FirstWeekTimelineState = "done" | "now" | "next";

export interface FirstWeekTimelineStep {
  id: string;
  /** "Day 1", "Days 2–3", "Week 1". */
  label: string;
  state: FirstWeekTimelineState;
  /** "Done Oct 7" or "Oct 8 – 9 (Estimate)". */
  when: string;
  /** What the team does. */
  team: string;
  /** What the founder is asked. */
  asks: string;
}

export interface FirstWeekTimelineProps {
  steps: readonly FirstWeekTimelineStep[];
  /** One line when the team is stopped. */
  paused?: string | null;
  span?: GridSpan;
  className?: string;
}

export const FIRST_WEEK_TIMELINE_WORDS = {
  title: "Your first week",
  team: "The team",
  you: "You",
  state: { done: "Done", now: "Now", next: "Next" },
} as const;

const STATE_ICON = { done: Check, now: CircleDot, next: Circle } as const;
const STATE_TEXT = { done: "text-status-good", now: "text-kit-lift", next: "text-tertiary" } as const;

export function FirstWeekTimeline({ steps, paused, span, className }: FirstWeekTimelineProps) {
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <Panel title={FIRST_WEEK_TIMELINE_WORDS.title} span={span} meta={`${done} of ${steps.length} steps done`} className={className} data-testid="first-week-timeline" data-done={done}>
      {paused ? (
        <p className="t-small mb-3 text-status-warn" data-first-week-paused>
          {paused}
        </p>
      ) : null}
      <ol className="m-0 grid list-none grid-cols-1 gap-gutter p-0 @page-wide:grid-cols-3" aria-label={FIRST_WEEK_TIMELINE_WORDS.title}>
        {steps.map((s) => (
          <li key={s.id} className={cn("flex min-w-0 flex-col gap-1.5 border-t pt-2", s.state === "now" ? "border-kit-lift" : "border-line")} aria-current={s.state === "now" ? "step" : undefined} data-first-week-step={s.id} data-state={s.state}>
            <div className="flex items-center gap-2">
              <Icon icon={STATE_ICON[s.state]} size="inline" className={STATE_TEXT[s.state]} aria-hidden />
              <span className="t-body-strong text-primary">{s.label}</span>
              <span className={cn("t-data", STATE_TEXT[s.state])}>{FIRST_WEEK_TIMELINE_WORDS.state[s.state]}</span>
            </div>
            <span className="t-small font-mono text-tertiary" data-first-week-when>
              {s.when}
            </span>
            <p className="t-body m-0 text-pretty text-primary">{s.team}</p>
            <p className="t-body m-0 text-pretty text-secondary">{s.asks}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
