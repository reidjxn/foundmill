"use client";
/**
 * Inbox (BUILD §11.3, DESIGN §9): a 380 px list + reading pane. Tabs All / Respond / Customers / Updates / Messages
 * (LIVE) / Archive, rows per DESIGN, J/K navigation, R = Refresh (`inbox.refresh`, exactly one new item, 3 s debounce
 * feedback), the reading pane with note, status strip, exhibit and DecisionBar (see ReadingPane.tsx).
 *
 * Selection lives in the URL (`/b/[bid]/inbox/[itemId]`) and is changed with `history.pushState`, which Next's app
 * router integrates with `usePathname`, so J/K never re-renders the server page.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Inbox as InboxIcon, RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, Kbd, useToast } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { humanSender } from "@foundmill/widgets/shared/note-tags";
import { routes } from "@foundmill/widgets/shared/routes";
import { usePageShortcuts } from "@/lib/keys";
import { streamAwareStaleTime } from "@/lib/query-client";
import { streamPollInterval, useBusinessLive } from "@/lib/stream-status";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { RefreshFailedNotice, loadFailed, refreshFailed } from "@/components/shell/QueryStates";
import { InboxList, type InboxListRow } from "./InboxList";
import { ReadingPane } from "./ReadingPane";
import { INBOX_TAB_LABELS, OLDER_PAGE_REUSE_MS, REFRESH_DEBOUNCE_MS, agentIndex, inboxTabs, itemIdFromPath, mergeFirstPage, neighbourId, parseInboxTab, refreshGate, rowModel, type InboxTab } from "./logic";

/** Fresh for minutes while the business's event channel keeps the inbox current, 10 s otherwise. */
const INBOX_LIST_STALE = streamAwareStaleTime(10_000);

