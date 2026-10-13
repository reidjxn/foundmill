"use client";
/**
 * Cash and runway widget (BUILD §11.2 gallery, §11.8 metric definitions): cash in bank, net burn (Estimate), runway
 * (Estimate, amber under 9 months, red under 6) and the cash forecast cone (Forecast) or the monthly cash flow.
 */
import { useMemo } from "react";
import { z } from "zod";
import { Landmark } from "lucide-react";
import { LineChart, MetricTile, StatusPill, formatNumber, type LineSeries } from "@foundmill/dugout";
import { minorToMajor } from "@foundmill/shared";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { moduleHref, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import type { FinanceOverview, ForecastRecord, ForecastSeriesPoint } from "../shared/types";

export const CashRunwaySettings = z.object({
  chart: z.enum(["forecast", "monthly"]).default("forecast"),
  months: z.union([z.literal(6), z.literal(12)]).default(12),
});
export type CashRunwaySettings = z.infer<typeof CashRunwaySettings>;

export const RUNWAY_WARN_MONTHS = 9;
export const RUNWAY_BAD_MONTHS = 6;

export function runwayTone(months: number | null): "good" | "warn" | "bad" | "neutral" {
  if (months === null) return "neutral";
  if (months < RUNWAY_BAD_MONTHS) return "bad";
  if (months < RUNWAY_WARN_MONTHS) return "warn";
  return "good";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Forecast cash per scenario as dashed series (one point per month or day the forecast carries). */
export function forecastSeries(forecasts: FinanceOverview["forecasts"] | undefined, currency = "USD"): LineSeries[] {
  const out: LineSeries[] = [];
  const tones = { base: "kit", upside: "good", downside: "warn" } as const;
  for (const scenario of ["downside", "base", "upside"] as const) {
    const rec = forecasts?.[scenario] as ForecastRecord | null | undefined;
    const points = ((rec?.series ?? []) as ForecastSeriesPoint[])
      .map((p) => {
        if (!p || typeof p !== "object") return null;
        const day = typeof p.day === "string" ? p.day : typeof p.month === "string" ? `${p.month}-01` : null;
        const y = num(p.cashMinor) ?? num(p.baseMinor) ?? num(p.revenueMinor);
        return day && y !== null ? { x: new Date(`${day}T00:00:00.000Z`), y: minorToMajor(y, currency) } : null;
      })
      .filter((p): p is { x: Date; y: number } => !!p);
    if (points.length > 1) out.push({ id: scenario, label: scenario[0]!.toUpperCase() + scenario.slice(1), tone: tones[scenario], data: points, dashed: true, area: scenario === "base" });
  }
  return out;
}

/** Monthly net cash flow (inflow − outflow) as one solid series. */
export function monthlySeries(finance: FinanceOverview | undefined, months: number, currency: string = finance?.cash.currency ?? "USD"): LineSeries[] {
  const rows = (finance?.revenue.monthly ?? []).slice(-months);
  if (rows.length < 2) return [];
  return [{ id: "net", label: "Net cash flow", tone: "kit", data: rows.map((m) => ({ x: new Date(`${m.month}-01T00:00:00.000Z`), y: minorToMajor(m.netMinor, currency) })), area: true }];
}

function CashRunwayWidget({ settings }: WidgetProps<CashRunwaySettings>) {
  const { businessId, navigate, currency } = useWidgetData();
  const finance = useWidgetQuery<FinanceOverview>("finance.overview", {});
  const departments = useDepartments();
  useBusinessEvents(() => finance.refetch(), ["bank.balance_updated", "payment.received", "runway.threshold_crossed"]);
  const f = finance.data;
  const cur = f?.cash.currency ?? currency;
  const series = useMemo(() => (settings.chart === "forecast" ? forecastSeries(f?.forecasts, cur) : monthlySeries(f, settings.months, cur)), [settings.chart, settings.months, f, cur]);
  const forecastShown = settings.chart === "forecast" && series.length > 0;
  const runway = f?.runway.months ?? null;
  const tone = runwayTone(runway);
  const open = () => navigate(moduleHref(businessId, departments.data, "finance", "runway") ?? routes.settings(businessId, "integrations"));
  return (
    <WidgetFrame
      title="Cash and runway"
      data-widget="cash_runway"
      queries={[finance]}
      flush
      empty={f && f.cash.accounts === 0 && f.revenue.monthly.length === 0 ? { icon: Landmark, text: "Connect a bank account to see cash, burn and runway.", action: { label: "Open integrations", onClick: () => navigate(routes.settings(businessId, "integrations")) } } : null}
      actions={runway !== null ? <StatusPill tone={tone}>{tone === "bad" ? "Short runway" : tone === "warn" ? "Watch runway" : "Runway fine"}</StatusPill> : null}
      footer={<span>{forecastShown ? "Cone: driver-based forecast, Base/Upside/Downside" : "Net burn is a trailing 3-month average; financing excluded"}</span>}
    >
      {f ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="grid grid-cols-3 gap-px border-b border-subtle bg-subtle">
            <MetricTile label="Cash" value={{ amountMinor: f.cash.amountMinor, currency: cur }} caption={f.cash.accounts ? `${f.cash.accounts} account${f.cash.accounts === 1 ? "" : "s"}` : "No bank connected"} provenance={{ source: "Bank balances", asOf: f.cash.asOf ?? undefined }} onClick={open} />
            <MetricTile label="Net burn / month" value={{ amountMinor: f.burn.netBurnMinor, currency: cur }} estimate="estimate" caption={`Gross ${formatNumber(minorToMajor(f.burn.grossBurnMinor, cur), { maxDigits: 0 })} ${cur}`} provenance={{ source: "Operating outflows − inflows", note: f.burn.definition }} onClick={open} />
            <MetricTile label="Runway" value={runway === null ? "—" : formatNumber(runway, { maxDigits: 1 })} unit={runway === null ? undefined : "mo"} estimate="estimate" caption={f.runway.blocksContinue ? "Under 3 months: blocks Continue until acknowledged" : runway === null ? "Needs net burn above zero" : "Cash ÷ net burn"} provenance={{ source: "Cash ÷ net burn", note: "Plus the forecast-based runway on the Finance tab" }} onClick={open} />
          </div>
          <div className="min-h-0 flex-1 p-panel-pad">
            {series.length > 0 ? (
              <LineChart series={series} label={forecastShown ? "Cash forecast by scenario" : "Monthly net cash flow"} height={140} provenance={forecastShown ? "forecast" : undefined} yFormat={(v) => formatNumber(v, { maxDigits: 0 })} />
            ) : (
              <p className="text-small text-secondary">{settings.chart === "forecast" ? "No forecast yet. The Finance lead drafts one after the first cycle." : "Monthly cash flow appears after two months of transactions."}</p>
            )}
          </div>
        </div>
      ) : null}
    </WidgetFrame>
  );
}

export const cashRunwayWidget = registerWidget<CashRunwaySettings>({
  key: "cash_runway",
  title: "Cash and runway",
  description: "Cash in bank, net burn, runway and the forecast cone.",
  icon: "landmark",
  surfaces: ["home", "department"],
  defaultSize: { w: 6, h: 12, minW: 4, minH: 9 },
  settingsSchema: CashRunwaySettings,
  defaultSettings: CashRunwaySettings.parse({}),
  Component: CashRunwayWidget,
});
