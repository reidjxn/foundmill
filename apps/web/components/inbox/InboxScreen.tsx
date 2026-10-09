"use client";
/**
 * Inbox (BUILD §11.3, DESIGN §9): a 380 px list + reading pane. Tabs All / Respond / Customers / Updates / Messages
 * (LIVE) / Archive, rows per DESIGN, J/K navigation, R = Refresh (`inbox.refresh`, exactly one new item, 3 s debounce
 * feedback), the reading pane with note, status strip, exhibit and DecisionBar (see ReadingPane.tsx).
 *
 * Selection lives in the URL (`/b/[bid]/inbox/[itemId]`) and is changed with `history.pushState`, which Next's app
 * router integrates with `usePathname`, so J/K never re-renders the server page.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, Kbd, useToast } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { usePageShortcuts } from "@/lib/keys";
import { streamAwareStaleTime } from "@/lib/query-client";
import { pollUnlessStreaming, useStreamOpen } from "@/lib/stream-status";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { InboxList, type InboxListRow } from "./InboxList";
import { ReadingPane } from "./ReadingPane";
import { INBOX_TAB_LABELS, REFRESH_DEBOUNCE_MS, agentIndex, inboxTabs, itemIdFromPath, neighbourId, parseInboxTab, refreshGate, rowModel, type InboxTab } from "./logic";

/** Fresh for minutes while the event stream keeps the inbox current, 10 s while it is down. */
const INBOX_LIST_STALE = streamAwareStaleTime(10_000);

/** DESIGN §9: the list is 380 px wide. */
export const INBOX_LIST_WIDTH = 380;
const PAGE = 50;

const EMPTY_TEXT: Record<InboxTab, string> = {
  all: "Notes from the team arrive here after each cycle. Press R to pull one now.",
  respond: "Nothing waits for an answer. Continue is free to run.",
  customers: "Won customers appear here with their Customer Update.",
  updates: "Updates, milestones and reports from the team land here.",
  messages: "Messages from other founders on LIVE arrive here.",
  archive: "Decided and archived notes are kept here.",
};

export interface InboxScreenProps {
  /** Initial selection from the route; the pathname is the source of truth afterwards. */
  itemId?: string;
}

