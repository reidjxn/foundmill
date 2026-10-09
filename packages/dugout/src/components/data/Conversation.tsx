"use client";
import { useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatDateTime, formatRelative } from "../../lib/format";
import { Avatar } from "../foundation/Avatar";
import { EmptyState } from "../foundation/EmptyState";
import { ErrorState } from "../foundation/ErrorState";
import { SkeletonText } from "../foundation/Skeleton";
import { Composer } from "./Composer";

export interface ConversationMessage {
  id: string;
  /** Display name of the sender. */
  author: string;
  /** Sent by the person looking at the screen: aligned right on the raised surface. */
  self?: boolean;
  body: string;
  at: Date | string;
}

export interface ConversationProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSubmit"> {
  /** Oldest first. */
  messages: readonly ConversationMessage[];
  /** Whoever is signed in presses Send; this is called with the trimmed text. */
  onSend: (body: string) => void | Promise<unknown>;
  /** Accessible name for the log and the field, e.g. "Conversation with Priya". */
  label: string;
  sending?: boolean;
  loading?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  /** Shown instead of the log when there are no messages. */
  empty?: ReactNode;
  placeholder?: string;
  /** Small note under the field. */
  note?: ReactNode;
  disabled?: boolean;
}

/**
 * A message thread (BUILD §11.14): the log on top, newest at the bottom and kept in view, the composer underneath.
 * The log is a polite live region, focusable so the arrow keys scroll it. Messages are plain text.
 */
export function Conversation({ messages, onSend, label, sending, loading, error, onRetry, empty, placeholder = "Write a message", note, disabled, className, ...rest }: ConversationProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last, messages.length]);

  let body: ReactNode;
  if (loading) body = <SkeletonText lines={4} className="p-panel-pad" />;
  else if (error) body = <ErrorState onRetry={onRetry} className="py-6">{error}</ErrorState>;
  else if (messages.length === 0) body = <EmptyState icon={MessageSquare} className="py-6">{empty ?? "No messages yet. Write the first one below."}</EmptyState>;
  else
    body = (
      <ol className="flex flex-col gap-0.5 px-panel-pad py-3">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          // Consecutive messages from one person within five minutes read as one group: one name, one face.
          const grouped = !!prev && prev.author === m.author && !!prev.self === !!m.self && Math.abs(new Date(m.at).getTime() - new Date(prev.at).getTime()) < 5 * 60_000;
          const next = messages[i + 1];
          const lastOfGroup = !next || next.author !== m.author || !!next.self !== !!m.self || Math.abs(new Date(next.at).getTime() - new Date(m.at).getTime()) >= 5 * 60_000;
          return (
            <li key={m.id} className={cn("flex max-w-xl gap-2.5", m.self ? "ml-auto flex-row-reverse" : "mr-auto", !grouped && i > 0 && "mt-3")} data-self={m.self || undefined}>
              {m.self ? null : (
                <span className="w-7 shrink-0">{lastOfGroup ? <Avatar size={28} name={m.author} className="mt-auto" /> : null}</span>
              )}
              <div className={cn("flex min-w-0 flex-col gap-1", m.self ? "items-end" : "items-start")}>
                {grouped ? null : (
                  <div className={cn("flex items-baseline gap-2 px-1", m.self && "flex-row-reverse")}>
                    <span className="text-small font-medium text-primary">{m.self ? "You" : m.author}</span>
                    <time dateTime={new Date(m.at).toISOString()} title={formatDateTime(m.at)} className="font-mono text-micro text-tertiary">
                      {formatRelative(m.at)}
                    </time>
                  </div>
                )}
                <p
                  className={cn(
                    "whitespace-pre-wrap break-words px-3 py-2 t-chat text-primary",
                    m.self ? "bubble-self" : "bubble-other",
                    m.self ? (grouped ? "rounded-lg rounded-tr-xs" : "rounded-lg") : grouped ? "rounded-lg rounded-tl-xs" : "rounded-lg",
                    m.self && lastOfGroup && "rounded-br-xs",
                    !m.self && lastOfGroup && "rounded-bl-xs",
                  )}
                >
                  {m.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    );

  return (
    <div className={cn("flex min-h-0 flex-col", className)} data-conversation {...rest}>
      <div ref={logRef} role="log" aria-label={label} aria-live="polite" aria-relevant="additions" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:shadow-ring">
        {body}
      </div>
      <div className="shrink-0 border-t border-line p-panel-pad">
        <Composer aria-label={`Message: ${label}`} onSubmit={onSend} submitting={sending} placeholder={placeholder} note={note} disabled={disabled} rows={2} />
      </div>
    </div>
  );
}