/** DESIGN §9: the list is 380 px wide. */
export const INBOX_LIST_WIDTH = 380;
const PAGE = 50;
type InboxPage = RouterOutputs["inbox"]["list"];

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
  const { businessId, data, departments, access } = useBusiness();
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
  // The shell refetches the inbox on every event that adds or settles an item; polling every 30 s while the business's
  // channel is not live, and a slow safety net while it is (a read by another member publishes no event).
  const streamLive = useBusinessLive(businessId);
  const listOptions = trpc.inbox.list.infiniteQueryOptions(
    { businessId, tab, limit: PAGE },
    { getNextPageParam: (last) => last.nextCursor ?? undefined, initialCursor: null, staleTime: INBOX_LIST_STALE, refetchInterval: streamPollInterval(streamLive, 30_000) },
  );
  // A refetch (an inbox event, the safety-net poll) refetches every page the reader has loaded, one request each. Here
  // it fetches the first page and folds it into the one held (`mergeFirstPage`), and reuses the older pages for a minute,
  // so a new note costs about one request however deep the reader has scrolled (audit SOAK-09).
  const fetchedAt = useRef(new Map<string, number>()); // "business|tab|cursor" → when that page was fetched
  const fetchPage = listOptions.queryFn;
  const listQ = useInfiniteQuery({
    ...listOptions,
    queryFn: typeof fetchPage === "function"
      ? async (ctx) => {
          const cursor = ctx.pageParam ?? null;
          const held = queryClient.getQueryData<InfiniteData<InboxPage, string | null>>(listOptions.queryKey);
          if (cursor !== null) {
            const at = fetchedAt.current.get(`${businessId}|${tab}|${cursor}`);
            const kept = at !== undefined && Date.now() - at < OLDER_PAGE_REUSE_MS ? held?.pages[(held.pageParams as (string | null)[]).indexOf(cursor)] : undefined;
            if (kept) return kept;
            const page = await fetchPage(ctx);
            fetchedAt.current.set(`${businessId}|${tab}|${cursor}`, Date.now());
            return page;
          }
          return mergeFirstPage(held?.pages[0], await fetchPage(ctx));
        }
      : fetchPage,
  });
  const pages = listQ.data?.pages;
  const agents = useMemo(() => agentIndex(departments), [departments]);
  // The founder's own notes carry the founder's initials ("JR"), never the letters of "You".
  const founderQ = useQuery(trpc.founder.profile.get.queryOptions(undefined, { staleTime: 5 * 60_000 }));
  const founderName = founderQ.data?.profile?.displayName?.trim() || undefined;
  const viewerId = data.membership.userId;
  const rows = useMemo<InboxListRow[]>(() => {
    const seen = new Set<string>();
    const out: InboxListRow[] = [];
    for (const page of pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const agent = item.fromAgentId ? agents.get(item.fromAgentId) : undefined;
        // The founder's own note, or another founder's words that Network filed here (never "You" for someone else).
        const sender = humanSender(item.fromUserId, viewerId);
        out.push({ ...rowModel(item), agent: agent ? { ...agent, dept: agent.dept as DeptColourToken } : undefined, fromUser: sender === "self", fromPerson: sender === "other" });
      }
    }
    return out;
  }, [pages, agents, viewerId]);
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
        // Nothing new happened (the composer fell back to the next-best decision or an insight): say so, plainly.
        const quiet = result.slot === "decision" || result.slot === "insight";
        toast({ title: quiet ? "Nothing new since your last note" : "One new note", description: quiet ? `The next call instead: ${result.item.subject}` : result.item.subject, tone: "info" });
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

  // Refresh asks the team for a new note: viewers and advisors only read (the API refuses it for them).
  usePageShortcuts({ onRefreshInbox: access.canChange ? onRefresh : undefined, onNextInboxItem: onNext, onPrevInboxItem: onPrev });

  // --- chrome ---------------------------------------------------------------------------------------------------------
  const glossary = data.business.glossary;
  const tabs = useMemo(() => inboxTabs(businessId, live, counts, glossary), [businessId, live, counts, glossary]);
  const canRefresh = access.canChange;
  const trailing = useMemo(
    () => canRefresh ? (
      <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onRefresh} loading={refresh.isPending} aria-disabled={waitMs > 0 || undefined} data-testid="inbox-refresh" data-wait-ms={waitMs > 0 ? waitMs : undefined} title={waitMs > 0 ? `Settling for ${Math.ceil(waitMs / 1000)} s` : "Pull one new note"}>
        {waitMs > 0 && !refresh.isPending ? `Refreshed · ${Math.ceil(waitMs / 1000)}s` : "Refresh"}
        <Kbd>R</Kbd>
      </Button>
    ) : undefined,
    [onRefresh, refresh.isPending, waitMs, canRefresh],
  );
  useShellChrome({ title: "Inbox", tabs: { tabs, activeId: tab, onChange: (id) => router.push(id === "all" ? routes.inbox(businessId) : `${routes.inbox(businessId)}?tab=${id}`), trailing, "aria-label": "Inbox tabs" } }, [tabs, tab, trailing, businessId]);

  // A failed refetch keeps the loaded list on screen (with a quiet notice); only a first load that failed shows the panel.
  if (loadFailed(listQ)) return <ErrorPanel title="Inbox" message={errorMessage(listQ.error)} onRetry={() => void listQ.refetch()} />;

  return (
    <div className="flex h-full min-h-0" data-testid="inbox-screen" data-tab={tab} data-selected={selectedId ?? undefined}>
      <aside className="flex min-h-0 shrink-0 flex-col border-r border-subtle bg-panel" style={{ width: INBOX_LIST_WIDTH }} aria-label={`${INBOX_TAB_LABELS[tab]} notes`} data-testid="inbox-pane">
        {refreshFailed(listQ) ? <RefreshFailedNotice query={listQ} /> : null}
        <InboxList rows={rows} selectedId={selectedId} onSelect={select} loading={listQ.isLoading} hasMore={!!listQ.hasNextPage} loadingMore={listQ.isFetchingNextPage} onLoadMore={() => void listQ.fetchNextPage()} emptyText={EMPTY_TEXT[tab]} founderName={founderName} />
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
