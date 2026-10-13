/** finance (accounts, transactions, totals, snapshots, forecasts), capTable (securities, entries, summary), usage (ledger, wages, credits). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isNonOperatingCategory, repos } from "../../repos";
import { day, setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("fin");
});
afterAll(() => r?.close());

describe("finance", () => {
  let accountId: string;

  it("upserts accounts idempotently and reports the cash position per currency", async () => {
    const a1 = await repos.finance.upsertAccount(r.db, r.A.businessId, { provider: "tink", externalId: "acc-1", name: "Operating", currency: "EUR", balanceMinor: 1_000_000, balanceAt: day("2026-10-01"), consentExpiresAt: day("2026-10-10") });
    const a1b = await repos.finance.upsertAccount(r.db, r.A.businessId, { provider: "tink", externalId: "acc-1", name: "Operating EUR", balanceMinor: 1_200_000 });
    expect(a1b.id).toBe(a1.id);
    expect(a1b.name).toBe("Operating EUR");
    accountId = a1.id;
    await repos.finance.upsertAccount(r.db, r.A.businessId, { provider: "tink", externalId: "acc-2", name: "Savings SEK", currency: "SEK", balanceMinor: 50_000_00 });
    const cash = await repos.finance.cashPosition(r.db, r.A.businessId);
    expect(cash.byCurrency.find((c) => c.currency === "EUR")?.balanceMinor).toBe(1_200_000);
    expect(cash.byCurrency.find((c) => c.currency === "SEK")?.balanceMinor).toBe(50_000_00);
    expect(cash.accounts).toHaveLength(3); // + fixture account
    const expiring = await repos.finance.consentsExpiring(r.db, r.A.businessId, day("2026-10-17"));
    expect(expiring.map((a) => a.id)).toEqual([accountId]);
    expect(await repos.finance.consentsExpiring(r.db, r.B.businessId, day("2026-12-31"))).toHaveLength(0);
  });

  it("upserts transactions by external id, keeps user categories, filters and aggregates", async () => {
    const written = await repos.finance.upsertTransactions(r.db, r.A.businessId, [
      { accountId, externalId: "t1", bookedAt: day("2026-07-05"), amountMinor: -120000, counterparty: "AWS", description: "Cloud", category: "hosting", categorySource: "model" },
      { accountId, externalId: "t2", bookedAt: day("2026-07-20"), amountMinor: 500000, counterparty: "Stripe", description: "Payout", category: "revenue", categorySource: "rule" },
      { accountId, externalId: "t3", bookedAt: day("2026-08-05"), amountMinor: -120000, counterparty: "AWS", description: "Cloud" },
      { accountId, externalId: "t4", bookedAt: day("2026-08-15"), amountMinor: -300000, counterparty: "Acme Payroll", description: "Salaries", category: "payroll", categorySource: "model" },
      { accountId, externalId: "t5", bookedAt: day("2026-09-05"), amountMinor: -120000, counterparty: "AWS", description: "Cloud" },
      { accountId, externalId: "t6", bookedAt: day("2026-09-25"), amountMinor: 200000, counterparty: "Stripe", description: "Payout", category: "revenue", categorySource: "rule" },
      { accountId, bookedAt: day("2026-09-26"), amountMinor: -1000, description: "Fee" },
    ]);
    expect(written).toBe(7);
    await expect(repos.finance.upsertTransactions(r.db, r.A.businessId, [{ accountId: r.B.accountId, bookedAt: day("2026-09-01"), amountMinor: 1 }])).rejects.toThrow(/account of this business/);

    const t1 = (await repos.finance.listTransactions(r.db, r.A.businessId, { q: "aws", from: day("2026-07-01"), to: day("2026-07-31") })).items[0]!;
    const user = await repos.finance.recategorise(r.db, r.A.businessId, t1.id, "infrastructure");
    expect(user.categorySource).toBe("user");
    // A re-sync must not overwrite the founder's category but does update the model-set one.
    await repos.finance.upsertTransactions(r.db, r.A.businessId, [
      { accountId, externalId: "t1", bookedAt: day("2026-07-05"), amountMinor: -120000, counterparty: "AWS", description: "Cloud", category: "hosting", categorySource: "model" },
      { accountId, externalId: "t4", bookedAt: day("2026-08-15"), amountMinor: -300000, counterparty: "Acme Payroll", description: "Salaries", category: "people", categorySource: "model" },
    ]);
    expect((await repos.finance.getTransaction(r.db, r.A.businessId, t1.id)).category).toBe("infrastructure");
    const t4 = (await repos.finance.listTransactions(r.db, r.A.businessId, { q: "payroll" })).items[0]!;
    expect(t4.category).toBe("people");
    expect(await repos.finance.recategoriseCounterparty(r.db, r.A.businessId, "aws", "infrastructure")).toBe(2); // t3 and t5, not the user-set t1
    expect((await repos.finance.listTransactions(r.db, r.A.businessId, { category: "infrastructure" })).items).toHaveLength(3);
    expect((await repos.finance.listTransactions(r.db, r.A.businessId, { uncategorised: true })).items.map((t) => t.description)).toEqual(["Fee"]);
    expect((await repos.finance.listTransactions(r.db, r.A.businessId, { direction: "in" })).items).toHaveLength(2);
    expect((await repos.finance.listTransactions(r.db, r.A.businessId, { minAmountMinor: -150000, maxAmountMinor: -100000 })).items).toHaveLength(3);
    expect((await r.svc((tx) => repos.finance.listTransactions(tx, r.B.businessId))).items).toHaveLength(0);

    const months = await repos.finance.monthlyTotals(r.db, r.A.businessId, { from: day("2026-07-01"), to: day("2026-10-01") });
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(months[0]).toMatchObject({ inflowMinor: 500000, outflowMinor: 120000, netMinor: 380000, count: 2 });
    expect(months[1]).toMatchObject({ inflowMinor: 0, outflowMinor: 420000 });
    const burn = await repos.finance.netBurn(r.db, r.A.businessId, { months: 3, asOf: day("2026-10-07") });
    expect(burn.grossBurnMinor).toBe(Math.round((120000 + 420000 + 121000) / 3));
    expect(burn.netBurnMinor).toBe(Math.round((661000 - 700000) / 3));
    const cats = await repos.finance.categoryTotals(r.db, r.A.businessId);
    expect(cats.find((c) => c.category === "revenue")?.inflowMinor).toBe(700000);
    expect(cats.find((c) => c.category === null)?.outflowMinor).toBe(1000);
  });

  it("net burn and gross burn leave financing and transfers out (BUILD §11.8: a raise never reads as income)", async () => {
    // April to June, before the July–September rows above: operating rows plus a SAFE, a director loan, its repayment
    // and a round trip through a savings account, categorized the ways the bank sync and the seeds store them.
    await repos.finance.upsertTransactions(r.db, r.A.businessId, [
      { accountId, externalId: "op-1", bookedAt: day("2026-04-10"), amountMinor: -300_000, counterparty: "Acme Payroll", category: "payroll" },
      { accountId, externalId: "op-2", bookedAt: day("2026-05-10"), amountMinor: -300_000, counterparty: "Acme Payroll", category: "payroll" },
      { accountId, externalId: "op-3", bookedAt: day("2026-06-10"), amountMinor: -300_000, counterparty: "Acme Payroll", category: "payroll" },
      { accountId, externalId: "op-4", bookedAt: day("2026-06-20"), amountMinor: 150_000, counterparty: "Stripe", category: "revenue" },
      { accountId, externalId: "fin-1", bookedAt: day("2026-05-02"), amountMinor: 40_000_000, counterparty: "Angel", category: "financing" },
      { accountId, externalId: "fin-2", bookedAt: day("2026-05-03"), amountMinor: 6_000_000, counterparty: "Director", category: "Director loan" },
      { accountId, externalId: "fin-3", bookedAt: day("2026-06-03"), amountMinor: -1_000_000, counterparty: "Director", category: "loan_repayment" },
      { accountId, externalId: "tr-1", bookedAt: day("2026-06-15"), amountMinor: -15_000_000, counterparty: "Savings", category: "transfer" },
      { accountId, externalId: "tr-2", bookedAt: day("2026-06-25"), amountMinor: 6_000_000, counterparty: "Savings", category: " Internal-Transfer " },
    ]);
    const months = await repos.finance.monthlyTotals(r.db, r.A.businessId, { from: day("2026-04-01"), to: day("2026-07-01") });
    // The plain totals keep every row (cash history needs them); the operating totals drop the non-operating ones.
    expect(months.find((m) => m.month === "2026-05")).toMatchObject({ inflowMinor: 46_000_000, outflowMinor: 300_000, operatingInflowMinor: 0, operatingOutflowMinor: 300_000 });
    expect(months.find((m) => m.month === "2026-06")).toMatchObject({ inflowMinor: 6_150_000, outflowMinor: 16_300_000, operatingInflowMinor: 150_000, operatingOutflowMinor: 300_000 });
    const burn = await repos.finance.netBurn(r.db, r.A.businessId, { months: 3, asOf: day("2026-07-02") });
    expect(burn.grossBurnMinor).toBe(300_000);
    expect(burn.netBurnMinor).toBe(Math.round((900_000 - 150_000) / 3));
    expect(burn.netBurnMinor).toBeGreaterThan(0); // still burning: runway warnings keep firing after the raise
    expect(isNonOperatingCategory("Share_Capital")).toBe(true);
    expect(isNonOperatingCategory("revenue")).toBe(false);
    expect(isNonOperatingCategory(null)).toBe(false);
  });

  it("ledger snapshots upsert per period/basis; forecasts version per scenario", async () => {
    await repos.finance.upsertSnapshot(r.db, r.A.businessId, { period: "2026-09", pnl: { revenue: 700000 }, source: "codat" });
    const again = await repos.finance.upsertSnapshot(r.db, r.A.businessId, { period: "2026-09", pnl: { revenue: 710000 } });
    expect(again.pnl).toEqual({ revenue: 710000 });
    expect(await repos.finance.listSnapshots(r.db, r.A.businessId)).toHaveLength(1);
    expect((await repos.finance.getSnapshot(r.db, r.A.businessId, "2026-09"))?.basis).toBe("cash");
    await expect(repos.finance.upsertSnapshot(r.db, r.A.businessId, { period: "Sept", pnl: {} })).rejects.toThrow(/Invalid ledger snapshot/);

    const f1 = await repos.finance.createForecast(r.db, r.A.businessId, { scenario: "base", drivers: { growth: 0.1 }, series: [{ month: "2026-11", cashMinor: 1 }] });
    const f2 = await repos.finance.createForecast(r.db, r.A.businessId, { scenario: "base", drivers: { growth: 0.12 } });
    await repos.finance.createForecast(r.db, r.A.businessId, { scenario: "downside", drivers: { growth: -0.05 } });
    const latest = await repos.finance.latestForecasts(r.db, r.A.businessId);
    expect(latest.base?.id).toBe(f2.id);
    expect(latest.downside).toBeDefined();
    expect(latest.upside).toBeUndefined();
    expect((await repos.finance.getForecast(r.db, r.A.businessId, f1.id)).archivedAt).toBeInstanceOf(Date);
    expect(await repos.finance.listForecasts(r.db, r.A.businessId, "base")).toHaveLength(1);
  });
});

describe("capTable", () => {
  it("issues positions against authorised quantities and summarises fully diluted ownership", async () => {
    const A = r.A.businessId;
    const common = await repos.capTable.createSecurity(r.db, A, { class: "Common", kind: "common", authorisedQuantity: 10000 });
    const pool = await repos.capTable.createSecurity(r.db, A, { class: "Option pool", kind: "option", authorisedQuantity: 1000 });
    const founder = await repos.entities.create(r.db, A, { kind: "person", displayName: "Founder One" });
    const angel = await repos.entities.create(r.db, A, { kind: "person", displayName: "Angel Investor" });
    await repos.capTable.createEntry(r.db, A, { holderEntityId: founder.id, securityId: common.id, quantity: 7000, issuedAt: "2026-01-01" });
    await repos.capTable.createEntry(r.db, A, { holderEntityId: angel.id, securityId: common.id, quantity: 1000, priceMinor: 500 });
    await repos.capTable.createEntry(r.db, A, { holderEntityId: founder.id, securityId: pool.id, quantity: 500, vesting: { cliffMonths: 12, months: 48 } });
    await expect(repos.capTable.createEntry(r.db, A, { holderEntityId: angel.id, securityId: common.id, quantity: 2500 })).rejects.toThrow(/exceeds the authorized/);
    await expect(repos.capTable.createEntry(r.db, A, { holderEntityId: r.B.entityId, securityId: common.id, quantity: 1 })).rejects.toThrow(/not an entity of this business/);
    await expect(repos.capTable.createEntry(r.db, r.B.businessId, { holderEntityId: r.B.entityId, securityId: common.id, quantity: 1 })).rejects.toThrow(/not found/);

    const summary = await repos.capTable.summary(r.db, A);
    expect(summary.totalQuantity).toBe(8500);
    expect(summary.byClass.find((c) => c.class === "Common")).toMatchObject({ quantity: 8000, holders: 2, authorisedQuantity: 10000 });
    expect(summary.byHolder[0]).toMatchObject({ displayName: "Founder One", quantity: 7500 });
    expect(summary.byHolder[0]!.fullyDilutedPct).toBeCloseTo(88.24, 1);
    expect(summary.byHolder[1]!.fullyDilutedPct).toBeCloseTo(11.76, 1);
    const entries = await repos.capTable.listEntries(r.db, A, { holderEntityId: founder.id });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.holder.displayName).toBe("Founder One");
    await expect(repos.capTable.archiveSecurity(r.db, A, pool.id)).rejects.toThrow(/issued positions/);
    const poolEntry = entries.find((e) => e.securityId === pool.id)!;
    await repos.capTable.archiveEntry(r.db, A, poolEntry.id);
    await repos.capTable.archiveSecurity(r.db, A, pool.id);
    expect((await repos.capTable.listSecurities(r.db, A)).map((s) => s.class)).toEqual(["Common", "Ordinary"]);
  });
});

describe("usage", () => {
  it("records usage, totals by kind, computes wages per agent and caps, and debits credits atomically", async () => {
    const A = r.A.businessId;
    await repos.usage.record(r.db, A, { agentId: r.A.agent2Id, sessionId: r.A.sessionId, kind: "tokens", modelKey: "sonnet", quantity: 120000, costMinor: 36, occurredAt: day("2026-10-02") });
    await repos.usage.record(r.db, A, { agentId: r.A.agent2Id, kind: "sandbox", quantity: 45, unit: "minutes", costMinor: 9, occurredAt: day("2026-10-02") });
    await repos.usage.record(r.db, A, { agentId: r.A.agentId, kind: "tokens", modelKey: "opus", quantity: 50000, costMinor: 120, occurredAt: day("2026-10-03"), billedTo: "byok" });
    await repos.usage.record(r.db, A, { kind: "training", quantity: 1, costMinor: 250, occurredAt: day("2026-10-04") });
    await repos.usage.record(r.db, A, { agentId: r.A.agentId, kind: "tokens", quantity: 1, costMinor: 999, occurredAt: day("2026-09-30") }); // previous month
    await expect(repos.usage.record(r.db, A, { kind: "tokens", costMinor: -1 })).rejects.toThrow(/Invalid usage entry/);
    // Third-party tool spend in the vendor's currency is listed apart, never added to the US dollar costs.
    await repos.usage.record(r.db, A, { agentId: r.A.agentId, kind: "tool", quantity: 1, unit: "calls", costMinor: 700, currency: "GBP", occurredAt: day("2026-10-03") });

    const totals = await repos.usage.totals(r.db, A, { from: day("2026-10-01"), to: day("2026-11-01") });
    expect(totals.currency).toBe("USD");
    expect(totals.costMinor).toBe(415);
    expect(totals.otherCurrencies).toEqual([{ currency: "GBP", costMinor: 700 }]);
    expect(totals.byKind.tokens.quantity).toBe(170000);
    expect(totals.byKind.tool).toEqual({ costMinor: 0, quantity: 1 });
    expect(totals.byBilledTo.byok).toBe(120);
    expect(totals.entries).toBe(5);
    // A row written without a currency is US dollars (platform costs are metered in the model price list's currency).
    expect(new Set((await repos.usage.list(r.db, A, { kind: ["tokens", "sandbox", "training"] })).items.map((u) => u.currency))).toEqual(new Set(["USD"]));
    const daily = await repos.usage.daily(r.db, A, { from: day("2026-10-01"), to: day("2026-11-01") });
    expect(daily.map((d) => d.costMinor)).toEqual([45, 120, 250]);

    const wages = await repos.usage.wages(r.db, A, "2026-10");
    expect(wages.map((w) => [w.agentId, w.costMinor])).toEqual([
      [null, 250],
      [r.A.agentId, 120],
      [r.A.agent2Id, 45],
    ]);
    expect(wages.find((w) => w.agentId === r.A.agent2Id)).toMatchObject({ tokens: 120000, sandboxMinutes: 45, trainingMinor: 0 });
    expect(wages.find((w) => w.agentId === r.A.agentId)).toMatchObject({ costMinor: 120, toolCalls: 1 });
    await repos.agents.update(r.db, A, r.A.agent2Id, { wageCapMinor: 100 });
    expect(await repos.usage.agentSpend(r.db, A, r.A.agent2Id, "2026-10")).toEqual({ costMinor: 45, wageCapMinor: 100, remainingMinor: 55 });
    // A training run books its model calls once, as tokens attributed to it; the Training column still shows them.
    await repos.usage.record(r.db, A, { agentId: r.A.agent2Id, kind: "tokens", quantity: 900, costMinor: 7, occurredAt: day("2026-10-05"), details: { kind: "training" } });
    await repos.usage.record(r.db, A, { agentId: r.A.agent2Id, kind: "tokens", quantity: 300, costMinor: 2, occurredAt: day("2026-10-05"), details: { kind: "skill_grader" } });
    await repos.usage.record(r.db, A, { agentId: r.A.agent2Id, kind: "training", quantity: 3, unit: "tests", costMinor: 0, occurredAt: day("2026-10-05") });
    expect((await repos.usage.wages(r.db, A, "2026-10")).find((w) => w.agentId === r.A.agent2Id)).toMatchObject({ costMinor: 54, tokens: 121200, trainingMinor: 9 });
    expect((await repos.usage.list(r.db, A, { agentId: r.A.agentId, kind: "tokens" })).items).toHaveLength(2);
    expect((await r.svc((tx) => repos.usage.list(tx, r.B.businessId))).items).toHaveLength(0);

    await repos.usage.grantCredits(r.db, A, "2026-10", 1000);
    const topped = await repos.usage.grantCredits(r.db, A, "2026-10", 500);
    expect(topped.balanceMinor).toBe(1500);
    expect(topped.grantedMinor).toBe(1500);
    const debited = await repos.usage.debitCredits(r.db, A, "2026-10", 1200);
    expect(debited.balanceMinor).toBe(300);
    expect(debited.spentMinor).toBe(1200);
    await expect(repos.usage.debitCredits(r.db, A, "2026-10", 301)).rejects.toThrow(/Insufficient credits/);
    await expect(repos.usage.debitCredits(r.db, r.B.businessId, "2026-10", 1)).rejects.toThrow(/Insufficient credits/);
    expect((await repos.usage.creditBalance(r.db, A, "2026-10"))?.balanceMinor).toBe(300);
    await expect(repos.usage.grantCredits(r.db, A, "2026/10", 1)).rejects.toThrow(/Invalid credit grant/);
    // Credits are US dollars: a grant in another currency is refused, never merged into the balance.
    await expect(repos.usage.grantCredits(r.db, A, "2026-10", 2500, "JPY")).rejects.toThrow(/Invalid credit grant/);
    expect((await repos.usage.creditBalance(r.db, A, "2026-10"))).toMatchObject({ balanceMinor: 300, currency: "USD" });
  });

  it("books a call made outside a session (a token id with no agent_sessions row) without a session link (audit ARB-06)", async () => {
    const A = r.A.businessId;
    const orphan = await repos.usage.record(r.db, A, { agentId: r.A.agentId, sessionId: "00000000-0000-4000-8000-00000000dead", kind: "tool", quantity: 1, unit: "calls", costMinor: 0, occurredAt: day("2026-10-05") });
    expect(orphan.sessionId).toBeNull();
    const linked = await repos.usage.record(r.db, A, { agentId: r.A.agent2Id, sessionId: r.A.sessionId, kind: "tool", quantity: 1, unit: "calls", costMinor: 0, occurredAt: day("2026-10-05") });
    expect(linked.sessionId).toBe(r.A.sessionId);
  });
});

describe("usage, calls under half a cent (0039)", () => {
  // A Haiku utility call is about 0.2 cents: stored per call as 0, thousands of them were free (audit BILL-09, CML-11).
  it("keeps each call's exact cost, adds the exact costs and rounds once in totals, wages and agent spend", async () => {
    const A = r.A.businessId;
    const at = day("2027-05-03");
    for (let i = 0; i < 10; i++) await repos.usage.record(r.db, A, { agentId: r.A.agent2Id, kind: "tokens", modelKey: "haiku", quantity: 1150, costMicroMinor: 175_000, occurredAt: at });
    const rows = (await repos.usage.list(r.db, A, { agentId: r.A.agent2Id, kind: "tokens" })).items.filter((u) => u.occurredAt.getUTCFullYear() === 2027);
    expect(rows).toHaveLength(10);
    expect(rows.every((u) => u.costMinor === 0 && Number(u.costMicroMinor) === 175_000)).toBe(true);
    // Ten 0.175-cent calls are 1.75 cents, not 0 (and not 10 × 1 after rounding up).
    const range = { from: day("2027-05-01"), to: day("2027-06-01") };
    const totals = await repos.usage.totals(r.db, A, range);
    expect(totals.costMinor).toBe(2);
    expect(totals.byKind.tokens.costMinor).toBe(2);
    expect(totals.byBilledTo.credits).toBe(2);
    expect((await repos.usage.daily(r.db, A, range)).map((d) => d.costMinor)).toEqual([2]);
    expect((await repos.usage.wages(r.db, A, "2027-05")).find((w) => w.agentId === r.A.agent2Id)?.costMinor).toBe(2);
    expect((await repos.usage.agentSpend(r.db, A, r.A.agent2Id, "2027-05")).costMinor).toBe(2);
  });

  it("a row written with only a rounded cost counts as that many cents; a micro-only row rounds for display", async () => {
    const A = r.A.businessId;
    const old = await repos.usage.record(r.db, A, { agentId: r.A.agentId, kind: "tokens", quantity: 1, costMinor: 3, occurredAt: day("2027-06-03") });
    expect(Number(old.costMicroMinor)).toBe(3_000_000);
    const micro = await repos.usage.record(r.db, A, { agentId: r.A.agentId, kind: "tokens", quantity: 1, costMicroMinor: 600_000, occurredAt: day("2027-06-03") });
    expect(micro.costMinor).toBe(1);
    expect((await repos.usage.totals(r.db, A, { from: day("2027-06-01"), to: day("2027-07-01") })).costMinor).toBe(4);
  });

  it("credits are charged what the calls cost: the sub-cent remainder is carried to the next charge", async () => {
    const B = r.B.businessId;
    await repos.usage.grantCredits(r.db, B, "2027-07", 100);
    const first = await repos.usage.chargeCreditsMicro(r.db, B, "2027-07", 400_000);
    expect(first).toMatchObject({ chargedMinor: 0, balance: { balanceMinor: 100, spentMinor: 0, carryMicroMinor: 400_000 } });
    const second = await repos.usage.chargeCreditsMicro(r.db, B, "2027-07", 700_000);
    expect(second).toMatchObject({ chargedMinor: 1, balance: { balanceMinor: 99, spentMinor: 1, carryMicroMinor: 100_000 } });
    // A whole-cent charge still works as before and keeps the carry.
    expect(await repos.usage.chargeCredits(r.db, B, "2027-07", 5)).toMatchObject({ balance: { balanceMinor: 94, spentMinor: 6, carryMicroMinor: 100_000 } });
  });
});
