"use client";
/**
 * Finance › Overview (BUILD §11.8): the ten metric tiles with hover-visible definitions, provenance and sparklines,
 * runway warnings at 12/9/6 months (red and blocking under 3), cash history against the Base forecast, and monthly
 * money in and out. Read-only: nothing here can move money.
 */
import { useMemo } from "react";
import { AlertTriangle, Inbox, Landmark } from "lucide-react";
import { BarChart, Button, EmptyState, ErrorState, LineChart, MetricTile, Panel, StatusPill, type LineSeries, type MetricTileProps, type MetricProvenance } from "@foundmill/dugout";
import { routes, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import {
  METRIC_DEFINITIONS,
  acquisitionCost,
  cashHistory,
  formatMonth,
  monthStart,
  monthlySeries,
  paybackMonths,
  pnlTotals,
  readDrivers,
  readSeries,
  runwayTone,
  runwayWarnings,
  runwayWord,
  seedDrivers,
  trailingMonths,
  RUNWAY_BLOCK_MONTHS,
  type MetricKey,
} from "./metrics";
import { Screen, fmtMoney, fmtMonths, useCurrency, useNow } from "./shared";
import type { ChannelsListResponse, FinanceOverview, PnlResponse } from "./types";

const TRAILING = 3;
const HISTORY = 6;

export interface OverviewMetric extends MetricTileProps {
  key: MetricKey;
}

/** Forecast-based runway from the stored Base forecast: its drivers' runway, else the first month its series goes negative. */
export function forecastRunway(overview: FinanceOverview | undefined, now: Date): number | null {
  const base = overview?.forecasts?.base;
  if (!base) return null;
  const drivers = readDrivers((base as { drivers?: Record<string, unknown> }).drivers, seedDrivers("base", { cashMinor: 0, mrrMinor: 0, grossBurnMinor: 0 }));
  if (typeof drivers.runway_months === "number") return drivers.runway_months;
  const series = readSeries(base.series as unknown[]);
  const thisMonth = now.toISOString().slice(0, 7);
  const idx = series.findIndex((p) => p.cashMinor < 0);
  if (idx < 0) return null;
  const first = series[0]?.month ?? thisMonth;
  const offset = (Number(first.slice(0, 4)) - Number(thisMonth.slice(0, 4))) * 12 + (Number(first.slice(5, 7)) - Number(thisMonth.slice(5, 7)));
  return Math.max(0, idx + offset);
}

/** The ten tiles (BUILD §11.8 metric definitions) from the overview, the trailing P&L and the channel board. */
export function overviewTiles(args: { overview: FinanceOverview; pnl: PnlResponse | undefined; channels: ChannelsListResponse | undefined; currency: string; now: Date }): OverviewMetric[] {
  const { overview, pnl, channels, now } = args;
  const currency = overview.cash.currency || args.currency;
  const months = trailingMonths(now, HISTORY);
  const monthly = overview.revenue.monthly ?? [];
  const totals = pnl ? pnlTotals(pnl.categories) : null;
  const revenue = totals?.revenueMinor ?? 0;
  const mrr = Math.round(revenue / TRAILING);
  const gm = totals?.grossMarginPct ?? null;
  const blended = channels?.blended;
  const cpa = acquisitionCost(blended ? { spendMinor: blended.spendMinor, customers: blended.customers } : null);
  const payingCustomers = blended && blended.customers > 0 ? blended.customers : overview.customers30d;
  const payback = paybackMonths(cpa, mrr, gm, payingCustomers);
  const fcRunway = forecastRunway(overview, now);
  const asOf = overview.cash.asOf ?? undefined;
  const bank = `${overview.cash.accounts} connected account${overview.cash.accounts === 1 ? "" : "s"}`;
  const pnlSource = pnl?.label ?? "Management P&L, unaudited, cash basis";
  const prov = (key: MetricKey, source: string, query?: string, extra?: string): MetricProvenance => ({ source, asOf, query, note: extra ? `${METRIC_DEFINITIONS[key].definition} ${extra}` : METRIC_DEFINITIONS[key].definition });

  const perChannel = channels?.channels
    .filter((c) => c.form && c.form.customers > 0)
    .map((c) => ({ label: c.meta?.label ?? c.channelKey, cpa: Math.round(c.form!.spendMinor / c.form!.customers) }))
    .sort((a, b) => a.cpa - b.cpa)
    .slice(0, 4);
  const perChannelText = perChannel && perChannel.length ? `Per channel: ${perChannel.map((c) => `${c.label} ${fmtMoney(c.cpa, currency, { compact: true })}`).join(", ")}.` : undefined;

  const tiles: OverviewMetric[] = [
    { key: "cash", label: METRIC_DEFINITIONS.cash.label, value: { amountMinor: overview.cash.amountMinor, currency }, spark: cashHistory(overview.cash.amountMinor, monthly, months), provenance: prov("cash", `Bank balances, ${bank}`, "finance.overview.cash"), caption: bank },
    { key: "grossBurn", label: METRIC_DEFINITIONS.grossBurn.label, value: { amountMinor: overview.burn.grossBurnMinor, currency }, estimate: "estimate", spark: monthlySeries(monthly, months, (m) => m.outflowMinor), provenance: prov("grossBurn", "Bank transactions, operating outflows", "finance.overview.burn.grossBurnMinor"), caption: `per month, ${overview.burn.months}-month average` },
    { key: "netBurn", label: METRIC_DEFINITIONS.netBurn.label, value: { amountMinor: overview.burn.netBurnMinor, currency }, estimate: "estimate", delta: undefined, spark: monthlySeries(monthly, months, (m) => m.outflowMinor - m.inflowMinor), provenance: prov("netBurn", "Bank transactions, financing excluded", "finance.overview.burn.netBurnMinor"), caption: overview.burn.netBurnMinor <= 0 ? "Cash-flow positive" : `per month, ${overview.burn.months}-month average` },
    { key: "runway", label: METRIC_DEFINITIONS.runway.label, value: overview.runway.months === null ? "—" : `${overview.runway.months}`, unit: overview.runway.months === null ? undefined : "mo", estimate: "estimate", provenance: prov("runway", "Cash ÷ net burn", "finance.overview.runway", fcRunway !== null ? `Base forecast: ${fmtMonths(fcRunway)}.` : undefined), caption: fcRunway !== null ? `Forecast: ${fmtMonths(fcRunway)}` : overview.runway.months === null ? "Needs a positive net burn" : runwayWord(overview.runway.months) },
    { key: "revenue", label: METRIC_DEFINITIONS.revenue.label, value: { amountMinor: revenue, currency }, estimate: pnl?.source === "ledger" ? undefined : "estimate", spark: monthlySeries(monthly, months, (m) => m.inflowMinor), provenance: prov("revenue", pnlSource, "finance.pnl.categories[revenue]"), caption: `trailing ${TRAILING} months` },
    { key: "mrr", label: METRIC_DEFINITIONS.mrr.label, value: { amountMinor: mrr, currency }, estimate: "estimate", provenance: prov("mrr", pnlSource, `revenue ÷ ${TRAILING}`), caption: "per month" },
    { key: "arr", label: METRIC_DEFINITIONS.arr.label, value: { amountMinor: mrr * 12, currency }, estimate: "estimate", provenance: prov("arr", pnlSource, "MRR × 12"), caption: "annualised" },
    { key: "grossMargin", label: METRIC_DEFINITIONS.grossMargin.label, value: gm === null ? "—" : gm / 100, format: "percent", estimate: "estimate", provenance: prov("grossMargin", pnlSource, "(revenue − cost of sales) ÷ revenue"), caption: gm === null ? "Needs revenue" : `trailing ${TRAILING} months` },
    { key: "acquisitionCost", label: METRIC_DEFINITIONS.acquisitionCost.label, value: cpa === null ? "—" : { amountMinor: cpa, currency }, estimate: "estimate", provenance: prov("acquisitionCost", "Distribution board, channel spend and customers", "spend ÷ new customers", perChannelText), caption: blended ? `${blended.customers} customers, ${blended.days} days` : "Needs channel spend" },
    { key: "payback", label: METRIC_DEFINITIONS.payback.label, value: payback === null ? "—" : `${payback}`, unit: payback === null ? undefined : "mo", estimate: "estimate", provenance: prov("payback", "Acquisition cost and gross profit per customer", "CPA ÷ (MRR × gross margin ÷ customers)"), caption: payback === null ? "Needs acquisition cost, margin and customers" : `${payingCustomers} paying customers` },
  ];
  return tiles;
}

export function RunwayWarning({ months, warnings, blocksContinue, onOpenInbox }: { months: number | null; warnings: readonly number[]; blocksContinue: boolean; onOpenInbox: () => void }) {
  if (!warnings.length && !blocksContinue) return null;
  const tone = runwayTone(months);
  const lowest = [...warnings].sort((a, b) => a - b)[0];
  return (
    <div role="status" aria-label="Runway warning" className={`col-span-12 flex items-center gap-3 rounded-panel border px-panel-pad py-2 ${tone === "bad" ? "border-status-bad/40 bg-status-bad/12" : "border-status-warn/40 bg-status-warn/12"}`}>
      <StatusPill tone={tone === "bad" ? "bad" : "warn"} icon={AlertTriangle}>
        {runwayWord(months)}
      </StatusPill>
      <span className="text-body text-primary">
        {blocksContinue
          ? `Runway is under ${RUNWAY_BLOCK_MONTHS} months. Continue is blocked until the warning in the Inbox is acknowledged.`
          : `Runway is ${fmtMonths(months)}, under the ${lowest}-month threshold. The finance lead has drafted options in the Inbox.`}
      </span>
      <Button size="sm" variant={blocksContinue ? "danger" : "default"} icon={Inbox} className="ml-auto" onClick={onOpenInbox}>
        Open Inbox
      </Button>
    </div>
  );
}

export function OverviewScreen({ businessId }: ModuleScreenProps) {
  const now = useNow();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const range = useMemo(() => ({ from: monthStart(now, -TRAILING).toISOString(), to: monthStart(now, 0).toISOString() }), [now]);
  const overview = useWidgetQuery<FinanceOverview>("finance.overview", {});
  const pnl = useWidgetQuery<PnlResponse>("finance.pnl", range);
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});

  const data = overview.data;
  const tiles = useMemo(() => (data ? overviewTiles({ overview: data, pnl: pnl.data, channels: channels.data, currency, now }) : null), [data, pnl.data, channels.data, currency, now]);
  const months = useMemo(() => trailingMonths(now, HISTORY), [now]);
  const cur = data?.cash.currency || currency;
  const hasData = !!data && (data.cash.accounts > 0 || (data.revenue.monthly?.length ?? 0) > 0);

  const cashSeries = useMemo(() => {
    if (!data) return [];
    const history = cashHistory(data.cash.amountMinor, data.revenue.monthly ?? [], months);
    const actual = months.map((m, i) => ({ x: new Date(`${m}-01T00:00:00.000Z`), y: history[i] ?? 0 }));
    const base = data.forecasts?.base ? readSeries(data.forecasts.base.series as unknown[]) : [];
    const forecast = base.slice(0, 12).map((p) => ({ x: new Date(`${p.month}-01T00:00:00.000Z`), y: p.cashMinor }));
    const series: LineSeries[] = [{ id: "cash", label: "Cash in bank", tone: "kit", data: actual, area: true }];
    if (forecast.length) series.push({ id: "base", label: "Base forecast", tone: "secondary", data: forecast, dashed: true });
    return series;
  }, [data, months]);

  const flow = useMemo(() => {
    if (!data) return [];
    const monthly = data.revenue.monthly ?? [];
    return months.map((m) => {
      const row = monthly.find((x) => x.month === m);
      const net = row ? row.netMinor : 0;
      return { label: formatMonth(m), value: net, tone: net >= 0 ? ("good" as const) : ("bad" as const) };
    });
  }, [data, months]);

  const openInbox = () => navigate(routes.inbox(businessId));

  return (
    <Screen name="finance/overview">
      {data ? <RunwayWarning months={data.runway.months} warnings={data.runway.warnings?.length ? data.runway.warnings : runwayWarnings(data.runway.months)} blocksContinue={data.runway.blocksContinue} onOpenInbox={openInbox} /> : null}
      <section aria-label="Finance metrics" aria-busy={overview.isLoading || undefined} className="col-span-12">
        {overview.error ? (
          <ErrorState onRetry={overview.refetch} detail={overview.error.message}>
            The finance overview could not be loaded.
          </ErrorState>
        ) : data && !hasData ? (
          <EmptyState icon={Landmark} title="No bank or revenue data yet" action={{ label: "Connect a bank", icon: Landmark, onClick: () => navigate(routes.settings(businessId, "integrations")) }}>
            Connect a bank account (Tink or Plaid) or Stripe and the tiles fill with cash, burn, runway and revenue.
          </EmptyState>
        ) : (
          <div role="list" className="grid grid-cols-5 gap-px overflow-hidden rounded-panel border border-subtle bg-subtle">
            {(tiles ?? Array.from({ length: 10 }, (_, i) => ({ key: `loading-${i}`, label: Object.values(METRIC_DEFINITIONS)[i]?.label ?? "", value: null, loading: true }))).map(({ key, ...tile }) => (
              <MetricTile key={key} role="listitem" data-metric={key} {...tile} />
            ))}
          </div>
        )}
      </section>
      <Panel title={`Cash, last ${HISTORY} months`} span={8} loading={overview.isLoading} error={overview.error ? overview.error.message : undefined} onRetry={overview.refetch} empty={data && !hasData ? "Cash history appears once a bank account is connected." : undefined} footer={<span>Actuals from bank balances walked back through monthly net cash; the dashed line is the Base forecast.</span>}>
        {cashSeries.length ? <LineChart label="Cash history and Base forecast" series={cashSeries} height={200} yFormat={(v) => fmtMoney(v, cur, { compact: true })} provenance={cashSeries.length > 1 ? "forecast" : undefined} zeroBased={false} markX={monthStart(now, 0)} markLabel="This month" /> : null}
      </Panel>
      <Panel title="Net cash change by month" span={4} loading={overview.isLoading} error={overview.error ? overview.error.message : undefined} onRetry={overview.refetch} empty={data && !hasData ? "Monthly inflows and outflows appear once transactions sync." : undefined} footer={<span>{pnl.data?.label ?? "Management P&L, unaudited, cash basis"}</span>}>
        {flow.length ? <BarChart label="Net cash change by month" data={flow} height={200} format={(v) => fmtMoney(v, cur, { compact: true })} provenance="estimate" showValues /> : null}
      </Panel>
    </Screen>
  );
}
