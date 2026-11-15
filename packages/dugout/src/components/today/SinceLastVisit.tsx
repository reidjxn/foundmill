"use client";
/**
 * SinceLastVisit (Today; retention plan, founder 2026-11-11): "Since you were last here" — what the team did between
 * the founder's previous visit and now, in a few plain lines built from data (apps/web today-view.ts `sinceLastVisitLines`).
 * Shown only when something happened; a line may link to where it is (the Inbox, Milestones). Spend says Estimate.
 */
import { ArrowRight } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { Panel } from "../shell/Panel";
import { useShellLink } from "../shell/ShellLink";
import type { GridSpan } from "../shell/types";

export interface SinceLastVisitLine {
  id: string;
  text: string;
  /** Where the line's link goes, with its label. */
  link?: { href: string; label: string };
  /** Gold for a win or a milestone (DESIGN: gold is reserved for customers and milestones). */
  tone?: "gold" | "default";
}

export interface SinceLastVisitProps {
  /** "Since Tue, Nov 10, 6:42 PM". */
  meta: string;
  lines: readonly SinceLastVisitLine[];
  span?: GridSpan;
  className?: string;
}

export const SINCE_LAST_VISIT_WORDS = { title: "Since you were last here" } as const;

export function SinceLastVisit({ meta, lines, span, className }: SinceLastVisitProps) {
  const renderLink = useShellLink();
  if (lines.length === 0) return null;
  return (
    <Panel title={SINCE_LAST_VISIT_WORDS.title} meta={meta} span={span} className={className} data-testid="since-last-visit">
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-col gap-1 @page-wide:flex-row @page-wide:items-baseline @page-wide:justify-between @page-wide:gap-4" data-line={l.id}>
            <span className={cn("t-body text-pretty", l.tone === "gold" ? "text-gold" : "text-primary")}>{l.text}</span>
            {l.link
              ? renderLink({
                  href: l.link.href,
                  className: "t-small inline-flex min-h-tap shrink-0 items-center gap-1 text-secondary hover:text-primary @page-wide:min-h-0",
                  children: (
                    <>
                      {l.link.label}
                      <Icon icon={ArrowRight} size="inline" />
                    </>
                  ),
                })
              : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
