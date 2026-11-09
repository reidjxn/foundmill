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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, EmptyState, Kbd, useAgentPersona, useGuided, useToast } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { humanSender } from "@foundmill/widgets/shared/note-tags";
import { routes } from "@foundmill/widgets/shared/routes";
import { usePageShortcuts } from "@/lib/keys";
import { streamAwareStaleTime } from "@/lib/query-client";
import { shellQueryInputs } from "@/lib/shell-queries";
import { streamPollInterval, useBusinessLive } from "@/lib/stream-status";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { RefreshFailedNotice, loadFailed, refreshFailed } from "@/components/shell/QueryStates";
import { InboxList, type InboxListRow } from "./InboxList";
import { InboxTour } from "./InboxTour";
import { ReadingPane } from "./ReadingPane";
import { INBOX_TAB_LABELS, OLDER_PAGE_REUSE_MS, REFRESH_DEBOUNCE_MS, agentIndex, inboxTabs, inboxTourStarts, itemIdFromPath, mergeFirstPage, neighbourId, parseInboxTab, refreshGate, rowModel, type InboxTab } from "./logic";

/** Fresh for minutes while the business's event channel keeps the inbox current, 10 s otherwise. */
const INBOX_LIST_STALE = streamAwareStaleTime(10_000);

/** DESIGN §9: the list is 380 px wide. */
export const INBOX_LIST_WIDTH = 380;
const PAGE = 50;
type InboxPage = RouterOutputs["inbox"]["list"];

/** The empty line per tab (UX plan §5.1: the loop, stated where it is needed). The R hint is added for operators only. */
export const EMPTY_TEXT: Record<InboxTab, string> = {
  all: "Your team works in cycles: rounds of work whose notes land here. Press Continue to start one.",
  respond: "Nothing waits for an answer. Continue is free to run.",
  customers: "Won customers appear here with their Customer Update.",
  updates: "Updates, milestones and reports from the team land here.",
  messages: "Messages from other founders on LIVE arrive here.",
  archive: "Decided and archived notes are kept here.",
};

/** Refresh's tooltip: one quick note from the team, which is not a cycle (UX plan B17). */
export const REFRESH_HINT = "Ask the team for one quick note (does not start a cycle)";

