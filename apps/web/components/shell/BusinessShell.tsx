"use client";
/**
 * The AppShell wiring for /b/[bid] (docs/ARCHITECTURE.md §14, BUILD §5.3–5.5):
 * - sidebar from department.list in the founder's order, badges from inbox.list;
 * - Continue state from inbox.list (blocking → "Respond · N"), the holiday and `cycle.status`; one pulse per
 *   `cycle.completed`; the button calls `business.continue` / `business.pauseCycle`;
 * - Stop all agents → business.stopAllAgents; processing strip from `cycle.status` kept current by the event stream;
 * - universal search (CommandPalette, remote) over local screens/commands + crm.search;
 * - date + runway chip from finance.overview, business-mode chip → Settings › Mode;
 * - NeedsLargerWindow below 1280 (AppShell measures the window itself); G-then-letter chords (AppShell);
 * - providers for everything below: business context, WidgetDataProvider, ModuleEnv, EntityLink, keyboard registry,
 *   screen chrome.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AppShell, EntityLinkProvider, ShellLinkProvider, useToast, type PaletteItem, type ProcessingSegment, type SearchQuery, type SidebarItem } from "@foundmill/dugout";
import { ModuleEnvProvider, type ModuleEnv } from "@foundmill/modules/env";
import { readWidgetEvent, routes, type WidgetEvent } from "@foundmill/widgets";
import { LAST_BUSINESS_COOKIE, SIDEBAR_COLLAPSED_PREFIX } from "@/lib/auth/constants";
import { computeContinueState, respondHref, unviewedWin } from "@/lib/continue-state";
import { CYCLE_EVENT_TYPES, cycleFromSnapshot, reduceCycleEvent, setPaused, type CycleEvent, type CycleStatus, EMPTY_CYCLE } from "@/lib/cycle";
import { publicEnv } from "@/lib/env";
import { useBusinessLogoSrc } from "@/components/logo/useBusinessLogo";
import { KeyboardRegistryProvider, createKeyboardRegistry, useRegisteredShortcuts } from "@/lib/keys";
import { entityPaletteItems, filterLocal, localPaletteItems, searchInputFor } from "@/lib/search";
import { SIDEBAR_BRAND, activeSidebarId, buildSidebarItems, orderedVisibleDepartments } from "@/lib/sidebar";
import { useStreamSubscription } from "@/lib/stream-client";
import { getBrowserAccessToken } from "@/lib/supabase/client";
import { errorMessage, trpcErrorCode, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { WidgetDataHost } from "@/lib/widget-data";
import { SpecUserProvider } from "@/components/spec/spec-user";
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
/** `cycle.status` is refetched on cycle events; this is the safety net while nothing streams. */
const CYCLE_POLL_MS = 30_000;

/**
 * The collaborative spec editor (Tiptap 3 + Yjs + Hocuspocus) loads on demand: only the Specification tab needs it,
 * and ProseMirror has no server render. The module screens fall back to their plain editor until it arrives.
 */
const SpecEditor = dynamic(() => import("@/components/spec/SpecEditor").then((m) => m.SpecEditor), { ssr: false });

