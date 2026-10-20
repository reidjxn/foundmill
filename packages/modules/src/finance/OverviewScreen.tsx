"use client";
/**
 * Finance › Overview (BUILD §11.8): the ten metric tiles with hover-visible definitions, provenance and sparklines,
 * runway warnings at 12/9/6 months (red and blocking under 3), cash history against the Base forecast, and monthly
 * money in and out. Read-only: nothing here can move money.
 */
import { useMemo } from "react";
import { AlertTriangle, Inbox, Landmark } from "lucide-react";
import { BarChart, Button, EmptyState, ErrorState, Explainer, LineChart, MetricTile, Panel, ProvenanceChip, StatusPill, Term, formatNumber, useDateFormat, type LineSeries, type MetricTileProps, type MetricProvenance } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import {
  METRIC_DEFINITIONS,
  acquisitionCost,
  cashHistory,
  financeSummarySentence,
  formatMonth,
  monthKey,
  monthStart,
  monthlySeries,
  operatingBurn,
  operatingInflow,
  operatingOutflow,
  paybackMonths,
  plainLine,
  pnlLabelWords,
  pnlTotals,
  readDrivers,
  readSeries,
  runwayTone,
  runwayWarnings,
  runwayWord,
  seedDrivers,
  storedProjection,
  trailingMonths,
  RUNWAY_BLOCK_MONTHS,
  type MetricKey,
} from "./metrics";
import { Screen, fmtAxisMoney, fmtMoney, fmtMonths, useCurrency, useNow } from "./shared";
import type { ChannelsListResponse, FinanceOverview, PnlResponse } from "./types";
import { runwayFigure, runwayWords } from "@foundmill/widgets/shared/runway";
import { usePinToHomeMenu } from "@foundmill/widgets/shared/pin";
import { CHANNEL_WINDOW_DAYS } from "@foundmill/shared/constants";

const TRAILING = 3;
const HISTORY = 6;
/** Charts fill the rest of a 900 px window under the ten tiles. */
const CHART_HEIGHT = 320;

/** The department's intro, on its first tab while guidance is on (UX plan §7.10). */
export const FINANCE_EXPLAINER = {
  screenId: "finance/overview",
  purpose: "Where the money is and how long it lasts.",
  action: "Connect a bank or Stripe in Settings so the tiles measure instead of estimate; the Runway tab lets you try a forecast.",
  watchFor: "Numbers marked Estimate are worked out, not measured.",
} as const;

export interface OverviewMetric extends MetricTileProps {
  key: MetricKey;
}

/**
 * A tile's label as a founder first meets it: the defined word becomes a `Term` (dotted while guidance is on) and the
 * rest of the label stays plain ("Gross burn (spending per month)", "Monthly recurring revenue (MRR)").
 */
