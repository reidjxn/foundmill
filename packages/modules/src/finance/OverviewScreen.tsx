"use client";
/**
 * Finance › Overview (BUILD §11.8): the ten metric tiles with hover-visible definitions, provenance and sparklines,
 * runway warnings at 12/9/6 months (red and blocking under 3), cash history against the Base forecast, and monthly
 * money in and out. Read-only: nothing here can move money.
 */
import { useMemo } from "react";
import { AlertTriangle, ChevronRight, Inbox, Landmark } from "lucide-react";
import { BarChart, Button, EmptyState, ErrorState, Explainer, LineChart, MetricTile, Panel, ProvenanceChip, StatusPill, Term, formatNumber, useDateFormat, type DateFormatPrefs, type LineSeries, type MetricTileProps, type MetricProvenance } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import {
  METRIC_DEFINITIONS,
  acquisitionCost,
  metricWords,
  cashHistory,
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
import { emptyWhy } from "@foundmill/shared/empty-why";
import { MONTHLY_REVENUE_MONTHS, monthlyRevenueMinor, monthlyRevenueWindow } from "@foundmill/shared/monthly-revenue";

const TRAILING = MONTHLY_REVENUE_MONTHS;
const HISTORY = 6;
/** What the Overview opens on (Nov 7, 2026, one number per fact): cash, monthly spend and months left; the rest sit behind "More numbers". */
export const HEADLINE_METRICS: readonly MetricKey[] = ["cash", "netBurn", "runway"];

/**
 * The one sentence that says which figures are estimates (Nov 7, 2026: "Estimate" once per screen, in words, not a
 * chip on every tile). Null when every figure is measured.
 */
export function estimateSentence(tiles: readonly { key: MetricKey; estimate?: unknown }[], recurring: boolean | null | undefined = true): string | null {
  const labels = tiles.filter((t) => t.estimate).map((t) => metricWords(t.key, recurring).label.replace(/\s*\(.*\)$/, "").toLowerCase());
  if (!labels.length) return null;
  const list = labels.length === 1 ? labels[0]! : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return `Estimate: ${list} ${labels.length === 1 ? "is" : "are"} worked out, not measured.`;
}
/** Charts fill the rest of a 900 px window under the ten tiles. */
const CHART_HEIGHT = 320;

/**
 * The full months a trailing figure covers, in the person's date format: "Aug – Oct 2026" (a shared year said once),
 * "Nov 2025 – Jan 2026", or "2026-08 – 2026-10" in ISO. The revenue and the monthly figure name the same months, so
 * "£76K" and "£25K a month" read as one fact.
 */
export function monthRangeWords(months: readonly string[], prefs?: DateFormatPrefs | null): string {
  const first = months[0];
  const last = months.at(-1);
  if (!first || !last) return "";
  const a = formatMonth(first, prefs);
  const b = formatMonth(last, prefs);
  if (first === last) return b;
  const year = / \d{4}$/.exec(b)?.[0];
  return year && a.endsWith(year) ? `${a.slice(0, -year.length)} – ${b}` : `${a} – ${b}`;
}

/** The department's intro, on its first tab while guidance is on (UX plan §7.10). */
export const FINANCE_EXPLAINER = {
  screenId: "finance/overview",
  purpose: "Where the money is and how long it lasts.",
  action: "Connect a bank or Stripe in Settings so the tiles measure instead of estimate; the Runway tab lets you try a forecast.",
  watchFor: "The line under the numbers says which are estimates: worked out, not measured.",
} as const;

export interface OverviewMetric extends MetricTileProps {
  key: MetricKey;
}

/**
 * A tile's label as a founder first meets it: the defined word becomes a `Term` (dotted while guidance is on) and the
 * rest of the label stays plain ("Gross burn (spending per month)", "Monthly recurring revenue (MRR)").
 */
export function MetricLabel({ metric, recurring }: { metric: MetricKey; recurring?: boolean | null }) {
  const { label, term } = metricWords(metric, recurring);
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
export function overviewTiles(args: { overview: FinanceOverview; pnl: PnlResponse | undefined; channels: ChannelsListResponse | undefined; currency: string; now: Date; datePrefs?: DateFormatPrefs | null }): OverviewMetric[] {
  const { overview, pnl, channels, now } = args;
  const currency = overview.cash.currency || args.currency;
  const months = trailingMonths(now, HISTORY);
  const monthly = overview.revenue.monthly ?? [];
  const totals = pnl ? pnlTotals(pnl.categories) : null;
  const revenue = totals?.revenueMinor ?? 0;
  // The one monthly figure (@foundmill/shared/monthly-revenue): the revenue milestones count the same.
  const mrr = monthlyRevenueMinor(revenue, TRAILING);
  // A business whose customers buy once has no recurring revenue: its monthly figure is the average month (finance.overview `revenue.recurring`).
  const recurring = overview.revenue.recurring;
  const revenueWindow = monthRangeWords(trailingMonths(now, TRAILING), args.datePrefs);
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
  const prov = (key: MetricKey, source: string, query?: string, extra?: string): MetricProvenance => ({ source, asOf, query, note: extra ? `${metricWords(key, recurring).definition} ${extra}` : metricWords(key, recurring).definition });

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
    { key: "revenue", label: METRIC_DEFINITIONS.revenue.label, value: { amountMinor: revenue, currency }, estimate: pnl?.source === "ledger" ? undefined : "estimate", spark: monthlySeries(monthly, months, operatingInflow), provenance: prov("revenue", pnlSource, "finance.pnl.categories[revenue]"), caption: `${revenueWindow}, ${TRAILING} full months` },
    { key: "mrr", label: metricWords("mrr", recurring).label, value: { amountMinor: mrr, currency }, estimate: "estimate", provenance: prov("mrr", pnlSource, `revenue ÷ ${TRAILING}`), caption: `a month: the ${revenueWindow} revenue ÷ ${TRAILING}` },
    { key: "arr", label: metricWords("arr", recurring).label, value: { amountMinor: mrr * 12, currency }, estimate: "estimate", provenance: prov("arr", pnlSource, recurring === false ? "average monthly revenue × 12" : "MRR × 12"), caption: "annualized" },
    { key: "grossMargin", label: METRIC_DEFINITIONS.grossMargin.label, value: gm === null ? "—" : gm / 100, format: "percent", estimate: gm === null ? undefined : "estimate", provenance: prov("grossMargin", pnlSource, "(revenue − cost of sales) ÷ revenue"), caption: gm === null ? "Appears with the first revenue" : `trailing ${TRAILING} months` },
    { key: "acquisitionCost", label: METRIC_DEFINITIONS.acquisitionCost.label, value: cpa === null ? "—" : { amountMinor: cpa, currency }, estimate: cpa === null ? undefined : "estimate", provenance: prov("acquisitionCost", "Distribution board, channel spend and customers", "spend ÷ new customers", perChannelText), caption: blended ? `${blended.customers} customer${blended.customers === 1 ? "" : "s"}, ${blended.days} days` : "Appears once a channel spends" },
    { key: "payback", label: METRIC_DEFINITIONS.payback.label, value: payback === null ? "—" : `${payback}`, unit: payback === null ? undefined : "mo", estimate: payback === null ? undefined : "estimate", provenance: prov("payback", "Acquisition cost, and gross profit per paying customer (every customer who had paid by the end of the revenue window and had not churned)", "cost to win a customer ÷ (MRR × gross margin ÷ paying customers)"), caption: payback === null ? "Appears with acquisition cost, margin and paying customers" : `${formatNumber(payingCustomers)} paying customer${payingCustomers === 1 ? "" : "s"}` },
  ];
  // The plain line under each figure while guidance is on (PlainFigure): the definitions map's sentence for a defined
  // metric, the definition's own plain half for the rest.
  return tiles.map((t) => {
    const term = metricWords(t.key, recurring).term;
    return term ? { ...t, metricId: term } : { ...t, plain: plainLine(t.key, recurring) };
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
          ? `Runway is under ${RUNWAY_BLOCK_MONTHS} months. The finance lead has drafted options in the Inbox.`
          : `Runway is ${fmtMonths(months)}, under the ${lowest}-month threshold. The finance lead has drafted options in the Inbox.`}
      </span>
      <Button size="sm" variant="default" icon={Inbox} className="ml-auto" onClick={onOpenInbox}>
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
  // The monthly figure's window (@foundmill/shared/monthly-revenue): the revenue milestones read the same months.
  const range = useMemo(() => {
    const w = monthlyRevenueWindow(now);
    return { from: w.from.toISOString(), to: w.to.toISOString() };
  }, [now]);
  const overview = useWidgetQuery<FinanceOverview>("finance.overview", {});
  // Pin to Home (audit #394): the Cash panel is the gallery's Cash and runway widget.
  const pinMenu = usePinToHomeMenu({ key: "cash_runway" });
  const pnl = useWidgetQuery<PnlResponse>("finance.pnl", range);
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {});

  const data = overview.data;
  const tiles = useMemo(() => (data ? overviewTiles({ overview: data, pnl: pnl.data, channels: channels.data, currency, now, datePrefs }) : null), [data, pnl.data, channels.data, currency, now, datePrefs]);
  const months = useMemo(() => trailingMonths(now, HISTORY), [now]);
  const cur = data?.cash.currency || currency;
  const hasData = !!data && (data.cash.accounts > 0 || (data.revenue.monthly?.length ?? 0) > 0);

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
  const allKeys = Object.keys(METRIC_DEFINITIONS) as MetricKey[];
  const headline = allKeys.filter((k) => HEADLINE_METRICS.includes(k));
  const more = allKeys.filter((k) => !HEADLINE_METRICS.includes(k));
  const estimates = tiles ? estimateSentence(tiles, data?.revenue.recurring) : null;
  const renderTile = (key: MetricKey) => {
    const tile = tiles?.find((t) => t.key === key);
    if (!tile) return <MetricTile key={`loading-${key}`} role="listitem" label={metricWords(key, data?.revenue.recurring).label} value={null} loading />;
    const { key: _key, estimate: _estimate, ...rest } = tile;
    return <MetricTile key={key} role="listitem" data-metric={key} {...rest} label={<MetricLabel metric={key} recurring={data?.revenue.recurring} />} />;
  };

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
            <EmptyState icon={Landmark} title={emptyWhy("bank").title} action={{ label: "Connect a bank", icon: Landmark, onClick: () => navigate(routes.settings(businessId, "integrations")) }}>
              {emptyWhy("bank").text}
            </EmptyState>
          </>
        ) : (
          <>
            {/* The department's intro while guidance is on. The plain sentence the tiles add up to is the Money area's
                opening line above every tab (Nov 9, 2026), so the screen does not repeat it. */}
            <Explainer {...FINANCE_EXPLAINER} className="mb-3" />
            {/* Three numbers first (cash, monthly spend, months left); the rest behind "More numbers". No Estimate chip
                on the tiles: one sentence under them names the figures that are worked out (Nov 7, 2026). */}
            <div role="list" className="grid grid-cols-3 gap-px overflow-hidden rounded-panel border border-subtle bg-subtle" data-testid="finance-headline">
              {headline.map((key) => renderTile(key))}
            </div>
            {estimates ? (
              <p className="mt-2 text-small text-secondary" data-testid="finance-estimate-note">
                {estimates}
              </p>
            ) : null}
            <details className="group/more mt-2" data-testid="finance-more">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-small text-secondary transition-colors duration-hover ease-out hover:text-primary [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} aria-hidden className="transition-transform duration-overlay ease-out group-open/more:rotate-90" />
                More numbers
              </summary>
              <div role="list" className="mt-2 grid grid-cols-4 gap-px overflow-hidden rounded-panel border border-subtle bg-subtle">
                {more.map((key) => renderTile(key))}
              </div>
            </details>
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
        empty={data && !hasData ? emptyWhy("cash_history").text : undefined}
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
        empty={data && !hasData ? emptyWhy("cash_flow").text : undefined}
        footer={<span>{pnlLabelWords(pnl.data?.label)}</span>}
      >
        {flow.length ? <BarChart label="Net cash change by month" data={flow} height={CHART_HEIGHT} format={(v) => fmtAxisMoney(v, cur)} showValues /> : null}
      </Panel>
    </Screen>
  );
}
