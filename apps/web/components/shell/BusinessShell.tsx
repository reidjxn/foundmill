"use client";
/**
 * The AppShell wiring for /b/[bid] (docs/ARCHITECTURE.md §14, BUILD §5.3–5.5):
 * - sidebar from department.list in the founder's order, badges from inbox.list;
 * - Continue state from inbox.list (blocking → "Respond · N"), the holiday and the cycle status; one pulse per
 *   `cycle.completed`;
 * - Stop all agents → business.stopAllAgents; processing strip from the cycle reducer over the event stream;
 * - universal search (CommandPalette, remote) over local screens/commands + crm.search;
 * - date + runway chip from finance.overview, business-mode chip → Settings › Mode;
 * - NeedsLargerWindow below 1280 (AppShell measures the window itself); G-then-letter chords (AppShell);
 * - providers for everything below: business context, WidgetDataProvider, ModuleEnv, EntityLink, keyboard registry,
 *   screen chrome.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AppShell, EntityLinkProvider, ShellLinkProvider, useToast, type PaletteItem, type ProcessingSegment, type SearchQuery, type SidebarItem } from "@foundmill/dugout";
// @foundmill/modules does not re-export env.tsx from its barrel yet (open issue); the realpath import shares the
// same module instance as the screens' own "../env" once bundlers resolve the workspace symlink.
import { ModuleEnvProvider } from "../../../../packages/modules/src/env";
import { readWidgetEvent, routes, type WidgetEvent } from "@foundmill/widgets";
import { LAST_BUSINESS_COOKIE, SIDEBAR_COLLAPSED_PREFIX } from "@/lib/auth/constants";
import { computeContinueState, firstBlockingItem, unviewedWin } from "@/lib/continue-state";
import { CYCLE_EVENT_TYPES, cycleFromSnapshot, reduceCycleEvent, type CycleEvent, type CycleStatus, EMPTY_CYCLE } from "@/lib/cycle";
import { publicEnv } from "@/lib/env";
import { monogram } from "@/lib/format";
import { KeyboardRegistryProvider, createKeyboardRegistry, useRegisteredShortcuts } from "@/lib/keys";
import { entityPaletteItems, filterLocal, localPaletteItems, searchInputFor } from "@/lib/search";
import { activeSidebarId, buildSidebarItems, orderedVisibleDepartments } from "@/lib/sidebar";
import { useStreamSubscription } from "@/lib/stream-client";
import { getBrowserAccessToken } from "@/lib/supabase/client";
import { errorMessage, trpcErrorCode, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { WidgetDataHost } from "@/lib/widget-data";
import { useUntypedApi } from "@/components/providers/AppProviders";
import { BusinessProvider, makeBusinessContext, type BusinessGet, type DepartmentList } from "./business-context";
import { ShellChromeProvider, useShellChromeValue } from "./chrome";
import { renderNextShellLink } from "./NextShellLink";

export interface BusinessShellProps {
  businessId: string;
  initialBusiness: BusinessGet;
  initialDepartments: DepartmentList;
  viewer: { email: string | null; userId: string | null };
  children: ReactNode;
}

const INBOX_PAGE = 50;
const SEARCH_DEBOUNCE_MS = 150;

/** Events after which the shell refetches a router's queries. */
const INVALIDATE_ON_EVENT: Record<string, readonly string[]> = {
  "inbox.item_created": ["inbox"],
  "decision.made": ["inbox", "plan"],
  "customer.converted": ["inbox", "journey", "finance"],
  "agent.health_changed": ["department", "team"],
  "mode.changed": ["business"],
  "holiday.started": ["business"],
  "holiday.ended": ["business", "inbox"],
  "cycle.completed": ["inbox", "department", "dev", "finance"],
  "bank.balance_updated": ["finance"],
  "runway.threshold_crossed": ["finance", "inbox"],
  "approval.requested": ["inbox"],
  "credential.expiring": ["integrations", "inbox"],
};

function readCollapsed(businessId: string): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_PREFIX + businessId) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(businessId: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_PREFIX + businessId, collapsed ? "1" : "0");
  } catch {
    /* private mode */
  }
}

function cycleReducer(status: CycleStatus, action: { type: "event"; event: CycleEvent; agentDepartment: (id: string) => string | null | undefined } | { type: "snapshot"; status: CycleStatus }): CycleStatus {
  if (action.type === "snapshot") return status.running || status.completedCount > 0 ? status : action.status;
  return reduceCycleEvent(status, action.event, action.agentDepartment);
}

export function BusinessShell(props: BusinessShellProps) {
  const [registry] = useState(createKeyboardRegistry);
  return (
    <KeyboardRegistryProvider value={registry}>
      <ShellChromeProvider>
        <ShellInner {...props} />
      </ShellChromeProvider>
    </KeyboardRegistryProvider>
  );
}

