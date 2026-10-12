/** finance (accounts, transactions, totals, snapshots, forecasts), capTable (securities, entries, summary), usage (ledger, wages, credits). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
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

    const totals = await repos.usage.totals(r.db, A, { from: day("2026-10-01"), to: day("2026-11-01") });
    expect(totals.costMinor).toBe(415);
    expect(totals.byKind.tokens.quantity).toBe(170000);
    expect(totals.byBilledTo.byok).toBe(120);
    expect(totals.entries).toBe(4);
    const daily = await repos.usage.daily(r.db, A, { from: day("2026-10-01"), to: day("2026-11-01") });
    expect(daily.map((d) => d.costMinor)).toEqual([45, 120, 250]);

    const wages = await repos.usage.wages(r.db, A, "2026-10");
    expect(wages.map((w) => [w.agentId, w.costMinor])).toEqual([
      [null, 250],
      [r.A.agentId, 120],
      [r.A.agent2Id, 45],
    ]);
    expect(wages.find((w) => w.agentId === r.A.agent2Id)).toMatchObject({ tokens: 120000, sandboxMinutes: 45 });
    await repos.agents.update(r.db, A, r.A.agent2Id, { wageCapMinor: 100 });
    expect(await repos.usage.agentSpend(r.db, A, r.A.agent2Id, "2026-10")).toEqual({ costMinor: 45, wageCapMinor: 100, remainingMinor: 55 });
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
  });
});
