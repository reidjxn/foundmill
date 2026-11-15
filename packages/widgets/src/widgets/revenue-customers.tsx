"use client";
/**
 * Revenue and customers widget: monthly revenue (cash basis) as bars and customers won per week from the journey
 * daily rows; two headline tiles on top.
 */
import { useMemo } from "react";
import { z } from "zod";
import { TrendingUp } from "lucide-react";
import { BarChart, LineChart, MetricTile, formatDate, formatMoney, formatNumber, useDateFormat, type BarDatum, type DateFormatPrefs, type LineSeries } from "@foundmill/dugout";
import { useBusinessEvents, useGlossary, useToday, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { NOT_KNOWN_YET, monthRevenueMinor, revenueThisMonthMinor } from "../shared/cash";
import { customersThisWeek } from "../shared/customers";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import { addDays, monthKey, weekKey, weekStart } from "../shared/time";
import type { FinanceOverview, RibbonResponse } from "../shared/types";

export const RevenueCustomersSettings = z.object({
  view: z.enum(["both", "revenue", "customers"]).default("both"),
  months: z.union([z.literal(6), z.literal(12)]).default(6),
});
export type RevenueCustomersSettings = z.infer<typeof RevenueCustomersSettings>;

/** A month key's short US name: "2026-05" → "May". */
export function monthLabel(month: string): string {
  return formatDate(`${month}-01`, "MMM");
}

/** Monthly revenue bars, labeled "May" … "Oct", valued in minor units of the revenue's currency (formatted with it). */
export function revenueBars(finance: FinanceOverview | undefined, months: number): BarDatum[] {
  return (finance?.revenue.monthly ?? []).slice(-months).map((m) => ({ label: monthLabel(m.month), value: monthRevenueMinor(m) }));
}

/** The weeks the chart covers: from the Monday of the week holding `today − months × 30 days`, so no partial first week. */
export function weeksFrom(today: string, months: number): string {
  return weekStart(addDays(today, -months * 30));
}

/**
 * Customers (first payments) and signups per week from the business-wide daily rows, oldest first, each week named by
 * its ISO key and its Monday. With a range every week in it is present (an empty week is a zero, never skipped).
 */
export function customersPerWeek(ribbon: RibbonResponse | undefined, range?: { from: string; to: string }): { week: string; start: string; customers: number; signups: number }[] {
  const byWeek = new Map<string, { customers: number; signups: number }>();
  if (range) for (let start = weekStart(range.from); start <= range.to; start = addDays(start, 7)) byWeek.set(start, { customers: 0, signups: 0 });
  for (const r of ribbon?.rows ?? []) {
    if (r.departmentId !== null) continue;
    const k = weekStart(r.day);
    const cur = byWeek.get(k) ?? { customers: 0, signups: 0 };
    cur.customers += r.payments;
    cur.signups += r.signups;
    byWeek.set(k, cur);
  }
  return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, v]) => ({ week: weekKey(start), start, ...v }));
}

/** The week series, plotted at each week's Monday (a date axis, labeled "Oct 5"). */
export function weekLines(weeks: ReturnType<typeof customersPerWeek>): LineSeries[] {
  if (weeks.length < 2) return [];
  const x = (start: string) => new Date(`${start}T12:00:00`);
  return [
    { id: "customers", label: "Customers", tone: "kit", data: weeks.map((w) => ({ x: x(w.start), y: w.customers })), area: true },
    { id: "signups", label: "Signups", tone: "info", data: weeks.map((w) => ({ x: x(w.start), y: w.signups })) },
  ];
}

const weekTick = (prefs: DateFormatPrefs | null | undefined) => (v: number) => formatDate(v, "dayMonth", prefs);