function ShellInner({ businessId, initialBusiness, initialDepartments, children }: BusinessShellProps) {
  const trpc = useTRPC();
  const untyped = useUntypedApi();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const chrome = useShellChromeValue();
  const shortcuts = useRegisteredShortcuts();

  // --- data ---------------------------------------------------------------------------------------------------
  const businessQ = useQuery(trpc.business.get.queryOptions({ businessId }, { initialData: initialBusiness, staleTime: 30_000 }));
  const departmentsQ = useQuery(trpc.department.list.queryOptions({ businessId, includeHidden: true, includeArchived: false }, { initialData: initialDepartments, staleTime: 30_000 }));
  const inboxQ = useQuery(trpc.inbox.list.queryOptions({ businessId, limit: INBOX_PAGE }, { staleTime: 10_000, refetchInterval: 30_000 }));
  const financeQ = useQuery(trpc.finance.overview.queryOptions({ businessId }, { staleTime: 60_000, retry: false }));
  const tasksQ = useQuery(trpc.dev.tasks.list.queryOptions({ businessId, status: "running", limit: 100 }, { staleTime: 60_000, retry: false }));

  const data = businessQ.data ?? initialBusiness;
  const departments = departmentsQ.data ?? initialDepartments;
  const visibleDepartments = useMemo(() => orderedVisibleDepartments(departments), [departments]);
  const business = data.business;
  const live = business.gameMode === "live";
  const currency = financeQ.data?.cash.currency ?? "EUR";

  const agentDepartment = useCallback(
    (agentId: string) => departments.find((d) => d.squad.some((a) => a.id === agentId) || d.leadAgentId === agentId)?.id ?? null,
    [departments],
  );

  // --- cycle status from the stream -----------------------------------------------------------------------------
  const [cycle, dispatch] = useReducer(cycleReducer, EMPTY_CYCLE);
  useEffect(() => {
    if (tasksQ.data) dispatch({ type: "snapshot", status: cycleFromSnapshot({ tasks: tasksQ.data.items }) });
  }, [tasksQ.data]);

  const invalidate = useCallback((routers: readonly string[]) => Promise.all(routers.map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] }))), [queryClient]);

  useStreamSubscription(`ev:${businessId}`, (raw) => {
    const event: WidgetEvent | null = readWidgetEvent(raw);
    if (!event) return;
    if ((CYCLE_EVENT_TYPES as readonly string[]).includes(event.type)) dispatch({ type: "event", event, agentDepartment });
    const routers = INVALIDATE_ON_EVENT[event.type];
    if (routers) void invalidate(routers);
  });

  // --- last business cookie (the index route redirects here next time) -------------------------------------------
  useEffect(() => {
    document.cookie = `${LAST_BUSINESS_COOKIE}=${businessId}; path=/; max-age=31536000; samesite=lax`;
  }, [businessId]);

  // --- sidebar -------------------------------------------------------------------------------------------------
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(readCollapsed(businessId)), [businessId]);
  const onCollapsedChange = useCallback(
    (c: boolean) => {
      setCollapsed(c);
      writeCollapsed(businessId, c);
    },
    [businessId],
  );
  const sidebarItems = useMemo(
    () => buildSidebarItems({ businessId, departments, inboxCounts: inboxQ.data?.counts, inboxItems: inboxQ.data?.items, live }),
    [businessId, departments, inboxQ.data?.counts, inboxQ.data?.items, live],
  );
  const activeId = useMemo(() => activeSidebarId(pathname, businessId, departments), [pathname, businessId, departments]);
  const onNavigate = useCallback(
    (item: SidebarItem) => {
      if (item.href) router.push(item.href);
    },
    [router],
  );

  // --- Continue ------------------------------------------------------------------------------------------------
  const continueState = useMemo(
    () => computeContinueState({ blocking: inboxQ.data?.blocking ?? data.blockingItems ?? 0, items: inboxQ.data?.items, holiday: data.holiday, cycle }),
    [inboxQ.data?.blocking, inboxQ.data?.items, data.blockingItems, data.holiday, cycle],
  );

  const refreshInbox = useMutation(
    trpc.inbox.refresh.mutationOptions({
      onSuccess: (result) => {
        void invalidate(["inbox"]);
        toast({ title: "One new note", description: result.item.subject, tone: "info", action: { label: "Open", onClick: () => router.push(routes.inbox(businessId, result.item.id)) } });
      },
      onError: (err) => toast({ title: "Refresh failed", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const endHoliday = useMutation(
    trpc.business.endHoliday.mutationOptions({
      onSuccess: () => {
        void invalidate(["business", "inbox"]);
        toast({ title: "Welcome back", description: "The Chief of Staff handed the business back to you.", tone: "good" });
      },
      onError: (err) => toast({ title: "Could not end the holiday", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const stopAll = useMutation(
    trpc.business.stopAllAgents.mutationOptions({
      onSuccess: () => {
        dispatch({ type: "event", event: { type: "agents.stopped" }, agentDepartment });
        void invalidate(["business", "dev", "department", "inbox"]);
        toast({ title: "All agents stopped", description: "Workflows, engines and campaigns are paused.", tone: "warn" });
      },
    }),
  );

  const continuing = useRef(false);
  const onContinue = useCallback(async () => {
    if (continuing.current) return;
    continuing.current = true;
    try {
      // `business.continue` (one press of Continue → businessCycle) is not in the API yet; until it lands, Continue
      // advances the Inbox by one note so the loop still moves (docs/PROGRESS.md open issue).
      await untyped.mutation("business.continue", { businessId });
      dispatch({ type: "event", event: { type: "cycle.started" }, agentDepartment });
      toast({ title: "Cycle started", description: "The Chief of Staff is planning the next cycle.", tone: "info" });
    } catch (err) {
      if (trpcErrorCode(err) === "NOT_FOUND") refreshInbox.mutate({ businessId });
      else toast({ title: "Continue failed", description: errorMessage(err), tone: "bad" });
    } finally {
      continuing.current = false;
    }
  }, [untyped, businessId, agentDepartment, toast, refreshInbox]);

  const onRespond = useCallback(() => {
    const first = firstBlockingItem(inboxQ.data?.items);
    router.push(first ? routes.inbox(businessId, first.id) : routes.inbox(businessId));
  }, [inboxQ.data?.items, router, businessId]);
  const onGoToJourney = useCallback(() => {
    const win = unviewedWin(inboxQ.data?.items);
    router.push(win ? routes.inbox(businessId, win.id) : routes.inbox(businessId));
  }, [inboxQ.data?.items, router, businessId]);
  const onPause = useCallback(() => {
    void untyped.mutation("business.pauseCycle", { businessId }).catch((err: unknown) => {
      if (trpcErrorCode(err) === "NOT_FOUND") toast({ title: "Pause is not wired yet", description: "Use Stop all agents to halt the cycle; the API gains business.pauseCycle in a later build.", tone: "warn" });
      else toast({ title: "Pause failed", description: errorMessage(err), tone: "bad" });
    });
  }, [untyped, businessId, toast]);

  // --- processing strip -----------------------------------------------------------------------------------------
  const segments = useMemo<ProcessingSegment[]>(
    () => visibleDepartments.map((d) => ({ id: d.id, label: d.name, dept: d.colourToken, active: cycle.activeDepartmentIds.includes(d.id) })),
    [visibleDepartments, cycle.activeDepartmentIds],
  );

  // --- search ----------------------------------------------------------------------------------------------------
  const [searchText, setSearchText] = useState("");
  const [parsed, setParsed] = useState<SearchQuery | null>(null);
  const [debounced, setDebounced] = useState<ReturnType<typeof searchInputFor>>(null);
  const resolveDepartment = useCallback((v: string) => departments.find((d) => d.slug === v.toLowerCase() || d.name.toLowerCase() === v.toLowerCase())?.id, [departments]);
  useEffect(() => {
    const input = parsed ? searchInputFor(parsed, resolveDepartment) : null;
    const t = window.setTimeout(() => setDebounced(input), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [parsed, resolveDepartment]);
  const searchQ = useQuery(trpc.crm.search.queryOptions({ businessId, ...(debounced ?? { q: "-" }) }, { enabled: debounced !== null, staleTime: 15_000, retry: false }));
  const localItems = useMemo(() => localPaletteItems({ businessId, departments, inboxItems: inboxQ.data?.items, live }), [businessId, departments, inboxQ.data?.items, live]);
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const text = parsed?.text ?? searchText;
    const local = filterLocal(localItems, text);
    const remote = debounced && searchQ.data ? entityPaletteItems(businessId, searchQ.data.hits) : [];
    return [...remote, ...local];
  }, [parsed, searchText, localItems, debounced, searchQ.data, businessId]);
  const onQueryChange = useCallback((raw: string, q: SearchQuery) => {
    setSearchText(raw);
    setParsed(q);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const onSelect = useCallback(
    (item: PaletteItem) => {
      setSearchOpen(false);
      if (item.id === "command:refresh-inbox") return refreshInbox.mutate({ businessId });
      if (item.id === "command:edit-layout") return shortcuts.onEditLayout?.();
      if (item.id === "command:stop-all") return document.querySelector<HTMLButtonElement>("[data-testid=stop-all-trigger]")?.click();
      if (item.href) router.push(item.href);
    },
    [router, refreshInbox, businessId, shortcuts],
  );

  // --- providers for the surfaces below ---------------------------------------------------------------------------
  const businessCtx = useMemo(() => makeBusinessContext(businessId, data, departments), [businessId, data, departments]);
  const [collabToken, setCollabToken] = useState<string | undefined>(undefined);
  useEffect(() => {
    void getBrowserAccessToken().then((t) => setCollabToken(t ?? undefined));
  }, []);
  const moduleEnv = useMemo(() => ({ collabUrl: publicEnv().collabUrl, collabToken }), [collabToken]);
  const entityLinks = useMemo(() => ({ hrefFor: (ref: { id: string }) => routes.crm(businessId, ref.id), onOpen: (ref: { id: string }) => router.push(routes.crm(businessId, ref.id)) }), [businessId, router]);

  const financeDept = useMemo(() => visibleDepartments.find((d) => d.moduleKeys.includes("finance")), [visibleDepartments]);
  const onRunwayClick = useCallback(() => {
    if (financeDept) {
      const tab = financeDept.tabs.slice().sort((a, b) => a.position - b.position)[0];
      router.push(routes.department(businessId, financeDept.slug, tab?.slug ?? "overview"));
    }
  }, [financeDept, router, businessId]);

  const stopAllError = stopAll.error ? errorMessage(stopAll.error) : undefined;

  return (
    <BusinessProvider value={businessCtx}>
      <WidgetDataHost businessId={businessId} glossary={business.glossary ?? {}} gameMode={business.gameMode} currency={currency}>
        <ModuleEnvProvider value={moduleEnv}>
          <EntityLinkProvider value={entityLinks}>
            <ShellLinkProvider render={renderNextShellLink}>
              <AppShell
                mode={business.gameMode}
                businessMode={business.businessMode}
                kit={data.kit}
                crest={{ seed: business.slug || business.id, monogram: monogram(business.name) }}
                businessName={business.name}
                screenTitle={chrome.title ?? "Home"}
                sidebar={{ items: sidebarItems, activeId, collapsed, onCollapsedChange }}
                onNavigate={onNavigate}
                nav={{ onBack: () => router.back(), onForward: () => router.forward() }}
                continueButton={{
                  state: continueState,
                  pulseKey: cycle.completedCount,
                  disabled: refreshInbox.isPending || endHoliday.isPending,
                  onContinue,
                  onRespond,
                  onPause,
                  onGoToJourney,
                  onComeBack: () => endHoliday.mutate({ businessId, reason: "founder_returned" }),
                }}
                stopAll={{ onConfirm: () => stopAll.mutateAsync({ businessId, reason: "kill_switch" }).then(() => undefined), runningCount: cycle.activeAgentIds.length, disabled: stopAll.isPending }}
                processing={{ segments, active: cycle.running }}
                tabs={chrome.tabs}
                breadcrumbs={chrome.breadcrumbs}
                rightRail={chrome.rightRail}
                search={{
                  items: paletteItems,
                  query: searchText,
                  onQueryChange,
                  remote: true,
                  loading: debounced !== null && searchQ.isFetching,
                  onSelect,
                  open: searchOpen,
                  onOpenChange: setSearchOpen,
                  placeholder: "Search people, organisations, agents, screens…",
                }}
                date={new Date()}
                runwayMonths={financeQ.data?.runway.months ?? null}
                cash={financeQ.data ? { amountMinor: financeQ.data.cash.amountMinor, currency: financeQ.data.cash.currency } : undefined}
                runwayEstimate
                onRunwayClick={financeDept ? onRunwayClick : undefined}
                onModeClick={() => router.push(routes.settings(businessId, "mode"))}
                keyboard={{
                  onRefreshInbox: shortcuts.onRefreshInbox ?? (() => refreshInbox.mutate({ businessId })),
                  onNextInboxItem: shortcuts.onNextInboxItem,
                  onPrevInboxItem: shortcuts.onPrevInboxItem,
                  onChooseOption: shortcuts.onChooseOption,
                  onEditLayout: shortcuts.onEditLayout,
                  onEscape: shortcuts.onEscape,
                }}
                data-business-id={businessId}
              >
                {stopAllError ? <p className="sr-only" role="alert">{stopAllError}</p> : null}
                {children}
              </AppShell>
            </ShellLinkProvider>
          </EntityLinkProvider>
        </ModuleEnvProvider>
      </WidgetDataHost>
    </BusinessProvider>
  );
}
