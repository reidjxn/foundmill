/**
 * StreakStrip (Today; retention plan, founder 2026-11-11: "daily streak"): how many days in a row the founder has opened
 * the business, and a dot for each day of the last seven they opened it. The number and the words come from data
 * (packages/shared streak.ts, `today.visit`). Gold marks a milestone day only (DESIGN: gold is for customers and
 * milestones).
 *
 * Quiet by the founder's decision (WP-04 D5, 2026-11-16): "Hide on day one, the streak appears from the second day. Also
 * make the streak less prominent on the page in general." So it is one small line, not a panel; it shows only the days
 * the founder came (never a day missed) and never warns that the streak is about to end (confirmed by the founder, Nov 19,
 * 2026, WP-10 decision 6). Today draws it from the project's second day, under the goal, the week and Since you were last here.
 */
import { Flame } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { spanClass } from "../shell/PageGrid";
import type { GridSpan } from "../shell/types";

export interface StreakStripProps {
  headline: string;
  line: string;
  /** The days of the last seven the founder opened the business, oldest first, each with a short label ("Mon"). */
  opened: readonly { day: string; label: string }[];
  /** A milestone reached today: the number shows in gold. */
  milestone?: boolean;
  span?: GridSpan;
  className?: string;
}

export const STREAK_WORDS = { title: "Your streak", opened: "Days you opened it this week" } as const;

export function StreakStrip({ headline, line, opened, milestone, span = 12, className }: StreakStripProps) {
  return (
    <section aria-label={STREAK_WORDS.title} className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-panel-pad py-1 text-tertiary", spanClass(span), className)} data-testid="streak-strip">
      <Icon icon={Flame} size="inline" className={milestone ? "text-gold" : "text-tertiary"} />
      <span className={cn("t-small", milestone ? "text-gold" : "text-secondary")} data-testid="streak-headline">
        {headline}
      </span>
      <span className="t-small min-w-0 text-pretty">{line}</span>
      {opened.length ? (
        <ol className="m-0 flex list-none items-center gap-1.5 p-0" aria-label={STREAK_WORDS.opened}>
          {opened.map((d) => (
            <li key={d.day} className="flex items-center" data-day={d.day} title={d.label}>
              <span aria-hidden className="block size-2 rounded-full bg-accent" />
              <span className="sr-only">{d.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
