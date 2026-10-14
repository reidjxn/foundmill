import { describe, expect, it } from "vitest";
import { NON_OPERATING_CATEGORY_KEYS } from "@foundmill/shared/constants";
import {
  CHART_OF_ACCOUNTS,
  acquisitionCost,
  aktiebokRows,
  buildPnl,
  cashHistory,
  chartEntry,
  delawareLedgerRows,
  driversHint,
  entryCurrency,
  forecastStartMonth,
  formatMonth,
  holderKindWord,
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
  scenarioRunway,
  sectionOf,
  seedDrivers,
  storedProjection,
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

  it("files exactly the keys net burn leaves out under Financing and Transfers, so the P&L and burn agree (BUILD §11.8)", () => {
    // A director loan used to fall through to operating expenses here while net burn already left it out.
    expect(chartEntry("Director_Loan")?.category).toBe("Financing");
    for (const key of NON_OPERATING_CATEGORY_KEYS.financing) expect(sectionOf(key), key).toBe("financing");
    for (const key of NON_OPERATING_CATEGORY_KEYS.transfers) expect(chartEntry(key)?.category, key).toBe("Transfers");
    const nonOperating = new Set<string>([...NON_OPERATING_CATEGORY_KEYS.financing, ...NON_OPERATING_CATEGORY_KEYS.transfers]);
    for (const line of CHART_OF_ACCOUNTS.filter((c) => c.category === "Financing" || c.category === "Transfers")) {
      for (const alias of line.aliases) expect(nonOperating.has(alias), alias).toBe(true);
    }
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
  });

  it("never reads a grant as fully vested because its keys differ or its start is missing (#169)", () => {
    // the rows the seed used to write: { schedule: "4y", startsAt, cliffMonths }
    const tomas = vestingSummary({ schedule: "4y", startsAt: "2026-03-25", cliffMonths: 12 }, 50_000, NOW)!;
    expect(tomas).toMatchObject({ totalMonths: 48, cliffMonths: 12, startDate: "2026-03-25", vestedPct: 0, vestedQuantity: 0 });
    expect(tomas.text).toBe("4y / 1y cliff · 0% vested");
    const priya = vestingSummary({ schedule: "4y", cliffMonths: 12 }, 2_000_000, NOW, "2024-10-17")!;
    expect(priya.startDate).toBe("2024-10-17"); // falls back to the issue date
    expect(priya.vestedPct).toBe(47.9);
    // a schedule with no start anywhere is unknown, not 100%
    const unknown = vestingSummary({}, 10, NOW)!;
    expect(unknown.vestedPct).toBeNull();
    expect(unknown.vestedQuantity).toBeNull();
    expect(unknown.text).toBe("4y / 1y cliff · start date unknown");
    expect(vestingSummary({ months: 24, cliffMonths: 0 }, 100, NOW, "2026-04-07")!.vestedPct).toBe(25);
  });
});

