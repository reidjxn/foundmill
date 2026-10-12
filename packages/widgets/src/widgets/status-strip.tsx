"use client";
/**
 * Status strip widget (BUILD §11.2, DESIGN §9): six tiles under the Ribbon — cash, runway, revenue, customers this
 * week, business health and leaderboard position when LIVE. Display-lg figures with label captions; every non-measured
 * number carries Estimate.
 */
import { useMemo } from "react";
import { z } from "zod";
import { Gauge } from "lucide-react";
import { StatusStrip, formatNumber, type MetricTileProps } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { RUNWAY_WORDS, runwayWords } from "../shared/runway";
import { registerWidget, type WidgetProps } from "../registry";
import { moduleHref, orderedDepartments, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { useRecentRibbon } from "../shared/ribbon";
import { routes } from "../shared/routes";
import { addDays, dailySeries, dayKey, lastDays, monthKey, sumInRange } from "../shared/time";
import type { DepartmentRow, FinanceOverview, LeaderboardPositionRow, RibbonResponse } from "../shared/types";

export const StatusStripSettings = z.object({
  /** Show the leaderboard tile in LIVE mode. */
  showLeague: z.boolean().default(true),
});
export type StatusStripSettings = z.infer<typeof StatusStripSettings>;

export interface StatusStripInputs {
  finance?: FinanceOverview;
  ribbon?: RibbonResponse;
  departments?: DepartmentRow[];
  positions?: LeaderboardPositionRow[];
  live: boolean;
  today: string;
  currency: string;
  loading: { finance: boolean; ribbon: boolean; departments: boolean; positions: boolean };
  open: (where: "finance" | "customers" | "team" | "league", id?: string) => void;
}

/** Squad health as the share of healthy agents across every department (0–1), null without a squad. */
export function squadHealth(departments: readonly DepartmentRow[] | undefined): number | null {
  const seen = new Map<string, string>();
  for (const d of departments ?? []) for (const a of d.squad) seen.set(a.id, a.status);
  if (seen.size === 0) return null;
  let healthy = 0;
  for (const s of seen.values()) if (s === "healthy" || s === "idle") healthy += 1;
  return healthy / seen.size;
}

/**
 * The runway tile. With a burn model it is the figure in months with its Estimate chip; without one it says why in the
 * shared runway words (shared/runway.ts: "No limit" when cash-flow positive, "Not known yet" otherwise) with the reason
 * underneath, and no Estimate chip: nothing has been estimated yet.
 */
export function runwayTile(finance: FinanceOverview | undefined, loading: boolean, onClick: () => void): MetricTileProps {
  const months = finance?.runway.months ?? null;
  const provenance = finance ? { source: "Cash ÷ net burn (trailing 3 months)", note: finance.burn.definition } : undefined;
  if (months === null) {
    const words = runwayWords(finance);
    return { label: "Runway", value: loading ? null : (words?.value ?? RUNWAY_WORDS.no_bank.value), loading, caption: words?.caption, provenance, onClick };
  }
  return {
    label: "Runway",
    value: formatNumber(months, { maxDigits: 1 }),
    unit: "mo",
    estimate: "estimate",
    loading,
    caption: finance?.runway.blocksContinue ? "Under 3 months: blocks Continue" : months < 9 ? "Under 9 months" : "Cash ÷ net burn",
    provenance,
    onClick,
  };
}

/** A board's kind in words, for a caption: "customers_won" → "Customers won", "mrr_growth" → "MRR growth". */
export function boardWords(kind: string): string {
  const words = kind.split(/[_\s-]+/).filter(Boolean).map((w) => (/^(mrr|arr|cpa|ltv)$/i.test(w) ? w.toUpperCase() : w.toLowerCase()));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function statusTiles(i: StatusStripInputs): MetricTileProps[] {
  const weekFrom = addDays(i.today, -6);
  const prevFrom = addDays(i.today, -13);
  const prevTo = addDays(i.today, -7);
  const rows = i.ribbon?.rows.filter((r) => r.departmentId === null) ?? [];
  const customersWeek = sumInRange(rows, weekFrom, i.today, (r) => r.payments);
  const customersPrev = sumInRange(rows, prevFrom, prevTo, (r) => r.payments);
  const month = monthKey(i.today);
  const revenueMonth = i.finance?.revenue.monthly.find((m) => m.month === month)?.inflowMinor ?? null;
  const revenueSeries = (i.finance?.revenue.monthly ?? []).slice(-6).map((m) => m.inflowMinor);
  const health = squadHealth(i.departments);
  const currency = i.finance?.cash.currency ?? i.currency;
  const tiles: MetricTileProps[] = [
    { label: "Cash", value: i.finance ? { amountMinor: i.finance.cash.amountMinor, currency } : null, loading: i.loading.finance, caption: i.finance?.cash.accounts ? `${i.finance.cash.accounts} account${i.finance.cash.accounts === 1 ? "" : "s"}` : "Connect a bank in Settings", provenance: { source: "Bank balances", asOf: i.finance?.cash.asOf ?? undefined }, onClick: () => i.open("finance") },
    runwayTile(i.finance, i.loading.finance, () => i.open("finance")),
    { label: "Revenue this month", value: revenueMonth === null ? (i.loading.finance ? null : "—") : { amountMinor: revenueMonth, currency }, spark: revenueSeries, loading: i.loading.finance, caption: i.finance?.revenue.label ?? "Cash basis", provenance: { source: "Bank inflows, cash basis" }, onClick: () => i.open("finance") },
    { label: "Customers this week", value: i.ribbon ? customersWeek : null, format: "integer", loading: i.loading.ribbon, delta: i.ribbon ? { value: customersWeek - customersPrev, label: "vs last week" } : undefined, spark: i.ribbon ? dailySeries(rows, lastDays(14, i.today), (r) => r.payments) : undefined, provenance: { source: "Payments (first payments count as customers)" }, onClick: () => i.open("customers") },
    { label: "Business health", value: health === null ? (i.loading.departments ? null : "—") : health, format: "percent", loading: i.loading.departments, caption: health === null ? "No agents hired yet" : health >= 0.9 ? "Team healthy" : health >= 0.6 ? "Some agents need attention" : "Team in trouble", provenance: { source: "Share of agents healthy or idle" }, onClick: () => i.open("team") },
  ];
  if (i.live) {
    const best = (i.positions ?? []).slice().sort((a, b) => a.position - b.position)[0];
    tiles.push({
      label: "Leaderboard position",
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
  const today = dayKey();
  const live = gameMode === "live" && settings.showLeague;
  const finance = useWidgetQuery<FinanceOverview>("finance.overview", {});
  // The recent ribbon Home shares with the department cards (the strip reads its last 14 days).
  const ribbon = useRecentRibbon();
  const departments = useDepartments();
  const positions = useWidgetQuery<LeaderboardPositionRow[]>("live.leaderboards.positions", {}, { enabled: live });
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
        positions: positions.data,
        live,
        today,
        currency,
        loading: { finance: finance.isLoading, ribbon: ribbon.isLoading, departments: departments.isLoading, positions: positions.isLoading },
        open: (where, id) => {
          if (where === "finance") navigate(moduleHref(businessId, departments.data, "finance") ?? routes.settings(businessId, "integrations"));
          else if (where === "team") navigate(moduleHref(businessId, departments.data, "team") ?? routes.home(businessId));
          else if (where === "customers") navigate(routes.crm(businessId));
          else navigate(id ? routes.leaderboard(id) : "/leaderboards");
        },
      }),
    [finance.data, finance.isLoading, ribbon.data, ribbon.isLoading, departments.data, departments.isLoading, positions.data, positions.isLoading, live, today, currency, navigate, businessId],
  );
  const failed = finance.error && ribbon.error && departments.error;
  return (
    <WidgetFrame title="Status" data-widget="status_strip" error={failed ? (finance.error ?? undefined) : undefined} onRetry={failed ? () => [finance, ribbon, departments].forEach((q) => q.refetch()) : undefined} flush empty={null}>
      <StatusStrip tiles={tiles} className="rounded-none border-0" aria-label="Business status" />
      {!failed && !finance.isLoading && (!finance.data || (finance.data.cash.accounts === 0 && finance.data.revenue.monthly.length === 0)) ? (
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
  description: "Cash, runway, revenue, customers this week, business health and leaderboard position once live.",
  icon: "gauge",
  surfaces: ["home", "department"],
  defaultSize: { w: 12, h: 6, minW: 6, minH: 5, maxH: 8 },
  settingsSchema: StatusStripSettings,
  defaultSettings: StatusStripSettings.parse({}),
  single: true,
  Component: StatusStripWidget,
});
