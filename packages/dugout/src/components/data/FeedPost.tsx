import type { HTMLAttributes, ReactNode } from "react";
import { ChevronDown, ChevronRight, MessageSquareReply } from "lucide-react";
import { cn } from "../../lib/cn";
import type { DateFormatPrefs } from "../../lib/date-preferences";
import { formatDateTime, formatRelative } from "../../lib/format";
import { Avatar } from "../foundation/Avatar";
import { Button } from "../foundation/Button";

export interface FeedPostProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** Display name of the author. */
  author: string;
  /** Chip or link after the name: the business the author posted for. */
  badge?: ReactNode;
  /** Chips after the badge about the post itself: "Edited", "Held for review". */
  status?: ReactNode;
  /**
   * The post's own controls at the end of its header, usually a "More" menu (report, edit, delete, a moderator's hide
   * or remove). Omitted: nothing.
   */
  actions?: ReactNode;
  at: Date | string;
  /** The post text, already rendered. */
  children: ReactNode;
  /** Replies under this post. Omit on a reply, which has no thread of its own. */
  replyCount?: number;
  /** Opens the reply box. Omitted: no Reply button. */
  onReply?: () => void;
  /** Shows or hides the replies. Omitted: no toggle. */
  onToggleReplies?: () => void;
  repliesOpen?: boolean;
  /** Replies and the reply box, indented under the post. */
  thread?: ReactNode;
  /**
   * The signed-in person's date format for the full moment on hover (Settings › Preferences): pass `useDateFormat()`
   * from the caller. Server-safe, so the post cannot read it itself; US without it. The relative time never changes.
   */
  datePrefs?: DateFormatPrefs | null;
}

/**
 * One post in a community feed: avatar, author, business badge, status chips, relative time, the post's own controls,
 * the text, a Reply button and a replies toggle (a disclosure: `aria-expanded`). Replies nest one level under `thread`.
 */
export function FeedPost({ author, badge, status, actions, at, children, replyCount, onReply, onToggleReplies, repliesOpen, thread, datePrefs, className, ...rest }: FeedPostProps) {
  const count = replyCount ?? 0;
  return (
    <article className={cn("flex flex-col gap-1.5 border-b border-subtle/50 px-panel-pad py-2.5 last:border-b-0", className)} data-feed-post {...rest}>
      <header className="flex min-w-0 items-center gap-2">
        <Avatar size={24} name={author} />
        <span className="t-body-strong min-w-0 truncate text-primary">{author}</span>
        {badge}
        {status}
        <time dateTime={new Date(at).toISOString()} title={formatDateTime(at, datePrefs)} className="ml-auto shrink-0 text-small text-secondary">
          {formatRelative(at)}
        </time>
        {actions ? <span className="-my-1 flex shrink-0 items-center">{actions}</span> : null}
      </header>
      <div className="pl-8 text-body text-primary">{children}</div>
      {onReply || onToggleReplies ? (
        <footer className="flex items-center gap-1 pl-7">
          {onToggleReplies ? (
            <Button variant="ghost" size="sm" icon={repliesOpen ? ChevronDown : ChevronRight} onClick={onToggleReplies} aria-expanded={!!repliesOpen}>
              {count === 0 ? "No replies" : count === 1 ? "1 reply" : `${count} replies`}
            </Button>
          ) : null}
          {onReply ? (
            <Button variant="ghost" size="sm" icon={MessageSquareReply} onClick={onReply}>
              Reply
            </Button>
          ) : null}
        </footer>
      ) : null}
      {thread ? <div className="ml-8 flex flex-col border-l border-subtle">{thread}</div> : null}
    </article>
  );
}
