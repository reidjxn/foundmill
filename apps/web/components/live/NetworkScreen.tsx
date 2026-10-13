"use client";
/**
 * /network (BUILD §6.2, §11.14): the founder's connections and messages. A status strip (unread messages, requests
 * waiting, connections), the requests to accept or block, the requests the founder sent, accepted connections in a
 * DataTable, message threads with a reply box, and the profile visibility control. Everything here is between people:
 * agents never send a human-to-human message; only the founder's own Send does.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StatusStrip, useToast, type MetricTileProps } from "@foundmill/dugout";
import { counterpartId, findDirectThread, groupConnections, otherParticipants } from "@/lib/live";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useShellChrome } from "@/components/shell/chrome";
import { ConnectionsPanel, RequestsPanel, SentRequestsPanel, type ConnectionRow } from "./ConnectionPanels";
import { MessagesPanel, type Selection } from "./MessagesPanel";
import { PeopleSearchPanel } from "./PeopleSearchPanel";
import { PersonalNotice, usePeople } from "./shared";
import { useLiveViewer } from "./viewer";
import { VisibilityPanel } from "./VisibilityPanel";

/** Conversations per page; "Show more conversations" asks for the next. */
const THREADS_PAGE = 50;

export function NetworkScreen() {
  const viewer = useLiveViewer();
  const router = useRouter();
  const findFounders = () => router.push("/communities");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();
  useShellChrome({ title: "Network" });

  const connectionsQ = useQuery(trpc.live.connections.list.queryOptions(undefined, { staleTime: 15_000 }));
  const threadsQ = useInfiniteQuery(
    trpc.live.messages.threads.infiniteQueryOptions({ limit: THREADS_PAGE }, { getNextPageParam: (last) => last.nextCursor ?? undefined, initialCursor: null, staleTime: 10_000, refetchInterval: 30_000 }),
  );
  const unreadQ = useQuery(trpc.live.messages.unread.queryOptions(undefined, { staleTime: 10_000, refetchInterval: 30_000 }));

  const rows = useMemo<ConnectionRow[]>(() => connectionsQ.data ?? [], [connectionsQ.data]);
  const threads = useMemo(() => {
    const seen = new Set<string>();
    return (threadsQ.data?.pages ?? []).flatMap((p) => p.items).filter((t) => !seen.has(t.id) && !!seen.add(t.id));
  }, [threadsQ.data]);
  const groups = useMemo(() => groupConnections(rows, viewer.userId), [rows, viewer.userId]);
  const peopleIds = useMemo(() => [...rows.map((c) => counterpartId(c, viewer.userId)), ...threads.flatMap((t) => otherParticipants(t, viewer.userId))], [rows, threads, viewer.userId]);
  const people = usePeople(peopleIds);

  // --- the open conversation ------------------------------------------------------------------------------------------
  // Nothing opens by itself: opening a thread marks it read, so the unread counts stay visible until the founder chooses one.
  const [selection, setChosen] = useState<Selection>(null);

  const messageConnection = (row: ConnectionRow) => {
    const other = counterpartId(row, viewer.userId);
    const existing = findDirectThread(threads, viewer.userId, other);
    setChosen(existing ? { kind: "thread", threadId: existing.id } : { kind: "new", userId: other });
    document.querySelector<HTMLElement>('[data-testid="messages-panel"]')?.scrollIntoView({ block: "nearest" });
  };

  // --- connection mutations -------------------------------------------------------------------------------------------
  const refreshConnections = () => qc.invalidateQueries({ queryKey: trpcPathPrefix("live.connections") as unknown[] });
  const failed = (title: string) => (err: unknown) => toast({ title, description: errorMessage(err), tone: "bad" });
  const respond = useMutation(trpc.live.connections.respond.mutationOptions({ onSuccess: () => void refreshConnections(), onError: failed("The request was not updated") }));
  const remove = useMutation(trpc.live.connections.remove.mutationOptions({ onSuccess: () => void refreshConnections(), onError: failed("The connection was not changed") }));
  const busyId = respond.isPending ? respond.variables?.connectionId : remove.isPending ? remove.variables?.connectionId : null;
  const nameOf = (row: ConnectionRow) => people.name(counterpartId(row, viewer.userId));

  const handlers = {
    onAccept: (row: ConnectionRow) => respond.mutate({ connectionId: row.id, status: "accepted" }, { onSuccess: () => toast({ title: `Connected with ${nameOf(row)}`, tone: "good" }) }),
    onBlock: (row: ConnectionRow) => respond.mutate({ connectionId: row.id, status: "blocked" }, { onSuccess: () => toast({ title: `Blocked ${nameOf(row)}`, description: "They cannot send you another request. Unblock them from the Blocked view.", tone: "info" }) }),
    onRemove: (row: ConnectionRow) =>
      remove.mutate(
        { connectionId: row.id },
        { onSuccess: () => toast({ title: row.status === "requested" ? "Request withdrawn" : row.status === "blocked" ? `Unblocked ${nameOf(row)}` : `Removed ${nameOf(row)}`, tone: "info" }) },
      ),
    onMessage: messageConnection,
  };

  const unread = unreadQ.data ?? 0;
  const tiles: MetricTileProps[] = [
    { label: "Unread messages", value: unread, format: "integer", caption: unread ? "Open a thread to read it" : "All read" },
    { label: "Requests waiting", value: groups.incoming.length, format: "integer", caption: groups.incoming.length ? "Accept or block each one" : "Nobody is waiting on you" },
    { label: "Connections", value: groups.accepted.length, format: "integer", caption: groups.outgoing.length ? `${groups.outgoing.length} request${groups.outgoing.length === 1 ? "" : "s"} sent, waiting` : undefined },
  ];

  const connectionsError = connectionsQ.error ? errorMessage(connectionsQ.error) : undefined;
  const loading = connectionsQ.isLoading;

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="network-screen">
      <PersonalNotice className="col-span-12" />
      <StatusStrip className="col-span-12" tiles={tiles} aria-label="Network at a glance" data-testid="network-strip" />
      {/* One way on from an empty network, not three: only Connections offers "Browse communities". */}
      <div className="col-span-4 flex min-w-0 flex-col gap-gutter">
        <PeopleSearchPanel />
        <RequestsPanel rows={groups.incoming} viewerId={viewer.userId} people={people} loading={loading} error={connectionsError} onRetry={() => void connectionsQ.refetch()} busyId={busyId} onAccept={handlers.onAccept} onBlock={handlers.onBlock} />
        <SentRequestsPanel rows={groups.outgoing} viewerId={viewer.userId} people={people} loading={loading} error={connectionsError} onRetry={() => void connectionsQ.refetch()} busyId={busyId} onRemove={handlers.onRemove} />
        <VisibilityPanel />
      </div>
      <div className="col-span-8 flex min-w-0 flex-col gap-gutter">
        <MessagesPanel
          viewerId={viewer.userId}
          threads={threads}
          unreadTotal={unread}
          people={people}
          selection={selection}
          onSelect={setChosen}
          loading={threadsQ.isLoading}
          error={threadsQ.error ? errorMessage(threadsQ.error) : undefined}
          onRetry={() => void threadsQ.refetch()}
          hasMoreThreads={threadsQ.hasNextPage}
          onLoadMoreThreads={() => void threadsQ.fetchNextPage()}
          loadingMoreThreads={threadsQ.isFetchingNextPage}
        />
        <ConnectionsPanel rows={[...groups.accepted, ...groups.blocked]} viewerId={viewer.userId} people={people} loading={loading} error={connectionsError} onRetry={() => void connectionsQ.refetch()} onBlock={handlers.onBlock} onRemove={handlers.onRemove} onMessage={handlers.onMessage} onFind={findFounders} />
      </div>
    </div>
  );
}
