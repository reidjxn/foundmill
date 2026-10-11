import { describe, expect, it } from "vitest";
import {
  acquisitionCost,
  aktiebokRows,
  buildPnl,
  cashHistory,
  chartEntry,
  delawareLedgerRows,
  formatMonth,
  ledgerPnlRows,
  modelRound,
  monthlySeries,
  outputPerHundred,
  paybackMonths,
  pnlTotals,
  projectForecast,
  readDrivers,
  readSeries,
  runwayTone,
  runwayWarnings,
  runwayWord,
  sectionOf,
  seedDrivers,
  toCsv,
  trailingMonths,
  vestingSummary,
} from "../metrics";
import type { CapTableEntryRow, CapTableResponse, SecurityRow } from "../types";
import { NOW } from "./fake-source";
import { capTable, categories, monthly, pnlLedger } from "./fixtures";

describe("months", () => {
  it("lists trailing full months and formats them", () => {
    expect(trailingMonths(NOW, 3)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(formatMonth("2026-09")).toBe("Sep 2026");
  });
});

describe("category names", () => {
  it("reads snake_case keys from the categoriser and the seeds as chart lines, and merges lines that name the same one", async () => {
    const { categoryLabel, isUncategorised } = await import("../metrics");
    expect(categoryLabel("cost_of_goods")).toBe("Cost of sales");
    expect(categoryLabel("COST_OF_GOODS_SOLD")).toBe("Cost of sales");
    expect(categoryLabel("professional_fees")).toBe("Professional services");
    expect(categoryLabel("software_and_hosting")).toBe("Software");
    expect(categoryLabel("rnd_materials")).toBe("Rnd materials");
    expect(categoryLabel(null)).toBe("Uncategorized");
    expect(isUncategorised("uncategorised")).toBe(true);
    const rows = buildPnl([
      { category: "cost_of_goods", inflowMinor: 0, outflowMinor: 1000, count: 2 },
      { category: "Cost of sales", inflowMinor: 0, outflowMinor: 500, count: 1 },
      { category: "revenue", inflowMinor: 5000, outflowMinor: 0, count: 3 },
    ]);
    const cogs = rows.filter((r) => r.kind === "line" && r.section === "cogs");
    expect(cogs).toHaveLength(1);
    expect(cogs[0]).toMatchObject({ label: "Cost of sales", amountMinor: -1500, count: 3 });
    expect(rows.some((r) => /_/.test(r.label))).toBe(false);
  });
});

describe("chart of accounts", () => {
  it("maps free-text categories to the standard lines and sections", () => {
    expect(chartEntry("stripe payout")?.category).toBe("Revenue");
    expect(sectionOf("AWS")).toBe("cogs");
    expect(sectionOf("Salaries")).toBe("opex");
    expect(sectionOf("Loan repayment")).toBe("financing");
    expect(sectionOf(null)).toBe("uncategorised");
    expect(sectionOf("Something new")).toBe("opex");
  });
});

describe("management P&L (AC-11.8.1 hand-computed fixture)", () => {
  it("totals every section to the minor unit", () => {
    const t = pnlTotals(categories);
    expect(t.revenueMinor).toBe(6_000_000);
    expect(t.cogsMinor).toBe(-750_000);
    expect(t.grossProfitMinor).toBe(5_250_000);
    expect(t.grossMarginPct).toBe(87.5);
    expect(t.opexMinor).toBe(-6_600_000);
    expect(t.operatingResultMinor).toBe(-1_350_000);
    expect(t.financingMinor).toBe(10_000_000);
    expect(t.taxMinor).toBe(-200_000);
    expect(t.uncategorisedMinor).toBe(-300_000);
    expect(t.netMinor).toBe(8_150_000);
  });

  it("builds indented lines, subtotal rules and totals in statement order", () => {
    const rows = buildPnl(categories);
    expect(rows.map((r) => `${r.kind}:${r.label}`)).toEqual([
      "header:Revenue",
      "line:Revenue",
      "subtotal:Total revenue",
      "header:Cost of sales",
      "line:Hosting",
      "line:Payment fees",
      "subtotal:Total cost of sales",
      "total:Gross profit",
      "header:Operating expenses",
      "line:Payroll",
      "line:Marketing",
      "line:Software",
      "subtotal:Total operating expenses",
      "total:Operating result",
      "header:Financing",
      "line:Financing",
      "subtotal:Total financing",
      "header:Taxes",
      "line:Taxes",
      "subtotal:Total taxes",
      "header:Uncategorized",
      "line:Uncategorized transactions",
      "total:Net cash change",
    ]);
    const gross = rows.find((r) => r.id === "t-gross")!;
    expect(gross.amountMinor).toBe(5_250_000);
    expect(gross.pctOfRevenue).toBe(87.5);
    expect(rows.find((r) => r.id === "t-operating")!.pctOfRevenue).toBe(-22.5);
    expect(rows.find((r) => r.label === "Payroll")!.depth).toBe(1);
    expect(rows.find((r) => r.label === "Uncategorized transactions")!.warn).toBe(true);
    expect(rows.at(-1)!.count).toBe(177);
    expect(rows.at(-1)!.amountMinor).toBe(8_150_000);
  });

  it("flattens a ledger snapshot's lines and nested objects", () => {
    const rows = ledgerPnlRows(pnlLedger.snapshots[0]!.pnl);
    expect(rows.map((r) => [r.label, r.kind, r.amountMinor, r.depth])).toEqual([
      ["Revenue", "subtotal", 2_150_000, 0],
      ["Subscriptions", "line", 2_150_000, 1],
      ["Operating expenses", "subtotal", -3_400_000, 0],
      ["Net result", "total", -1_250_000, 0],
    ]);
    const nested = ledgerPnlRows({ Revenue: { Subscriptions: 100, Services: 50 }, "Net result": -20 });
    expect(nested.map((r) => `${r.depth}:${r.kind}:${r.label}`)).toEqual(["0:header:Revenue", "1:line:Subscriptions", "1:line:Services", "0:subtotal:Net result"]);
  });
});

describe("overview metrics (AC-11.8.1)", () => {
  it("walks cash back through monthly net totals and builds monthly series", () => {
    expect(cashHistory(15_000_000, monthly, ["2026-07", "2026-08", "2026-09"])).toEqual([7_900_000, 16_400_000, 15_000_000]);
    expect(monthlySeries(monthly, ["2026-08", "2026-09", "2026-10"], (m) => m.outflowMinor)).toEqual([3_500_000, 3_600_000, 0]);
  });

  it("computes acquisition cost and payback to the spec definitions", () => {
    expect(acquisitionCost({ spendMinor: 1_200_000, customers: 24 })).toBe(50_000);
    expect(acquisitionCost({ spendMinor: 1_200_000, customers: 0 })).toBeNull();
    expect(paybackMonths(50_000, 2_000_000, 87.5, 24)).toBe(0.7);
    expect(paybackMonths(50_000, 2_000_000, null, 24)).toBeNull();
    expect(paybackMonths(null, 2_000_000, 87.5, 24)).toBeNull();
  });

  it("flags runway thresholds at 12, 9, 6 and 3 months", () => {
    expect(runwayWarnings(7.5)).toEqual([12, 9]);
    expect(runwayWarnings(2)).toEqual([12, 9, 6, 3]);
    expect(runwayWarnings(14)).toEqual([]);
    expect(runwayWarnings(null)).toEqual([]);
    expect(runwayTone(2.9)).toBe("bad");
    expect(runwayTone(7.5)).toBe("warn");
    expect(runwayTone(13)).toBe("good");
    expect(runwayWord(7.5)).toBe("Runway under 9 months");
    expect(runwayWord(2)).toBe("Runway under 3 months");
    expect(runwayWord(null)).toBe("Runway unknown");
  });

  it("measures output per hundred units of cost", () => {
    expect(outputPerHundred(3, 42_000)).toBe(0.71);
    expect(outputPerHundred(3, 0)).toBeNull();
  });
});

describe("driver-based forecast", () => {
  it("projects cash month by month and interpolates the zero crossing", () => {
    const p = projectForecast({ startingCashMinor: 10_000, monthlyRevenueMinor: 1_000, revenueGrowthPct: 0, monthlyCostsMinor: 5_000, costGrowthPct: 0, horizonMonths: 6 }, "2026-10");
    expect(p.series.map((x) => [x.month, x.cashMinor])).toEqual([
      ["2026-10", 6_000],
      ["2026-11", 2_000],
      ["2026-12", -2_000],
      ["2027-01", -6_000],
      ["2027-02", -10_000],
      ["2027-03", -14_000],
    ]);
    expect(p.runwayMonths).toBe(2.5);
    expect(p.zeroMonth).toBe("2026-12");
  });

  it("compounds growth and reports no runway limit when cash stays positive", () => {
    const p = projectForecast({ startingCashMinor: 100_000, monthlyRevenueMinor: 10_000, revenueGrowthPct: 10, monthlyCostsMinor: 9_000, costGrowthPct: 0, horizonMonths: 3 }, "2026-10");
    expect(p.series.map((x) => x.revenueMinor)).toEqual([10_000, 11_000, 12_100]);
    expect(p.runwayMonths).toBeNull();
    expect(p.zeroMonth).toBeNull();
  });

  it("seeds scenarios from cash, MRR and gross burn and reads drivers back with defaults", () => {
    const seeds = { cashMinor: 15_000_000, mrrMinor: 2_000_000, grossBurnMinor: 3_500_000 };
    expect(seedDrivers("base", seeds)).toMatchObject({ startingCashMinor: 15_000_000, monthlyRevenueMinor: 2_000_000, revenueGrowthPct: 5, monthlyCostsMinor: 3_500_000, costGrowthPct: 1, horizonMonths: 24 });
    expect(seedDrivers("upside", seeds).revenueGrowthPct).toBe(10);
    expect(seedDrivers("downside", seeds)).toMatchObject({ revenueGrowthPct: 0, costGrowthPct: 2 });
    const d = readDrivers({ monthlyRevenueMinor: 500, horizonMonths: 99, runway_months: 4 }, seedDrivers("base", seeds));
    expect(d.monthlyRevenueMinor).toBe(500);
    expect(d.horizonMonths).toBe(60);
    expect(d.startingCashMinor).toBe(15_000_000);
    expect(d.runway_months).toBe(4);
    expect(readSeries([{ month: "2026-10", cashMinor: 5 }, { day: "2026-11-01", baseMinor: 7 }, null])).toEqual([
      { month: "2026-10", revenueMinor: 0, costsMinor: 0, netMinor: 0, cashMinor: 5 },
      { month: "2026-11", revenueMinor: 0, costsMinor: 0, netMinor: 0, cashMinor: 7 },
    ]);
  });
});

describe("vesting", () => {
  it("vests monthly after the cliff from the schedule JSON", () => {
    const v = vestingSummary({ months: 48, cliffMonths: 12, startDate: "2025-10-01" }, "4500000", NOW)!;
    expect(v.vestedPct).toBe(25);
    expect(v.vestedQuantity).toBe(1_125_000);
    expect(v.text).toBe("4y / 1y cliff · 25% vested");
    expect(vestingSummary({ months: 48, cliffMonths: 12, startDate: "2026-04-01" }, 200_000, NOW)!.vestedPct).toBe(0);
    expect(vestingSummary(null, 10, NOW)).toBeNull();
    expect(vestingSummary({}, 10, NOW)!.vestedPct).toBe(100);
  });
});

/* ---- Round modelling reference fixtures (AC-11.8.4) ---- */

const founder = { id: "f", displayName: "Founder", kind: "person" };
function entry(id: string, security: SecurityRow, quantity: number, priceMinor: number | null, holder = founder, vesting: Record<string, unknown> | null = null): CapTableEntryRow {
  return { id, holderEntityId: holder.id, securityId: security.id, quantity, priceMinor, currency: "EUR", vesting, issuedAt: "2026-01-01", holder, security: { id: security.id, class: security.class, kind: security.kind } };
}
const common: SecurityRow = { id: "s-common", class: "Common", kind: "common", terms: {}, authorisedQuantity: null, currency: "EUR" };
const cappedSafe: SecurityRow = { id: "s-safe", class: "SAFE", kind: "safe", terms: { valuationCapMinor: 100_000_000 }, authorisedQuantity: null, currency: "EUR" };
const discountSafe: SecurityRow = { id: "s-safe-d", class: "SAFE discount", kind: "safe", terms: { discountPct: 20 }, authorisedQuantity: null, currency: "EUR" };
const pool: SecurityRow = { id: "s-pool", class: "Pool", kind: "option", terms: {}, authorisedQuantity: 0, currency: "EUR" };
const investor = { id: "inv", displayName: "Seed Fund", kind: "organisation" };
const summaryOf = (entries: CapTableEntryRow[]): CapTableResponse["summary"] => ({ totalQuantity: entries.reduce((n, e) => n + Number(e.quantity), 0), byClass: [], byHolder: [] });

describe("round modelling (AC-11.8.4 reference SAFE conversion)", () => {
  it("converts a post-money SAFE at principal ÷ cap and prices the round on the converted capitalisation", () => {
    const entries = [entry("c1", common, 1_000_000, 1), entry("safe1", cappedSafe, 1, 10_000_000, investor)];
    const m = modelRound({ securities: [common, cappedSafe], entries, summary: summaryOf(entries) }, { preMoneyMinor: 400_000_000, investmentMinor: 100_000_000, poolTargetPct: 0 });
    expect(m.safeShares).toBe(111_111.1111);
    expect(m.pricePerShareMinor).toBe(360);
    expect(m.newShares).toBe(277_777.7778);
    expect(m.postRoundFullyDiluted).toBe(1_388_888.8889);
    expect(m.investorPct).toBe(20);
    expect(m.conversions[0]).toMatchObject({ holder: "Seed Fund", method: "cap", principalMinor: 10_000_000, shares: 111_111.1111 });
    const byName = Object.fromEntries(m.rows.map((r) => [r.name, r.afterPct]));
    expect(byName.Founder).toBe(72);
    expect(byName["Seed Fund (converted)"]).toBe(8);
    expect(byName["New investors"]).toBe(20);
    expect(m.label).toBe("Estimate");
  });

  it("converts a discount-only SAFE at the round price less the discount", () => {
    const entries = [entry("c1", common, 1_000_000, 1), entry("safe2", discountSafe, 1, 10_000_000, investor)];
    const m = modelRound({ securities: [common, discountSafe], entries, summary: summaryOf(entries) }, { preMoneyMinor: 400_000_000, investmentMinor: 100_000_000, poolTargetPct: 0 });
    expect(m.pricePerShareMinor).toBe(400);
    expect(m.conversions[0]).toMatchObject({ method: "discount", shares: 31_250, conversionPriceMinor: 320 });
    expect(m.newShares).toBe(250_000);
    expect(m.postRoundFullyDiluted).toBe(1_281_250);
    expect(m.investorPct).toBe(19.51);
  });

  it("tops the option pool up to the target share of the post-money fully diluted", () => {
    const entries = [entry("c1", common, 1_000_000, 1)];
    const m = modelRound({ securities: [common, pool], entries, summary: summaryOf(entries) }, { preMoneyMinor: 400_000_000, investmentMinor: 100_000_000, poolTargetPct: 10, newClass: "Series A" });
    expect(m.poolTopUpShares).toBe(142_857.1429);
    expect(m.pricePerShareMinor).toBe(350);
    expect(m.newShares).toBe(285_714.2857);
    expect(m.postRoundFullyDiluted).toBe(1_428_571.4286);
    expect(m.rows.find((r) => r.kind === "pool")!.afterPct).toBe(10);
    expect(m.rows.find((r) => r.kind === "investor")).toMatchObject({ name: "Series A", afterPct: 20 });
  });

  it("models the Ledgerly fixture with cap-or-discount choice and an existing pool", () => {
    const m = modelRound(capTable, { preMoneyMinor: 4_000_000_000, investmentMinor: 100_000_000, poolTargetPct: 0 });
    // SAFE €100k at €10M post-money cap → 1 % of the 10,000,000 pre-round capitalisation (9.2M issued + 800k unallocated pool).
    expect(m.conversions[0]!.method).toBe("cap");
    expect(m.conversions[0]!.shares).toBe(101_010.101);
    expect(m.postMoneyMinor).toBe(4_100_000_000);
    expect(m.investorPct).toBeCloseTo(100 / 41, 1);
    expect(m.rows.find((r) => r.kind === "pool")!.beforeQuantity).toBe(800_000);
  });
});

describe("share registers", () => {
  it("writes a Delaware stock ledger with certificates per equity issuance", () => {
    const rows = delawareLedgerRows(capTable.entries, NOW);
    expect(rows[0]![0]).toBe("Certificate No.");
    expect(rows).toHaveLength(4); // header + 2 common + 1 option; the SAFE is not stock
    expect(rows[1]).toEqual(["C-0001", "2025-10-01", "Mara Lindqvist", "person", "Common", "common", 4_500_000, "0.01 EUR", "45000.00 EUR", "4y / 1y cliff · 25% vested", "Outstanding"]);
    expect(rows[3]![2]).toBe("Lena Okafor");
  });

  it("numbers shares in sequence in the aktiebok and leaves options out", () => {
    const rows = aktiebokRows(capTable.entries);
    expect(rows).toHaveLength(3);
    expect(rows[1]!.slice(0, 5)).toEqual([1, 4_500_000, 4_500_000, "Common", "Mara Lindqvist"]);
    expect(rows[2]!.slice(0, 3)).toEqual([4_500_001, 9_000_000, 4_500_000]);
    expect(rows[1]![5]).toBe("Fysisk person");
  });

  it("quotes CSV cells that need it", () => {
    expect(toCsv([["a", 'say "hi", now', 3]])).toBe('a,"say ""hi"", now",3');
  });
});
