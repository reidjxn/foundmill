"use client";
/**
 * NeedsYouList (Today, founder 2026-11-07: "Needs you"): up to three notes from the Inbox's Needs you tab. Each row is
 * the note's subject (entity mentions as links), who it is from and what kind of answer it asks for, then one tap where
 * one tap answers it without the plan compiler (an agent's request, a sign-off, the goal: the note's own option label,
 * "Approve this goal") and **Open** for everything else. The header links "See all in the Inbox"; with nothing waiting
 * the panel says "Nothing needs you right now. The team keeps working."
 */
import type { ReactNode } from "react";
import { ArrowRight, Check, CircleCheck } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button, buttonVariants } from "../foundation/Button";
import { Icon } from "../foundation/Icon";
import { StatusPill } from "../foundation/StatusPill";
import { EntityText } from "../data/EntityText";
import { Panel } from "../shell/Panel";
import { useShellLink } from "../shell/ShellLink";
import type { GridSpan } from "../shell/types";

export interface NeedsYouRow {
  id: string;
  /** The note's subject, as the Inbox shows it (agent markup allowed: `[[ent:<uuid>|Name]]`). */
  subject: string;
  /** Who it is from ("Ines Park"); null for a system note. */
  from?: string | null;
  /** What it asks for, as a short word ("Sign-off", "Request", "Goal", "Your decision", "Go-ahead"). */
  kindLabel?: string;
  /** The note in the Inbox. */
  href: string;
  /** The one option a tap chooses, with the note's own label; absent opens the note instead. */
  quickOption?: { id: string; label: string } | null;
  /** A hard stop that holds Continue. */
  holdsContinue?: boolean;
}

export interface NeedsYouListProps {
  items: readonly NeedsYouRow[];
  /** Every note waiting in Needs you (the panel shows up to three). */
  total: number;
  /** The Inbox's Needs you tab. */
  seeAllHref: string;
  onQuickAnswer?: (row: NeedsYouRow) => void;
  /** The note whose one tap is on its way. */
  pendingId?: string | null;
  /** The line with nothing to show; default "Nothing needs you right now. The team keeps working." */
  emptyText?: ReactNode;
  loading?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  span?: GridSpan;
  className?: string;
}

export const NEEDS_YOU_WORDS = {
  title: "Needs you",
  seeAll: "See all in the Inbox",
  empty: "Nothing needs you right now. The team keeps working.",
  open: "Open",
} as const;

export const NEEDS_YOU_MAX = 3;

/** "3 waiting" / "3 of 7 waiting" for the panel's meta. */
export function needsYouMeta(shown: number, total: number): string | null {
  if (total <= 0) return null;
  return shown < total ? `${shown} of ${total} waiting` : `${total} waiting`;
}

function OpenLink({ href, subject }: { href: string; subject: string }) {
  const renderLink = useShellLink();
  return (
    <>
      {renderLink({
        href,
        className: cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-secondary hover:text-primary"),
        "aria-label": `Open: ${subject.replace(/\[\[ent:[^|\]]+\|([^\]]+)\]\]/g, "$1")}`,
        children: (
          <>
            {NEEDS_YOU_WORDS.open}
            <Icon icon={ArrowRight} size="inline" />
          </>
        ),
      })}
    </>
  );
}

export function NeedsYouList({ items, total, seeAllHref, onQuickAnswer, pendingId, emptyText = NEEDS_YOU_WORDS.empty, loading, error, onRetry, span, className }: NeedsYouListProps) {
  const renderLink = useShellLink();
  const rows = items.slice(0, NEEDS_YOU_MAX);
  const seeAll = renderLink({ href: seeAllHref, className: cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-secondary hover:text-primary"), children: NEEDS_YOU_WORDS.seeAll });
  return (
    <Panel
      title={NEEDS_YOU_WORDS.title}
      span={span}
      meta={needsYouMeta(rows.length, total)}
      actions={<span data-testid="needs-you-see-all">{seeAll}</span>}
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={!loading && !error && rows.length === 0 ? { icon: CircleCheck, children: emptyText, compact: true } : undefined}
      className={className}
      data-testid="needs-you"
      data-count={rows.length}
      flush
    >
      <ul className="m-0 flex list-none flex-col p-0" aria-label={NEEDS_YOU_WORDS.title}>
        {rows.map((row, i) => (
          <li key={row.id} className={cn("flex min-h-control-xl items-center gap-3 px-panel-pad py-2", i > 0 && "border-t border-line")} data-needs-you-row={row.id} data-quick={row.quickOption ? row.quickOption.id : undefined}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <EntityText as="p" className="t-body-strong text-pretty text-primary">
                {row.subject}
              </EntityText>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 t-small text-tertiary">
                {row.kindLabel ? <span>{row.kindLabel}</span> : null}
                {row.from ? <span>From {row.from}</span> : null}
                {row.holdsContinue ? <StatusPill tone="bad">Holds Continue</StatusPill> : null}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {row.quickOption && onQuickAnswer ? (
                <Button size="sm" variant="primary" icon={Check} loading={pendingId === row.id} onClick={() => onQuickAnswer(row)} data-testid="needs-you-quick">
                  {row.quickOption.label}
                </Button>
              ) : null}
              <OpenLink href={row.href} subject={row.subject} />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
