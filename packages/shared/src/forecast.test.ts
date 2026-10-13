import { describe, expect, it } from "vitest";
import { DEFAULT_FORECAST_HORIZON_MONTHS, projectForecast, shiftMonth, type ForecastDrivers } from "./forecast";

const drivers: ForecastDrivers = { startingCashMinor: 10_000, monthlyRevenueMinor: 1_000, revenueGrowthPct: 0, monthlyCostsMinor: 5_000, costGrowthPct: 0, horizonMonths: 6 };

describe("shiftMonth", () => {
  it("moves a month across year ends in both directions", () => {
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
    expect(shiftMonth("2026-10", 3)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 24)).toBe("2028-12");
  });
});

describe("projectForecast", () => {
  it("projects cash month by month from the start month and interpolates the zero crossing", () => {
    const p = projectForecast(drivers, "2026-10");
    expect(p.series.map((x) => [x.month, x.cashMinor])).toEqual([["2026-10", 6_000], ["2026-11", 2_000], ["2026-12", -2_000], ["2027-01", -6_000], ["2027-02", -10_000], ["2027-03", -14_000]]);
    expect(p.runwayMonths).toBe(2.5);
    expect(p.zeroMonth).toBe("2026-12");
  });

  it("compounds growth and reports no zero crossing while cash stays positive", () => {
    const p = projectForecast({ ...drivers, startingCashMinor: 100_000, monthlyRevenueMinor: 10_000, revenueGrowthPct: 10, monthlyCostsMinor: 9_000, horizonMonths: 3 }, "2026-10");
    expect(p.series.map((x) => x.revenueMinor)).toEqual([10_000, 11_000, 12_100]);
    expect(p.runwayMonths).toBeNull();
    expect(p.zeroMonth).toBeNull();
  });

  it("treats negative starting cash as no runway at all", () => {
    expect(projectForecast({ ...drivers, startingCashMinor: -1 }, "2026-10")).toMatchObject({ runwayMonths: 0, zeroMonth: "2026-10" });
  });

  it("is the one projection a stored series and the screens share", () => {
    expect(DEFAULT_FORECAST_HORIZON_MONTHS).toBe(24);
    const a = projectForecast({ ...drivers, horizonMonths: DEFAULT_FORECAST_HORIZON_MONTHS, revenueGrowthPct: 4, costGrowthPct: 2 }, "2026-10");
    const b = projectForecast({ ...drivers, horizonMonths: DEFAULT_FORECAST_HORIZON_MONTHS, revenueGrowthPct: 4, costGrowthPct: 2 }, "2026-10");
    expect(a.series).toHaveLength(24);
    expect(a).toEqual(b);
    expect(a.series[0]!.month).toBe("2026-10");
    expect(a.series.at(-1)!.month).toBe("2028-09");
  });
});
