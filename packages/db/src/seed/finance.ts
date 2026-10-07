/**
 * Finance history for a demo business (BUILD §11.8): one open-banking account with 24 months of transactions that
 * reconcile to the journey's revenue (payouts), the squad's cost (platform wages), channel spend, suppliers and
 * fixed costs; cash-basis ledger snapshots for the last three months; Base/Upside/Downside forecasts; the current
 * credit balance and usage-ledger rows for the last 30 days of sessions. Everything is labelled Estimate/Forecast.
 */
import { APP_NAME } from "@foundmill/config";
import { repos } from "../repos";
import { transactions, usageLedger, type NewTransaction, type NewUsageEntry } from "../schema";
import { addDays, bulkInsert, dayKey, monthDay, monthKey, monthsBetween, type SeedCtx } from "./context";
import type { RecentSession } from "./journey";

export interface FixedCost {
  counterparty: string;
  category: string;
  amountMinor: number;
  cadence: "monthly" | "quarterly" | "yearly";
  description?: string;
  /** Day of the month the charge lands (1-28). */
  day?: number;
}

export interface FinancingEvent {
  at: Date;
  counterparty: string;
  amountMinor: number;
  description: string;
  category: string;
  counterpartyEntityId?: string | null;
}

export interface FinanceSeedOptions {
  businessId: string;
  slug: string;
  currency: string;
  provider: "tink" | "plaid";
  accountName: string;
  integrationId: string | null;
  consentExpiresAt: Date;
  /** Who pays the business: "Shopify Payments" / "Stripe". */
  payoutCounterparty: string;
  payoutCategory: string;
  revenueByMonth: Map<string, number>;
  agentSpendByMonth: Map<string, number>;
  adSpendByMonth: Map<string, number>;
  /** Cost of goods as a share of revenue (0 for software). */
  cogsRate: number;
  supplierNames: string[];
  supplierEntityIds?: string[];
  fixedCosts: FixedCost[];
  financing: FinancingEvent[];
  financeLeadAgentId: string | null;
  recentSessions: RecentSession[];
  /** Monthly recurring revenue right now (for the forecast drivers). */
  mrrMinorNow: number;
}

export interface FinanceSeedResult {
  accountId: string;
  balanceMinor: number;
  netBurnMinor: number;
  runwayMonths: number | null;
  transactions: number;
  usageRows: number;
  monthlyNet: Array<{ month: string; inMinor: number; outMinor: number }>;
}

const round = (n: number): number => Math.round(n);