/** Events after which the shell refetches a router's queries. */
const INVALIDATE_ON_EVENT: Record<string, readonly string[]> = {
  "inbox.item_created": ["inbox"],
  "decision.made": ["inbox", "plan"],
  "customer.converted": ["inbox", "journey", "finance"],
  "agent.health_changed": ["department", "team"],
  "mode.changed": ["business"],
  "holiday.started": ["business"],
  "holiday.ended": ["business", "inbox", "cycle"],
  "cycle.started": ["cycle"],
  "cycle.completed": ["inbox", "department", "dev", "finance", "cycle"],
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

type CycleAction = { type: "event"; event: CycleEvent; agentDepartment: (id: string) => string | null | undefined } | { type: "snapshot"; status: CycleStatus } | { type: "paused"; paused: boolean };

/** `cycle.status` is authoritative; stream events keep it current between refetches; the pulse key never goes backwards. */
export function cycleReducer(status: CycleStatus, action: CycleAction): CycleStatus {
  if (action.type === "snapshot") return { ...action.status, completedCount: Math.max(status.completedCount, action.status.completedCount) };
  if (action.type === "paused") return setPaused(status, action.paused);
  return reduceCycleEvent(status, action.event, action.agentDepartment);
}

type ContinueResult = RouterOutputs["business"]["continue"];

/** The toast one press of Continue earns (BUILD §9.4): what happened, and where the new note is in local mode. */
export function describeContinue(result: ContinueResult): { title: string; description: string; tone: "info" | "good" | "warn"; itemId: string | null } {
  if (result.action === "already_running") return { title: "A cycle is already running", description: "The team is still working; the strip shows where.", tone: "info", itemId: null };
  if (result.action === "resumed") return { title: "Cycle resumed", description: "Paused tasks pick up where they stopped.", tone: "good", itemId: null };
  if (result.mode === "local" && result.item) return { title: "One new note", description: result.item.subject, tone: "info", itemId: result.item.id };
  return { title: "Cycle started", description: "The Chief of Staff is planning the next cycle.", tone: "info", itemId: null };
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

function ShellInner({ businessId, initialBusiness, initialDepartments, viewer, children }: BusinessShellProps) {
  const trpc = useTRPC();
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
  const cycleQ = useQuery(trpc.cycle.status.queryOptions({ businessId }, { staleTime: 10_000, refetchInterval: CYCLE_POLL_MS, retry: false }));

  const data = businessQ.data ?? initialBusiness;
  const departments = departmentsQ.data ?? initialDepartments;
  const visibleDepartments = useMemo(() => orderedVisibleDepartments(departments), [departments]);
  const business = data.business;
  const logoSrc = useBusinessLogoSrc(businessId, data.logo);
  const live = business.gameMode === "live";
  const currency = financeQ.data?.cash.currency ?? "EUR";

  const agentDepartment = useCallback(
    (agentId: string) => departments.find((d) => d.squad.some((a) => a.id === agentId) || d.leadAgentId === agentId)?.id ?? null,
    [departments],
  );

  // --- cycle status: `cycle.status` snapshot + the stream ----------------------------------------------------------
  const [cycle, dispatch] = useReducer(cycleReducer, EMPTY_CYCLE);
  useEffect(() => {
    if (cycleQ.data) dispatch({ type: "snapshot", status: cycleFromSnapshot(cycleQ.data) });
  }, [cycleQ.data]);

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

  // One press of Continue → `business.continue` (BUILD §9.4): starts the next businessCycle on Temporal, resumes a
  // paused one, or runs one in-process cycle step (one new note) when no worker answers. The result carries the new
  // cycle status, adopted at once; the stream keeps it current afterwards.
  const continueCycle = useMutation(
    trpc.business.continue.mutationOptions({
      onSuccess: (result) => {
        dispatch({ type: "snapshot", status: cycleFromSnapshot(result.status) });
        void invalidate(["cycle", "inbox", "dev"]);
        const t = describeContinue(result);
        toast({ title: t.title, description: t.description, tone: t.tone, action: t.itemId ? { label: "Open", onClick: () => router.push(routes.inbox(businessId, t.itemId!)) } : undefined });
      },
      onError: (err) => {
        const code = trpcErrorCode(err);
        void invalidate(["cycle", "inbox", "business"]);
        toast({ title: code === "CONFLICT" ? "Continue is waiting on you" : "Continue failed", description: errorMessage(err), tone: code === "CONFLICT" ? "warn" : "bad" });
      },
    }),
  );
  const pauseCycle = useMutation(
    trpc.business.pauseCycle.mutationOptions({
      onSuccess: (result) => {
        dispatch({ type: "snapshot", status: cycleFromSnapshot(result.status) });
        dispatch({ type: "paused", paused: result.paused });
        void invalidate(["cycle", "dev"]);
        toast(result.paused ? { title: "Cycle paused", description: `${result.pausedTasks} running task${result.pausedTasks === 1 ? "" : "s"} paused. Continue resumes the cycle.`, tone: "warn" } : { title: "Nothing to pause", description: result.reason ?? "No cycle is running.", tone: "info" });
      },
      onError: (err) => toast({ title: "Pause failed", description: errorMessage(err), tone: "bad" }),
    }),
  );

  const continuing = useRef(false);
  const startCycle = continueCycle.mutateAsync;
  const onContinue = useCallback(async () => {
    if (continuing.current) return;
    continuing.current = true;
    try {
      await startCycle({ businessId });
    } catch {
      /* reported by onError */
    } finally {
      continuing.current = false;
    }
  }, [startCycle, businessId]);

  const onRespond = useCallback(() => {
    router.push(respondHref(businessId, inboxQ.data?.items));
  }, [inboxQ.data?.items, router, businessId]);
  const onGoToJourney = useCallback(() => {
    const win = unviewedWin(inboxQ.data?.items);
    router.push(win ? routes.inbox(businessId, win.id) : routes.inbox(businessId));
  }, [inboxQ.data?.items, router, businessId]);
  const pause = pauseCycle.mutate;
  const pausing = pauseCycle.isPending;
  const onPause = useCallback(() => {
    if (!pausing) pause({ businessId });
  }, [pause, pausing, businessId]);

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
  // Module environment (docs/ARCHITECTURE.md §18): the collab server, the Supabase access token it authenticates (the
  // dev bearer when there is no Supabase session) and the host's collaborative SpecEditor. Without a collab URL the
  // editor keeps its edits local and saves whole blocks through `product.spec.editBlock`.
  const [collabToken, setCollabToken] = useState<string | undefined>(undefined);
  useEffect(() => {
    void getBrowserAccessToken().then((t) => setCollabToken(t ?? undefined));
  }, []);
  const moduleEnv = useMemo<Partial<ModuleEnv>>(() => ({ collabUrl: publicEnv().collabUrl, collabToken, SpecEditor }), [collabToken]);
  const specUser = useMemo(() => ({ id: viewer.userId ?? "dev", name: viewer.email ?? "You" }), [viewer.userId, viewer.email]);
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
          <SpecUserProvider value={specUser}>
          <EntityLinkProvider value={entityLinks}>
            <ShellLinkProvider render={renderNextShellLink}>
              <AppShell
                mode={business.gameMode}
                businessMode={business.businessMode}
                kit={data.kit}
                logoSrc={logoSrc}
                businessName={business.name}
                screenTitle={chrome.title ?? "Home"}
                sidebar={{ items: sidebarItems, activeId, collapsed, onCollapsedChange, brand: SIDEBAR_BRAND }}
                onNavigate={onNavigate}
                nav={{ onBack: () => router.back(), onForward: () => router.forward() }}
                continueButton={{
                  state: continueState,
                  pulseKey: cycle.completedCount,
                  disabled: refreshInbox.isPending || endHoliday.isPending || continueCycle.isPending || pauseCycle.isPending,
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
          </SpecUserProvider>
        </ModuleEnvProvider>
      </WidgetDataHost>
    </BusinessProvider>
  );
}
