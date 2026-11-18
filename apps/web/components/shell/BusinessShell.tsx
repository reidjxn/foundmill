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
 * - NeedsLargerWindow below 1280 (AppShell measures the window itself), except Today and Needs you, which get the shell's phone layout (`phone`); G-then-letter chords (AppShell);
 * - providers for everything below: business context, WidgetDataProvider, ModuleEnv, EntityLink, keyboard registry,
 *   screen chrome, and the definitions in this business's own words (`GuidanceTermsProvider` over the layout's
 *   GuidanceHost: the glossary comes from `business.get`, which the shell already holds).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition, type ReactNode } from "react";
import { AppShell, Avatar, useAgentPersona, useBuilderView, Button, Callout, EntityLinkProvider, GuidanceTermsProvider, ShellLinkProvider, useToast, type PaletteItem, type ProcessingSegment, type SearchQuery, type SidebarItem } from "@foundmill/dugout";
import { ModuleEnvProvider, type ModuleEnv } from "@foundmill/modules/env";
import { readWidgetEvent, type WidgetEvent } from "@foundmill/widgets/data";
import { routes } from "@foundmill/widgets/shared/routes";
import { runwayFigure, runwayWords } from "@foundmill/widgets/shared/runway";
import { agentsStoppedView } from "@/lib/agents-stopped";
import { formatMoney as formatCredits } from "@/lib/format";
import { SIDEBAR_COLLAPSED_PREFIX } from "@/lib/auth/constants";
import { rememberLastBusiness } from "@/lib/auth/last-business";
import { usePresencePing } from "@/lib/presence";
import { showWinNotice, winNoticeFor } from "@/lib/browser-notifications";
import { accountRoutes } from "@/lib/account-routes";
import { readOnlyReason, sampleMarker, type Access, type SampleMarker } from "@/lib/access";
import { CONTINUE_RUN_END_REASONS, RUN_UNTIL_DONE, continueRunEndedMessage, type ContinueRunEndReason } from "@foundmill/shared";
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
import { appErrorCode, errorMessage, trpcErrorCode, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { WidgetDataHost } from "@/lib/widget-data";
import { SpecUserProvider, specUserName } from "@/components/spec/spec-user";
import { AgentDeskHost, prefetchAgentDesk, type AgentDeskApi } from "@/components/conversation/DeskHost";
import { useNetworkBadge } from "@/components/live/signals";
import { termsFor } from "@/components/providers/GuidanceHost";
import { useKeyboardShortcutsOn } from "@/components/providers/guidance-context";
import { isTodayPath, worksOnSmallScreens } from "@/components/providers/DesktopOnly";
import { agentOfAskItem, agentOfCallItem, askPaletteItems, askQuestion, callPaletteItems, generatePaletteItems, paletteAgents } from "@/components/conversation/palette";
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
  // A public page published or taken down from another tab or by another owner (0077): the tab and Today's line follow.
  "page.published": ["page", "today"],
  "page.unpublished": ["page", "today"],
  // Someone followed the page (0079): its count and the contact lists follow; Today does not change.
  "page.followed": ["page", "crm"],
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
  // A team call started (here or in another tab) or ended: the lobby's list follows; an ended call has filed its actions,
  // so the Inbox note, the plans, the tasks, the roadmap and Today follow too (docs/TEAM_CALL.md §5).
  "team_call.started": ["teamCall"],
  "team_call.ended": ["teamCall", "inbox", "plan", "dev", "product", "today"],
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
export function shellConnection(state: "reconnecting" | "paused" | "off" | null, builder: boolean): { state: "reconnecting" | "paused" | "late" | "off"; detail: string } | null {
  if (!state) return null;
  // Never live since the page opened (first-time founder report, Nov 8, 2026): "off" is the truth for everyone, Builder
  // view or not; "Updates may be late" would promise a connection this server does not have.
  if (state === "off") return { state, detail: "This server has no live connection right now. Nothing is lost: the Inbox and Continue refresh every 30 s." };
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

export { RUN_UNTIL_DONE };

/** What the strip says the instant Continue is pressed, before the answer lands (first-time founder report, Nov 8, 2026). */
export const CONTINUE_PRESSED_NOTICE = "Starting the next round of work…";
/** The same with Builder view off, in the founder's words ("round of work", as the live feed and the team's notes say). */
export const CONTINUE_PRESSED_NOTICE_PLAIN = "Starting the next round of work…";
export const continuePressedNotice = (builder: boolean): string => (builder ? CONTINUE_PRESSED_NOTICE : CONTINUE_PRESSED_NOTICE_PLAIN);
/** How long the answer to a press stays as the strip's sentence when no cycle event replaces it sooner. */
export const CONTINUE_NOTICE_MS = 15_000;
/**
 * Continue's refusal while paid entry's plan is missing (api `entry_plan_required`), as the request the founder sees:
 * what is bought, its price and the one press. Null for any other error.
 */
export function entryPlanRequestOf(err: unknown): { title: string; description: string; action: string } | null {
  if (appErrorCode(err) !== "entry_plan_required") return null;
  const request = (err as { data?: { details?: { request?: { name?: string; priceMonthlyMinor?: number; includedCreditsMinor?: number } } } }).data?.details?.request;
  const price = formatCredits({ amountMinor: request?.priceMonthlyMinor ?? 0, currency: "USD" });
  const included = formatCredits({ amountMinor: request?.includedCreditsMinor ?? 0, currency: "USD" });
  return {
    title: "Your team is ready to start",
    description: `Subscribe to the ${request?.name ?? "entry"} plan for ${price} a month, with ${included} of AI included, and the team starts as soon as the payment is confirmed.`,
    action: `Subscribe · ${price}/month`,
  };
}

/** Under Continue's tooltip while the orchestrator cannot be reached: what a press does and does not do. */
export const ORCHESTRATOR_DOWN_CAVEAT = "The team cannot start right now. Pressing Continue will only write a short note.";

/**
 * The toast one press of Continue earns (BUILD §9.4): the api's own sentence about what happened (`summary`, first-time
 * founder report, Nov 8, 2026): the cycle and what is ready to build, nothing ready and why, the orchestrator not
 * reachable (a warning; the note that stood in opens from the toast), resumed, already running.
 */
export function describeContinue(result: ContinueResult, builder = false): { title: string; description: string; tone: "info" | "good" | "warn"; itemId: string | null } {
  const s = result.summary;
  // Cycle numbers are Builder view's (docs/DESIGN.md): everyone else reads the plain line.
  const title = builder ? s.headline : s.plainHeadline;
  const itemId = result.mode === "local" && result.item ? result.item.id : null;
  if (s.kind === "orchestrator_unreachable") return { title, description: s.detail, tone: "warn", itemId };
  if (s.kind === "resumed") return { title, description: s.detail, tone: "good", itemId: null };
  return { title, description: s.detail, tone: "info", itemId };
}

/**
 * "Last cycle cost $0.52 · Estimate" under Continue's tooltip (first-time founder report, Nov 8, 2026: a founder had
 * no way to see what a cycle costs before pressing). Credits are counted in their own currency; a cycle that cost
 * nothing still says so. Null before the first finished cycle.
 */
export function lastCycleCostLine(cost: { amountMinor: number; currency: string } | null): string | null {
  if (!cost) return null;
  return `The last round of work cost ${formatCredits(cost)} · Estimate`;
}

/**
 * Whether the shell says the orchestrator is down: only a known "not reachable" (`business.get` `orchestrator.reachable`
 * false); unknown reads as fine, so a page never opens with a warning it cannot back.
 */
export function orchestratorDown(business: { orchestrator?: { reachable: boolean | null } | null } | null | undefined): boolean {
  return business?.orchestrator?.reachable === false;
}

type PauseResult = RouterOutputs["business"]["pauseCycle"];

/** The toast a press of Pause earns: the round paused, the run ended (so no new cycle starts), or nothing to pause. */
export function describePause(result: Pick<PauseResult, "paused" | "pausedTasks" | "reason"> & { runEnded?: boolean }): { title: string; description: string; tone: "info" | "warn" } {
  if (result.paused) return { title: "Paused", description: `${result.pausedTasks} running task${result.pausedTasks === 1 ? "" : "s"} paused. Press Continue to pick up where the team stopped.`, tone: "warn" };
  if (result.runEnded) return { title: "Paused", description: "No new round of work starts. Press Continue to pick up where the team stopped.", tone: "warn" };
  return { title: "Nothing to pause", description: result.reason ?? "The team is not working right now.", tone: "info" };
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

export const FIRST_CONTINUE_CALLOUT = { tourId: "first-continue", targetId: "continue", title: "This is how you move forward", body: "One press and your team works until nothing is left to do. Anything that needs you shows in Needs you." } as const;

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
  /** The example viewer's frame is on: the "Sample business" marker says nothing is saved (`sampleMarker`). */
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
 * The sample marker under the business name (KitBar `businessBadge`, `lib/access.ts sampleMarker`): a quiet "Sample
 * business" caption on a seeded demo business, whoever opens it. Its line (the figures are made up, and for an example
 * viewer that nothing is saved) is the second line of the switcher's own tooltip (`businessBadgeLine`), so the trigger
 * has one tooltip that still says "Switch business". Under the name, it takes no width from the top bar: the name never
 * clips and the search keeps its room at 1280 and 1440 px. Never on a founder's own business.
 */
function SampleBadge({ marker, example }: { marker: SampleMarker; example: boolean }) {
  return (
    <span className="t-small truncate text-kit-on-primary opacity-80" data-testid="sample-chip" data-example={example ? "true" : undefined}>
      {marker.label}
    </span>
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
  // Single keys only once the person turned them on in Settings › Preferences (WP-04 T13): a stray key does nothing.
  const singleKeys = useKeyboardShortcutsOn();

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

  // The answer to a press of Continue, as the strip's sentence (first-time founder report, Nov 8, 2026): "Starting the
  // next cycle…" the instant Continue is pressed, then the api's one sentence about what happened, until the
  // orchestrator's own `cycle.started` catches the strip up or the notice times out. Never "No cycle running" unchanged
  // after a press.
  const [continueNotice, setContinueNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const announce = useCallback((text: string | null, forMs: number | null) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setContinueNotice(text);
    if (text && forMs !== null) noticeTimer.current = window.setTimeout(() => setContinueNotice(null), forMs);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

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

  // Opt-in browser notifications for wins (Settings › Preferences › Email; retention plan, 2026-11-11).
  const notifyPrefs = useQuery(trpc.founder.email.get.queryOptions(undefined, { staleTime: 5 * 60_000 }));
  const browserNotices = notifyPrefs.data?.browserNotifications === true;

  useStreamSubscription(`ev:${businessId}`, (raw) => {
    const event: WidgetEvent | null = readWidgetEvent(raw);
    if (!event) return;
    if (browserNotices) {
      const notice = winNoticeFor(event, { id: businessId, name: business.name });
      if (notice) showWinNotice(notice, (href) => router.push(href));
    }
    if ((CYCLE_EVENT_TYPES as readonly string[]).includes(event.type)) dispatch({ type: "event", event, agentDepartment });
    // The orchestrator's own mark catches the strip up: its sentence takes over from the press's answer.
    if (event.type === "cycle.started") announce(null, null);
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

  // --- presence: the founder is here (sessions, "Since you were last here", returns from notifications) ------------
  usePresencePing(businessId);

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
        toast({ title: "Agents resumed", description: `${result.resumedAgents} agent${result.resumedAgents === 1 ? " is" : "s are"} back. The next round of work picks up the paused tasks.`, tone: "good" });
      },
    }),
  );
  const stopped = useMemo(() => agentsStoppedView(business, data.role), [business, data.role]);

  // One press of Continue → `business.continue` (BUILD §9.4): starts the next businessCycle on Temporal, resumes a
  // paused one, or runs one in-process cycle step (one new note) when no worker answers. The result carries the new
  // cycle status, adopted at once; the stream keeps it current afterwards.
  const continueCycle = useMutation(
    trpc.business.continue.mutationOptions({
      onMutate: () => announce(continuePressedNotice(builder), null),
      onSuccess: (result) => {
        dispatch({ type: "snapshot", status: cycleFromSnapshot(result.status) });
        void invalidate(["cycle", "inbox", "dev"]);
        const t = describeContinue(result, builder);
        announce(t.title, CONTINUE_NOTICE_MS);
        toast({ title: t.title, description: t.description, tone: t.tone, action: t.itemId ? { label: "Open", onClick: () => router.push(routes.inbox(businessId, t.itemId!)) } : undefined });
      },
      onError: (err) => {
        const code = trpcErrorCode(err);
        void invalidate(["cycle", "inbox", "business"]);
        // Paid entry (WP-09 T16): the refusal is the request, with its one press to Stripe; once the payment is
        // confirmed the team starts by itself (the pay-and-resume loop), so there is nothing to press afterwards.
        const request = entryPlanRequestOf(err);
        if (request) {
          announce(request.title, CONTINUE_NOTICE_MS);
          toast({ title: request.title, description: request.description, tone: "info", action: { label: request.action, onClick: () => subscribe.mutate({ businessId, resume: "continue" }) } });
          return;
        }
        const title = code === "CONFLICT" ? "Continue is waiting on you" : "Continue failed";
        announce(`${title}: ${errorMessage(err)}`, CONTINUE_NOTICE_MS);
        toast({ title, description: errorMessage(err), tone: code === "CONFLICT" ? "warn" : "bad" });
      },
    }),
  );
  const subscribe = useMutation(
    trpc.billing.subscribe.mutationOptions({
      // Stripe's own page; in mock mode the simulated checkout on the Billing tab.
      onSuccess: (r) => (r.mode === "live" ? window.location.assign(r.checkoutUrl) : router.push(`${routes.settings(businessId, "billing")}?checkout=${r.checkout.id}`)),
      onError: (err) => toast({ title: "Checkout not opened", description: errorMessage(err), tone: "bad" }),
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
  // "Call <agent>" (docs/TEAM_CALL.md §6): one-to-one calls, offered once the query names an agent or says "call", to whoever may write the Team section.
  const callItems = useMemo(() => (access.canWrite("team") ? callPaletteItems(agents, askText, (a) => <Avatar size={20} name={a.name} agent={{ seed: a.avatarSeed, dept: a.dept, personaKey: a.personaKey }} />) : []), [agents, askText, access]);
  const startCall = useMutation(
    trpc.teamCall.start.mutationOptions({
      onSuccess: (call) => {
        queryClient.setQueryData(trpc.teamCall.get.queryKey({ businessId, callId: call.id }), call);
        router.push(routes.call(businessId, call.id));
      },
      onError: (err) => toast({ title: "The call did not start", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const allPaletteItems = useMemo(() => [...paletteItems, ...callItems], [paletteItems, callItems]);
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
      const callee = agentOfCallItem(item, agents);
      if (callee) return startCall.mutate({ businessId, kind: "one_to_one", agentIds: [callee.id] });
      if (item.id === "command:edit-layout") return shortcuts.onEditLayout?.();
      // While the team is stopped the same place holds Resume agents, which says so.
      if (item.id === "command:stop-all") return document.querySelector<HTMLButtonElement>("[data-testid=stop-all-trigger], [data-testid=resume-agents-trigger]")?.click();
      if (item.id === "command:sign-out") return signOut();
      if (item.id.startsWith("business:")) rememberLastBusiness(item.id.slice("business:".length));
      if (item.href) router.push(item.href);
    },
    [router, refreshInbox, startCall, agents, businessId, shortcuts, setSearchOpen],
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
      onPublicProfile: () => router.push(accountRoutes.publicProfile),
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
  const sample = sampleMarker(business, access);

  return (
    <GuidanceTermsProvider terms={glossaryTerms}>
    <BusinessProvider value={businessCtx}>
      <WidgetDataHost businessId={businessId} glossary={business.glossary ?? {}} gameMode={business.gameMode} currency={currency} timeZone={business.timeZone ?? null}>
        <ModuleEnvProvider value={moduleEnv}>
          <SpecUserProvider value={specUser}>
          <EntityLinkProvider value={entityLinks}>
            <ShellLinkProvider render={renderNextShellLink}>
              <AppShell
                // Today and Needs you work from 390 px (package 2.1): the shell's phone layout; other routes keep the 1280 px floor.
                phone={worksOnSmallScreens(pathname)}
                // "Explain this page" in the phone title row on Today only (WP-04 T7).
                phoneExplain={isTodayPath(pathname)}
                mode={business.gameMode}
                businessMode={business.businessMode}
                // The mode chip says the setting in words with the business's own currency ("Asks before spending over £50").
                spendLineMinor={business.spendCapMinor}
                businessCurrency={currency}
                kit={data.kit}
                logoSrc={logoSrc}
                // The sample marker after the name (every demo business), and the Example frame's "Start your own" in Continue's slot.
                businessBadge={sample ? <SampleBadge marker={sample} example={frame.chip} /> : undefined}
                businessBadgeLine={sample?.tooltip}
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
                  // Before the press: what it can and cannot do while the orchestrator is down (never a surprise after).
                  caveat: orchestratorDown(data) && continueState.kind === "idle" ? ORCHESTRATOR_DOWN_CAVEAT : null,
                  // What the last cycle cost, so a press has a price (an Estimate: the next cycle's work is its own).
                  hint: lastCycleCostLine(cycleQ.data?.lastCost ?? null),
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
                processing={{ segments, active: cycle.running, cycleNumber, notice: continueNotice }}
                tabs={chrome.tabs}
                breadcrumbs={chrome.breadcrumbs}
                // "Ask <Chief of Staff>" beside "Explain this page" on every page (nothing without a Chief of Staff).
                pageActions={<AskChief desk={deskApi} />}
                rightRail={chrome.rightRail}
                search={{
                  items: allPaletteItems,
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
                  singleKeys,
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
