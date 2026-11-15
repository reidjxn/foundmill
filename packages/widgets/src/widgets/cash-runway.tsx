"use client";
/**
 * Cash and runway widget (BUILD §11.2 gallery, §11.8 metric definitions): cash in bank, net burn (Estimate), runway
 * (Estimate, amber under 9 months, red under 6) and the cash forecast cone (Forecast) or the monthly cash flow.
 */
import { useMemo } from "react";
import { z } from "zod";
import { Landmark } from "lucide-react";
import { LineChart, MetricTile, StatusPill, Term, formatMoney, formatNumber, type LineSeries, type MetricTileProps } from "@foundmill/dugout";
import { minorToMajor } from "@foundmill/shared";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { moduleHref, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import { RUNWAY_WORDS, runwayWords } from "../shared/runway";
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

/**
 * The Runway tile: the figure in months with its Estimate chip and a caption in words (UX plan B9: "Months of cash
 * left at today's spending"; the formula "Cash ÷ net burn" is the provenance tooltip), or, without a figure, the shared
 * runway words every other screen uses ("Not running out" when cash-flow positive, "Not known yet" with the reason) and no
 * Estimate chip, since nothing has been estimated.
 */
export function runwayTileProps(f: FinanceOverview): Pick<MetricTileProps, "label" | "value" | "unit" | "estimate" | "caption" | "provenance"> {
  const months = f.runway.months;
  const provenance = { source: "Cash ÷ net burn", note: "Plus the forecast-based runway on the Finance tab" };
  if (months === null) {
    const words = runwayWords(f) ?? RUNWAY_WORDS.no_bank;
    return { label: "Runway", value: words.value, caption: words.caption, provenance };
  }
  return { label: "Runway", value: formatNumber(months, { maxDigits: 1 }), unit: "mo", estimate: "estimate", caption: months < 3 ? "Under 3 months of cash left" : "Months of cash left at today's spending", provenance };
}

/** The Net burn tile's caption in words, with the gross figure the net one is cut from (UX plan B9). */
export function netBurnCaption(f: FinanceOverview, currency: string): string {
  return `Spent minus earned each month · gross ${formatMoney({ amountMinor: f.burn.grossBurnMinor, currency }, { compact: true })}`;
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
      help="Runway is how many months your cash lasts at today's spending. Net burn is what the business spends in a month minus what it earns."
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
            <MetricTile label="Cash" value={{ amountMinor: f.cash.amountMinor, currency: cur }} caption={f.cash.accounts ? `In the bank · ${f.cash.accounts} account${f.cash.accounts === 1 ? "" : "s"}` : "No bank connected"} provenance={{ source: "Bank balances", asOf: f.cash.asOf ?? undefined }} onClick={open} />
            <MetricTile label="Net burn / month" value={{ amountMinor: f.burn.netBurnMinor, currency: cur }} estimate="estimate" caption={netBurnCaption(f, cur)} provenance={{ source: "Operating outflows − inflows (trailing 3 months)", note: f.burn.definition }} onClick={open} />
            <MetricTile {...runwayTileProps(f)} onClick={open} />
          </div>
          <div className="min-h-0 flex-1 p-panel-pad">
            {series.length > 0 ? (
              <LineChart series={series} label={forecastShown ? "Cash forecast by scenario" : "Monthly net cash flow"} height={140} provenance={forecastShown ? "forecast" : undefined} yFormat={(v) => formatNumber(v, { maxDigits: 0 })} />
            ) : (
              <p className="text-small text-secondary">{settings.chart === "forecast" ? (
                  <>
                    No forecast yet. The Finance lead drafts one after the first <Term id="cycle">cycle</Term>.
                  </>
                ) : (
                  "Monthly cash flow appears after two months of transactions."
                )}</p>
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
  // Tall enough for the three tiles, the chart and the footer at 1280–1440 px (the body scrolls in a smaller cell).
  defaultSize: { w: 6, h: 16, minW: 4, minH: 9 },
  settingsSchema: CashRunwaySettings,
  defaultSettings: CashRunwaySettings.parse({}),
  Component: CashRunwayWidget,
});