export function MetricLabel({ metric }: { metric: MetricKey }) {
  const { label, term } = METRIC_DEFINITIONS[metric];
  if (!term) return <>{label}</>;
  const open = label.indexOf(" (");
  if (open < 0) return <Term id={term}>{label}</Term>;
  return (
    <>
      <Term id={term}>{label.slice(0, open)}</Term>
      {label.slice(open)}
    </>
  );
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
  // Payback divides by the whole paying base of the revenue window (everyone who had paid by its end and had not
  // churned), never by the customers newly acquired (acquisition cost's denominator): MRR comes from all of them, so
  // gross profit per customer must too.
  const payingCustomers = overview.payingCustomers?.count ?? 0;
  const payback = paybackMonths(cpa, mrr, gm, payingCustomers);
  const fcRunway = forecastRunway(overview, now);
  const asOf = overview.cash.asOf ?? undefined;
  const bank = `${overview.cash.accounts} connected account${overview.cash.accounts === 1 ? "" : "s"}`;
  const pnlSource = pnlLabelWords(pnl?.label);
  const prov = (key: MetricKey, source: string, query?: string, extra?: string): MetricProvenance => ({ source, asOf, query, note: extra ? `${METRIC_DEFINITIONS[key].definition} ${extra}` : METRIC_DEFINITIONS[key].definition });

  const perChannel = channels?.channels
    .filter((c) => c.form && c.form.customers > 0)
    .map((c) => ({ label: c.meta?.label ?? c.channelKey, cpa: Math.round(c.form!.spendMinor / c.form!.customers) }))
    .sort((a, b) => a.cpa - b.cpa)
    .slice(0, 4);
  const perChannelText = perChannel && perChannel.length ? `Per channel: ${perChannel.map((c) => `${c.label} ${fmtMoney(c.cpa, currency, { compact: true })}`).join(", ")}.` : undefined;
  // A balance below zero has no runway to count: the words stand in for the figure and keep the Estimate tag
  // (@foundmill/widgets/shared/runway, the one wording every screen shares).
  const runwayMonths = runwayFigure(overview);
  const runwayStandIn = runwayWords(overview);

  const tiles: OverviewMetric[] = [
    { key: "cash", label: METRIC_DEFINITIONS.cash.label, value: { amountMinor: overview.cash.amountMinor, currency }, spark: cashHistory(overview.cash.amountMinor, monthly, months), provenance: prov("cash", `Bank balances, ${bank}`, "finance.overview.cash"), caption: bank },
    { key: "grossBurn", label: METRIC_DEFINITIONS.grossBurn.label, value: { amountMinor: overview.burn.grossBurnMinor, currency }, estimate: "estimate", spark: monthlySeries(monthly, months, operatingOutflow), provenance: prov("grossBurn", "Bank transactions, operating outflows", "finance.overview.burn.grossBurnMinor"), caption: `per month, ${overview.burn.months}-month average` },
    { key: "netBurn", label: METRIC_DEFINITIONS.netBurn.label, value: { amountMinor: overview.burn.netBurnMinor, currency }, estimate: "estimate", delta: undefined, spark: monthlySeries(monthly, months, operatingBurn), provenance: prov("netBurn", "Bank transactions, financing and transfers excluded", "finance.overview.burn.netBurnMinor"), caption: overview.burn.netBurnMinor <= 0 ? "Cash-flow positive" : `per month, ${overview.burn.months}-month average` },
    { key: "runway", label: METRIC_DEFINITIONS.runway.label, value: runwayMonths === null ? (runwayStandIn?.value ?? "—") : `${runwayMonths}`, unit: runwayMonths === null ? undefined : "mo", estimate: runwayMonths === null ? (runwayStandIn?.estimate ? "estimate" : undefined) : "estimate", provenance: prov("runway", "Cash ÷ net burn", "finance.overview.runway", fcRunway !== null ? `Base forecast: ${fmtMonths(fcRunway)}.` : undefined), caption: runwayMonths === null ? (runwayStandIn?.caption ?? "Appears once net burn is measured") : fcRunway !== null ? `Forecast: ${fmtMonths(fcRunway)}` : runwayWord(runwayMonths) },
    { key: "revenue", label: METRIC_DEFINITIONS.revenue.label, value: { amountMinor: revenue, currency }, estimate: pnl?.source === "ledger" ? undefined : "estimate", spark: monthlySeries(monthly, months, operatingInflow), provenance: prov("revenue", pnlSource, "finance.pnl.categories[revenue]"), caption: `trailing ${TRAILING} months` },
    { key: "mrr", label: METRIC_DEFINITIONS.mrr.label, value: { amountMinor: mrr, currency }, estimate: "estimate", provenance: prov("mrr", pnlSource, `revenue ÷ ${TRAILING}`), caption: "per month" },
    { key: "arr", label: METRIC_DEFINITIONS.arr.label, value: { amountMinor: mrr * 12, currency }, estimate: "estimate", provenance: prov("arr", pnlSource, "MRR × 12"), caption: "annualized" },
    { key: "grossMargin", label: METRIC_DEFINITIONS.grossMargin.label, value: gm === null ? "—" : gm / 100, format: "percent", estimate: gm === null ? undefined : "estimate", provenance: prov("grossMargin", pnlSource, "(revenue − cost of sales) ÷ revenue"), caption: gm === null ? "Appears with the first revenue" : `trailing ${TRAILING} months` },
    { key: "acquisitionCost", label: METRIC_DEFINITIONS.acquisitionCost.label, value: cpa === null ? "—" : { amountMinor: cpa, currency }, estimate: cpa === null ? undefined : "estimate", provenance: prov("acquisitionCost", "Distribution board, channel spend and customers", "spend ÷ new customers", perChannelText), caption: blended ? `${blended.customers} customer${blended.customers === 1 ? "" : "s"}, ${blended.days} days` : "Appears once a channel spends" },
    { key: "payback", label: METRIC_DEFINITIONS.payback.label, value: payback === null ? "—" : `${payback}`, unit: payback === null ? undefined : "mo", estimate: payback === null ? undefined : "estimate", provenance: prov("payback", "Acquisition cost, and gross profit per paying customer (every customer who had paid by the end of the revenue window and had not churned)", "CPA ÷ (MRR × gross margin ÷ paying customers)"), caption: payback === null ? "Appears with acquisition cost, margin and paying customers" : `${formatNumber(payingCustomers)} paying customer${payingCustomers === 1 ? "" : "s"}` },
  ];
  // The plain line under each figure while guidance is on (PlainFigure): the definitions map's sentence for a defined
  // metric, the definition's own plain half for the rest.
  return tiles.map((t) => {
    const term = METRIC_DEFINITIONS[t.key].term;
    return term ? { ...t, metricId: term } : { ...t, plain: plainLine(t.key) };
  });
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
  const datePrefs = useDateFormat();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const range = useMemo(() => ({ from: monthStart(now, -TRAILING).toISOString(), to: monthStart(now, 0).toISOString() }), [now]);
  const overview = useWidgetQuery<FinanceOverview>("finance.overview", {});
  // Pin to Home (audit #394): the Cash panel is the gallery's Cash and runway widget.
  const pinMenu = usePinToHomeMenu({ key: "cash_runway" });
  const pnl = useWidgetQuery<PnlResponse>("finance.pnl", range);
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});

  const data = overview.data;
  const tiles = useMemo(() => (data ? overviewTiles({ overview: data, pnl: pnl.data, channels: channels.data, currency, now }) : null), [data, pnl.data, channels.data, currency, now]);
  const months = useMemo(() => trailingMonths(now, HISTORY), [now]);
  const cur = data?.cash.currency || currency;
  const hasData = !!data && (data.cash.accounts > 0 || (data.revenue.monthly?.length ?? 0) > 0);
  // The one plain sentence above the tiles, from the same figures the tiles show (UX plan §7.14).
  const summary = data && hasData ? financeSummarySentence({ cashMinor: data.cash.amountMinor, accounts: data.cash.accounts, netBurnMinor: data.burn.netBurnMinor, runwayMonths: data.runway.months, currency: cur }) : null;

  const cashSeries = useMemo(() => {
    if (!data) return [];
    const history = cashHistory(data.cash.amountMinor, data.revenue.monthly ?? [], months);
    const actual = months.map((m, i) => ({ x: new Date(`${m}-01T00:00:00.000Z`), y: history[i] ?? 0 }));
    // The Base forecast as the Runway tab draws it: its drivers projected over its own months (one computation).
    const fallback = seedDrivers("base", { cashMinor: data.cash.amountMinor, mrrMinor: 0, grossBurnMinor: data.burn.grossBurnMinor });
    const base = storedProjection(data.forecasts?.base as { drivers?: unknown; series?: unknown[] } | null | undefined, fallback, monthKey(now))?.series ?? [];
    const forecast = base.slice(0, 12).map((p) => ({ x: new Date(`${p.month}-01T00:00:00.000Z`), y: p.cashMinor }));
    const series: LineSeries[] = [{ id: "cash", label: "Cash in bank", tone: "kit", data: actual, area: true }];
    if (forecast.length) series.push({ id: "base", label: "Base forecast", tone: "secondary", data: forecast, dashed: true });
    return series;
  }, [data, months, now]);

  const flow = useMemo(() => {
    if (!data) return [];
    const monthly = data.revenue.monthly ?? [];
    return months.map((m) => {
      const row = monthly.find((x) => x.month === m);
      const net = row ? row.netMinor : 0;
      return { label: formatMonth(m, datePrefs), value: net, tone: net >= 0 ? ("good" as const) : ("bad" as const) };
    });
  }, [data, months, datePrefs]);

  const openInbox = () => navigate(routes.inbox(businessId));

  // The months the warning judges: a balance below zero has none (the tile says "Cash is below zero").
  const warningMonths = data ? runwayFigure(data) : null;

  return (
    <Screen name="finance/overview">
      {data ? <RunwayWarning months={warningMonths} warnings={data.runway.warnings?.length ? data.runway.warnings : runwayWarnings(warningMonths)} blocksContinue={data.runway.blocksContinue} onOpenInbox={openInbox} /> : null}
      <section aria-label="Finance metrics" aria-busy={overview.isLoading || undefined} className="col-span-12">
        {overview.error ? (
          <ErrorState onRetry={overview.refetch} detail={overview.error.message}>
            The finance overview could not be loaded.
          </ErrorState>
        ) : data && !hasData ? (
          <>
            <Explainer {...FINANCE_EXPLAINER} className="mb-3" />
            <EmptyState icon={Landmark} title="No bank or revenue data yet" action={{ label: "Connect a bank", icon: Landmark, onClick: () => navigate(routes.settings(businessId, "integrations")) }}>
              Connect a bank account (Tink or Plaid) or Stripe and the tiles fill with cash, burn, runway and revenue.
            </EmptyState>
          </>
        ) : (
          <>
            {/* The department's intro while guidance is on, then the one plain sentence the tiles add up to (UX plan §7.14). */}
            <Explainer {...FINANCE_EXPLAINER} className="mb-3" />
            {summary ? (
              <p className="mb-2 max-w-reading text-body text-primary" data-testid="finance-summary">
                {summary}
              </p>
            ) : null}
            <div role="list" className="grid grid-cols-5 gap-px overflow-hidden rounded-panel border border-subtle bg-subtle">
              {tiles
                ? tiles.map(({ key, ...tile }) => <MetricTile key={key} role="listitem" data-metric={key} {...tile} label={<MetricLabel metric={key} />} />)
                : (Object.keys(METRIC_DEFINITIONS) as MetricKey[]).map((key) => <MetricTile key={`loading-${key}`} role="listitem" label={METRIC_DEFINITIONS[key].label} value={null} loading />)}
            </div>
          </>
        )}
      </section>
      <Panel
        title="Cash"
        menu={pinMenu}
        meta={<>last {HISTORY} months and the Base <Term id="forecast" always>forecast</Term></>}
        span={8}
        loading={overview.isLoading}
        error={overview.error ? overview.error.message : undefined}
        onRetry={overview.refetch}
        actions={cashSeries.length > 1 ? <ProvenanceChip kind="forecast" /> : undefined}
        empty={data && !hasData ? "Cash history appears once a bank account is connected." : undefined}
        footer={<span>Actuals from bank balances walked back through monthly net cash; the dashed line is the Base forecast.</span>}
      >
        {cashSeries.length ? <LineChart label="Cash history and Base forecast" series={cashSeries} height={CHART_HEIGHT} yFormat={(v) => fmtAxisMoney(v, cur)} zeroBased={false} markX={monthStart(now, 0)} markLabel="This month" /> : null}
      </Panel>
      <Panel
        title="Net cash change"
        meta="by month"
        span={4}
        loading={overview.isLoading}
        error={overview.error ? overview.error.message : undefined}
        onRetry={overview.refetch}
        actions={flow.length ? <ProvenanceChip kind="estimate" /> : undefined}
        empty={data && !hasData ? "Monthly inflows and outflows appear once transactions sync." : undefined}
        footer={<span>{pnlLabelWords(pnl.data?.label)}</span>}
      >
        {flow.length ? <BarChart label="Net cash change by month" data={flow} height={CHART_HEIGHT} format={(v) => fmtAxisMoney(v, cur)} showValues /> : null}
      </Panel>
    </Screen>
  );
}
