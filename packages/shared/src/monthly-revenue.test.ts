import { describe, expect, it } from "vitest";
import { MONTHLY_REVENUE_MONTHS, monthlyRevenueFromCategories, monthlyRevenueMinor, monthlyRevenueWindow, monthlyRevenueWords } from "./monthly-revenue";

describe("one monthly-revenue figure (DECISIONS 2026-11-11)", () => {
  it("windows the last 3 full UTC months before the month, never the current one", () => {
    const w = monthlyRevenueWindow(new Date("2026-11-11T15:00:00.000Z"));
    expect(MONTHLY_REVENUE_MONTHS).toBe(3);
    expect(w.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(w.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(monthlyRevenueWindow(new Date("2026-01-01T00:00:00.000Z")).months).toEqual(["2025-10", "2025-11", "2025-12"]);
  });

  it("is the window's P&L revenue ÷ 3: revenue lines net of refunds, nothing else", () => {
    expect(monthlyRevenueMinor(300_001)).toBe(100_000);
    const categories = [
      { category: "revenue", inflowMinor: 250_000, outflowMinor: 0, count: 4 },
      { category: "Stripe payout", inflowMinor: 60_000, outflowMinor: 0, count: 2 },
      { category: "refunds", inflowMinor: 0, outflowMinor: 10_000, count: 1 },
      { category: "financing", inflowMinor: 5_000_000, outflowMinor: 0, count: 1 },
      { category: "marketing", inflowMinor: 0, outflowMinor: 80_000, count: 3 },
      { category: null, inflowMinor: 9_000, outflowMinor: 0, count: 1 },
    ];
    expect(monthlyRevenueFromCategories(categories)).toBe(100_000);
  });

  it("is named MRR only when revenue recurs (or before an archetype), monthly revenue otherwise", () => {
    expect(monthlyRevenueWords(true)).toMatchObject({ name: "MRR", label: "Monthly recurring revenue (MRR)" });
    expect(monthlyRevenueWords(null).name).toBe("MRR");
    expect(monthlyRevenueWords(false)).toMatchObject({ name: "monthly revenue", label: "Average monthly revenue" });
  });
});
