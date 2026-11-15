/**
 * StreakStrip (Today; retention plan, founder 2026-11-11: "daily streak"): how many days in a row the founder has opened
 * the business, the last seven days as dots, and one line on what keeps it going. The number and the words come from
 * data (packages/shared streak.ts, `today.streak`); vacation days show as a frozen dot and never break it. Gold marks a
 * milestone day only (DESIGN: gold is for customers and milestones).
 */
import { Flame } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { Panel } from "../shell/Panel";
import type { GridSpan } from "../shell/types";

export type StreakDotState = "visited" | "vacation" | "missed" | "today";

export interface StreakStripProps {
  headline: string;
  line: string;
  /** The last seven days, oldest first, each with a short label ("Mon"). */
  week: readonly { day: string; label: string; state: StreakDotState }[];
  /** A milestone reached today: the number shows in gold. */
  milestone?: boolean;
  /** The streak ends today unless the founder comes back. */
  atRisk?: boolean;
  span?: GridSpan;
  className?: string;
}

export const STREAK_WORDS = { title: "Your streak", vacation: "On vacation: the streak is frozen", visited: "Opened", missed: "Not opened", today: "Today" } as const;

const DOT: Record<StreakDotState, string> = {
  visited: "bg-accent border-accent",
  vacation: "bg-transparent border-info border-dashed",
  missed: "bg-transparent border-line-strong",
  today: "bg-transparent border-accent",
};

export function StreakStrip({ headline, line, week, milestone, atRisk, span, className }: StreakStripProps) {
  return (
    <Panel title={STREAK_WORDS.title} span={span} className={className} data-testid="streak-strip" data-at-risk={atRisk ? "true" : "false"}>
      <div className="flex flex-wrap items-center justify-between gap-gutter">
        <div className="flex min-w-0 items-center gap-3">
          <Icon icon={Flame} size="lg" className={milestone ? "text-gold" : atRisk ? "text-warn" : "text-accent"} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className={cn("t-body-strong", milestone ? "text-gold" : "text-primary")} data-testid="streak-headline">
              {headline}
            </span>
            <span className="t-small text-pretty text-secondary">{line}</span>
          </div>
        </div>
        <ol className="m-0 flex list-none items-end gap-2 p-0" aria-label="The last seven days">
          {week.map((d) => (
            <li key={d.day} className="flex flex-col items-center gap-1" data-state={d.state} title={`${d.label}: ${STREAK_WORDS[d.state === "vacation" ? "vacation" : d.state]}`}>
              <span aria-hidden className={cn("block size-3 rounded-full border", DOT[d.state])} />
              <span className="t-data text-tertiary">{d.label}</span>
              <span className="sr-only">{STREAK_WORDS[d.state === "vacation" ? "vacation" : d.state]}</span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