export async function seedFinance(ctx: SeedCtx, opts: FinanceSeedOptions): Promise<FinanceSeedResult> {
  const rng = ctx.rng.fork(`finance:${opts.slug}`);
  const { db } = ctx;
  const months = monthsBetween(ctx.startDate, ctx.today);
  const todayMs = ctx.today.getTime();

  const account = await repos.finance.upsertAccount(db, opts.businessId, {
    provider: opts.provider,
    externalId: `${opts.provider}:${opts.slug}:main`,
    name: opts.accountName,
    currency: opts.currency,
    balanceMinor: 0,
    balanceAt: ctx.today,
    consentExpiresAt: opts.consentExpiresAt,
    integrationId: opts.integrationId,
  });

  const rows: NewTransaction[] = [];
  const push = (bookedAt: Date, amountMinor: number, counterparty: string, description: string, category: string, extra: Partial<NewTransaction> = {}) => {
    if (bookedAt.getTime() > todayMs || amountMinor === 0) return;
    rows.push({
      id: rng.uuid(),
      businessId: opts.businessId,
      accountId: account.id,
      externalId: `${opts.slug}:${dayKey(bookedAt)}:${rows.length}`,
      bookedAt,
      amountMinor: round(amountMinor),
      currency: opts.currency,
      counterparty,
      description,
      category,
      categorySource: "rule",
      ...extra,
    });
  };

  for (const f of opts.financing) push(f.at, f.amountMinor, f.counterparty, f.description, f.category, { counterpartyEntityId: f.counterpartyEntityId ?? null, categorySource: "user" });

  months.forEach((m, i) => {
    const revenue = opts.revenueByMonth.get(m) ?? 0;
    // Payouts land weekly, net of processor fees (2.9% + fixed), labelled by the processor.
    if (revenue > 0) {
      const net = revenue * 0.971;
      for (const d of [7, 14, 21, 28]) push(monthDay(m, d, 6), net / 4, opts.payoutCounterparty, `${opts.payoutCounterparty} payout`, opts.payoutCategory);
    }
    const agentSpend = opts.agentSpendByMonth.get(m) ?? 0;
    if (agentSpend > 0) push(monthDay(m, 28, 9), -agentSpend, APP_NAME, `${APP_NAME} squad usage (tokens, sandbox, tools)`, "agents");
    const adSpend = opts.adSpendByMonth.get(m) ?? 0;
    if (adSpend > 0) {
      push(monthDay(m, 15, 11), -adSpend * 0.6, "Meta Ads", "Advertising", "marketing");
      push(monthDay(m, 27, 11), -adSpend * 0.4, "Google Ads", "Advertising", "marketing");
    }
    if (opts.cogsRate > 0 && revenue > 0 && opts.supplierNames.length) {
      const idx = i % opts.supplierNames.length;
      push(monthDay(m, 10, 12), -revenue * opts.cogsRate, opts.supplierNames[idx]!, "Stock purchase", "cost_of_goods", { counterpartyEntityId: opts.supplierEntityIds?.[idx] ?? null });
    }
    for (const f of opts.fixedCosts) {
      const due = f.cadence === "monthly" || (f.cadence === "quarterly" && i % 3 === 0) || (f.cadence === "yearly" && i % 12 === 0);
      if (due) push(monthDay(m, f.day ?? 3, 8), -f.amountMinor, f.counterparty, f.description ?? f.counterparty, f.category);
    }
  });
  rows.sort((a, b) => (a.bookedAt as Date).getTime() - (b.bookedAt as Date).getTime());
  await bulkInsert(db, transactions, rows);

  const balanceMinor = rows.reduce((s, r) => s + (r.amountMinor as number), 0);
  await repos.finance.updateBalance(db, opts.businessId, account.id, balanceMinor, ctx.today);

  // Monthly net for the last three complete months (burn) and the ledger snapshots.
  const monthlyNet = months.map((m) => {
    const inMonth = rows.filter((r) => monthKey(r.bookedAt as Date) === m);
    return {
      month: m,
      inMinor: inMonth.filter((r) => (r.amountMinor as number) > 0 && r.category !== "financing").reduce((s, r) => s + (r.amountMinor as number), 0),
      outMinor: inMonth.filter((r) => (r.amountMinor as number) < 0).reduce((s, r) => s - (r.amountMinor as number), 0),
    };
  });
  const trailing = monthlyNet.slice(-4, -1);
  const netBurnMinor = trailing.length ? round(trailing.reduce((s, m) => s + (m.outMinor - m.inMinor), 0) / trailing.length) : 0;
  const runwayMonths = netBurnMinor > 0 ? Math.round((balanceMinor / netBurnMinor) * 10) / 10 : null;

  for (const m of monthlyNet.slice(-4, -1)) {
    const inMonth = rows.filter((r) => monthKey(r.bookedAt as Date) === m.month);
    const byCat = new Map<string, number>();
    for (const r of inMonth) byCat.set(r.category ?? "other", (byCat.get(r.category ?? "other") ?? 0) + (r.amountMinor as number));
    await repos.finance.upsertSnapshot(db, opts.businessId, {
      period: m.month,
      basis: "cash",
      currency: opts.currency,
      source: "bank",
      pnl: {
        label: "Management P&L, unaudited, cash basis",
        revenueMinor: byCat.get(opts.payoutCategory) ?? 0,
        costOfGoodsMinor: -(byCat.get("cost_of_goods") ?? 0),
        marketingMinor: -(byCat.get("marketing") ?? 0),
        agentsMinor: -(byCat.get("agents") ?? 0),
        softwareMinor: -(byCat.get("software") ?? 0),
        otherMinor: -[...byCat.entries()].filter(([k]) => !["cost_of_goods", "marketing", "agents", "software", "financing", opts.payoutCategory].includes(k)).reduce((s, [, v]) => s + v, 0),
        netMinor: m.inMinor - m.outMinor,
      },
    });
  }

  // Forecasts: 12 months of cash under three scenarios, driver-based and labelled.
  const lastRevenue = monthlyNet.slice(-2, -1)[0]?.inMinor ?? 0;
  const lastOut = monthlyNet.slice(-2, -1)[0]?.outMinor ?? 0;
  const scenarios = [
    { scenario: "base" as const, growth: 0.04, costGrowth: 0.02 },
    { scenario: "upside" as const, growth: 0.08, costGrowth: 0.03 },
    { scenario: "downside" as const, growth: -0.02, costGrowth: 0.01 },
  ];
  for (const s of scenarios) {
    let cash = balanceMinor;
    let revenue = lastRevenue;
    let out = lastOut;
    const series: Array<Record<string, unknown>> = [];
    for (let k = 1; k <= 12; k++) {
      revenue = revenue * (1 + s.growth);
      out = out * (1 + s.costGrowth);
      cash = cash + revenue - out;
      const month = monthKey(addDays(ctx.today, 30 * k));
      series.push({ month, revenueMinor: round(revenue), outflowMinor: round(out), cashMinor: round(cash), runwayMonths: out > revenue ? Math.max(0, Math.round((cash / (out - revenue)) * 10) / 10) : null, label: "Forecast" });
    }
    await repos.finance.createForecast(db, opts.businessId, {
      scenario: s.scenario,
      currency: opts.currency,
      drivers: { label: "Forecast", startingCashMinor: balanceMinor, monthlyRevenueMinor: round(lastRevenue), revenueGrowthPct: s.growth * 100, monthlyOutflowMinor: round(lastOut), costGrowthPct: s.costGrowth * 100, mrrMinorNow: opts.mrrMinorNow },
      series,
      generatedByAgentId: opts.financeLeadAgentId,
    });
  }

  // Credits and usage ledger (last 30 days of sessions).
  const period = monthKey(ctx.today);
  const usageRows: NewUsageEntry[] = opts.recentSessions.map((s) => ({
    id: rng.uuid(),
    businessId: opts.businessId,
    agentId: s.agentId,
    sessionId: s.id,
    kind: "tokens",
    modelKey: s.modelKey,
    quantity: s.tokensIn + s.tokensOut,
    unit: "tokens",
    costMinor: s.costMinor,
    currency: opts.currency,
    billedTo: "credits",
    occurredAt: s.occurredAt,
    details: { tokensIn: s.tokensIn, tokensOut: s.tokensOut, label: "Estimate" },
  }));
  await bulkInsert(db, usageLedger, usageRows);
  const spentThisPeriod = usageRows.filter((u) => monthKey(u.occurredAt as Date) === period).reduce((s, u) => s + (u.costMinor as number), 0);
  await repos.usage.grantCredits(db, opts.businessId, period, Math.max(spentThisPeriod + 50_000, 100_000), opts.currency);
  if (spentThisPeriod > 0) await repos.usage.debitCredits(db, opts.businessId, period, spentThisPeriod);

  return { accountId: account.id, balanceMinor, netBurnMinor, runwayMonths, transactions: rows.length, usageRows: usageRows.length, monthlyNet };
}
