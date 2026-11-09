"use client";
/**
 * The AppShell wiring for /b/[bid] (docs/ARCHITECTURE.md §14, BUILD §5.3–5.5):
 * - sidebar from department.list in the founder's order, badges from inbox.list;
 * - Continue state from inbox.list (blocking → "Respond · N"), the holiday and `cycle.status`; one pulse per
 *   `cycle.completed`; the button calls `business.continue` / `business.pauseCycle`;
 * - Stop all agents → business.stopAllAgents; while the team is stopped (`business.get`) the same control is Resume
 *   agents → business.resumeAgents (owners and admins); processing strip from `cycle.status` kept current by the stream;
 * - universal search (CommandPalette, remote) over local screens/commands + crm.search;
 * - date + runway chip from finance.overview, business-mode chip → Settings › What the team can do;
 * - NeedsLargerWindow below 1280 (AppShell measures the window itself); G-then-letter chords (AppShell);
 * - providers for everything below: business context, WidgetDataProvider, ModuleEnv, EntityLink, keyboard registry,
 *   screen chrome, and the definitions in this business's own words (`GuidanceTermsProvider` over the layout's
 *   GuidanceHost: the glossary comes from `business.get`, which the shell already holds).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition, type ReactNode } from "react";
import { AppShell, Avatar, useAgentPersona, useBuilderView, Button, Callout, Chip, EntityLinkProvider, GuidanceTermsProvider, ShellLinkProvider, Tooltip, useToast, type PaletteItem, type ProcessingSegment, type SearchQuery, type SidebarItem } from "@foundmill/dugout";
import { ModuleEnvProvider, type ModuleEnv } from "@foundmill/modules/env";
import { readWidgetEvent, type WidgetEvent } from "@foundmill/widgets/data";
import { routes } from "@foundmill/widgets/shared/routes";
import { runwayFigure, runwayWords } from "@foundmill/widgets/shared/runway";
import { agentsStoppedView } from "@/lib/agents-stopped";
import { SIDEBAR_COLLAPSED_PREFIX } from "@/lib/auth/constants";
import { rememberLastBusiness } from "@/lib/auth/last-business";
import { accountRoutes } from "@/lib/account-routes";
import { EXAMPLE_CHIP_TOOLTIP, readOnlyReason, type Access } from "@/lib/access";
import { CONTINUE_RUN_END_REASONS, continueRunEndedMessage, type ContinueRunEndReason } from "@foundmill/shared";
import { awayReportId, computeContinueState, journeyHref, respondHref, unviewedWin } from "@/lib/continue-state";
import { CYCLE_EVENT_TYPES, cycleFromSnapshot, initialCycle, nextPulseKey, reduceCycleEvent, setPaused, type CycleEvent, type CycleStatus } from "@/lib/cycle";
import type { AgentSummary } from "@/lib/entity-links";
import { useEntityResolver } from "@/lib/entity-resolver";
import { publicEnv } from "@/lib/env";
import { invalidateForEvent, streamAwareStaleTime } from "@/lib/query-client";
import { shellQueryInputs } from "@/lib/shell-queries";
import { useBusinessLogoSrc, useBusinessLogos } from "@/components/logo/useBusinessLogo";
import { KeyboardRegistryProvider, createKeyboardRegistry, useRegisteredShortcuts } from "@/lib/keys";
import { publicPaletteItems, publicSearchText } from "@/lib/public-search";
import { entityPaletteItems, filterLocal, helpPaletteItems, localPaletteItems, searchInputFor } from "@/lib/search";
import { SIDEBAR_BRAND, SIDEBAR_IDS, activeSidebarId, buildSidebarItems, orderedVisibleDepartments } from "@/lib/sidebar";
import { signOut } from "@/lib/auth/sign-out";
import { useStreamSubscription } from "@/lib/stream-client";
import { CONNECTION_GRACE_MS, LATE_NOTICE_MS, SAFETY_POLL_MS, streamPollInterval, useBusinessLive, useConnectionNotice } from "@/lib/stream-status";
import { browserTimeZone, timeZoneToClaim, useClientToday } from "@/lib/today";
import { getBrowserAccessToken } from "@/lib/supabase/client";
import { errorMessage, trpcErrorCode, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { WidgetDataHost } from "@/lib/widget-data";
import { SpecUserProvider, specUserName } from "@/components/spec/spec-user";
import { AgentDeskHost, prefetchAgentDesk, type AgentDeskApi } from "@/components/conversation/DeskHost";
import { useNetworkBadge } from "@/components/live/signals";
import { termsFor } from "@/components/providers/GuidanceHost";
import { agentOfAskItem, askPaletteItems, askQuestion, generatePaletteItems, paletteAgents } from "@/components/conversation/palette";
import { BusinessProvider, makeBusinessContext, type BusinessGet, type DepartmentList } from "./business-context";
import { switcherBusinesses } from "./business-switcher";
import { AskChief } from "./AskChief";
import { ShellChromeProvider, useShellChromeValue } from "./chrome";
import { isShellLinkClick, renderNextShellLink } from "./NextShellLink";

export interface BusinessShellProps {
  businessId: string;
  initialBusiness: BusinessGet;
  initialDepartments: DepartmentList;
  /** The signed-in person; `name` is their profile's display name (the label on their caret in the spec editor). */
  viewer: { email: string | null; userId: string | null; name?: string | null };
  children: ReactNode;
}

const SEARCH_DEBOUNCE_MS = 150;
/**
 * `inbox.list` and `cycle.status` are refetched on the events that change them; polling is the safety net: every 30 s
 * while the business's event channel is not live, and slowly while it is (changes that publish no event, such as a
 * read by another member, and a link that stalls).
 */
