"use client";
/**
 * Messages on /network: the founder's threads on the left (with an unread count each), the open thread on the right
 * with a reply box. Messages are human to human: only the signed-in founder's own Send writes one (`live.messages.send`);
 * agents may draft, never send. Opening a thread marks it read on the server, then the counts are refreshed.
 *
 * The thread pane says who is in it (and who left) and has a More menu: mute (no badge, no Inbox note), leave, ask a
 * person in it they are not connected with to connect (after a removed connection, the way back), and block any person
 * in it, connected or not (`live.connections.block`). A thread the founder can no longer write to (a removed connection,
 * a group member they are not connected with, a block) shows why in place of the reply box.
 */
import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Ban, BellOff, BellRing, Lock, LogOut, Mail, MailCheck, MessageSquare, MoreHorizontal, SquarePen, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import {
  Avatar,
  Button,
  Chip,
  Conversation,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  Panel,
  cn,
  formatRelative,
  useToast,
  type ConversationMessage,
} from "@foundmill/dugout";
import { joinNames, leftNote, otherParticipants, threadTitle } from "@/lib/live";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useAskToConnect, useConnectStates } from "./connect";
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
  /** More conversations exist than `threads` holds (the threads query is paged). */
  hasMoreThreads?: boolean;
  onLoadMoreThreads?: () => void;
  loadingMoreThreads?: boolean;
}

/** Messages per page; the log opens on the newest and "Load earlier messages" pages upward. */
export const MESSAGES_PAGE = 50;
const NIL_THREAD = "00000000-0000-0000-0000-000000000000";
const REFRESH = ["live.messages.threads", "live.messages.unread", "live.messages.list", "live.messages.thread", "live.summary"] as const;

/** Why the reply box is gone (`live.messages.thread` closedReason). Blocked and not connected read the same. */
const CLOSED_COPY: Record<string, string> = {
  closed: "You can no longer write here: everyone in a conversation has to be connected with you. Past messages stay readable.",
  alone: "Everyone else has left this conversation.",
  archived: "This conversation is closed.",
};

