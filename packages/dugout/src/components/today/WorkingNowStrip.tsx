"use client";
/**
 * WorkingNowStrip (Today; WP-14 T5, the founder's brief of Nov 17, 2026, A10: show the work): while the team is
 * working, one quiet line for each agent with what it is doing in the founder's words (`today.get` › `workingNow`: the
 * running tasks by their founder-facing titles). Quiet by design: no panel, no progress, no cost, no motion beyond one
 * small dot; the detail is one link away on Working now. With nobody working the host passes no lines and this renders
 * nothing: the strip is absent, never empty.
 */
import { ArrowRight } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { spanClass } from "../shell/PageGrid";
import { useShellLink } from "../shell/ShellLink";
import type { GridSpan } from "../shell/types";

export interface WorkingNowStripLine {
  /** The agent's id (the row's key). */
  id: string;
  /** The agent as the reader names agents ("Rhea Stone", or "Backend engineer"). */
  agent: string;
  /** What it is doing, in the founder's words. */
  doing: string;
}

export interface WorkingNowStripProps {
  lines: readonly WorkingNowStripLine[];
  /** Where the work can be watched (the Working now tab); no link without it. */
  href?: string;
  span?: GridSpan;
  className?: string;
}

export const WORKING_NOW_WORDS = { title: "Working now", open: "See the work" } as const;

export function WorkingNowStrip({ lines, href, span = 12, className }: WorkingNowStripProps) {
  const renderLink = useShellLink();
  if (lines.length === 0) return null;
  return (
    <section aria-label={WORKING_NOW_WORDS.title} className={cn("flex min-w-0 flex-col gap-1 px-panel-pad text-secondary", spanClass(span), className)} data-testid="working-now">
      <div className="flex items-center gap-2">
        <span aria-hidden className="block size-1.5 shrink-0 rounded-full bg-accent" />
        <h2 className="t-data m-0">{WORKING_NOW_WORDS.title}</h2>
        {href
          ? renderLink({
              href,
              className: "t-small ml-auto inline-flex min-h-tap shrink-0 items-center gap-1 text-tertiary transition-colors duration-hover hover:text-primary focus-ring @page-wide:min-h-0",
              children: (
                <>
                  {WORKING_NOW_WORDS.open}
                  <Icon icon={ArrowRight} size="inline" />
                </>
              ),
            })
          : null}
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {lines.map((l) => (
          <li key={l.id} className="t-small min-w-0 text-pretty" data-working-now-line>
            <span className="text-primary">{l.agent}</span>: {l.doing}
          </li>
        ))}
      </ul>
    </section>
  );
}
