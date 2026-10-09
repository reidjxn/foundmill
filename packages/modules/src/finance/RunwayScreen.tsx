"use client";
/**
 * Finance › Runway (BUILD §11.8): the driver-based forecast in Base, Upside and Downside scenarios, every value
 * captioned Forecast; drivers are edited here and saved as a new forecast version through `finance.forecast.update`
 * (which also raises the runway threshold events); warnings at 12, 9 and 6 months, red and blocking under 3.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Inbox, Save, TrendingUp, Undo2 } from "lucide-react";
import { Button, Chip, Field, Input, KeyValueList, LineChart, Panel, ProvenanceChip, StatusPill, type LineSeries, type SeriesTone } from "@foundmill/dugout";
import { routes, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { FORECAST_SCENARIOS, type FinanceOverview, type ForecastDrivers, type ForecastRow, type ForecastScenario, type PnlResponse } from "./types";
import { RUNWAY_BLOCK_MONTHS, formatMonth, monthKey, monthStart, pnlTotals, projectForecast, readDrivers, runwayTone, runwayWarnings, runwayWord, seedDrivers } from "./metrics";
import { InlineError, Screen, fmtMoney, fmtMonths, toDate, useAction, useCurrency, useNow } from "./shared";

export const SCENARIO_META: Record<ForecastScenario, { label: string; tone: SeriesTone; hint: string }> = {
  base: { label: "Base", tone: "kit", hint: "What the plan says: current MRR, 5 % monthly growth, costs up 1 % a month." },
  upside: { label: "Upside", tone: "good", hint: "Distribution lands: 10 % monthly growth on the same cost line." },
  downside: { label: "Downside", tone: "bad", hint: "Flat revenue and costs creeping up 2 % a month." },
};

export const DRIVER_FIELDS: readonly { key: keyof ForecastDrivers; label: string; kind: "money" | "percent" | "months"; hint: string }[] = [
  { key: "startingCashMinor", label: "Starting cash", kind: "money", hint: "Cash in bank today" },
  { key: "monthlyRevenueMinor", label: "Monthly revenue", kind: "money", hint: "Cash-basis revenue this month" },
  { key: "revenueGrowthPct", label: "Revenue growth", kind: "percent", hint: "% month on month" },
  { key: "monthlyCostsMinor", label: "Monthly costs", kind: "money", hint: "Gross burn this month" },
  { key: "costGrowthPct", label: "Cost growth", kind: "percent", hint: "% month on month" },
  { key: "horizonMonths", label: "Horizon", kind: "months", hint: "Months projected (1–60)" },
];

/** Latest stored forecast per scenario (the list is ordered scenario asc, createdAt desc). */
export function latestByScenario(rows: readonly ForecastRow[] | undefined): Partial<Record<ForecastScenario, ForecastRow>> {
  const out: Partial<Record<ForecastScenario, ForecastRow>> = {};
  for (const r of rows ?? []) {
    const s = r.scenario as ForecastScenario;
    if (!FORECAST_SCENARIOS.includes(s) || r.archivedAt) continue;
    const prev = out[s];
    if (!prev || prev.createdAt < r.createdAt) out[s] = r;
  }
  return out;
}

function toField(d: ForecastDrivers, key: keyof ForecastDrivers, kind: "money" | "percent" | "months"): string {
  const v = d[key];
  if (typeof v !== "number") return "";
  return kind === "money" ? (v / 100).toFixed(0) : String(v);
}

function fromField(raw: string, kind: "money" | "percent" | "months", prev: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return prev;
  return kind === "money" ? Math.round(n * 100) : n;
}

