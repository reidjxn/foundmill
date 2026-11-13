"use client";
/**
 * PublicPageNote (Today; docs/THESIS_REVIEW.md package 1.1): one quiet line while the project has no public page live,
 * pointing at Product › Public page. Not a task and not a warning: no count, no color, no badge. The API answers
 * `today.get` › `pageReady` (never for a sample business); the host renders this only then.
 */
import { ArrowRight, Globe } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { spanClass } from "../shell/PageGrid";
import { useShellLink } from "../shell/ShellLink";
import type { GridSpan } from "../shell/types";

export const PUBLIC_PAGE_NOTE_WORDS = { line: "Your project's public page is ready to check", open: "Open" } as const;

export interface PublicPageNoteProps {
  /** Product › Public page in this business. */
  href: string;
  span?: GridSpan;
  className?: string;
}

export function PublicPageNote({ href, span = 12, className }: PublicPageNoteProps) {
  const renderLink = useShellLink();
  return (
    <div className={cn("min-w-0", spanClass(span), className)} data-testid="public-page-note">
      {renderLink({
        href,
        className: "group flex min-h-tap items-center gap-2.5 py-2 @page-wide:min-h-control-lg @page-wide:py-0 rounded-md border border-line bg-surface-1 px-panel-pad text-secondary transition-colors duration-hover hover:border-line-strong hover:text-primary focus-ring",
        children: (
          <>
            <Icon icon={Globe} className="shrink-0 text-tertiary group-hover:text-secondary" />
            <span className="t-body min-w-0 flex-1">{PUBLIC_PAGE_NOTE_WORDS.line}</span>
            <span className="t-action inline-flex shrink-0 items-center gap-1">
              {PUBLIC_PAGE_NOTE_WORDS.open}
              <Icon icon={ArrowRight} size="inline" />
            </span>
          </>
        ),
      })}
    </div>
  );
}
