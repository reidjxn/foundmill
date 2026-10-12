"use client";
/**
 * Revenue and customers widget: monthly revenue (cash basis) as bars and customers won per week from the journey
 * daily rows; two headline tiles on top.
 */
import { useMemo } from "react";
import { z } from "zod";
import { TrendingUp } from "lucide-react";
import { BarChart, LineChart, MetricTile, formatNumber, type BarDatum, type LineSeries } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import { addDays, dayKey, monthKey, weekKey } from "../shared/time";
import type { FinanceOverview, RibbonResponse } from "../shared/types";

export const RevenueCustomersSettings = z.object({
  view: z.enum(["both", "revenue", "customers"]).default("both"),
  months: z.union([z.literal(6), z.literal(12)]).default(6),
});
export type RevenueCustomersSettings = z.infer<typeof RevenueCustomersSettings>;

export function revenueBars(finance: FinanceOverview | undefined, months: number): BarDatum[] {
  return (finance?.revenue.monthly ?? []).slice(-months).map((m) => ({ label: m.month.slice(5), value: m.inflowMinor / 100 }));
}

/** Customers (payments) per ISO week from the business-wide daily rows, oldest first. */
export function customersPerWeek(ribbon: RibbonResponse | undefined): { week: string; customers: number; signups: number }[] {
  const byWeek = new Map<string, { customers: number; signups: number }>();
  for (const r of ribbon?.rows ?? []) {
    if (r.departmentId !== null) continue;
    const k = weekKey(r.day);
    const cur = byWeek.get(k) ?? { customers: 0, signups: 0 };
    cur.customers += r.payments;
    cur.signups += r.signups;
    byWeek.set(k, cur);
  }
  return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ...v }));
}

function RevenueCustomersWidget({ settings }: WidgetProps<RevenueCustomersSettings>) {
  const { businessId, navigate, currency } = useWidgetData();
  const today = dayKey();
  const finance = useWidgetQuery<FinanceOverview>("finance.overview", {}, { enabled: settings.view !== "customers" });
  const ribbon = useWidgetQuery<RibbonResponse>("journey.ribbon", { from: addDays(today, -settings.months * 30), to: today }, { enabled: settings.view !== "revenue" });
  useBusinessEvents(() => {
    finance.refetch();
    ribbon.refetch();
  }, ["payment.received", "customer.converted", "signup.created"]);

  const bars = useMemo(() => revenueBars(finance.data, settings.months), [finance.data, settings.months]);
  const weeks = useMemo(() => customersPerWeek(ribbon.data), [ribbon.data]);
  const weekSeries: LineSeries[] = useMemo(() => {
    if (weeks.length < 2) return [];
    const x = (i: number) => i + 1;
    return [
      { id: "customers", label: "Customers", tone: "kit", data: weeks.map((w, i) => ({ x: x(i), y: w.customers })), area: true },
      { id: "signups", label: "Signups", tone: "info", data: weeks.map((w, i) => ({ x: x(i), y: w.signups })) },
    ];
  }, [weeks]);
  const cur = finance.data?.cash.currency ?? currency;
  const thisMonth = finance.data?.revenue.monthly.find((m) => m.month === monthKey(today))?.inflowMinor ?? null;
  const last30 = (ribbon.data?.rows ?? []).filter((r) => r.departmentId === null && r.day >= addDays(today, -29)).reduce((s, r) => s + r.payments, 0);
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
          {settings.view !== "customers" ? <MetricTile label="Revenue this month" value={thisMonth === null ? "—" : { amountMinor: thisMonth, currency: cur }} caption="Cash basis" spark={bars.map((b) => b.value)} /> : null}
          {settings.view !== "revenue" ? <MetricTile label="Customers, last 30 days" value={ribbon.data ? last30 : null} format="integer" caption={ribbon.data ? `${formatNumber(weeks.at(-1)?.customers ?? 0, { maxDigits: 0 })} this week` : undefined} spark={weeks.map((w) => w.customers)} /> : null}
        </div>
        <div className={`grid min-h-0 flex-1 gap-gutter p-panel-pad ${settings.view === "both" ? "grid-cols-2" : "grid-cols-1"}`}>
          {settings.view !== "customers" && bars.length > 0 ? <BarChart data={bars} label="Revenue by month" height={140} format={(v) => formatNumber(v, { maxDigits: 0 })} /> : null}
          {settings.view !== "revenue" && weekSeries.length > 0 ? <LineChart series={weekSeries} label="Customers and signups per week" height={140} xType="linear" xFormat={(v) => `W${v}`} yFormat={(v) => formatNumber(v, { maxDigits: 0 })} /> : null}
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
  defaultSize: { w: 6, h: 12, minW: 4, minH: 9 },
  settingsSchema: RevenueCustomersSettings,
  defaultSettings: RevenueCustomersSettings.parse({}),
  Component: RevenueCustomersWidget,
});
