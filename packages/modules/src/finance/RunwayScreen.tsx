"use client";
/**
 * Finance › Runway (BUILD §11.8): the driver-based forecast in Base, Upside and Downside scenarios, every value
 * captioned Forecast; drivers are edited here and saved as a new forecast version through `finance.forecast.update`
 * (which also raises the runway threshold events); warnings at 12, 9 and 6 months, red and blocking under 3.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, HelpCircle, Inbox, Save, TrendingUp, Undo2 } from "lucide-react";
import { Button, Chip, Field, Input, KeyValueList, LineChart, MoneyInput, Panel, ProvenanceChip, SegmentedControl, StatusPill, useFormatters, type LineSeries, type SeriesTone } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { FORECAST_SCENARIOS, type FinanceOverview, type ForecastDrivers, type ForecastRow, type ForecastScenario, type PnlResponse } from "./types";
import { runwayWords } from "@foundmill/widgets/shared/runway";
import { RUNWAY_BLOCK_MONTHS, driversHint, forecastStartMonth, formatMonth, monthKey, monthStart, pnlTotals, projectForecast, readDrivers, runwayTone, runwayWarnings, runwayWord, scenarioRunway, seedDrivers, type ScenarioRunway } from "./metrics";
import { InlineError, Screen, fmtAxisMoney, fmtMoney, fmtMonths, parseAmount, toDate, useAction, useCurrency, useNow } from "./shared";

/** What each scenario is for; the figures behind it are the drivers themselves (`driversHint`), never fixed text. */
export const SCENARIO_META: Record<ForecastScenario, { label: string; tone: SeriesTone; hint: string }> = {
  base: { label: "Base", tone: "kit", hint: "What the plan says" },
  upside: { label: "Upside", tone: "good", hint: "Distribution lands" },
  downside: { label: "Downside", tone: "bad", hint: "Things go slower than planned" },
};

/** "Base: what the plan says, revenue up 4% and costs up 2% a month, over 24 months." */
export function scenarioHint(scenario: ForecastScenario, drivers: ForecastDrivers): string {
  return `${SCENARIO_META[scenario].label}: ${SCENARIO_META[scenario].hint.toLowerCase()}, ${driversHint(drivers)}.`;
}

/** The runway in words: the status pill and the Runway figure of one scenario. */
export function runwayText(r: ScenarioRunway): { pill: string; tone: "good" | "warn" | "bad" | "neutral"; figure: string; caption: string | null } {
  switch (r.kind) {
    case "unknown":
      return { pill: "Runway not known yet", tone: "neutral", figure: r.value, caption: r.caption };
    case "months":
      return { pill: runwayWord(r.months), tone: runwayTone(r.months), figure: fmtMonths(r.months), caption: null };
    case "no_limit":
      return { pill: "No limit", tone: "good", figure: "No limit", caption: "Cash-flow positive every month" };
    case "beyond":
      return { pill: "Runway healthy", tone: "good", figure: `Beyond ${r.horizonMonths} months`, caption: null };
  }
}

export const DRIVER_FIELDS: readonly { key: keyof ForecastDrivers; label: string; kind: "money" | "percent" | "months"; hint: string }[] = [
  { key: "startingCashMinor", label: "Starting cash", kind: "money", hint: "Cash in bank today" },
  { key: "monthlyRevenueMinor", label: "Monthly revenue", kind: "money", hint: "Cash-basis revenue this month" },
  { key: "revenueGrowthPct", label: "Revenue growth", kind: "percent", hint: "Month on month" },
  { key: "monthlyCostsMinor", label: "Monthly costs", kind: "money", hint: "Gross burn this month" },
  { key: "costGrowthPct", label: "Cost growth", kind: "percent", hint: "Month on month" },
  { key: "horizonMonths", label: "Horizon", kind: "months", hint: "Projected, 1 to 60" },
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

/** A driver as the field shows it when nobody is typing in it (cents kept: "1500.5", not "1501"). */
export function toField(d: ForecastDrivers, key: keyof ForecastDrivers, kind: "money" | "percent" | "months"): string {
  const v = d[key];
  if (typeof v !== "number") return "";
  return kind === "money" ? String(Math.round(v) / 100) : String(v);
}

/**
 * What a field's text means, or null while it means nothing yet ("", "-", "2." means 2). The field keeps the text
 * itself while it has focus; only this number reaches the drivers, so a keystroke never rewrites what was typed.
 */
export function parseField(raw: string, kind: "money" | "percent" | "months"): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = kind === "money" ? parseAmount(text) : Number(text.replace(/[%\s,]/g, ""));
  if (n === null || !Number.isFinite(n)) return null;
  if (kind === "money") return Math.round(n * 100);
  return kind === "months" ? Math.max(1, Math.min(60, Math.round(n))) : n;
}

