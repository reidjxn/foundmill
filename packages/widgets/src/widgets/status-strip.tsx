"use client";
/**
 * Status strip widget (BUILD §11.2, DESIGN §9): six tiles under the Ribbon — cash, runway, revenue, customers this
 * week, team health and leaderboard position when LIVE. Display-lg figures with captions in plain words (UX plan B9,
 * B10: "Months of cash left at today's spending", "4 of 4 agents healthy"); the formula behind a figure lives in its
 * provenance tooltip ("Cash ÷ net burn"), never in the caption. Every non-measured number carries Estimate.
 */
import { useMemo } from "react";
import { z } from "zod";
import { Gauge } from "lucide-react";
import { StatusStrip, Term, formatNumber, type MetricTileProps } from "@foundmill/dugout";
import { useBusinessEvents, useGlossary, useToday, useWidgetData, useWidgetQuery } from "../data";
import { NOT_KNOWN_YET, monthRevenueMinor, revenueThisMonthMinor } from "../shared/cash";
import { RUNWAY_WORDS, runwayWords } from "../shared/runway";
import { registerWidget, type WidgetProps } from "../registry";
import { moduleHref, orderedDepartments, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { unavailableWords } from "../shared/errors";
import { isBackgroundAgent } from "@foundmill/shared";
import { TEAM_HEALTH_SOURCE, teamHealth, teamHealthCounts, type TeamHealthCounts } from "../shared/health";
import { useRecentRibbon } from "../shared/ribbon";
import { routes } from "../shared/routes";
import { customersThisWeek } from "../shared/customers";

export { customersThisWeek };
import { addDays, monthKey } from "../shared/time";
import type { DepartmentRow, FinanceOverview, LeaderboardPositionRow, Page, RibbonResponse, TaskRow } from "../shared/types";

export const StatusStripSettings = z.object({
  /** Show the leaderboard tile in LIVE mode. */
  showLeague: z.boolean().default(true),
});
export type StatusStripSettings = z.infer<typeof StatusStripSettings>;

export interface StatusStripInputs {
  finance?: FinanceOverview;
  ribbon?: RibbonResponse;
  departments?: DepartmentRow[];
  /** The team's open and recently ended tasks: the Team health tile reads work shipped and blocked, not only agent statuses. */
  tasks?: { blocked: number; doneLast7Days: number };
  positions?: LeaderboardPositionRow[];
  live: boolean;
  today: string;
  currency: string;
  loading: { finance: boolean; ribbon: boolean; departments: boolean; positions: boolean };
  /** Queries that failed with nothing cached: their tiles say "No access" or "Couldn't load", never a zero or setup advice. */
  errors?: { finance?: Error | null; ribbon?: Error | null; departments?: Error | null };
  open: (where: "finance" | "customers" | "team" | "league", id?: string) => void;
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

/** The runway caption in words (UX plan B9); the formula stays in the provenance tooltip. */
export const RUNWAY_CAPTION = "Months of cash left at today's spending";

/**
 * A tile of the strip: a MetricTile, plus the id of the definition its label is wrapped in (`Term`, UX plan §7.8:
 * "Runway", "Revenue this month"). The plain-words line under the figure (`PlainFigure`) comes from `metricId` (the
 * definitions map) or `plain` (tiles without a term); guidance off shows the figure alone.
 */
export type StatusTile = MetricTileProps & { termId?: string };

/** The plain-words line under the tiles that have no definition of their own (UX plan §7.8). */
export const PLAIN_LINES = {
  cash: "What is in the bank right now.",
  revenue: "What customers paid you this month.",
  customers: "People who paid you for the first time in the last 7 days.",
} as const;

/**
 * The runway tile. With a burn model it is the figure in months with its Estimate chip and a caption in words ("Months
 * of cash left at today's spending", or the warning when it is short); without one it says why in the shared runway
 * words (shared/runway.ts: "Not running out" when cash-flow positive, "Not known yet" otherwise) with the reason underneath,
 * and no Estimate chip: nothing has been estimated yet. The formula ("Cash ÷ net burn") is the provenance tooltip.
 */
export function runwayTile(finance: FinanceOverview | undefined, loading: boolean, onClick: () => void): StatusTile {
  const months = finance?.runway.months ?? null;
  const provenance = finance ? { source: "Cash ÷ net burn (net burn: monthly spending minus income, trailing 3 months)", note: finance.burn.definition } : undefined;
  if (months === null) {
    const words = runwayWords(finance);
    return { label: "Runway", termId: "runway", metricId: "runway", value: loading ? null : (words?.value ?? RUNWAY_WORDS.no_bank.value), loading, caption: words?.caption, provenance, onClick };
  }
  return {
    label: "Runway",
    termId: "runway",
    metricId: "runway",
    value: formatNumber(months, { maxDigits: 1 }),
    unit: "mo",
    estimate: "estimate",
    loading,
    caption: months < 3 ? "Under 3 months of cash left" : months < 9 ? "Under 9 months of cash left" : RUNWAY_CAPTION,
    provenance,
    onClick,
  };
}

/** The Cash tile: the bank balance in the business's currency, or why there is none. */
export function cashTile(finance: FinanceOverview | undefined, loading: boolean, currency: string, onClick: () => void): StatusTile {
  const c = finance?.cash.currency ?? currency;
  return {
    label: "Cash",
    plain: PLAIN_LINES.cash,
    value: finance ? { amountMinor: finance.cash.amountMinor, currency: c } : null,
    loading,
    caption: finance ? (finance.cash.accounts ? `In the bank · ${finance.cash.accounts} account${finance.cash.accounts === 1 ? "" : "s"}` : "Connect a bank in Settings") : undefined,
    provenance: { source: "Bank balances", asOf: finance?.cash.asOf ?? undefined },
    onClick,
  };
}

/** The Customers this week tile: first payments in the last 7 days, with the change against the week before. */
export function customersWeekTile(ribbon: RibbonResponse | undefined, loading: boolean, today: string, onClick: () => void): StatusTile {
  const c = customersThisWeek(ribbon, today);
  return { label: "Customers this week", plain: PLAIN_LINES.customers, value: c ? c.week : null, format: "integer", loading, caption: "Paying customers, last 7 days", delta: c ? { value: c.week - c.previous, label: "vs last week" } : undefined, spark: c?.spark, provenance: { source: "Payments (first payments count as customers)" }, onClick };
}

/**
 * The week's spend as Today reads it (`today.get`): AI usage in US dollars, channel spend in the business's own
 * currency, and channel spend kept in any other currency listed apart.
 */
export interface WeekSpend {
  aiUsage: { amountMinor: number; currency: string };
  channel: { amountMinor: number; currency: string; otherCurrencies: readonly { currency: string; amountMinor: number }[] };
}

export const SPEND_WORDS = {
  combined: "Spent this week",
  ai: "AI usage this week",
  channel: "Channel spend this week",
} as const;

/**
 * The spend tiles (founder, 2026-11-07: two figures, never summed across currencies), each an Estimate. A business in
 * US dollars with every channel in dollars gets one "Spent this week" tile (AI usage plus channel spend, one currency);
 * otherwise "AI usage this week" in USD, and "Channel spend this week" in the business's currency when there was any.
 */
export function spendWeekTiles(spend: WeekSpend | undefined | null, loading: boolean, onClick: () => void): StatusTile[] {
  const provenance = { source: "AI usage as the team's work is metered (US dollars); channel spend from each channel's daily figures; last 7 days" };
  if (!spend) return [{ label: SPEND_WORDS.ai, value: loading ? null : "Not known yet", loading, caption: loading ? undefined : "No usage read yet", provenance, onClick }];
  const otherNote = spend.channel.otherCurrencies.length ? ` · plus spend in ${spend.channel.otherCurrencies.map((o) => o.currency).join(", ")}, not added` : "";
  const oneCurrency = spend.aiUsage.currency === spend.channel.currency && spend.channel.otherCurrencies.length === 0;
  if (oneCurrency) {
    return [{ label: SPEND_WORDS.combined, value: { amountMinor: spend.aiUsage.amountMinor + spend.channel.amountMinor, currency: spend.aiUsage.currency }, estimate: "estimate", loading, caption: "AI usage and channels, last 7 days", provenance, onClick }];
  }
  const tiles: StatusTile[] = [{ label: SPEND_WORDS.ai, value: { amountMinor: spend.aiUsage.amountMinor, currency: spend.aiUsage.currency }, estimate: "estimate", loading, caption: `The team's AI cost, last 7 days (${spend.aiUsage.currency})`, provenance, onClick }];
  if (spend.channel.amountMinor > 0 || spend.channel.otherCurrencies.length > 0) {
    tiles.push({ label: SPEND_WORDS.channel, value: { amountMinor: spend.channel.amountMinor, currency: spend.channel.currency }, estimate: "estimate", loading, caption: `Ads and channels, last 7 days${otherNote}`, provenance, onClick });
  }
  return tiles;
}

/** A board's kind in words, for a caption: "customers_won" → "Customers won", "mrr_growth" → "MRR growth". */
export function boardWords(kind: string): string {
  const words = kind.split(/[_\s-]+/).filter(Boolean).map((w) => (/^(mrr|arr|cpa|ltv)$/i.test(w) ? w.toUpperCase() : w.toLowerCase()));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A tile whose query failed: what happened instead of a figure (shared/errors.ts). */
export function unavailableTile(label: string, error: Error, section: string, onClick: () => void, termId?: string): StatusTile {
  const words = unavailableWords(error, section);
  return { label, termId, value: words.value, caption: words.caption, onClick };
}

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
  if (i.live) {
    const best = (i.positions ?? []).slice().sort((a, b) => a.position - b.position)[0];
    tiles.push({
      label: "Leaderboard position",
      metricId: "leaderboard",
      value: best ? `#${best.position}` : i.loading.positions ? null : "Not ranked",
      loading: i.loading.positions,
      delta: best && best.movement ? { value: best.movement, label: "places" } : undefined,
      caption: best ? (best.board.title ?? boardWords(best.board.boardKind)) : "Verified metrics rank once connected",
      provenance: { source: "Live leaderboards (verified integrations only)" },
      onClick: () => i.open("league", best?.leaderboardId),
    });
  }
  return tiles;
}

function StatusStripWidget({ settings }: WidgetProps<StatusStripSettings>) {
  const { businessId, navigate, gameMode = "personal", currency } = useWidgetData();
  const today = useToday();
  const live = gameMode === "live" && settings.showLeague;
  const finance = useWidgetQuery<FinanceOverview>("finance.overview", {});
  // The recent ribbon Home shares with the department cards (the strip reads its last 14 days).
  const ribbon = useRecentRibbon();
  const departments = useDepartments();
  const positions = useWidgetQuery<LeaderboardPositionRow[]>("live.leaderboards.positions", {}, { enabled: live });
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
        positions: positions.data,
        live,
        today,
        currency,
        loading: { finance: finance.isLoading, ribbon: ribbon.isLoading, departments: departments.isLoading, positions: positions.isLoading },
        errors: { finance: finance.error, ribbon: ribbon.error, departments: departments.error },
        open: (where, id) => {
          if (where === "finance") navigate(moduleHref(businessId, departments.data, "finance") ?? routes.settings(businessId, "integrations"));
          else if (where === "team") navigate(moduleHref(businessId, departments.data, "team") ?? routes.home(businessId));
          else if (where === "customers") navigate(routes.crm(businessId));
          else navigate(id ? routes.leaderboard(id) : "/leaderboards");
        },
      }),
    [finance.data, finance.isLoading, finance.error, ribbon.data, ribbon.isLoading, ribbon.error, departments.data, departments.isLoading, departments.error, blockedTasks.data, endedTasks.data, positions.data, positions.isLoading, live, today, currency, navigate, businessId],
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
  description: "Cash, runway, revenue, customers this week, team health and leaderboard position once live.",
  icon: "gauge",
  surfaces: ["home", "department"],
  defaultSize: { w: 12, h: 6, minW: 6, minH: 5, maxH: 8 },
  settingsSchema: StatusStripSettings,
  defaultSettings: StatusStripSettings.parse({}),
  single: true,
  Component: StatusStripWidget,
});