export function MessagesPanel({ viewerId, threads, unreadTotal, people, selection, onSelect, loading, error, onRetry, hasMoreThreads, onLoadMoreThreads, loadingMoreThreads }: MessagesPanelProps) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();

  const thread = selection?.kind === "thread" ? threads.find((t) => t.id === selection.threadId) : undefined;
  const threadId = selection?.kind === "thread" ? selection.threadId : NIL_THREAD;
  // Newest first, a page at a time: nextCursor leads to older messages, so none is silently out of reach (audit LS2-13).
  const messagesQ = useInfiniteQuery(
    trpc.live.messages.list.infiniteQueryOptions(
      { threadId, limit: MESSAGES_PAGE },
      { getNextPageParam: (last) => last.nextCursor ?? undefined, initialCursor: null, enabled: selection?.kind === "thread", staleTime: 5_000, refetchInterval: 15_000, retry: false },
    ),
  );
  const paneQ = useQuery(trpc.live.messages.thread.queryOptions({ threadId }, { enabled: selection?.kind === "thread", staleTime: 5_000, retry: false }));

  const refresh = (paths: readonly string[]) => Promise.all(paths.map((p) => qc.invalidateQueries({ queryKey: trpcPathPrefix(p) as unknown[] })));

  // Fetching a thread's messages marks it read on the server; once they have arrived, refresh the counts.
  const unreadHere = thread?.unread ?? 0;
  useEffect(() => {
    if (messagesQ.dataUpdatedAt > 0 && unreadHere > 0) void refresh(["live.messages.threads", "live.messages.unread", "live.summary"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per arrival of messages for a thread with unread ones
  }, [messagesQ.dataUpdatedAt, threadId]);

  const send = useMutation(
    trpc.live.messages.send.mutationOptions({
      onSuccess: (message) => {
        void refresh(REFRESH);
        if (selection?.kind === "new") onSelect({ kind: "thread", threadId: message.threadId });
      },
      onError: (err) => {
        void refresh(["live.messages.thread"]);
        toast({ title: "Message not sent", description: errorMessage(err), tone: "bad" });
      },
    }),
  );
  const onSend = async (body: string) => {
    if (!selection) return;
    await (selection.kind === "thread" ? send.mutateAsync({ threadId: selection.threadId, body }) : send.mutateAsync({ toUserIds: [selection.userId], body }));
  };

  // --- the thread's own controls: mute, leave, block a person in it ----------------------------------------------------
  const failed = (title: string) => (err: unknown) => toast({ title, description: errorMessage(err), tone: "bad" });
  const mute = useMutation(trpc.live.messages.mute.mutationOptions({ onSuccess: () => void refresh(REFRESH), onError: failed("Not changed") }));
  const leave = useMutation(
    trpc.live.messages.leave.mutationOptions({
      onSuccess: () => {
        onSelect(null);
        void refresh(REFRESH);
        toast({ title: "You left the conversation", description: "Its messages no longer reach you.", tone: "info" });
      },
      onError: failed("Could not leave"),
    }),
  );
  const block = useMutation(
    trpc.live.connections.block.mutationOptions({
      onSuccess: () => void Promise.all([refresh(REFRESH), refresh(["live.connections"])]),
      onError: failed("Not blocked"),
    }),
  );
  const pane = paneQ.data;
  const muted = pane?.thread.muted ?? thread?.muted ?? false;
  // People here the founder is not connected with and has no request or block with: "Ask to connect" from the menu.
  const connect = useAskToConnect();
  const connectStates = useConnectStates();
  const askable = connect.blocker ? [] : (pane?.participants ?? []).filter((p) => !p.connected && !p.blockedByMe && connectStates.stateOf(p.userId) === "none");

  const messages = useMemo<ConversationMessage[]>(() => {
    const seen = new Set<string>();
    const newestFirst = (messagesQ.data?.pages ?? []).flatMap((p) => p.items).filter((m) => !seen.has(m.id) && !!seen.add(m.id));
    return newestFirst.reverse().map((m) => ({ id: m.id, author: people.name(m.fromUser), self: m.fromUser === viewerId, body: m.body, at: m.createdAt }));
  }, [messagesQ.data, people, viewerId]);

  const titleOf = (t: ThreadRow) => threadTitle(t, viewerId, (id) => people.person(id));
  const withName = selection?.kind === "new" ? people.name(selection.userId) : thread ? titleOf(thread) : "";
  const leftLine = thread ? leftNote(thread.leftIds ?? [], (id) => people.person(id)) : null;
  const closed = selection?.kind === "thread" && pane && !pane.canSend ? (CLOSED_COPY[pane.closedReason ?? "closed"] ?? CLOSED_COPY.closed) : null;

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
                      "flex w-full items-center gap-2 border-b border-subtle/50 px-panel-pad py-2 text-left hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-link",
                      active && "bg-panel-alt shadow-[inset_3px_0_0_var(--kit-primary)]",
                    )}
                  >
                    <Avatar size={24} name={people.name(others[0] ?? "")} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-primary", t.unread > 0 && !t.muted ? "t-body-strong" : "text-body")}>{titleOf(t)}</span>
                      <span className="block truncate text-small text-secondary">{t.lastMessageAt ? formatRelative(t.lastMessageAt) : "No messages yet"}</span>
                    </span>
                    {t.muted ? <Icon icon={BellOff} size="inline" className="text-tertiary" label="Muted" /> : null}
                    {t.unread > 0 ? <Chip tone={t.muted ? "neutral" : "info"}>{t.unread} new</Chip> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {hasMoreThreads ? (
            <div className="flex justify-center p-2">
              <Button size="sm" variant="ghost" loading={loadingMoreThreads} onClick={onLoadMoreThreads}>
                Show more conversations
              </Button>
            </div>
          ) : null}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {selection ? (
            <>
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-subtle px-panel-pad">
                <span className="t-body-strong min-w-0 truncate text-primary">{withName}</span>
                {thread?.subject && thread.subject.trim() && thread.subject !== withName ? <span className="truncate text-small text-secondary">{thread.subject}</span> : null}
                {pane && pane.participants.length > 1 ? <span className="truncate text-small text-secondary" data-testid="thread-people">With {joinNames(pane.participants.map((p) => people.person(p.userId)))}</span> : null}
                {muted ? <Chip tone="neutral" icon={BellOff}>Muted</Chip> : null}
                {selection.kind === "thread" && pane ? (
                  <span className="ml-auto flex shrink-0 items-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label="Conversation options" data-testid="thread-menu" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => mute.mutate({ threadId: selection.threadId, muted: !muted })}>
                          <Icon icon={muted ? BellRing : BellOff} size="inline" /> {muted ? "Unmute" : "Mute"}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="danger" onSelect={() => leave.mutate({ threadId: selection.threadId })}>
                          <Icon icon={LogOut} size="inline" /> Leave conversation
                        </DropdownMenuItem>
                        {askable.length ? (
                          <>
                            <DropdownMenuSeparator />
                            {askable.map((p) => (
                              <DropdownMenuItem key={p.userId} onSelect={() => connect.ask({ userId: p.userId, name: people.name(p.userId) })}>
                                <Icon icon={UserPlus} size="inline" /> Ask {people.name(p.userId)} to connect
                              </DropdownMenuItem>
                            ))}
                          </>
                        ) : null}
                        {pane.participants.some((p) => !p.blockedByMe) ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Block someone here</DropdownMenuLabel>
                            {pane.participants
                              .filter((p) => !p.blockedByMe)
                              .map((p) => (
                                <DropdownMenuItem
                                  key={p.userId}
                                  variant="danger"
                                  onSelect={() =>
                                    block.mutate({ userId: p.userId }, { onSuccess: () => toast({ title: `Blocked ${people.name(p.userId)}`, description: "Neither of you can message the other or ask to connect. Unblock them from the Blocked view.", tone: "info" }) })
                                  }
                                >
                                  <Icon icon={Ban} size="inline" /> Block {people.name(p.userId)}
                                </DropdownMenuItem>
                              ))}
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                ) : null}
              </div>
              {leftLine ? <p className="border-b border-subtle px-panel-pad py-1 text-small text-secondary">{leftLine}.</p> : null}
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
                disabled={!!closed}
                note={
                  closed ? (
                    <span className="inline-flex items-start gap-1.5" data-testid="thread-closed">
                      <Icon icon={Lock} size="inline" className="mt-0.5 shrink-0" />
                      {closed}
                    </span>
                  ) : undefined
                }
                hasEarlier={selection.kind === "thread" && messagesQ.hasNextPage}
                onLoadEarlier={() => void messagesQ.fetchNextPage()}
                loadingEarlier={messagesQ.isFetchingNextPage}
              />
            </>
          ) : (
            <EmptyState icon={MessageSquare} className="flex-1">
              Pick a conversation to read it and reply.
            </EmptyState>
          )}
        </div>
      </div>
      {connect.dialog}
    </Panel>
  );
}