type FieldText = Partial<Record<ForecastScenario, Partial<Record<keyof ForecastDrivers, string>>>>;

export function RunwayScreen({ businessId }: ModuleScreenProps) {
  const now = useNow();
  const { prefs: datePrefs, formatDate } = useFormatters();
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
  // Without a bank (or with too little history) there is nothing to seed drivers from: runway is "Not known yet",
  // the same words as Home's status strip, until the founder saves or types a forecast of their own.
  const unknownRunway = useMemo(() => {
    const words = runwayWords(overview.data);
    return words && words.value !== "No limit" ? words : null;
  }, [overview.data]);

  const [drafts, setDrafts] = useState<Record<ForecastScenario, ForecastDrivers>>(storedDrivers);
  const [dirty, setDirty] = useState<Set<ForecastScenario>>(new Set());
  const [typing, setTyping] = useState<FieldText>({});
  const [scenario, setScenario] = useState<ForecastScenario>("base");
  useEffect(() => {
    // Stored or seeded drivers replace drafts the founder has not touched.
    setDrafts((d) => Object.fromEntries(FORECAST_SCENARIOS.map((s) => [s, dirty.has(s) ? d[s] : storedDrivers[s]])) as Record<ForecastScenario, ForecastDrivers>);
  }, [storedDrivers, dirty]);

  // A saved version keeps the months it was projected over (so it reads the same as on the Overview); a draft starts now.
  const projections = useMemo(
    () => Object.fromEntries(FORECAST_SCENARIOS.map((s) => [s, projectForecast(drafts[s], stored[s] && !dirty.has(s) ? forecastStartMonth(stored[s], thisMonth) : thisMonth)])) as Record<ForecastScenario, ReturnType<typeof projectForecast>>,
    [drafts, stored, dirty, thisMonth],
  );
  const runways = useMemo(
    () => Object.fromEntries(FORECAST_SCENARIOS.map((s) => [s, scenarioRunway(projections[s], drafts[s], !stored[s] && !dirty.has(s) ? unknownRunway : null)])) as Record<ForecastScenario, ScenarioRunway>,
    [projections, drafts, stored, dirty, unknownRunway],
  );
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
  const clearTyping = (s: ForecastScenario, key?: keyof ForecastDrivers) =>
    setTyping((t) => {
      if (!key) return { ...t, [s]: {} };
      const next = { ...t[s] };
      delete next[key];
      return { ...t, [s]: next };
    });
  /** The text stays as typed; the driver takes its number as soon as it means one (empty or "-" leaves it alone). */
  const typeDriver = (key: keyof ForecastDrivers, kind: "money" | "percent" | "months", raw: string) => {
    setTyping((t) => ({ ...t, [scenario]: { ...t[scenario], [key]: raw } }));
    const n = parseField(raw, kind);
    if (n !== null) setDriver(key, n);
    else setDirty((s) => new Set(s).add(scenario));
  };
  const reset = () => {
    clearTyping(scenario);
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
      clearTyping(s);
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
    const r = runwayText(runways[s]);
    if (runways[s].kind === "unknown") return [{ label: "Runway", value: <span className="tabular-nums">{r.figure}</span>, numeric: true }];
    return [
      { label: "Runway", value: <span className="flex items-center gap-1 tabular-nums">{r.figure} <ProvenanceChip kind="forecast" /></span>, numeric: true },
      { label: "Cash out", value: p.zeroMonth ? formatMonth(p.zeroMonth, datePrefs) : "Not within horizon", numeric: true },
      { label: last ? `Cash, ${formatMonth(last.month, datePrefs)}` : "Cash at horizon", value: fmtMoney(last?.cashMinor ?? null, cur, { compact: true }), numeric: true },
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
        meta={`${drafts.base.horizonMonths} months`}
        actions={<ProvenanceChip kind="forecast" />}
        footer={<span>{noForecasts ? "No forecast saved yet: the lines show drivers seeded from today's cash, MRR and gross burn. Save a scenario to keep it." : `Latest versions: ${FORECAST_SCENARIOS.map((s) => `${SCENARIO_META[s].label} ${stored[s] ? formatDate(toDate(stored[s]!.createdAt) ?? "") : "not saved"}`).join(" · ")}.`} Every value is a forecast, not a measurement.</span>}
      >
        <LineChart label="Cash forecast by scenario" series={series} height={320} yFormat={(v) => fmtAxisMoney(v, cur)} zeroBased={false} markX={monthStart(now, 0)} markLabel="Now" />
      </Panel>
      <Panel title="Runway warnings" span={4} loading={loading} error={error ? error.message : undefined} footer={<span>Warnings at 12, 9 and 6 months; under {RUNWAY_BLOCK_MONTHS} months is red and blocks Continue until acknowledged in the Inbox.</span>}>
        <ul className="flex flex-col gap-3" aria-label="Runway by scenario">
          {FORECAST_SCENARIOS.map((s) => {
            const months = projections[s].runwayMonths;
            const r = runwayText(runways[s]);
            const tone = r.tone;
            const crossed = runways[s].kind === "months" ? runwayWarnings(months) : [];
            return (
              <li key={s} className="flex flex-col gap-1" data-scenario={s}>
                <div className="flex items-center gap-2">
                  <Chip tone={s === "base" ? "kit" : s === "upside" ? "good" : "bad"}>{SCENARIO_META[s].label}</Chip>
                  <StatusPill tone={tone} icon={tone === "good" ? TrendingUp : tone === "neutral" ? HelpCircle : AlertTriangle} className="whitespace-nowrap">
                    {/* The judgement in words; the Runway row under it carries the figure. */}
                    {r.pill}
                  </StatusPill>
                  {dirty.has(s) ? <span className="text-small text-secondary">unsaved changes</span> : !stored[s] ? <span className="text-small text-secondary">not saved yet</span> : null}
                </div>
                <KeyValueList dense items={summary(s)} labelClassName="w-32" />
                {r.caption ? <span className="text-small text-secondary">{r.caption}</span> : null}
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
          <SegmentedControl<ForecastScenario>
            aria-label="Scenario"
            size="sm"
            value={scenario}
            onValueChange={setScenario}
            options={FORECAST_SCENARIOS.map((s) => ({ value: s, label: dirty.has(s) ? `${SCENARIO_META[s].label} · unsaved` : SCENARIO_META[s].label, title: scenarioHint(s, drafts[s]) }))}
          />
        }
        footer={<span>{scenarioHint(scenario, draft)} Saving creates a new forecast version; the previous one is kept for the audit trail.</span>}
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
                {f.kind === "money" ? (
                  <MoneyInput id={`${id}-${scenario}-${f.key}`} controlSize="lg" currency={cur} value={typing[scenario]?.[f.key] ?? toField(draft, f.key, f.kind)} onValueChange={(raw) => typeDriver(f.key, f.kind, raw)} onBlur={() => clearTyping(scenario, f.key)} />
                ) : (
                  <Input id={`${id}-${scenario}-${f.key}`} inputMode={f.kind === "months" ? "numeric" : "decimal"} controlSize="lg" className="tabular-nums" value={typing[scenario]?.[f.key] ?? toField(draft, f.key, f.kind)} suffix={f.kind === "percent" ? "%" : "months"} onChange={(e) => typeDriver(f.key, f.kind, e.target.value)} onBlur={() => clearTyping(scenario, f.key)} />
                )}
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
              {SCENARIO_META[scenario].label} runway with these drivers: {runwayText(runways[scenario]).figure.replace(/^Beyond/, "beyond")}
            </span>
            <InlineError error={action.error} className="ml-auto" />
          </div>
        </form>
      </Panel>
    </Screen>
  );
}
