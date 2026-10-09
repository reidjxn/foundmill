"use client";
/**
 * Messages on /network: the founder's threads on the left (with an unread count each), the open thread on the right
 * with a reply box. Messages are human to human: only the signed-in founder's own Send writes one (`live.messages.send`);
 * agents may draft, never send. Opening a thread marks it read on the server, then the counts are refreshed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MailCheck, MessageSquare, SquarePen } from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { Avatar, Chip, Conversation, EmptyState, Icon, Panel, cn, formatRelative, useToast, type ConversationMessage } from "@foundmill/dugout";
import { otherParticipants, threadTitle } from "@/lib/live";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import type { People } from "./shared";

export type ThreadRow = RouterOutputs["live"]["messages"]["threads"]["items"][number];

/** The open conversation: an existing thread, or a first message to a connection that has no thread yet. */
export type Selection = { kind: "thread"; threadId: string } | { kind: "new"; userId: string } | null;

export interface MessagesPanelProps {
  viewerId: string;
  threads: readonly ThreadRow[];
  unreadTotal: number;
  people: People;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

const NIL_THREAD = "00000000-0000-0000-0000-000000000000";
const REFRESH = ["live.messages.threads", "live.messages.unread", "live.messages.list"] as const;

export function MessagesPanel({ viewerId, threads, unreadTotal, people, selection, onSelect, loading, error, onRetry }: MessagesPanelProps) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();

  const thread = selection?.kind === "thread" ? threads.find((t) => t.id === selection.threadId) : undefined;
  const threadId = selection?.kind === "thread" ? selection.threadId : NIL_THREAD;
  const messagesQ = useQuery(trpc.live.messages.list.queryOptions({ threadId, limit: 200 }, { enabled: selection?.kind === "thread", staleTime: 5_000, refetchInterval: 15_000, retry: false }));

  const refresh = (paths: readonly string[]) => Promise.all(paths.map((p) => qc.invalidateQueries({ queryKey: trpcPathPrefix(p) as unknown[] })));

  // Fetching a thread's messages marks it read on the server; once they have arrived, refresh the counts.
  const unreadHere = thread?.unread ?? 0;
  useEffect(() => {
    if (messagesQ.dataUpdatedAt > 0 && unreadHere > 0) void refresh(["live.messages.threads", "live.messages.unread"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per arrival of messages for a thread with unread ones
  }, [messagesQ.dataUpdatedAt, threadId]);

  const send = useMutation(
    trpc.live.messages.send.mutationOptions({
      onSuccess: (message) => {
        void refresh(REFRESH);
        if (selection?.kind === "new") onSelect({ kind: "thread", threadId: message.threadId });
      },
      onError: (err) => toast({ title: "Message not sent", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const onSend = async (body: string) => {
    if (!selection) return;
    await (selection.kind === "thread" ? send.mutateAsync({ threadId: selection.threadId, body }) : send.mutateAsync({ toUserIds: [selection.userId], body }));
  };

  const messages = useMemo<ConversationMessage[]>(
    () => [...(messagesQ.data?.items ?? [])].reverse().map((m) => ({ id: m.id, author: people.name(m.fromUser), self: m.fromUser === viewerId, body: m.body, at: m.createdAt })),
    [messagesQ.data, people, viewerId],
  );

  const titleOf = (t: ThreadRow) => threadTitle(t, viewerId, (id) => people.person(id));
  const withName = selection?.kind === "new" ? people.name(selection.userId) : thread ? titleOf(thread) : "";

  // Arrow keys move through the thread list.
  const listRef = useRef<HTMLUListElement>(null);
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-thread]") ?? []);
    const at = buttons.findIndex((b) => b === document.activeElement);
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.click();
  };

  const hasAny = threads.length > 0 || selection?.kind === "new";
  const unreadChip = threads.length ? unreadTotal > 0 ? <Chip tone="info" icon={Mail}>{unreadTotal} unread</Chip> : <Chip tone="neutral" icon={MailCheck}>All read</Chip> : undefined;

  return (
    <Panel
      title="Messages"
      flush
      loading={loading}
      error={error}
      onRetry={onRetry}
      actions={unreadChip}
      empty={!hasAny ? { icon: MessageSquare, children: "No conversations yet. Right-click a connection and choose Message to start one, or wait for someone to write to you." } : undefined}
      footer="Messages go between people. An agent can draft one for you, but only your own Send sends it."
      data-testid="messages-panel"
    >
      <div className="flex h-120">
        <aside aria-label="Message threads" className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-subtle">
          <ul ref={listRef} onKeyDown={onListKey} className="flex flex-col">
            {selection?.kind === "new" ? (
              <li>
                <button type="button" data-thread="new" aria-current="true" className="flex w-full items-center gap-2 border-b border-subtle/50 bg-panel-alt px-panel-pad py-2 text-left shadow-[inset_3px_0_0_var(--kit-primary)]">
                  <Icon icon={SquarePen} size="default" className="text-secondary" />
                  <span className="min-w-0 flex-1">
                    <span className="t-body-strong block truncate text-primary">New message</span>
                    <span className="block truncate text-small text-secondary">To {withName}</span>
                  </span>
                </button>
              </li>
            ) : null}
            {threads.map((t) => {
              const others = otherParticipants(t, viewerId);
              const active = selection?.kind === "thread" && selection.threadId === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    data-thread={t.id}
                    data-unread={t.unread}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect({ kind: "thread", threadId: t.id })}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-subtle/50 px-panel-pad py-2 text-left outline-none hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-link",
                      active && "bg-panel-alt shadow-[inset_3px_0_0_var(--kit-primary)]",
                    )}
                  >
                    <Avatar size={24} name={people.name(others[0] ?? "")} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-primary", t.unread > 0 ? "t-body-strong" : "text-body")}>{titleOf(t)}</span>
                      <span className="block truncate text-small text-secondary">{t.lastMessageAt ? formatRelative(t.lastMessageAt) : "No messages yet"}</span>
                    </span>
                    {t.unread > 0 ? <Chip tone="info">{t.unread} new</Chip> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {selection ? (
            <>
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-subtle px-panel-pad">
                <span className="t-body-strong min-w-0 truncate text-primary">{withName}</span>
                {thread?.subject && thread.subject.trim() && thread.subject !== withName ? <span className="truncate text-small text-secondary">{thread.subject}</span> : null}
              </div>
              <Conversation
                className="flex-1"
                label={selection.kind === "new" ? `New message to ${withName}` : `Conversation with ${withName}`}
                messages={messages}
                loading={selection.kind === "thread" && messagesQ.isLoading}
                error={messagesQ.error ? errorMessage(messagesQ.error) : undefined}
                onRetry={() => void messagesQ.refetch()}
                empty={selection.kind === "new" ? `Nothing sent to ${withName} yet. Write the first message below.` : undefined}
                placeholder={`Write to ${withName}`}
                sending={send.isPending}
                onSend={onSend}
              />
            </>
          ) : (
            <EmptyState icon={MessageSquare} className="flex-1">
              Pick a conversation to read it and reply.
            </EmptyState>
          )}
        </div>
      </div>
    </Panel>
  );
}