const POLL_WITHOUT_STREAM_MS = 30_000;
/**
 * The shell's polling, by whether the business's event channel is live. `department.list` (the sidebar's names, order
 * and tabs, each department's team) changes with department edits and hires by another member, which publish no event
 * (audit RUI-09), so it polls at the safety pace whatever the channel.
 */
export function shellPollIntervals(live: boolean): { inbox: number; cycle: number; departments: number } {
  const stream = streamPollInterval(live, POLL_WITHOUT_STREAM_MS);
  return { inbox: stream, cycle: stream, departments: SAFETY_POLL_MS };
}
/**
 * Freshness of the shell's stream-kept queries: minutes while the business's channel has stayed live since they were
 * fetched, these values otherwise.
 */
const INBOX_STALE = streamAwareStaleTime(10_000);
const FINANCE_STALE = streamAwareStaleTime(60_000);
const CYCLE_STALE = streamAwareStaleTime(10_000);

/** Foundations states in which `product.foundations.ensure` still has work: claim a pending draft, or close a stale one. */
export function foundationsNeedEnsure(status: string | undefined): boolean {
  return status === undefined || status === "pending" || status === "drafting";
}

/**
 * The collaborative spec editor (Tiptap 3 + Yjs + Hocuspocus) loads on demand: only the Specification tab needs it,
 * and ProseMirror has no server render. The module screens fall back to their plain editor until it arrives.
 */
const SpecEditor = dynamic(() => import("@/components/spec/SpecEditor").then((m) => m.SpecEditor), { ssr: false });