export function InboxScreen({ itemId: routeItemId }: InboxScreenProps) {
  const { businessId, data, departments } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { toast } = useToast();
  const live = data.business.gameMode === "live";
  const tab = parseInboxTab(search.get("tab"), live);
  const selectedId = itemIdFromPath(pathname) ?? routeItemId ?? null;

  // --- list --------------------------------------------------------------------------------------------------------
  // The shell refetches the inbox on every event that adds or settles an item; polling only while the stream is down.
  const streamOpen = useStreamOpen();
  const listQ = useInfiniteQuery(
    trpc.inbox.list.infiniteQueryOptions(
      { businessId, tab, limit: PAGE },
      { getNextPageParam: (last) => last.nextCursor ?? undefined, initialCursor: null, staleTime: INBOX_LIST_STALE, refetchInterval: pollUnlessStreaming(streamOpen, 30_000) },
    ),
  );
  const pages = listQ.data?.pages;
  const agents = useMemo(() => agentIndex(departments), [departments]);
  const rows = useMemo<InboxListRow[]>(() => {
    const seen = new Set<string>();
    const out: InboxListRow[] = [];
    for (const page of pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const agent = item.fromAgentId ? agents.get(item.fromAgentId) : undefined;
        out.push({ ...rowModel(item), agent: agent ? { ...agent, dept: agent.dept as DeptColourToken } : undefined, fromUser: !!item.fromUserId });
      }
    }
    return out;
  }, [pages, agents]);
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const counts = pages?.[0]?.counts;
  const invalidate = useCallback((routers: readonly string[]) => Promise.all(routers.map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] }))), [queryClient]);

  // --- selection (URL) -----------------------------------------------------------------------------------------------
  const select = useCallback(
    (id: string | null) => {
      const href = `${routes.inbox(businessId, id ?? undefined)}${tab === "all" ? "" : `?tab=${tab}`}`;
      if (typeof window !== "undefined" && window.location.pathname + window.location.search !== href) window.history.pushState(null, "", href);
    },
    [businessId, tab],
  );
  const onNext = useCallback(() => select(neighbourId(ids, selectedId, "next")), [ids, selectedId, select]);
  const onPrev = useCallback(() => select(neighbourId(ids, selectedId, "prev")), [ids, selectedId, select]);

  // --- refresh (R) ---------------------------------------------------------------------------------------------------
  const lastRefresh = useRef<number | null>(null);
  const [waitMs, setWaitMs] = useState(0);
  useEffect(() => {
    if (waitMs <= 0) return;
    const t = window.setTimeout(() => setWaitMs(refreshGate(lastRefresh.current, Date.now()).waitMs), 250);
    return () => window.clearTimeout(t);
  }, [waitMs]);
  const refresh = useMutation(
    trpc.inbox.refresh.mutationOptions({
      onSuccess: (result) => {
        void invalidate(["inbox"]);
        toast({ title: "One new note", description: result.item.subject, tone: "info" });
        if (tab === "all" || tab === "respond") select(result.item.id);
        else router.push(routes.inbox(businessId, result.item.id));
      },
      onError: (err) => toast({ title: "Refresh failed", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const onRefresh = useCallback(() => {
    const gate = refreshGate(lastRefresh.current, Date.now());
    if (!gate.allowed || refresh.isPending) {
      setWaitMs(gate.waitMs);
      toast({ id: "inbox-refresh-wait", title: "One note at a time", description: `Refresh settles for ${Math.ceil(gate.waitMs / 1000)} s so the team never invents events.`, tone: "info", duration: 2000 });
      return;
    }
    lastRefresh.current = Date.now();
    setWaitMs(REFRESH_DEBOUNCE_MS);
    refresh.mutate({ businessId });
  }, [refresh, businessId, toast]);

  usePageShortcuts({ onRefreshInbox: onRefresh, onNextInboxItem: onNext, onPrevInboxItem: onPrev });

  // --- chrome ---------------------------------------------------------------------------------------------------------
  const tabs = useMemo(() => inboxTabs(businessId, live, counts), [businessId, live, counts]);
  const trailing = useMemo(
    () => (
      <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onRefresh} loading={refresh.isPending} aria-disabled={waitMs > 0 || undefined} data-testid="inbox-refresh" data-wait-ms={waitMs > 0 ? waitMs : undefined} title={waitMs > 0 ? `Settling for ${Math.ceil(waitMs / 1000)} s` : "Pull one new note"}>
        {waitMs > 0 && !refresh.isPending ? `Refreshed · ${Math.ceil(waitMs / 1000)}s` : "Refresh"}
        <Kbd>R</Kbd>
      </Button>
    ),
    [onRefresh, refresh.isPending, waitMs],
  );
  useShellChrome({ title: "Inbox", tabs: { tabs, activeId: tab, onChange: (id) => router.push(id === "all" ? routes.inbox(businessId) : `${routes.inbox(businessId)}?tab=${id}`), trailing, "aria-label": "Inbox tabs" } }, [tabs, tab, trailing, businessId]);

  if (listQ.error) return <ErrorPanel title="Inbox" message={errorMessage(listQ.error)} onRetry={() => void listQ.refetch()} />;

  return (
    <div className="flex min-h-0 flex-1" data-testid="inbox-screen" data-tab={tab} data-selected={selectedId ?? undefined}>
      <aside className="flex min-h-0 shrink-0 flex-col border-r border-subtle bg-panel" style={{ width: INBOX_LIST_WIDTH }} aria-label={`${INBOX_TAB_LABELS[tab]} notes`} data-testid="inbox-pane">
        <InboxList rows={rows} selectedId={selectedId} onSelect={select} loading={listQ.isLoading} hasMore={!!listQ.hasNextPage} loadingMore={listQ.isFetchingNextPage} onLoadMore={() => void listQ.fetchNextPage()} emptyText={EMPTY_TEXT[tab]} />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Reading pane" data-testid="reading-pane">
        {selectedId ? (
          <ReadingPane key={selectedId} itemId={selectedId} onArchived={() => select(neighbourId(ids.filter((i) => i !== selectedId), null, "next"))} />
        ) : (
          <EmptyState icon={InboxIcon} title="Select a note" className="my-auto" data-testid="reading-pane-empty">
            <span>
              Pick a note on the left, or move with <Kbd>J</Kbd> and <Kbd>K</Kbd>. <Kbd>R</Kbd> pulls one new note.
            </span>
          </EmptyState>
        )}
      </section>
    </div>
  );
}