/** "One note at a time: wait 3 s.": the gate toast while Refresh settles (UX plan B17). */
export const refreshWaitTitle = (waitMs: number): string => `One note at a time: wait ${Math.max(1, Math.ceil(waitMs / 1000))} s.`;

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
  // Key caps and "press R" hints are for operators: shown only while guidance is off (UX plan §7.9).
  const guided = useGuided();
  const live = data.business.gameMode === "live";
  const tab = parseInboxTab(search.get("tab"), live);
  const selectedId = itemIdFromPath(pathname) ?? routeItemId ?? null;
  // The tour waits for a moment with the list in front and no note open, then stays (see `inboxTourStarts`).
  const [tourStarted, setTourStarted] = useState(false);
  useEffect(() => {
    if (inboxTourStarts(selectedId, tourStarted)) setTourStarted(true);
  }, [selectedId, tourStarted]);

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
  // The shell already holds All's first page (`inbox.list({ businessId, limit: 50 })`: the same answer, tab defaults to
  // "all"), so the first open paints from it and revalidates under the same staleness (audit WEB-7).
  const shellListKey = trpc.inbox.list.queryKey(shellQueryInputs(businessId).inbox);
  const listQ = useInfiniteQuery({
    ...listOptions,
    initialData:
      tab === "all"
        ? () => {
            const shell = queryClient.getQueryData<InboxPage>(shellListKey);
            return shell ? { pages: [shell], pageParams: [null] } : undefined;
          }
        : undefined,
    initialDataUpdatedAt: tab === "all" ? () => queryClient.getQueryState(shellListKey)?.dataUpdatedAt : undefined,
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
  // Subjects are plain stored text with the agent's stored name: named here under the reader's preference, so a row says
  // what its sender line says (One name everywhere, Nov 8, 2026).
  const persona = useAgentPersona();
  const roster = useMemo(() => [...agents.values()], [agents]);
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
        // The founder's own note, or someone else's (never "You" for another person).
        const sender = humanSender(item.fromUserId, viewerId);
        out.push({ ...rowModel(item, (text) => persona.withNames(text, roster)), agent: agent ? { ...agent, dept: agent.dept as DeptColourToken } : undefined, fromUser: sender === "self", fromPerson: sender === "other" });
      }
    }
    return out;
  }, [pages, agents, viewerId, persona, roster]);
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
  // Hover or focus on a row starts its note (the same query and staleness the reading pane reads), so a click opens it.
  const prefetchNote = useCallback((itemId: string) => void queryClient.prefetchQuery(trpc.inbox.get.queryOptions({ businessId, itemId }, { staleTime: 10_000 })), [queryClient, trpc, businessId]);
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
      toast({ id: "inbox-refresh-wait", title: refreshWaitTitle(gate.waitMs), tone: "info", duration: 2000 });
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
      <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onRefresh} loading={refresh.isPending} aria-disabled={waitMs > 0 || undefined} data-testid="inbox-refresh" data-wait-ms={waitMs > 0 ? waitMs : undefined} title={waitMs > 0 ? `One note at a time: wait ${Math.ceil(waitMs / 1000)} s` : REFRESH_HINT}>
        {waitMs > 0 && !refresh.isPending ? `Refreshed · ${Math.ceil(waitMs / 1000)}s` : "Refresh"}
        {guided ? null : <Kbd>R</Kbd>}
      </Button>
    ) : undefined,
    [onRefresh, refresh.isPending, waitMs, canRefresh, guided],
  );
  // The empty line, with the key hints only for operators (guidance off); viewers cannot refresh, so no R for them.
  const emptyText: ReactNode = useMemo(() => {
    if (guided || tab !== "all" || !canRefresh) return EMPTY_TEXT[tab];
    return (
      <>
        {EMPTY_TEXT[tab]} <Kbd>R</Kbd> pulls one new note.
      </>
    );
  }, [guided, tab, canRefresh]);
  useShellChrome({ title: "Inbox", tabs: { tabs, activeId: tab, onChange: (id) => router.push(id === "all" ? routes.inbox(businessId) : `${routes.inbox(businessId)}?tab=${id}`), trailing, "aria-label": "Inbox tabs" } }, [tabs, tab, trailing, businessId]);

  // A failed refetch keeps the loaded list on screen (with a quiet notice); only a first load that failed shows the panel.
  if (loadFailed(listQ)) return <ErrorPanel title="Inbox" message={errorMessage(listQ.error)} onRetry={() => void listQ.refetch()} />;

  return (
    <div className="flex h-full min-h-0" data-testid="inbox-screen" data-tab={tab} data-selected={selectedId ?? undefined}>
      <aside className="flex min-h-0 shrink-0 flex-col border-r border-subtle bg-panel" style={{ width: INBOX_LIST_WIDTH }} aria-label={`${INBOX_TAB_LABELS[tab]} notes`} data-testid="inbox-pane" data-coachmark="inbox-pane">
        {refreshFailed(listQ) ? <RefreshFailedNotice query={listQ} /> : null}
        <InboxList rows={rows} selectedId={selectedId} onSelect={select} onPrefetch={prefetchNote} loading={listQ.isLoading} hasMore={!!listQ.hasNextPage} loadingMore={listQ.isFetchingNextPage} onLoadMore={() => void listQ.fetchNextPage()} emptyText={emptyText} founderName={founderName} />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Reading pane" data-testid="reading-pane" data-coachmark="reading-pane">
        {selectedId ? (
          <ReadingPane key={selectedId} itemId={selectedId} onArchived={() => select(neighbourId(ids.filter((i) => i !== selectedId), null, "next"))} />
        ) : (
          <EmptyState icon={InboxIcon} title="Select a note" className="my-auto" data-testid="reading-pane-empty">
            <span>
              Pick a note on the left.
              {guided ? null : (
                <>
                  {" "}
                  Move with <Kbd>J</Kbd> and <Kbd>K</Kbd>{canRefresh ? <>; <Kbd>R</Kbd> pulls one new note</> : null}.
                </>
              )}
            </span>
          </EmptyState>
        )}
      </section>
      {/* The first-visit tour (once per account, guidance on). It starts from the list, never over a note the founder
          opened first (first-time founder report, Nov 8, 2026); once started it stays through the notes they open. */}
      {tourStarted ? <InboxTour /> : null}
    </div>
  );
}