describe("currencies and words on the cap table (#170)", () => {
  it("prices every position in its share class's currency", () => {
    expect(entryCurrency({ currency: "EUR" }, { currency: "GBP" })).toBe("GBP");
    expect(entryCurrency({ currency: "EUR" }, undefined)).toBe("EUR");
    expect(entryCurrency({ currency: "EUR" }, { currency: "" })).toBe("EUR");
  });

  it("names holder kinds in words, never the stored enum", () => {
    expect(holderKindWord("organisation")).toBe("Organization");
    expect(holderKindWord("team_member")).toBe("Team member");
    expect(holderKindWord("person")).toBe("Person");
    expect(holderKindWord("future_kind")).toBe("Future kind");
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
const summaryOf = (entries: CapTableEntryRow[]): CapTableResponse["summary"] => ({ totalQuantity: entries.filter((e) => e.security.kind !== "safe" && e.security.kind !== "note").reduce((n, e) => n + Number(e.quantity), 0), byClass: [], byHolder: [] });

describe("round modelling (AC-11.8.4 reference SAFE conversion)", () => {
  it("converts a post-money SAFE at principal ÷ cap and prices the round on the converted capitalization", () => {
    const entries = [entry("c1", common, 1_000_000, 1), entry("safe1", cappedSafe, 1, 10_000_000, investor)];
    const m = modelRound({ securities: [common, cappedSafe], entries, summary: summaryOf(entries) }, { preMoneyMinor: 400_000_000, investmentMinor: 100_000_000, poolTargetPct: 0 });
    expect(m.safeShares).toBe(111_111);
    expect(m.pricePerShareMinor).toBe(360);
    expect(m.newShares).toBe(277_777);
    expect(m.postRoundFullyDiluted).toBe(1_388_888);
    expect(m.investorPct).toBe(20);
    expect(m.conversions[0]).toMatchObject({ holder: "Seed Fund", method: "cap", principalMinor: 10_000_000, shares: 111_111 });
    const byName = Object.fromEntries(m.rows.map((r) => [r.name, r.afterPct]));
    expect(byName.Founder).toBe(72);
    expect(byName["Seed Fund (converted)"]).toBe(8);
    expect(byName["New investors"]).toBe(20);
    expect(m.label).toBe("Estimate");
  });

  it("converts a discount-only SAFE at the round price less the discount, and the investor still holds investment ÷ post-money (#177)", () => {
    const entries = [entry("c1", common, 1_000_000, 1), entry("safe2", discountSafe, 1, 10_000_000, investor)];
    const m = modelRound({ securities: [common, discountSafe], entries, summary: summaryOf(entries) }, { preMoneyMinor: 400_000_000, investmentMinor: 100_000_000, poolTargetPct: 0 });
    // the discount shares are part of the pre-round capitalization the price divides, so the price is below pre-money ÷ existing shares
    expect(m.pricePerShareMinor).toBe(387.5);
    expect(m.conversions[0]).toMatchObject({ method: "discount", shares: 32_258, conversionPriceMinor: 310.0006 });
    expect(m.newShares).toBe(258_064);
    expect(m.postRoundFullyDiluted).toBe(1_290_322);
    expect(m.investorPct).toBe(20);
  });

  it("tops the option pool up to the target share of the post-money fully diluted", () => {
    const entries = [entry("c1", common, 1_000_000, 1)];
    const m = modelRound({ securities: [common, pool], entries, summary: summaryOf(entries) }, { preMoneyMinor: 400_000_000, investmentMinor: 100_000_000, poolTargetPct: 10, newClass: "Series A" });
    expect(m.poolTopUpShares).toBe(142_857);
    expect(m.pricePerShareMinor).toBe(350);
    expect(m.newShares).toBe(285_714);
    expect(m.postRoundFullyDiluted).toBe(1_428_571);
    expect(m.rows.find((r) => r.kind === "pool")!.afterPct).toBe(10);
    expect(m.rows.find((r) => r.kind === "investor")).toMatchObject({ name: "Series A", afterPct: 20 });
  });

  it("models the Ledgerly fixture with cap-or-discount choice and an existing pool", () => {
    const m = modelRound(capTable, { preMoneyMinor: 4_000_000_000, investmentMinor: 100_000_000, poolTargetPct: 0 });
    // SAFE €100k at €10M post-money cap → 1 % of the 10,000,000 pre-round capitalization (9.2M issued + 800k unallocated pool).
    expect(m.conversions[0]!.method).toBe("cap");
    expect(m.conversions[0]!.shares).toBe(101_010);
    expect(m.postMoneyMinor).toBe(4_100_000_000);
    expect(m.investorPct).toBeCloseTo(100 / 41, 1);
    expect(m.rows.find((r) => r.kind === "pool")!.beforeQuantity).toBe(800_000);
  });

  describe("with a cap SAFE, a discount SAFE and a partly granted pool (#177)", () => {
    const ordinary: SecurityRow = { id: "s-ord", class: "Ordinary", kind: "common", terms: {}, authorisedQuantity: 10_000_000, currency: "GBP" };
    const options: SecurityRow = { id: "s-opt", class: "EMI option pool", kind: "option", terms: {}, authorisedQuantity: 1_000_000, currency: "GBP" };
    const safeA: SecurityRow = { id: "s-a", class: "SAFE A", kind: "safe", terms: { postMoney: true, valuationCapMinor: 600_000_000, discountPct: 0 }, authorisedQuantity: null, currency: "GBP" };
    const safeB: SecurityRow = { id: "s-b", class: "SAFE B", kind: "safe", terms: { postMoney: true, valuationCapMinor: 1_100_000_000, discountPct: 15 }, authorisedQuantity: null, currency: "GBP" };
    const harbor = { id: "harbor", displayName: "Harbor Angels Syndicate", kind: "organisation" };
    const beacon = { id: "beacon", displayName: "Beacon Ventures", kind: "organisation" };
    const employee = { id: "emp", displayName: "Tomas Weiss", kind: "team_member" };
    const entries = [entry("c1", ordinary, 6_000_000, 0), entry("c2", ordinary, 2_000_000, 0, { id: "co", displayName: "Priya", kind: "person" }), entry("o1", options, 50_000, 12, employee), entry("sa", safeA, 250_000, 100, harbor), entry("sb", safeB, 400_000, 100, beacon)];
    const cap = { securities: [ordinary, options, safeA, safeB], entries, summary: summaryOf(entries) };

    it("gives the new investor investment ÷ post-money whatever the SAFEs convert at, with no pool target", () => {
      const m = modelRound(cap, { preMoneyMinor: 400_000_000, investmentMinor: 100_000_000, poolTargetPct: 0 });
      expect(m.investorPct).toBeGreaterThanOrEqual(19.99);
      expect(m.investorPct).toBeLessThanOrEqual(20.01);
      // the stated post-money is what the price pays for: price × post-round fully diluted
      expect(Math.abs(m.pricePerShareMinor * m.postRoundFullyDiluted - m.postMoneyMinor) / m.postMoneyMinor).toBeLessThan(0.0001);
    });

    it("lands the unallocated pool on its target and keeps the investor at investment ÷ post-money", () => {
      const m = modelRound(cap, { preMoneyMinor: 800_000_000, investmentMinor: 200_000_000, poolTargetPct: 10 });
      const poolRow = m.rows.find((r) => r.kind === "pool")!;
      expect(poolRow.afterPct).toBeGreaterThanOrEqual(9.99);
      expect(poolRow.afterPct).toBeLessThanOrEqual(10.01);
      expect(m.investorPct).toBeGreaterThanOrEqual(19.99);
      expect(m.investorPct).toBeLessThanOrEqual(20.01);
      expect(Number.isInteger(m.newShares) && Number.isInteger(m.safeShares) && Number.isInteger(m.poolTopUpShares)).toBe(true);
    });
  });
});

describe("share registers", () => {
  it("writes a Delaware stock ledger with certificates per equity issuance", () => {
    const rows = delawareLedgerRows(capTable.entries, NOW, capTable.securities);
    expect(rows[0]![0]).toBe("Certificate No.");
    expect(rows).toHaveLength(4); // header + 2 common + 1 option; the SAFE is not stock
    expect(rows[1]).toEqual(["C-0001", "2025-10-01", "Mara Lindqvist", "Person", "Common", "common", 4_500_000, "0.01 EUR", "45000.00 EUR", "4y / 1y cliff · 25% vested", "Outstanding"]);
    expect(rows[3]![2]).toBe("Lena Okafor");
  });

  it("prices both registers in the share class's currency and names holder kinds in words (#170)", () => {
    const gbp: SecurityRow = { ...common, id: "s-gbp", class: "Ordinary", currency: "GBP" };
    const e = entry("g1", gbp, 50_000, 12, { id: "tw", displayName: "Tomas Weiss", kind: "team_member" }, { schedule: "4y", startsAt: "2026-03-25", cliffMonths: 12 });
    // the entry row says EUR (the column default); its class says GBP
    const delaware = delawareLedgerRows([e], NOW, [gbp]);
    expect(delaware[1]).toEqual(["C-0001", "2026-01-01", "Tomas Weiss", "Team member", "Ordinary", "common", 50_000, "0.12 GBP", "6000.00 GBP", "4y / 1y cliff · 0% vested", "Outstanding"]);
    expect(aktiebokRows([e], [gbp])[1]![7]).toBe("0.12 GBP");
    const org = entry("g2", gbp, 10, 100, { id: "org", displayName: "Harbor Angels", kind: "organisation" });
    expect(delawareLedgerRows([org], NOW, [gbp])[1]![3]).toBe("Organization");
  });

  it("numbers shares in sequence in the aktiebok and leaves options out", () => {
    const rows = aktiebokRows(capTable.entries, capTable.securities);
    expect(rows).toHaveLength(3);
    expect(rows[1]!.slice(0, 5)).toEqual([1, 4_500_000, 4_500_000, "Common", "Mara Lindqvist"]);
    expect(rows[2]!.slice(0, 3)).toEqual([4_500_001, 9_000_000, 4_500_000]);
    expect(rows[1]![5]).toBe("Fysisk person");
  });

  it("quotes CSV cells that need it", () => {
    expect(toCsv([["a", 'say "hi", now', 3]])).toBe('a,"say ""hi"", now",3');
  });
});

describe("one Base forecast on every screen (#173)", () => {
  const drivers = { startingCashMinor: 10_000_000, monthlyRevenueMinor: 1_000_000, revenueGrowthPct: 4, monthlyCostsMinor: 2_000_000, costGrowthPct: 2, horizonMonths: 12 };

  it("projects a stored version's drivers over its own months, so the Overview and the Runway tab draw the same line", () => {
    const stored = projectForecast(drivers, "2026-11");
    const row = { drivers: { ...drivers, runway_months: stored.runwayMonths }, series: stored.series };
    const fallback = seedDrivers("base", { cashMinor: 1, mrrMinor: 1, grossBurnMinor: 1 });
    const shown = storedProjection(row, fallback, "2026-10")!;
    expect(shown.series.map((p) => [p.month, p.cashMinor])).toEqual(stored.series.map((p) => [p.month, p.cashMinor]));
    expect(shown.series[0]!.month).toBe("2026-11"); // a saved version keeps its months, not today's
    expect(forecastStartMonth(row, "2026-10")).toBe("2026-11");
    expect(forecastStartMonth(null, "2026-10")).toBe("2026-10");
  });

  it("reads the cost line from the key the seeds used before the contract was settled", () => {
    const d = readDrivers({ startingCashMinor: 5, monthlyRevenueMinor: 1, monthlyOutflowMinor: 3_767_038, revenueGrowthPct: 4, costGrowthPct: 2 }, seedDrivers("base", { cashMinor: 0, mrrMinor: 0, grossBurnMinor: 3_345_948 }));
    expect(d.monthlyCostsMinor).toBe(3_767_038);
    expect(readDrivers({ monthlyCostsMinor: 9 }, seedDrivers("base", { cashMinor: 0, mrrMinor: 0, grossBurnMinor: 7 })).monthlyCostsMinor).toBe(9);
  });

  it("draws a version written without the driver contract from its stored series", () => {
    const series = [{ month: "2026-11", cashMinor: 100 }, { month: "2026-12", cashMinor: -50 }];
    const shown = storedProjection({ drivers: { runway_months: 1.5 }, series }, seedDrivers("base", { cashMinor: 0, mrrMinor: 0, grossBurnMinor: 0 }), "2026-10")!;
    expect(shown.series.map((p) => p.cashMinor)).toEqual([100, -50]);
    expect(shown.runwayMonths).toBe(1.5);
    expect(shown.zeroMonth).toBe("2026-12");
    expect(storedProjection(null, seedDrivers("base", { cashMinor: 0, mrrMinor: 0, grossBurnMinor: 0 }), "2026-10")).toBeNull();
  });

  it("describes the scenario from the drivers it holds", () => {
    expect(driversHint(drivers)).toBe("revenue up 4% and costs up 2% a month, over 12 months");
    expect(driversHint({ ...drivers, revenueGrowthPct: -2, costGrowthPct: 0, horizonMonths: 1 })).toBe("revenue down 2% and flat costs a month, over 1 month");
    expect(driversHint({ ...drivers, revenueGrowthPct: 2.5, costGrowthPct: -1 })).toBe("revenue up 2.5% and costs down 1% a month, over 12 months");
  });
});

describe("what a scenario's runway is called (#352)", () => {
  const live = { startingCashMinor: 25, monthlyRevenueMinor: 10, revenueGrowthPct: 0, monthlyCostsMinor: 20, costGrowthPct: 0, horizonMonths: 6 };
  it("says 'unknown' with its reason when there is no bank to project from", () => {
    const empty = { ...live, startingCashMinor: 0, monthlyRevenueMinor: 0, monthlyCostsMinor: 0 };
    expect(scenarioRunway(projectForecast(empty, "2026-10"), empty, { value: "Not known yet", caption: "Connect a bank to estimate it" })).toEqual({ kind: "unknown", value: "Not known yet", caption: "Connect a bank to estimate it" });
    // all-zero drivers are unknown even without a reason from the overview
    expect(scenarioRunway(projectForecast(empty, "2026-10"), empty, null)).toMatchObject({ kind: "unknown", value: "Not known yet" });
  });

  it("separates cash running out, burning past the horizon, and cash-flow positive", () => {
    expect(scenarioRunway(projectForecast(live, "2026-10"), live, null)).toEqual({ kind: "months", months: 2.5 });
    const slow = { ...live, startingCashMinor: 1_000 };
    expect(scenarioRunway(projectForecast(slow, "2026-10"), slow, null)).toEqual({ kind: "beyond", horizonMonths: 6 });
    const positive = { ...live, monthlyRevenueMinor: 30 };
    expect(scenarioRunway(projectForecast(positive, "2026-10"), positive, null)).toEqual({ kind: "no_limit" });
  });
});
