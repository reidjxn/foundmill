/**
 * An example week on the landing page (DESIGN §9a "A first week, from $0"): one row per day, the day in the display
 * face, the line in the reading size. A day that reaches a milestone carries a gold star and the word "Milestone"
 * (gold is reserved for milestones, DESIGN §5; color is never the only signal).
 *
 * Server-safe: plain markup.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { Star } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";

export interface DayListItem {
  /** "Day 1". */
  day: string;
  text: ReactNode;
  /** The day reaches a milestone. */
  milestone?: boolean;
}

export interface DayListProps extends Omit<HTMLAttributes<HTMLOListElement>, "children"> {
  days: readonly DayListItem[];
}

export const DAY_LIST_WORDS = { milestone: "Milestone" } as const;

export function DayList({ days, className, ...rest }: DayListProps) {
  return (
    <ol data-day-list="" className={cn("m-0 flex list-none flex-col gap-4 p-0", className)} {...rest}>
      {days.map((d) => (
        <li key={d.day} className="landing-day border-t border-line-faint pt-4 first:border-t-0 first:pt-0">
          <span className="t-landing-body font-display font-semibold tabular-nums text-primary">{d.day}</span>
          <span className="text-secondary">
            {d.text}
            {d.milestone ? (
              <span className="t-landing-small ml-2 inline-flex items-center gap-1 align-middle text-gold">
                <Icon icon={Star} size="inline" />
                {DAY_LIST_WORDS.milestone}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
