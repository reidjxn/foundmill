"use client";
/**
 * Status strip widget (BUILD §11.2, DESIGN §9): five tiles under the Ribbon — cash, runway, revenue, customers this
 * week and team health. Display-lg figures with captions in plain words (UX plan B9,
 * B10: "Months of cash left at today's spending", "4 of 4 agents healthy"); the formula behind a figure lives in its
 * provenance tooltip ("Cash ÷ net burn"), never in the caption. Every non-measured number carries Estimate.
 */
import { useMemo } from "react";
import { z } from "zod";
import { Gauge } from "lucide-react";
import { StatusStrip, Term, type MetricTileProps } from "@foundmill/dugout";
import { useBusinessEvents, useGlossary, useToday, useWidgetData, useWidgetQuery } from "../data";
import { NOT_KNOWN_YET, monthRevenueMinor, revenueThisMonthMinor } from "../shared/cash";
import { registerWidget } from "../registry";
import { moduleHref, orderedDepartments, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { isBackgroundAgent } from "@foundmill/shared";
import { TEAM_HEALTH_SOURCE, teamHealth, teamHealthCounts, type TeamHealthCounts } from "../shared/health";
import { useRecentRibbon } from "../shared/ribbon";
import { routes } from "../shared/routes";
import { customersThisWeek } from "../shared/customers";

export { customersThisWeek };
import { addDays, monthKey } from "../shared/time";
import type { DepartmentRow, FinanceOverview, Page, RibbonResponse, TaskRow } from "../shared/types";

/**
 * The strip has no settings. A layout saved while it had one (`showLeague`, the leaderboard tile removed on
 * 2026-11-11) still parses: unknown keys are dropped, never refused.
 */
export const StatusStripSettings = z.object({});
export type StatusStripSettings = z.infer<typeof StatusStripSettings>;

export interface StatusStripInputs {
  finance?: FinanceOverview;
  ribbon?: RibbonResponse;
  departments?: DepartmentRow[];
  /** The team's open and recently ended tasks: the Team health tile reads work shipped and blocked, not only agent statuses. */
  tasks?: { blocked: number; doneLast7Days: number };
  today: string;
  currency: string;
  loading: { finance: boolean; ribbon: boolean; departments: boolean };
  /** Queries that failed with nothing cached: their tiles say "No access" or "Couldn't load", never a zero or setup advice. */
  errors?: { finance?: Error | null; ribbon?: Error | null; departments?: Error | null };
  open: (where: "finance" | "customers" | "team") => void;
}

/**
 * Team health across every department (0–1), null without a team: the shared definition (shared/health.ts), the same
 * figure the Team department card shows, counting each agent once even when it sits in several departments.
 */
export function squadHealth(departments: readonly DepartmentRow[] | undefined): number | null {
  return teamHealth(agentStatuses(departments));
}

/**
 * Each agent's status once, even when it sits in several departments. Background helpers are not counted: a down
 * helper never moves the founder's Team health (Leads first, 2026-11-08).
 */
function agentStatuses(departments: readonly DepartmentRow[] | undefined): string[] {
  const seen = new Map<string, string>();
  for (const d of departments ?? []) for (const a of d.squad) if (!isBackgroundAgent(a)) seen.set(a.id, a.status);
  return [...seen.values()];
}

/** The team's counts behind the Team health tile (the same definition as `squadHealth`), each agent counted once. */
export function squadHealthCounts(departments: readonly DepartmentRow[] | undefined): TeamHealthCounts {
  return teamHealthCounts(agentStatuses(departments));
}

/** "4 of 4 agents healthy" (UX plan B10): the Team health caption, the words the Team department card uses too. */
export function teamHealthCaption(c: TeamHealthCounts): string {
  if (c.total === 0) return "No agents hired yet";
  return `${c.total - c.needsYou} of ${c.total} ${c.total === 1 ? "agent" : "agents"} healthy`;
}

/** Blocked tasks from which the team reads as stalled when nothing finished this week (the department cards' rule). */
export const STRIP_STALLED_BLOCKED_TASKS = 5;
export const TEAM_WORK_SOURCE = "Tasks finished in the last 7 days and tasks blocked now";

/** Nothing shipped this week and many tasks blocked: "100% healthy" would be false whatever the agents' statuses say. */
export function teamStalled(tasks: { blocked: number; doneLast7Days: number } | undefined): boolean {
  return tasks !== undefined && tasks.blocked >= STRIP_STALLED_BLOCKED_TASKS && tasks.doneLast7Days === 0;
}

/** "3 finished this week · 9 blocked": the work behind the health figure. */
export function teamWorkCaption(tasks: { blocked: number; doneLast7Days: number }): string {
  return `${tasks.doneLast7Days} finished this week · ${tasks.blocked} blocked`;
}
// The tiles Today reads too live in shared/today-tiles.ts, so Today imports them without registering every widget.
import { PLAIN_LINES, RUNWAY_CAPTION, cashTile, customersWeekTile, runwayTile, unavailableTile, type StatusTile } from "../shared/today-tiles";
export { PLAIN_LINES, RUNWAY_CAPTION, cashTile, customersWeekTile, runwayTile, unavailableTile, type StatusTile };

export function statusTiles(i: StatusStripInputs): StatusTile[] {
  const financeError = !i.finance ? (i.errors?.finance ?? null) : null;
  const ribbonError = !i.ribbon ? (i.errors?.ribbon ?? null) : null;
  const departmentsError = !i.departments ? (i.errors?.departments ?? null) : null;
  const openFinance = () => i.open("finance");
  const month = monthKey(i.today);
  const revenueMonth = revenueThisMonthMinor(i.finance, month);
  const revenueSeries = (i.finance?.revenue.monthly ?? []).slice(-6).map(monthRevenueMinor);
  const healthCounts = squadHealthCounts(i.departments);
  const health = squadHealth(i.departments);
  const currency = i.finance?.cash.currency ?? i.currency;
  const openCustomers = () => i.open("customers");
  // Captions in words (UX plan B9); the formula and the accounting basis stay in each tile's provenance tooltip. The
  // plain-words line under each figure (`metricId` / `plain`) shows while guidance is on; the labels that are defined
  // terms carry `termId` (the widget wraps them in a `Term`).
  const tiles: StatusTile[] = [
    financeError ? unavailableTile("Cash", financeError, "Finance", openFinance) : cashTile(i.finance, i.loading.finance, i.currency, openFinance),
    financeError ? unavailableTile("Runway", financeError, "Finance", openFinance, "runway") : runwayTile(i.finance, i.loading.finance, openFinance),
    financeError
      ? unavailableTile("Revenue this month", financeError, "Finance", openFinance, "revenue")
      : { label: "Revenue this month", termId: "revenue", plain: PLAIN_LINES.revenue, value: revenueMonth === null ? (i.loading.finance ? null : NOT_KNOWN_YET.value) : { amountMinor: revenueMonth, currency }, spark: revenueSeries, loading: i.loading.finance, caption: revenueMonth === null && !i.loading.finance ? NOT_KNOWN_YET.caption : "Money in this month", provenance: { source: "Bank inflows, counted when the cash arrives; financing and transfers excluded", note: i.finance?.revenue.label }, onClick: openFinance },
    ribbonError ? unavailableTile("Customers this week", ribbonError, "The Journey", openCustomers) : customersWeekTile(i.ribbon, i.loading.ribbon, i.today, openCustomers),
    departmentsError
      ? unavailableTile("Team health", departmentsError, "The team", () => i.open("team"))
      : teamStalled(i.tasks)
        ? { label: "Team health", metricId: "team_health", value: "Stalled", loading: false, caption: teamWorkCaption(i.tasks!), provenance: { source: TEAM_WORK_SOURCE }, onClick: () => i.open("team") }
        : { label: "Team health", metricId: "team_health", value: health === null ? (i.loading.departments ? null : "No team yet") : health, format: health === null ? undefined : "percent", loading: i.loading.departments, caption: i.departments ? (i.tasks && i.tasks.blocked > 0 ? `${teamHealthCaption(healthCounts)} · ${teamWorkCaption(i.tasks)}` : teamHealthCaption(healthCounts)) : undefined, provenance: { source: i.tasks ? `${TEAM_HEALTH_SOURCE}; ${TEAM_WORK_SOURCE}` : TEAM_HEALTH_SOURCE }, onClick: () => i.open("team") },
  ];
  return tiles;
}

function StatusStripWidget() {
  const { businessId, navigate, currency } = useWidgetData();
  const today = useToday();
  const finance = useWidgetQuery<FinanceOverview>("finance.overview", {});
  // The recent ribbon Home shares with the department cards (the strip reads its last 14 days).
  const ribbon = useRecentRibbon();
  const departments = useDepartments();
  // The work behind the health figure: blocked tasks now, and tasks finished in the last 7 days (the same page the department cards read).
  const blockedTasks = useWidgetQuery<Page<TaskRow>>("dev.tasks.list", { status: ["blocked"], limit: 100 });
  const endedTasks = useWidgetQuery<Page<TaskRow>>("dev.tasks.list", { status: ["done", "failed"], limit: 100 });
  useBusinessEvents(() => {
    finance.refetch();
    ribbon.refetch();
  }, ["payment.received", "bank.balance_updated", "runway.threshold_crossed", "cycle.completed"]);
  useBusinessEvents(() => departments.refetch(), ["agent.health_changed"]);

  const tiles = useMemo(
    () =>
      statusTiles({
        finance: finance.data,
        ribbon: ribbon.data,
        departments: departments.data ? orderedDepartments(departments.data) : undefined,
        tasks: blockedTasks.data && endedTasks.data ? { blocked: blockedTasks.data.items.length, doneLast7Days: endedTasks.data.items.filter((t) => t.status === "done" && (t.endedAt ? Date.parse(t.endedAt) : 0) >= Date.parse(`${addDays(today, -6)}T00:00:00.000Z`)).length } : undefined,
        today,
        currency,
        loading: { finance: finance.isLoading, ribbon: ribbon.isLoading, departments: departments.isLoading },
        errors: { finance: finance.error, ribbon: ribbon.error, departments: departments.error },
        open: (where) => {
          if (where === "finance") navigate(moduleHref(businessId, departments.data, "finance") ?? routes.settings(businessId, "integrations"));
          else if (where === "team") navigate(moduleHref(businessId, departments.data, "team") ?? routes.home(businessId));
          else navigate(routes.crm(businessId));
        },
      }),
    [finance.data, finance.isLoading, finance.error, ribbon.data, ribbon.isLoading, ribbon.error, departments.data, departments.isLoading, departments.error, blockedTasks.data, endedTasks.data, today, currency, navigate, businessId],
  );
  // Tile labels, captions and plain lines in the business's words ("Customers this week" → "Clients this week"); a label
  // that is a defined term becomes a `Term` (lifted above the tile's covering button) with the map's definition.
  const g = useGlossary();
  const glossed = useMemo<MetricTileProps[]>(
    () =>
      tiles.map(({ termId, ...t }) => {
        const label = typeof t.label === "string" ? g(t.label) : t.label;
        return {
          ...t,
          label: termId ? (
            <Term id={termId} className="relative z-10">
              {label}
            </Term>
          ) : (
            label
          ),
          caption: typeof t.caption === "string" ? g(t.caption) : t.caption,
          plain: typeof t.plain === "string" ? g(t.plain) : t.plain,
        };
      }),
    [tiles, g],
  );
  const failed = finance.error && ribbon.error && departments.error;
  return (
    <WidgetFrame title="Status" data-widget="status_strip" data-coachmark="status-strip" error={failed ? (finance.error ?? undefined) : undefined} onRetry={failed ? () => [finance, ribbon, departments].forEach((q) => q.refetch()) : undefined} flush empty={null}>
      <StatusStrip tiles={glossed} className="rounded-none border-0" aria-label="Business status" />
      {/* Setup advice only when finance answered and there is no bank or revenue yet, never because the query failed. */}
      {finance.data && finance.data.cash.accounts === 0 && finance.data.revenue.monthly.length === 0 ? (
        <p className="flex items-center gap-2 px-panel-pad py-2 text-small text-secondary">
          <Gauge size={14} aria-hidden /> Finance figures appear once a bank or Stripe is connected.
        </p>
      ) : null}
    </WidgetFrame>
  );
}

export const statusStripWidget = registerWidget<StatusStripSettings>({
  key: "status_strip",
  title: "Status strip",
  description: "Cash, runway, revenue, customers this week and team health.",
  icon: "gauge",
  surfaces: ["home", "department"],
  defaultSize: { w: 12, h: 6, minW: 6, minH: 5, maxH: 8 },
  settingsSchema: StatusStripSettings,
  defaultSettings: StatusStripSettings.parse({}),
  single: true,
  Component: StatusStripWidget,
});