/** Events after which the shell refetches a router's queries (or one procedure group's, as a dotted path). */
export const INVALIDATE_ON_EVENT: Record<string, readonly string[]> = {
  // An Inbox item that blocks Continue (or the decision that clears it) moves the Autopilot chip: Needs your answer.
  "inbox.item_created": ["inbox", "business.autopilot", "today"],
  // Another member archived an item or confirmed its plan (audit RUI-09).
  "inbox.item_updated": ["inbox", "plan", "today"],
  "decision.made": ["inbox", "plan", "business.autopilot", "today"],
  "customer.converted": ["inbox", "journey", "finance", "goal", "today"],
  // A renewal or a repeat order is revenue with no customer.converted (only first payments win a customer).
  "payment.received": ["journey", "finance"],
  // Stop all agents and its resume write one per agent (from any tab or service): the business carries the stop flag.
  "agent.health_changed": ["department", "team", "business"],
  "mode.changed": ["business"],
  // A rename or new brand colors saved in another tab or by a co-founder (audit RES-07).
  "business.updated": ["business"],
  // Autopilot turned on or off, its settings changed, or a guard rail paused it: the chip and Settings read business.autopilot.
  "autopilot.changed": ["business"],
  "autopilot.cycle_started": ["business", "cycle"],
  "holiday.started": ["business"],
  "holiday.ended": ["business", "inbox", "cycle"],
  "cycle.started": ["cycle", "business.autopilot", "today"],
  // The run one press of Continue starts (Nov 7, 2026): Continue keeps Pause until it ends.
  "cycle.run_started": ["cycle", "business.autopilot"],
  "cycle.run_ended": ["cycle", "business.autopilot"],
  "cycle.completed": ["inbox", "department", "dev", "finance", "cycle", "business.autopilot", "goal", "today"],
  "bank.balance_updated": ["finance"],
  "runway.threshold_crossed": ["finance", "inbox"],
  "approval.requested": ["inbox", "today"],
  "credential.expiring": ["integrations", "inbox"],
  // Each part of the first-open drafting as it is stored, and the apply (audit P3): the vision, sections and roadmap
  // items appear on Home and the Product tabs as they land. Only the foundations query: the tabs reload their own data
  // when the drafting turns ready.
  "foundations.progressed": ["product.foundations"],
  // The founder signed off the specification or the roadmap (or declined to start selling): the Product tabs' pills, the
  // business's stage, the Inbox and Development › Plan (the first build) follow.
  "product.signoff_decided": ["business", "product.signoff", "inbox", "dev", "today"],
  // Distribution started: the Board and the Channels table drop "Waiting for the product"; the Board question is in the Inbox.
  "distribution.started": ["business", "distribution", "inbox"],
  // The Product Researcher's plan is ready: the Research tab's panel, the Inbox note and the first research tasks.
  "product.research_drafted": ["product.research", "inbox", "dev"],
  // The business's goal (founder, 2026-11-07): the Chief of Staff's proposal and its answer are Inbox notes; a reached
  // goal posts "Goal reached: …".
  "goal.proposed": ["goal", "today", "inbox"],
  "goal.approved": ["goal", "today", "inbox"],
  "goal.change_requested": ["goal", "today", "inbox"],
  "goal.achieved": ["goal", "today", "inbox"],
  // Someone's role or section permissions changed (maybe this reader's): the business carries the reader's own role
  // and walls, the Team the staff list. apps/stream has already re-checked the reader's open channels.
  "membership.changed": ["business", "team"],
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

/**
 * The top bar's connection chip (audit RES-11): in Builder view the state as it is ("Reconnecting…", "Live updates
 * paused"); with it off, either one reads "Updates may be late" (the caller shows it only after `LATE_NOTICE_MS`).
 */
export function shellConnection(state: "reconnecting" | "paused" | null, builder: boolean): { state: "reconnecting" | "paused" | "late"; detail: string } | null {
  if (!state) return null;
  if (!builder) return { state: "late", detail: "Nothing is lost: the team keeps working. What you see may be a little behind; the Inbox and Continue refresh every 30 s." };
  return { state, detail: state === "reconnecting" ? "The live connection dropped. Nothing is lost. What you see may be out of date; the Inbox and Continue refresh every 30 s until it is back." : "Live updates are paused. Nothing is lost. What you see may be out of date; the Inbox and Continue refresh every 30 s." };
}

/** `cycle.status` is authoritative; stream events keep it current between refetches; the pulse key never goes backwards. */
export function cycleReducer(status: CycleStatus, action: CycleAction): CycleStatus {
  if (action.type === "snapshot") return { ...action.status, completedCount: Math.max(status.completedCount, action.status.completedCount) };
  if (action.type === "paused") return setPaused(status, action.paused);
  return reduceCycleEvent(status, action.event, action.agentDepartment);
}

type ContinueResult = RouterOutputs["business"]["continue"];

/** The sentence a press that started a run adds (Nov 7, 2026): new cycles keep starting on their own. */
export const RUN_UNTIL_DONE = "New cycles start on their own until nothing is left to do, or until you pause.";

/**
 * The toast one press of Continue earns (BUILD §9.4): what happened, and where the new note is in local mode. With an
 * orchestrator a press starts a run (`result.run`): the toast says the cycles keep coming until nothing is left.
 */
export function describeContinue(result: ContinueResult): { title: string; description: string; tone: "info" | "good" | "warn"; itemId: string | null } {
  const run = Boolean(result.run);
  if (result.action === "already_running") return { title: "A cycle is already running", description: run ? `The team is still working. ${RUN_UNTIL_DONE}` : "The team is still working; the strip under the top bar shows where.", tone: "info", itemId: null };
  if (result.action === "resumed") return { title: "Cycle resumed", description: run ? `Paused tasks pick up where they stopped. ${RUN_UNTIL_DONE}` : "Paused tasks pick up where they stopped.", tone: "good", itemId: null };
  if (result.mode === "local" && result.item) return { title: "One new note", description: result.item.subject, tone: "info", itemId: result.item.id };
  if (run) return { title: "Cycle started", description: `The team is at work. ${RUN_UNTIL_DONE} Their notes land in the Inbox.`, tone: "info", itemId: null };
  return { title: "Cycle started", description: "The team is at work. What they finish and what they need from you come back as notes in the Inbox.", tone: "info", itemId: null };
}

type PauseResult = RouterOutputs["business"]["pauseCycle"];

/** The toast a press of Pause earns: the round paused, the run ended (so no new cycle starts), or nothing to pause. */
export function describePause(result: Pick<PauseResult, "paused" | "pausedTasks" | "reason"> & { runEnded?: boolean }): { title: string; description: string; tone: "info" | "warn" } {
  if (result.paused) return { title: "Paused", description: `${result.pausedTasks} running task${result.pausedTasks === 1 ? "" : "s"} paused. Press Continue to pick up where the team stopped.`, tone: "warn" };
  if (result.runEnded) return { title: "Paused", description: "No new cycle starts. Press Continue to pick up where the team stopped.", tone: "warn" };
  return { title: "Nothing to pause", description: result.reason ?? "No cycle is running.", tone: "info" };
}

/**
 * The toast a run's end earns on the stream (every member watching sees it): the team has done all it can, a day's
 * limit, a hard stop, a vacation. Null for an end the reader caused or hears about otherwise (Pause, Stop all agents).
 */
export function describeRunEnded(event: { type: string; payload?: Record<string, unknown> | null }): { title: string; description: string; tone: "info" | "good" | "warn" } | null {
  if (event.type !== "cycle.run_ended") return null;
  const reason = event.payload?.reason;
  if (typeof reason !== "string" || !(CONTINUE_RUN_END_REASONS as readonly string[]).includes(reason)) return null;
  const max = event.payload?.maxCyclesPerDay;
  return continueRunEndedMessage(reason as ContinueRunEndReason, typeof max === "number" ? max : null);
}

/**
 * The first-Continue callout (UX plan §7.7): "This is how you move forward", under Continue, until the first cycle
 * the founder starts has completed. Commit starts cycle 1 by itself (services/commit.ts), so the cycle a founder's
 * press starts is the second one; a business with two finished cycles has moved forward on its own. Never for a role
 * that cannot press Continue (viewers, advisors, the read-only demo). The Coachmark itself also waits while a cycle
 * is processing or a dialog is open, and never replays once "Got it" marked the tour done.
 */
export function wantsFirstContinueCallout(cycle: { completedCount: number }, canChange: boolean): boolean {
  return canChange && cycle.completedCount <= 1;
}

export const FIRST_CONTINUE_CALLOUT = { tourId: "first-continue", targetId: "continue", title: "This is how you move forward", body: "Press it when you have answered what needs you." } as const;

/**
 * The Example frame (docs/UX_AUDIT_AND_PLAN.md §12 item 5): what the shell changes for an example viewer (a read-only
 * walk around a seeded demo business, `lib/access.ts isExampleViewer`). The neutral "Example" chip sits beside the
 * business name; Stop all agents is hidden (nothing here is theirs to stop); the first-Continue callout gives way to
 * one that points at "Start your own", the primary action in Continue's slot (its own tour id, so the real
 * first-Continue callout still teaches the loop on the founder's own business later). Every write stays refused with
 * the example wording (`readOnlyReason`), and the first-week checklist, the next step and the tours stay: they teach
 * here too. Pure: the shell reads it and the unit tests pin it.
 */
export interface ExampleFrame {
  /** The "Example" chip beside the name, with `EXAMPLE_CHIP_TOOLTIP`. */
  chip: boolean;
  /** Stop all agents is hidden (not merely refused). */
  stopAllHidden: boolean;
  /** The callout under Continue's slot: the Start-your-own one in the example, the first-Continue one otherwise. */
  callout: typeof EXAMPLE_START_CALLOUT | typeof FIRST_CONTINUE_CALLOUT | null;
}

export const EXAMPLE_START_CALLOUT = { tourId: "example-start", targetId: "start-your-own", title: "This is an example", body: "When you are ready, start your own business here." } as const;

export function exampleFrame(access: Pick<Access, "isExample" | "canChange">, cycle: { completedCount: number }): ExampleFrame {
  if (access.isExample) return { chip: true, stopAllHidden: true, callout: EXAMPLE_START_CALLOUT };
  return { chip: false, stopAllHidden: false, callout: wantsFirstContinueCallout(cycle, access.canChange) ? FIRST_CONTINUE_CALLOUT : null };
}

/**
 * The Example frame's badge after the business name (KitBar `businessBadge`): the neutral "Example" chip. Its tooltip
 * explains the frame; pointer moves stop at the chip so the switcher's own "Switch business" tooltip does not open over
 * it.
 */
function ExampleBadge() {
  return (
    <Tooltip content={EXAMPLE_CHIP_TOOLTIP} side="bottom">
      <Chip className="shrink-0 text-kit-on-primary" data-testid="example-chip" onPointerMove={(e) => e.stopPropagation()}>
        Example
      </Chip>
    </Tooltip>
  );
}

/** Where "Start your own" goes from an example business: the three doors on /new. */
export const START_YOUR_OWN_HREF = "/new";

/**
 * The Example frame's primary action in Continue's slot (KitBar `continueSlot`): "Start your own", at Continue's size,
 * anchoring the Start-your-own callout (`data-coachmark="start-your-own"`, tour id `example-start`).
 */
function StartYourOwnButton({ onStart }: { onStart: () => void }) {
  return (
    <Button variant="primary" iconRight={ArrowRight} className="h-kitbar-chip rounded-track min-w-continue-min" data-coachmark="start-your-own" data-testid="start-your-own" onClick={onStart}>
      Start your own
    </Button>
  );
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
  // The layout starts inbox, finance and cycle on the server and hands them over under these same keys
  // (lib/shell-data.server.ts); business and departments arrive as initial data.
  const inputs = useMemo(() => shellQueryInputs(businessId), [businessId]);
  const poll = shellPollIntervals(useBusinessLive(businessId));
  const businessQ = useQuery(trpc.business.get.queryOptions({ businessId }, { initialData: initialBusiness, staleTime: 30_000 }));
  const departmentsQ = useQuery(trpc.department.list.queryOptions(inputs.departments, { initialData: initialDepartments, staleTime: 30_000, refetchInterval: poll.departments }));
  const inboxQ = useQuery(trpc.inbox.list.queryOptions(inputs.inbox, { staleTime: INBOX_STALE, refetchInterval: poll.inbox }));
  const financeQ = useQuery(trpc.finance.overview.queryOptions(inputs.finance, { staleTime: FINANCE_STALE, retry: false }));
  const cycleQ = useQuery(trpc.cycle.status.queryOptions(inputs.cycle, { staleTime: CYCLE_STALE, refetchInterval: poll.cycle, retry: false }));

  // --- foundations: the first open drafts the vision, specification and roadmap (BUILD §11.1, §11.5) ---------------
  // `product.foundations.ensure` is idempotent on the server (it claims a pending draft exactly once, so two tabs or a
  // reload never start it twice); this keeps it to one call per business per mount, and only while there is something
  // to start or to close (`business.get` carries the status: pending or drafting). Once the foundations are ready (or
  // failed, or the business has none) opening the business makes no call. It never blocks the page: the drafting runs
  // in the background and Home and the Product tabs poll `product.foundations.get`.
  const ensureFoundations = useMutation(
    trpc.product.foundations.ensure.mutationOptions({
      retry: 2,
      onSuccess: (view) => {
        if (view.started || view.status !== "none") void queryClient.invalidateQueries({ queryKey: trpc.product.foundations.get.queryKey({ businessId }) });
      },
    }),
  );
  const ensureFor = ensureFoundations.mutate;
  const ensuredBusiness = useRef<string | null>(null);
  const foundationsStatus = (businessQ.data ?? initialBusiness).foundationsStatus;
  useEffect(() => {
    if (ensuredBusiness.current === businessId) return;
    ensuredBusiness.current = businessId;
    if (foundationsNeedEnsure(foundationsStatus)) ensureFor({ businessId });
  }, [businessId, ensureFor, foundationsStatus]);

  const data = businessQ.data ?? initialBusiness;
  const departments = departmentsQ.data ?? initialDepartments;
  const visibleDepartments = useMemo(() => orderedVisibleDepartments(departments), [departments]);
  const business = data.business;
  // The business's day (audit #196): the same day Home's tiles and the Journey's rows count in.
  const today = useClientToday(business.timeZone);
  const logoSrc = useBusinessLogoSrc(businessId, data.logo);
  const live = business.gameMode === "live";
  // The business's own currency (0025) for every business amount on every screen; a bank account's currency is its own.
  const currency = business.currency;
  const businessCtx = useMemo(() => makeBusinessContext(businessId, data, departments), [businessId, data, departments]);
  // What this person may open and change (audit RUI-05): the sidebar, the palette and the shell's controls follow it.
  const access = businessCtx.access;

  const agentDepartment = useCallback(
    (agentId: string) => departments.find((d) => d.squad.some((a) => a.id === agentId) || d.leadAgentId === agentId)?.id ?? null,
    [departments],
  );

  // --- cycle status: `cycle.status` snapshot + the stream ----------------------------------------------------------
  // Seeded from the snapshot the page arrived with, so its finished cycles never read as one completing (audit WEB-15).
  const [cycle, dispatch] = useReducer(cycleReducer, cycleQ.data, initialCycle);
  useEffect(() => {
    if (cycleQ.data) dispatch({ type: "snapshot", status: cycleFromSnapshot(cycleQ.data) });
  }, [cycleQ.data]);
  // One Continue pulse per `cycle.completed` on the stream; adopting a snapshot never pulses.
  const [pulseKey, setPulseKey] = useState(0);
  // Come back waits for the "While you were away" note and opens it when it lands (audit OL-27).
  const awaitingAwayReport = useRef(false);

  const invalidate = useCallback((routers: readonly string[]) => Promise.all(routers.map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] }))), [queryClient]);

  // --- time zone: the first open by an owner or admin sets the business's zone from their browser (audit #196) -----
  // Until then days read as UTC everywhere; Settings › Business changes it. Once per business per mount, best effort.
  const claimZone = useMutation(trpc.business.setTimeZone.mutationOptions({ onSuccess: () => void invalidate(["business", "journey", "finance"]) }));
  const claimZoneFor = claimZone.mutate;
  const zoneClaimed = useRef<string | null>(null);
  useEffect(() => {
    if (zoneClaimed.current === businessId) return;
    const zone = timeZoneToClaim(business.timeZone, data.role, browserTimeZone());
    if (!zone) return;
    zoneClaimed.current = businessId;
    claimZoneFor({ businessId, timeZone: zone });
  }, [businessId, business.timeZone, data.role, claimZoneFor]);

  useStreamSubscription(`ev:${businessId}`, (raw) => {
    const event: WidgetEvent | null = readWidgetEvent(raw);
    if (!event) return;
    if ((CYCLE_EVENT_TYPES as readonly string[]).includes(event.type)) dispatch({ type: "event", event, agentDepartment });
    setPulseKey((k) => nextPulseKey(k, event.type));
    const ended = describeRunEnded(event);
    if (ended) toast(ended);
    const reportId = awayReportId(event);
    if (reportId && awaitingAwayReport.current) {
      awaitingAwayReport.current = false;
      router.push(routes.inbox(businessId, reportId));
    }
    const routers = INVALIDATE_ON_EVENT[event.type];
    // A read already on its way is kept and asked again once it lands (lib/query-client.ts `invalidateForEvent`).
    if (routers) void invalidateForEvent(queryClient, routers);
  });

  // --- last business cookie (the index route redirects here next time) -------------------------------------------
  useEffect(() => {
    rememberLastBusiness(businessId);
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
  // The founder's LIVE badge (requests, messages, invitations, posts to moderate) in every business and mode.
  const network = useNetworkBadge(viewer.userId);
  // Builder view (docs/DESIGN.md): its tabs are not linked and cycle numbers are not shown while it is off.
  const builder = useBuilderView();
  const sidebarItems = useMemo(
    () => buildSidebarItems({ businessId, departments, inboxCounts: inboxQ.data?.counts, inboxItems: inboxQ.data?.items, live, network, access, builder }),
    [businessId, departments, inboxQ.data?.counts, inboxQ.data?.items, live, network, access, builder],
  );
  const cycleNumber = builder ? cycle.cycleNumber : null;
  const activeId = useMemo(() => activeSidebarId(pathname, businessId, departments), [pathname, businessId, departments]);
  // Sidebar links navigate by themselves (next/link); this pushes only for keyboard chords, the logo button and items
  // without a link, so one click is one navigation.
  const onNavigate = useCallback(
    (item: SidebarItem) => {
      if (item.id === SIDEBAR_IDS.signOut) return signOut();
      if (item.href && !isShellLinkClick()) router.push(item.href);
    },
    [router],
  );

  // --- Continue ------------------------------------------------------------------------------------------------
  const continueState = useMemo(
    () => {
      const state = computeContinueState({ blocking: inboxQ.data?.blocking ?? data.blockingItems ?? 0, items: inboxQ.data?.items, holiday: data.holiday, cycle });
      // "On vacation until Oct 21" is the founder's own day, known only in the browser (see `today`): until then the
      // caption reads "On vacation", so the server's UTC day never mismatches the browser's on hydration.
      if (state.kind === "holiday" && today === null) return { ...state, until: null };
      // The running cycle's number travels with the state ("The team is working · cycle 3"), in Builder view only.
      if (state.kind === "processing" && cycleNumber) return { ...state, cycle: cycleNumber };
      return state;
    },
    [inboxQ.data?.blocking, inboxQ.data?.items, data.blockingItems, data.holiday, cycle, cycleNumber, today],
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
  // Come back opens the Inbox at once, then "While you were away" when the Chief of Staff has written it (BUILD §9.6).
  const endHoliday = useMutation(
    trpc.business.endHoliday.mutationOptions({
      onSuccess: () => {
        awaitingAwayReport.current = true;
        void invalidate(["business", "inbox"]);
        router.push(routes.inbox(businessId));
        toast({ title: "Welcome back", description: "You are back in charge. “While you were away” opens here as soon as it is written.", tone: "good" });
      },
      onError: (err) => toast({ title: "Could not end the vacation", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const stopAll = useMutation(
    trpc.business.stopAllAgents.mutationOptions({
      onSuccess: () => {
        dispatch({ type: "event", event: { type: "agents.stopped" }, agentDepartment });
        void invalidate(["business", "dev", "department", "team", "inbox", "cycle"]);
        toast({ title: "All agents stopped", description: "Workflows, engines and campaigns are paused. Nothing starts again until an owner or admin resumes the agents.", tone: "warn" });
      },
    }),
  );
  // The way back (owners and admins): the stop button turns into Resume agents while the team is stopped.
  const resumeAll = useMutation(
    trpc.business.resumeAgents.mutationOptions({
      onSuccess: (result) => {
        void invalidate(["business", "dev", "department", "team", "cycle"]);
        toast({ title: "Agents resumed", description: `${result.resumedAgents} agent${result.resumedAgents === 1 ? " is" : "s are"} back. The next cycle picks up the paused tasks.`, tone: "good" });
      },
    }),
  );
  const stopped = useMemo(() => agentsStoppedView(business, data.role), [business, data.role]);

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
        toast(describePause(result));
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
  // "Go to Journey" opens the won customer's Customer Update (the server knows its journey) and marks the win seen,
  // which frees Continue; without a journey yet it opens the win's note (audit OL-27).
  const markRead = useMutation(trpc.inbox.markRead.mutationOptions({ onSuccess: () => void invalidate(["inbox"]) }));
  const markWinRead = markRead.mutate;
  const onGoToJourney = useCallback(async () => {
    const win = unviewedWin(inboxQ.data?.items);
    let state: RouterOutputs["cycle"]["continueState"] | null = null;
    try {
      state = await queryClient.fetchQuery(trpc.cycle.continueState.queryOptions({ businessId }, { staleTime: 0 }));
    } catch {
      /* fall back to the note */
    }
    const winId = (state?.kind === "matchday" ? state.itemId : null) ?? win?.id ?? null;
    if (winId && state?.kind === "matchday" && state.journeyId) markWinRead({ businessId, itemId: winId });
    router.push(journeyHref(businessId, state, win?.id));
  }, [inboxQ.data?.items, router, businessId, queryClient, trpc, markWinRead]);
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
  // Records only for someone who may read the CRM (anyone else would get a silent refusal).
  const searchQ = useQuery(trpc.crm.search.queryOptions({ businessId, ...(debounced ?? { q: "-" }) }, { enabled: debounced !== null && access.canRead("crm"), staleTime: 15_000, retry: false }));
  const [searchOpen, setSearchOpenState] = useState(false);
  // The founder's businesses (Switch business, the palette's "Switch to"): asked for only once the founder reaches for
  // them (pointer, focus, open, or the palette), so opening a business costs no request for them.
  const [wantBusinesses, setWantBusinesses] = useState(false);
  const businessesQ = useQuery(trpc.founder.businesses.list.queryOptions(undefined, { enabled: wantBusinesses || searchOpen, staleTime: 60_000 }));
  const { data: businessesData, isLoading: businessesLoading, refetch: refetchBusinesses } = businessesQ;
  const businessesFailed = Boolean(businessesQ.error);
  const businessLogos = useBusinessLogos(businessesData?.businesses, wantBusinesses);
  const businesses = useMemo(() => (businessesData?.businesses ?? []).map((b) => ({ id: b.id, name: b.name })), [businessesData]);
  const canEditLayout = Boolean(shortcuts.onEditLayout);
  const localItems = useMemo(
    () => localPaletteItems({ businessId, departments, inboxItems: inboxQ.data?.items, live, canEditLayout, businesses, access, builder }),
    [businessId, departments, inboxQ.data?.items, live, canEditLayout, businesses, access, builder],
  );
  // The Help group: the defined terms in the business's own words, and the keyboard shortcuts (the shell opens them).
  const helpItems = useMemo(() => helpPaletteItems(businessId, business.glossary), [businessId, business.glossary]);
  // The definitions renamed by this business's glossary ("clients" in every term), computed here from what the shell
  // holds rather than by the account's host watching the query cache (perf audit item 3).
  const glossaryTerms = useMemo(() => termsFor(businessId, business.glossary ?? null), [businessId, business.glossary]);
  // A LIVE business also searches the public profiles ("On Foundmill"): founders and businesses found by name.
  const publicText = live && debounced ? publicSearchText(debounced.q) : null;
  const publicQ = useQuery(trpc.live.people.search.queryOptions({ q: publicText ?? "--", limit: 5 }, { enabled: publicText !== null, staleTime: 15_000, retry: false }));
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const text = parsed?.text ?? searchText;
    const local = filterLocal(localItems, text);
    const remote = debounced && searchQ.data ? entityPaletteItems(businessId, searchQ.data.hits) : [];
    const network = publicText !== null && publicQ.data ? publicPaletteItems(publicQ.data.hits) : [];
    return [...remote, ...network, ...local];
  }, [parsed, searchText, localItems, debounced, searchQ.data, businessId, publicText, publicQ.data]);
  const onQueryChange = useCallback((raw: string, q: SearchQuery) => {
    setSearchText(raw);
    setParsed(q);
  }, []);
  // Every open starts empty: the last query never lingers for new typing to append to (audit GTM-27).
  const setSearchOpen = useCallback((open: boolean) => {
    setSearchOpenState(open);
    if (!open) {
      setSearchText("");
      setParsed(null);
    }
  }, []);
  // The palette's Ask rows open a desk: its sheet's code is fetched as soon as the palette opens.
  useEffect(() => {
    if (searchOpen) prefetchAgentDesk();
  }, [searchOpen]);
  // Lead rows: "Ask <agent>" opens the agent's desk as a sheet (the typed words become the first message); "Generate…"
  // goes to a surface where a real model call drafts something.
  const deskApi = useRef<AgentDeskApi>(null);
  // Anthropomorphic agents: "Ask Bob" (and "ask bob why…" finds him) when the preference is on; the role stays on the row.
  const persona = useAgentPersona();
  const agents = useMemo(() => paletteAgents(departments).map((a) => ({ ...a, displayName: persona.nameFor(a) })), [departments, persona]);
  const askText = parsed?.text ?? searchText;
  const askItems = useMemo(() => askPaletteItems(agents, askText, (a) => <Avatar size={20} name={a.name} agent={{ seed: a.avatarSeed, dept: a.dept, personaKey: a.personaKey }} />), [agents, askText]);
  const generateItems = useMemo(() => generatePaletteItems(businessId, departments, builder), [businessId, departments, builder]);
  const onAsk = useCallback(
    (item: PaletteItem, text: string) => {
      const a = agentOfAskItem(item, agents);
      if (!a) return;
      setSearchOpen(false);
      deskApi.current?.open({ kind: "agent", id: a.id }, { persona: { name: a.name, role: a.role, avatarSeed: a.avatarSeed, personaKey: a.personaKey, dept: a.dept }, text: askQuestion(text, a) || null });
    },
    [agents, setSearchOpen],
  );
  const onSelect = useCallback(
    (item: PaletteItem) => {
      setSearchOpen(false);
      if (item.id === "command:refresh-inbox") return refreshInbox.mutate({ businessId });
      if (item.id === "command:edit-layout") return shortcuts.onEditLayout?.();
      // While the team is stopped the same place holds Resume agents, which says so.
      if (item.id === "command:stop-all") return document.querySelector<HTMLButtonElement>("[data-testid=stop-all-trigger], [data-testid=resume-agents-trigger]")?.click();
      if (item.id === "command:sign-out") return signOut();
      if (item.id.startsWith("business:")) rememberLastBusiness(item.id.slice("business:".length));
      if (item.href) router.push(item.href);
    },
    [router, refreshInbox, businessId, shortcuts, setSearchOpen],
  );

  // --- providers for the surfaces below ---------------------------------------------------------------------------
  // Module environment (docs/ARCHITECTURE.md §18): the collab server, the Supabase access token it authenticates (the
  // dev bearer when there is no Supabase session) and the host's collaborative SpecEditor. Without a collab URL the
  // editor keeps its edits local and saves whole blocks through `product.spec.editBlock`.
  const [collabToken, setCollabToken] = useState<string | undefined>(undefined);
  useEffect(() => {
    void getBrowserAccessToken().then((t) => setCollabToken(t ?? undefined));
  }, []);
  const moduleEnv = useMemo<Partial<ModuleEnv>>(() => ({ collabUrl: publicEnv().collabUrl, collabToken, SpecEditor, canWrite: access.canWrite, readOnly: access.canChange ? undefined : readOnlyReason(access) }), [collabToken, access]);
  const specUser = useMemo(() => ({ id: viewer.userId ?? "dev", name: specUserName(viewer) }), [viewer]);
  // Every mention resolves (lib/entity-resolver.tsx): agents (by agent id, or by their CRM record) open their profile,
  // records their CRM profile, with a full hover card and the right-click verbs (audit GTM-19, VFR3-X1, GTM-26).
  const agentSummaries = useMemo<AgentSummary[]>(
    () => departments.flatMap((d) => d.squad.map((a) => ({ id: a.id, name: a.name, role: a.role, status: a.status, modelKey: a.modelKey, avatarSeed: a.avatarSeed, personaKey: a.personaKey, layer: a.layer, departmentName: d.name, dept: d.colourToken }))),
    [departments],
  );
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const onMessageAgent = useCallback((a: AgentSummary) => deskApi.current?.open({ kind: "agent", id: a.id }, { persona: { name: a.name, role: a.role ?? "", avatarSeed: String(a.avatarSeed ?? a.id), personaKey: a.personaKey, dept: a.dept ?? "dept-1" }, text: null }), []);
  const entityLinks = useEntityResolver({ businessId, agents: agentSummaries, canReadCrm: access.canRead("crm"), navigate, onMessageAgent });
  // "Reconnecting…" / "Live updates paused" once the business's channel has been down a few seconds (audit RES-11).
  // Nothing is lost: the team's work and notes are on the server; only this screen may be behind.
  // With Builder view off a short reconnect shows nothing and a long outage (over 30 s) one quiet "Updates may be late".
  const connectionState = useConnectionNotice(businessId, builder ? CONNECTION_GRACE_MS : LATE_NOTICE_MS);
  const connection = useMemo(() => shellConnection(connectionState, builder), [connectionState, builder]);
  // Switch business: the pick is remembered at once and the other business opens in a transition, so this one stays
  // whole on screen until the new business's layout replaces it (the /b/[bid] segment remounts the shell; every query
  // is keyed by its business id).
  const [switching, startSwitching] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const openBusiness = useCallback(
    (id: string) => {
      rememberLastBusiness(id);
      setSwitchingTo(id);
      startSwitching(() => router.push(routes.today(id)));
    },
    [router],
  );
  const businessMenu = useMemo(
    () => ({
      businesses: switcherBusinesses(businessesData?.businesses, { id: businessId, name: business.name, kitPrimary: data.kit.primary, logoSrc, isDemo: business.isDemo, role: data.role, isExample: access.isExample }, businessLogos),
      loading: wantBusinesses && businessesLoading,
      error: businessesFailed ? "Could not load your other businesses." : null,
      onRetry: () => void refetchBusinesses(),
      onIntent: () => setWantBusinesses(true),
      onOpenBusiness: openBusiness,
      onNewBusiness: () => router.push(accountRoutes.newBusiness),
      onManageBusinesses: () => router.push(accountRoutes.businesses),
      onProfile: () => router.push(accountRoutes.profile),
      pendingBusinessId: switching ? switchingTo : null,
    }),
    [businessesData, businessesLoading, businessesFailed, refetchBusinesses, businessId, business.name, business.isDemo, data.kit.primary, data.role, access.isExample, logoSrc, businessLogos, wantBusinesses, openBusiness, router, switching, switchingTo],
  );

  const financeDept = useMemo(() => visibleDepartments.find((d) => d.moduleKeys.includes("finance")), [visibleDepartments]);
  const onRunwayClick = useCallback(() => {
    if (financeDept) {
      const tab = financeDept.tabs.slice().sort((a, b) => a.position - b.position)[0];
      router.push(routes.department(businessId, financeDept.slug, tab?.slug ?? "overview"));
    }
  }, [financeDept, router, businessId]);

  const stopAllError = stopAll.error ? errorMessage(stopAll.error) : undefined;
  // The Example frame (UX plan §12 item 5): the chip beside the name, Stop all agents hidden, the Start-your-own callout.
  const frame = exampleFrame(access, cycle);

  return (
    <GuidanceTermsProvider terms={glossaryTerms}>
    <BusinessProvider value={businessCtx}>
      <WidgetDataHost businessId={businessId} glossary={business.glossary ?? {}} gameMode={business.gameMode} currency={currency} timeZone={business.timeZone ?? null}>
        <ModuleEnvProvider value={moduleEnv}>
          <SpecUserProvider value={specUser}>
          <EntityLinkProvider value={entityLinks}>
            <ShellLinkProvider render={renderNextShellLink}>
              <AppShell
                mode={business.gameMode}
                businessMode={business.businessMode}
                // The mode chip says the setting in words with the business's own currency ("Asks before spending over £50").
                spendLineMinor={business.spendCapMinor}
                businessCurrency={currency}
                kit={data.kit}
                logoSrc={logoSrc}
                // The Example frame: the "Example" chip after the name, and "Start your own" in Continue's slot.
                businessBadge={frame.chip ? <ExampleBadge /> : undefined}
                continueSlot={frame.chip ? <StartYourOwnButton onStart={() => router.push(START_YOUR_OWN_HREF)} /> : undefined}
                businessName={business.name}
                screenTitle={chrome.title ?? "Home"}
                sidebar={{ items: sidebarItems, activeId, collapsed, onCollapsedChange, brand: SIDEBAR_BRAND }}
                onNavigate={onNavigate}
                nav={{ onBack: () => router.back(), onForward: () => router.forward() }}
                businessMenu={businessMenu}
                connection={connection}
                continueButton={{
                  state: continueState,
                  cycleNumber,
                  pulseKey,
                  // Pending, not disabled: Continue keeps keyboard focus while its own request is in flight.
                  pending: refreshInbox.isPending || endHoliday.isPending || continueCycle.isPending || pauseCycle.isPending,
                  // Viewers and advisors follow the business; they do not run cycles (audit RUI-05). In the Example
                  // frame "Start your own" takes the slot (`continueSlot`) and Continue's shortcut stays disabled.
                  disabled: !access.canChange,
                  onContinue,
                  onRespond,
                  onPause,
                  onGoToJourney,
                  onComeBack: () => endHoliday.mutate({ businessId, reason: "founder_returned" }),
                }}
                stopAll={{
                  canStop: access.isAdmin,
                  onConfirm: () => stopAll.mutateAsync({ businessId, reason: "kill_switch" }).then(() => undefined),
                  runningCount: cycle.activeAgentIds.length,
                  disabled: stopAll.isPending || resumeAll.isPending || frame.stopAllHidden,
                  stopped: stopped ? { ...stopped, onResume: () => resumeAll.mutateAsync({ businessId }).then(() => undefined) } : null,
                  // Hidden in the Example frame: nothing there is the viewer's to stop (the trigger keeps its slot's width rule: it is gone, not blank).
                  className: frame.stopAllHidden ? "hidden" : undefined,
                }}
                processing={{ segments, active: cycle.running, cycleNumber }}
                tabs={chrome.tabs}
                breadcrumbs={chrome.breadcrumbs}
                // "Ask <Chief of Staff>" beside "Explain this page" on every page (nothing without a Chief of Staff).
                pageActions={<AskChief desk={deskApi} />}
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
                  ask: askItems,
                  generate: generateItems,
                  onAsk,
                  helpItems,
                  placeholder: "Search, ask an agent or generate…",
                }}
                // The business's day, known only in the browser (null on the server, so hydration never disagrees).
                date={today}
                // A balance below zero shows its words, never a negative figure (runway.ts).
                runwayMonths={runwayFigure(financeQ.data)}
                // Without a figure the chip says what Home's tiles say ("Not running out", "Not known yet", "Cash is below
                // zero") with the reason.
                runwayWords={runwayWords(financeQ.data)}
                // A cash figure only when a bank account backs it (no account reads "Not known yet", never "Cash £0").
                cash={financeQ.data && financeQ.data.cash.accounts > 0 ? { amountMinor: financeQ.data.cash.amountMinor, currency: financeQ.data.cash.currency } : undefined}
                runwayEstimate
                onRunwayClick={financeDept ? onRunwayClick : undefined}
                onModeClick={() => router.push(routes.settings(businessId, "mode"))}
                keyboard={{
                  onRefreshInbox: shortcuts.onRefreshInbox ?? (access.canChange ? () => refreshInbox.mutate({ businessId }) : undefined),
                  onNextInboxItem: shortcuts.onNextInboxItem,
                  onPrevInboxItem: shortcuts.onPrevInboxItem,
                  onChooseOption: shortcuts.onChooseOption,
                  onEditLayout: shortcuts.onEditLayout,
                  onEscape: shortcuts.onEscape,
                }}
                data-business-id={businessId}
              >
                {stopAllError ? <p className="sr-only" role="alert">{stopAllError}</p> : null}
                {/* The first-Continue callout, anchored to the top bar's button (ContinueButton marks it data-coachmark="continue"); in the Example frame the Start-your-own one, anchored to its button (data-coachmark="start-your-own"). */}
                {frame.callout ? <Callout tourId={frame.callout.tourId} targetId={frame.callout.targetId} title={frame.callout.title} body={frame.callout.body} side="bottom" /> : null}
                <AgentDeskHost apiRef={deskApi}>{children}</AgentDeskHost>
              </AppShell>
            </ShellLinkProvider>
          </EntityLinkProvider>
          </SpecUserProvider>
        </ModuleEnvProvider>
      </WidgetDataHost>
    </BusinessProvider>
    </GuidanceTermsProvider>
  );
}