export function RunwayScreen({ businessId }: ModuleScreenProps) {
  const now = useNow();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const id = useId();
  const action = useAction();
  const list = useWidgetQuery<ForecastRow[]>("finance.forecast.list", {});
  const overview = useWidgetQuery<FinanceOverview>("finance.overview", {});
  const range = useMemo(() => ({ from: monthStart(now, -3).toISOString(), to: monthStart(now, 0).toISOString() }), [now]);
  const pnl = useWidgetQuery<PnlResponse>("finance.pnl", range);
  const thisMonth = monthKey(now);
  const cur = overview.data?.cash.currency || currency;

  const seeds = useMemo(() => {
    const o = overview.data;
    const revenue = pnl.data ? pnlTotals(pnl.data.categories).revenueMinor : 0;
    return { cashMinor: o?.cash.amountMinor ?? 0, mrrMinor: Math.round(revenue / 3), grossBurnMinor: o?.burn.grossBurnMinor ?? 0 };
  }, [overview.data, pnl.data]);
  const stored = useMemo(() => latestByScenario(list.data), [list.data]);
  const storedDrivers = useMemo(() => Object.fromEntries(FORECAST_SCENARIOS.map((s) => [s, readDrivers(stored[s]?.drivers, seedDrivers(s, seeds))])) as Record<ForecastScenario, ForecastDrivers>, [stored, seeds]);

  const [drafts, setDrafts] = useState<Record<ForecastScenario, ForecastDrivers>>(storedDrivers);
  const [dirty, setDirty] = useState<Set<ForecastScenario>>(new Set());
  const [scenario, setScenario] = useState<ForecastScenario>("base");
  useEffect(() => {
    // Stored or seeded drivers replace drafts the founder has not touched.
    setDrafts((d) => Object.fromEntries(FORECAST_SCENARIOS.map((s) => [s, dirty.has(s) ? d[s] : storedDrivers[s]])) as Record<ForecastScenario, ForecastDrivers>);
  }, [storedDrivers, dirty]);

  const projections = useMemo(() => Object.fromEntries(FORECAST_SCENARIOS.map((s) => [s, projectForecast(drafts[s], thisMonth)])) as Record<ForecastScenario, ReturnType<typeof projectForecast>>, [drafts, thisMonth]);
  const series = useMemo<LineSeries[]>(
    () => FORECAST_SCENARIOS.map((s) => ({ id: s, label: `${SCENARIO_META[s].label} cash`, tone: SCENARIO_META[s].tone, dashed: true, area: s === "base", data: projections[s].series.map((p) => ({ x: new Date(`${p.month}-01T00:00:00.000Z`), y: p.cashMinor })) })),
    [projections],
  );
  const base = projections.base;
  const blocks = base.runwayMonths !== null && base.runwayMonths < RUNWAY_BLOCK_MONTHS;
  const loading = list.isLoading || overview.isLoading;
  const error = list.error ?? overview.error;
  const noForecasts = list.data && Object.keys(stored).length === 0;

  const setDriver = (key: keyof ForecastDrivers, value: number) => {
    setDrafts((d) => ({ ...d, [scenario]: { ...d[scenario], [key]: key === "horizonMonths" ? Math.max(1, Math.min(60, Math.round(value))) : value } }));
    setDirty((s) => new Set(s).add(scenario));
  };
  const reset = () => {
    setDrafts((d) => ({ ...d, [scenario]: storedDrivers[scenario] }));
    setDirty((s) => {
      const n = new Set(s);
      n.delete(scenario);
      return n;
    });
  };
  const save = async (s: ForecastScenario) => {
    const projection = projections[s];
    const drivers = { ...drafts[s], runway_months: projection.runwayMonths };
    const result = await action.run("finance.forecast.update", { scenario: s, currency: cur, drivers, series: projection.series }, { key: `save-${s}` });
    if (result !== undefined) {
      setDirty((set) => {
        const n = new Set(set);
        n.delete(s);
        return n;
      });
      list.refetch();
    }
  };

  const draft = drafts[scenario];
  const summary = (s: ForecastScenario) => {
    const p = projections[s];
    const last = p.series.at(-1);
    return [
      { label: "Runway", value: <span className="flex items-center gap-1 tabular-nums">{p.runwayMonths === null ? `> ${drafts[s].horizonMonths} mo` : fmtMonths(p.runwayMonths)} <ProvenanceChip kind="forecast" /></span>, numeric: true },
      { label: "Cash out", value: p.zeroMonth ? formatMonth(p.zeroMonth) : "Not within horizon", numeric: true },
      { label: `Cash in ${last ? formatMonth(last.month) : "—"}`, value: fmtMoney(last?.cashMinor ?? null, cur, { compact: true }), numeric: true },
    ];
  };

  return (
    <Screen name="finance/runway">
      <Panel
        title="Cash forecast"
        span={8}
        loading={loading}
        error={error ? error.message : undefined}
        onRetry={() => {
          list.refetch();
          overview.refetch();
        }}
        actions={<ProvenanceChip kind="forecast" />}
        footer={<span>{noForecasts ? "No forecast saved yet: the lines show drivers seeded from today's cash, MRR and gross burn. Save a scenario to keep it." : `Latest versions: ${FORECAST_SCENARIOS.map((s) => `${SCENARIO_META[s].label} ${stored[s] ? (toDate(stored[s]!.createdAt)?.toISOString().slice(0, 10) ?? "unsaved") : "unsaved"}`).join(" · ")}.`} Every value is a forecast, not a measurement.</span>}
      >
        <LineChart label="Cash forecast by scenario" series={series} height={260} yFormat={(v) => fmtMoney(v, cur, { compact: true })} provenance="forecast" zeroBased={false} markX={monthStart(now, 0)} markLabel="Now" />
      </Panel>
      <Panel title="Runway warnings" span={4} loading={loading} error={error ? error.message : undefined} footer={<span>Warnings at 12, 9 and 6 months; under {RUNWAY_BLOCK_MONTHS} months is red and blocks Continue until acknowledged in the Inbox.</span>}>
        <ul className="flex flex-col gap-3" aria-label="Runway by scenario">
          {FORECAST_SCENARIOS.map((s) => {
            const months = projections[s].runwayMonths;
            const tone = runwayTone(months ?? Number.POSITIVE_INFINITY);
            const crossed = runwayWarnings(months);
            return (
              <li key={s} className="flex flex-col gap-1" data-scenario={s}>
                <div className="flex items-center gap-2">
                  <Chip tone={s === "base" ? "kit" : s === "upside" ? "good" : "bad"}>{SCENARIO_META[s].label}</Chip>
                  <StatusPill tone={tone === "neutral" ? "good" : tone} icon={tone === "good" ? TrendingUp : AlertTriangle}>
                    {months === null ? `Beyond ${drafts[s].horizonMonths} months` : runwayWord(months)}
                  </StatusPill>
                  {dirty.has(s) ? <span className="text-small text-secondary">unsaved changes</span> : !stored[s] ? <span className="text-small text-secondary">not saved yet</span> : null}
                </div>
                <KeyValueList dense items={summary(s)} labelClassName="w-28" />
                {crossed.length ? <span className="text-small text-secondary">Below the {crossed.join(", ")}-month threshold{crossed.length > 1 ? "s" : ""}.</span> : null}
              </li>
            );
          })}
        </ul>
        {blocks ? (
          <div role="status" className="mt-3 flex items-center gap-2 rounded-panel border border-status-bad/40 bg-status-bad/12 px-2 py-1.5">
            <span className="text-small text-primary">Base runway is under {RUNWAY_BLOCK_MONTHS} months: Continue is blocked until the warning is acknowledged.</span>
            <Button size="sm" variant="danger" icon={Inbox} className="ml-auto" onClick={() => navigate(routes.inbox(businessId))}>
              Open Inbox
            </Button>
          </div>
        ) : null}
      </Panel>
      <Panel
        title="Drivers"
        span={12}
        loading={loading}
        actions={
          <div role="group" aria-label="Scenario" className="flex items-center gap-1">
            {FORECAST_SCENARIOS.map((s) => (
              <Chip key={s} tone={scenario === s ? "kit" : "neutral"} selected={scenario === s} onClick={() => setScenario(s)} title={SCENARIO_META[s].hint}>
                {SCENARIO_META[s].label}
                {dirty.has(s) ? " •" : ""}
              </Chip>
            ))}
          </div>
        }
        footer={<span>{SCENARIO_META[scenario].hint} Saving creates a new forecast version; the previous one is kept for the audit trail.</span>}
      >
        <form
          className="flex flex-col gap-3"
          aria-label={`${SCENARIO_META[scenario].label} drivers`}
          onSubmit={(e) => {
            e.preventDefault();
            void save(scenario);
          }}
        >
          <div className="grid grid-cols-6 gap-gutter">
            {DRIVER_FIELDS.map((f) => (
              <Field key={f.key} htmlFor={`${id}-${scenario}-${f.key}`} label={f.label} hint={f.hint}>
                <Input id={`${id}-${scenario}-${f.key}`} numeric inputMode="decimal" controlSize="md" value={toField(draft, f.key, f.kind)} suffix={f.kind === "money" ? cur : f.kind === "percent" ? "%" : "months"} onChange={(e) => setDriver(f.key, fromField(e.target.value, f.kind, Number(draft[f.key] ?? 0)))} />
              </Field>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" icon={Save} loading={action.pending === `save-${scenario}`} disabled={!dirty.has(scenario) && !!stored[scenario]}>
              Save {SCENARIO_META[scenario].label} forecast
            </Button>
            <Button type="button" variant="ghost" icon={Undo2} disabled={!dirty.has(scenario)} onClick={reset}>
              Reset
            </Button>
            <span className="text-small text-secondary tabular-nums">
              {SCENARIO_META[scenario].label} runway with these drivers: {projections[scenario].runwayMonths === null ? `beyond ${draft.horizonMonths} months` : fmtMonths(projections[scenario].runwayMonths)}
            </span>
            <InlineError error={action.error} className="ml-auto" />
          </div>
        </form>
      </Panel>
    </Screen>
  );
}
