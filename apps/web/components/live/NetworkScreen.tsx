"use client";
/**
 * /network (BUILD §6.2, §11.14): the founder's connections and messages, in any business and mode. A status strip
 * (unread messages, requests waiting, connections, invitations), the requests to accept, ignore or block, the requests
 * the founder sent, community invitations, accepted connections in a DataTable, message threads with a reply box (and
 * the thread's people, mute, leave and block), and the profile visibility control. Everything here is between people:
 * agents never send a human-to-human message; only the founder's own Send does. The shell's stream signal refreshes
 * these lists when something reaches the founder.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StatusStrip, useToast, type MetricTileProps } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { counterpartId, findDirectThread, groupConnections, otherParticipants } from "@/lib/live";
import { streamPollInterval, useChannelLive } from "@/lib/stream-status";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useShellChrome } from "@/components/shell/chrome";
import { ConnectionsPanel, InvitationsPanel, RequestsPanel, SentRequestsPanel, type ConnectionRow, type InvitationRow } from "./ConnectionPanels";
import { MessagesPanel, type Selection } from "./MessagesPanel";
import { AdultNotice, PersonalNotice, usePeople } from "./shared";
import { userChannel } from "./signals";
import { PeopleSearchPanel } from "./PeopleSearchPanel";
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

  // The founder's own stream signal refreshes requests and invitations when one arrives (components/live/signals.ts);
  // without the stream they are polled, like the shell's badge, so a request never waits for a reload.
  const poll = streamPollInterval(useChannelLive(userChannel(viewer.userId)), 30_000);
  const connectionsQ = useQuery(trpc.live.connections.list.queryOptions(undefined, { staleTime: 15_000, refetchInterval: poll }));
  const threadsQ = useInfiniteQuery(
    trpc.live.messages.threads.infiniteQueryOptions({ limit: THREADS_PAGE }, { getNextPageParam: (last) => last.nextCursor ?? undefined, initialCursor: null, staleTime: 10_000, refetchInterval: 30_000 }),
  );
  const unreadQ = useQuery(trpc.live.messages.unread.queryOptions(undefined, { staleTime: 10_000, refetchInterval: 30_000 }));
  const invitationsQ = useQuery(trpc.live.communities.invitations.queryOptions(undefined, { staleTime: 15_000, refetchInterval: poll }));

  const rows = useMemo<ConnectionRow[]>(() => connectionsQ.data ?? [], [connectionsQ.data]);
  const threads = useMemo(() => {
    const seen = new Set<string>();
    return (threadsQ.data?.pages ?? []).flatMap((p) => p.items).filter((t) => !seen.has(t.id) && !!seen.add(t.id));
  }, [threadsQ.data]);
  const invitations = useMemo<InvitationRow[]>(() => invitationsQ.data ?? [], [invitationsQ.data]);
  const groups = useMemo(() => groupConnections(rows, viewer.userId), [rows, viewer.userId]);
  const peopleIds = useMemo(
    () => [
      ...rows.map((c) => counterpartId(c, viewer.userId)),
      ...threads.flatMap((t) => [...otherParticipants(t, viewer.userId), ...(t.leftIds ?? [])]),
      ...invitations.flatMap((i) => (i.invitedBy ? [i.invitedBy] : [])),
    ],
    [rows, threads, invitations, viewer.userId],
  );
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
  const refreshConnections = () => Promise.all(["live.connections", "live.summary"].map((p) => qc.invalidateQueries({ queryKey: trpcPathPrefix(p) as unknown[] })));
  const failed = (title: string) => (err: unknown) => toast({ title, description: errorMessage(err), tone: "bad" });
  const respond = useMutation(trpc.live.connections.respond.mutationOptions({ onSuccess: () => void refreshConnections(), onError: failed("The request was not updated") }));
  const remove = useMutation(trpc.live.connections.remove.mutationOptions({ onSuccess: () => void refreshConnections(), onError: failed("The connection was not changed") }));
  const busyId = respond.isPending ? respond.variables?.connectionId : remove.isPending ? remove.variables?.connectionId : null;
  const nameOf = (row: ConnectionRow) => people.name(counterpartId(row, viewer.userId));

  /** What a removal says: an ignored request, a withdrawn one, a lifted block, or an ended connection (whose thread closes). */
  const removedToast = (row: ConnectionRow) => {
    if (row.status === "requested") return row.toUser === viewer.userId ? { title: `Ignored ${nameOf(row)}'s request`, tone: "info" as const } : { title: "Request withdrawn", tone: "info" as const };
    if (row.status === "blocked") return { title: `Unblocked ${nameOf(row)}`, description: "They can ask to connect again. You cannot message each other unless you connect.", tone: "info" as const };
    return { title: `Removed ${nameOf(row)}`, description: "Your conversation with them is closed to new messages.", tone: "info" as const };
  };

  const handlers = {
    onAccept: (row: ConnectionRow) => respond.mutate({ connectionId: row.id, status: "accepted" }, { onSuccess: () => toast({ title: `Connected with ${nameOf(row)}`, tone: "good" }) }),
    onBlock: (row: ConnectionRow) => respond.mutate({ connectionId: row.id, status: "blocked" }, { onSuccess: () => toast({ title: `Blocked ${nameOf(row)}`, description: "They cannot message you or send you another request. Unblock them from the Blocked view.", tone: "info" }) }),
    onRemove: (row: ConnectionRow) => remove.mutate({ connectionId: row.id }, { onSuccess: () => toast(removedToast(row)) }),
    onMessage: messageConnection,
  };

  // --- invitations: join (accepts) or decline --------------------------------------------------------------------------
  const refreshInvitations = () => Promise.all(["live.communities", "live.summary"].map((p) => qc.invalidateQueries({ queryKey: trpcPathPrefix(p) as unknown[] })));
  const join = useMutation(trpc.live.communities.join.mutationOptions({ onSuccess: () => void refreshInvitations(), onError: failed("Could not join") }));
  const decline = useMutation(trpc.live.communities.decline.mutationOptions({ onSuccess: () => void refreshInvitations(), onError: failed("Could not decline") }));
  const invitationBusy = join.isPending ? join.variables?.communityId : decline.isPending ? decline.variables?.communityId : null;
  const onJoin = (row: InvitationRow) =>
    join.mutate({ communityId: row.community.id }, { onSuccess: () => toast({ title: `Joined ${row.community.name}`, tone: "good", action: { label: "Open", onClick: () => router.push(routes.community(row.community.id)) } }) });
  const onDecline = (row: InvitationRow) => decline.mutate({ communityId: row.community.id }, { onSuccess: () => toast({ title: `Declined ${row.community.name}`, tone: "info" }) });

  const unread = unreadQ.data ?? 0;
  const tiles: MetricTileProps[] = [
    { label: "Unread messages", value: unread, format: "integer", caption: unread ? "Open a thread to read it" : "All read" },
    { label: "Requests waiting", value: groups.incoming.length, format: "integer", caption: groups.incoming.length ? "Accept, ignore or block each one" : "Nobody is waiting on you" },
    { label: "Connections", value: groups.accepted.length, format: "integer", caption: groups.outgoing.length ? `${groups.outgoing.length} request${groups.outgoing.length === 1 ? "" : "s"} sent, waiting` : undefined },
    { label: "Invitations", value: invitations.length, format: "integer", caption: invitations.length ? "Join or decline each one" : "No community invitations" },
  ];

  const connectionsError = connectionsQ.error ? errorMessage(connectionsQ.error) : undefined;
  const loading = connectionsQ.isLoading;

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="network-screen">
      <PersonalNotice className="col-span-12" />
      <AdultNotice className="col-span-12" />
      <StatusStrip className="col-span-12" tiles={tiles} aria-label="Network at a glance" data-testid="network-strip" />
      {/* One way on from an empty network, not three: only Connections offers "Browse communities". */}
      <div className="col-span-4 flex min-w-0 flex-col gap-gutter">
        <PeopleSearchPanel />
        <RequestsPanel rows={groups.incoming} viewerId={viewer.userId} people={people} loading={loading} error={connectionsError} onRetry={() => void connectionsQ.refetch()} busyId={busyId} onAccept={handlers.onAccept} onRemove={handlers.onRemove} onBlock={handlers.onBlock} />
        <SentRequestsPanel rows={groups.outgoing} viewerId={viewer.userId} people={people} loading={loading} error={connectionsError} onRetry={() => void connectionsQ.refetch()} busyId={busyId} onRemove={handlers.onRemove} />
        <InvitationsPanel rows={invitations} people={people} loading={invitationsQ.isLoading} error={invitationsQ.error ? errorMessage(invitationsQ.error) : undefined} onRetry={() => void invitationsQ.refetch()} busyId={invitationBusy} onJoin={onJoin} onDecline={onDecline} />
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