function RevenueCustomersWidget({ settings }: WidgetProps<RevenueCustomersSettings>) {
  const { businessId, navigate, currency } = useWidgetData();
  const datePrefs = useDateFormat();
  const g = useGlossary();
  const today = useToday();
  const from = weeksFrom(today, settings.months);
  const finance = useWidgetQuery<FinanceOverview>("finance.overview", {}, { enabled: settings.view !== "customers" });
  const ribbon = useWidgetQuery<RibbonResponse>("journey.ribbon", { from, to: today }, { enabled: settings.view !== "revenue" });
  useBusinessEvents(() => {
    finance.refetch();
    ribbon.refetch();
  }, ["payment.received", "customer.converted", "signup.created"]);

  const bars = useMemo(() => revenueBars(finance.data, settings.months), [finance.data, settings.months]);
  const weeks = useMemo(() => (ribbon.data ? customersPerWeek(ribbon.data, { from, to: today }) : []), [ribbon.data, from, today]);
  const weekSeries: LineSeries[] = useMemo(() => weekLines(weeks).map((s) => ({ ...s, label: g(s.label) })), [weeks, g]);
  const cur = finance.data?.cash.currency ?? currency;
  const thisMonth = revenueThisMonthMinor(finance.data, monthKey(today));
  const last30 = (ribbon.data?.rows ?? []).filter((r) => r.departmentId === null && r.day >= addDays(today, -29)).reduce((s, r) => s + r.payments, 0);
  // "This week" is Home's Customers this week figure itself (one number per fact): the server's count when it has one.
  const last7 = customersThisWeek(ribbon.data, today)?.week ?? 0;
  const queries = settings.view === "revenue" ? [finance] : settings.view === "customers" ? [ribbon] : [finance, ribbon];
  const hasData = bars.some((b) => b.value > 0) || weeks.some((w) => w.customers > 0 || w.signups > 0);
  const loaded = queries.every((q) => q.data !== undefined);
  return (
    <WidgetFrame
      title="Revenue and customers"
      data-widget="revenue_customers"
      queries={queries}
      flush
      empty={loaded && !hasData ? { icon: TrendingUp, text: "Revenue and customers appear once Stripe, Shopify or a bank is connected and the first customer is won.", action: { label: "Open integrations", onClick: () => navigate(routes.settings(businessId, "integrations")) } } : null}
      footer={<span>{finance.data?.revenue.label ?? "Revenue on a cash basis"} · customers = first payments</span>}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="grid grid-cols-2 gap-px border-b border-subtle bg-subtle">
          {settings.view !== "customers" ? <MetricTile label="Revenue this month" value={thisMonth === null ? (finance.data ? NOT_KNOWN_YET.value : null) : { amountMinor: thisMonth, currency: cur }} caption={thisMonth === null && finance.data ? NOT_KNOWN_YET.caption : "Cash basis"} spark={bars.map((b) => b.value)} /> : null}
          {settings.view !== "revenue" ? <MetricTile label={g("Customers, last 30 days")} value={ribbon.data ? last30 : null} format="integer" caption={ribbon.data ? `${formatNumber(last7, { maxDigits: 0 })} in the last 7 days` : undefined} spark={weeks.map((w) => w.customers)} /> : null}
        </div>
        <div className={`grid min-h-0 flex-1 gap-gutter p-panel-pad ${settings.view === "both" ? "grid-cols-2" : "grid-cols-1"}`}>
          {settings.view !== "customers" && bars.length > 0 ? <BarChart data={bars} label="Revenue by month" height={140} format={(v) => formatMoney({ amountMinor: v, currency: cur }, { compact: true })} /> : null}
          {settings.view !== "revenue" && weekSeries.length > 0 ? <LineChart series={weekSeries} label={g("Customers and signups per week")} height={140} xType="time" xFormat={weekTick(datePrefs)} yFormat={(v) => formatNumber(v, { maxDigits: 0 })} /> : null}
        </div>
      </div>
    </WidgetFrame>
  );
}

export const revenueCustomersWidget = registerWidget<RevenueCustomersSettings>({
  key: "revenue_customers",
  title: "Revenue and customers",
  description: "Monthly revenue and customers won per week.",
  icon: "trending-up",
  surfaces: ["home", "department"],
  // Tall enough for the three tiles, the chart and the footer at 1280–1440 px (the body scrolls in a smaller cell).
  defaultSize: { w: 6, h: 16, minW: 4, minH: 9 },
  settingsSchema: RevenueCustomersSettings,
  defaultSettings: RevenueCustomersSettings.parse({}),
  Component: RevenueCustomersWidget,
});
