/**
 * WeekOutcomes (Today's headline; WP-14 T4, the founder's brief of Nov 17, 2026, A11): the week's real outcomes as one
 * count with what they were ("This week: 23 real outcomes"). The words come from data (packages/shared week-outcomes.ts,
 * `today.get` › `outcomes`): only what really happened outside the project, never a simulated result, never a cost.
 *
 * A week with none shows no count and no zero: one quiet line with what the team is working toward, or nothing at all
 * when that is not known either (the host passes neither and this renders nothing).
 */
import { cn } from "../../lib/cn";
import { spanClass } from "../shell/PageGrid";
import type { GridSpan } from "../shell/types";

export interface WeekOutcomesProps {
  /** "This week: 23 real outcomes". Null for a week with none. */
  headline: string | null;
  /** "1 payment, 2 replies, your page went live". Shown under the headline. */
  detail?: string | null;
  /** "Working toward: Get the first 10 paying customers by Dec 19". Shown only without a headline. */
  toward?: string | null;
  span?: GridSpan;
  className?: string;
}

export const WEEK_OUTCOMES_WORDS = { label: "This week's outcomes" } as const;

export function WeekOutcomes({ headline, detail, toward, span = 12, className }: WeekOutcomesProps) {
  if (!headline && !toward) return null;
  return (
    <section aria-label={WEEK_OUTCOMES_WORDS.label} className={cn("flex min-w-0 flex-col gap-1 px-panel-pad", spanClass(span), className)} data-testid="week-outcomes" data-state={headline ? "count" : "toward"}>
      {headline ? (
        <>
          <h2 className="t-display-sm m-0 text-pretty text-primary" data-testid="week-outcomes-headline">
            {headline}
          </h2>
          {detail ? (
            <p className="t-body m-0 text-pretty text-secondary" data-testid="week-outcomes-detail">
              {detail}
            </p>
          ) : null}
        </>
      ) : (
        <p className="t-body m-0 text-pretty text-secondary" data-testid="week-outcomes-toward">
          {toward}
        </p>
      )}
    </section>
  );
}
