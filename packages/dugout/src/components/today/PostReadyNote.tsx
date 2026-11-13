"use client";
/**
 * PostReadyNote (Today; docs/NETWORK.md F3 "Tap-to-post", F7 "Posting"; docs/DESIGN.md §9g): one quiet line while a
 * post the team wrote waits for the founder to share it, pointing at the post on Customers › Creative. An offer, never
 * a chore: no badge, no color and no number beyond the plain words, the same weight as the public page line. The API
 * answers `today.get` › `postsReady` (never for a sample business); the host renders this only then, and it goes when
 * the post is shared or set aside.
 */
import { ArrowRight, Share2 } from "lucide-react";
import { TEAM_POST_WORDS } from "@foundmill/shared/team-posts";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { spanClass } from "../shell/PageGrid";
import { useShellLink } from "../shell/ShellLink";
import type { GridSpan } from "../shell/types";

export interface PostReadyNoteProps {
  /** The waiting post on Customers › Creative in this business. */
  href: string;
  /** How many posts wait (one line whatever the number). */
  waiting?: number;
  span?: GridSpan;
  className?: string;
}

export function PostReadyNote({ href, waiting = 1, span = 12, className }: PostReadyNoteProps) {
  const renderLink = useShellLink();
  return (
    <div className={cn("min-w-0", spanClass(span), className)} data-testid="post-ready-note">
      {renderLink({
        href,
        className: "group flex min-h-control-lg items-center gap-2.5 rounded-md border border-line bg-surface-1 px-panel-pad text-secondary transition-colors duration-hover hover:border-line-strong hover:text-primary focus-ring",
        children: (
          <>
            <Icon icon={Share2} className="shrink-0 text-tertiary group-hover:text-secondary" />
            <span className="t-body min-w-0 flex-1">{TEAM_POST_WORDS.today(Math.max(1, waiting))}</span>
            <span className="t-action inline-flex shrink-0 items-center gap-1">
              {TEAM_POST_WORDS.open}
              <Icon icon={ArrowRight} size="inline" />
            </span>
          </>
        ),
      })}
    </div>
  );
}
