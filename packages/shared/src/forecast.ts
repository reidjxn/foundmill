/**
 * The driver-based cash forecast (BUILD §11.8): the `forecasts.drivers` contract and the month-by-month projection that
 * turns drivers into the series a forecast version stores. One implementation for the Runway and Overview screens
 * (packages/modules), the demo seeds (packages/db) and anything else that writes a forecast, so a stored series and
 * the screens' projection of the same drivers always agree (docs/DECISIONS.md "Forecast drivers contract").
 */

/** The driver contract of a forecast version (stored as `forecasts.drivers`). */
export interface ForecastDrivers {
  startingCashMinor: number;
  monthlyRevenueMinor: number;
  /** Month-on-month revenue growth in percent (5 = +5 %/month). */
  revenueGrowthPct: number;
  monthlyCostsMinor: number;
  /** Month-on-month cost growth in percent. */
  costGrowthPct: number;
  /** Months projected (default 24). */
  horizonMonths: number;
  /** Months until cash reaches zero under these drivers; null when it never does within the horizon. apps/api reads it. */
  runway_months?: number | null;
}

export interface ForecastPoint {
  month: string;
  revenueMinor: number;
  costsMinor: number;
  netMinor: number;
  cashMinor: number;
}

export interface ForecastProjection {
  series: ForecastPoint[];
  /** Months until cash reaches zero (fraction of a month interpolated); null when it stays positive to the horizon. */
  runwayMonths: number | null;
  /** The month cash first goes negative. */
  zeroMonth: string | null;
}

export const DEFAULT_FORECAST_HORIZON_MONTHS = 24;

/** YYYY-MM shifted by `n` months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Project cash month by month from `startMonth`: revenue and costs compound by their growth rates; cash = previous cash + net. */
export function projectForecast(drivers: ForecastDrivers, startMonth: string): ForecastProjection {
  const series: ForecastPoint[] = [];
  let cash = drivers.startingCashMinor;
  let revenue = drivers.monthlyRevenueMinor;
  let costs = drivers.monthlyCostsMinor;
  let runwayMonths: number | null = null;
  let zeroMonth: string | null = null;
  for (let i = 0; i < drivers.horizonMonths; i += 1) {
    const month = shiftMonth(startMonth, i);
    const r = Math.round(revenue);
    const c = Math.round(costs);
    const net = r - c;
    const before = cash;
    cash = before + net;
    series.push({ month, revenueMinor: r, costsMinor: c, netMinor: net, cashMinor: cash });
    if (runwayMonths === null && cash < 0) {
      const fraction = net < 0 ? before / -net : 0;
      runwayMonths = Math.round((i + Math.max(0, Math.min(1, fraction))) * 10) / 10;
      zeroMonth = month;
    }
    revenue *= 1 + drivers.revenueGrowthPct / 100;
    costs *= 1 + drivers.costGrowthPct / 100;
  }
  if (drivers.startingCashMinor < 0) {
    runwayMonths = 0;
    zeroMonth = startMonth;
  }
  return { series, runwayMonths, zeroMonth };
}
