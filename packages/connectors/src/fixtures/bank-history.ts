/**
 * Realistic 24 months of bank activity for a small software company, generated deterministically from a
 * seed. Shared by the Tink and Plaid mocks (each maps it to its vendor shape) and by the Finance module's
 * mock data. Patterns: weekly payment-processor payouts that grow month over month, payroll on the 25th,
 * rent on the 1st, SaaS tooling, quarterly VAT, insurance, bank fees, contractor invoices, one seed-round
 * deposit, one equipment purchase. Amounts are minor units; outflows are negative.
 */
import { addDays, createRng, isoDay, uuidFromSeed } from "../mock-utils";

export interface BankAccountFixture {
  id: string;
  externalId: string;
  name: string;
  type: "checking" | "savings";
  currency: string;
  iban: string;
  /** Balance at `asOf`. */
  balanceMinor: number;
  availableMinor: number;
  asOf: string;
}

export interface BankTransactionFixture {
  id: string;
  accountId: string;
  bookedDate: string; // YYYY-MM-DD
  valueDate: string;
  amountMinor: number;
  currency: string;
  description: string;
  counterparty: string;
  category: "revenue" | "payroll" | "rent" | "software" | "tax" | "insurance" | "fees" | "contractors" | "funding" | "equipment" | "transfer" | "travel" | "marketing";
  status: "booked" | "pending";
  reference: string;
}

export interface BankHistory {
  seed: string;
  currency: string;
  accounts: BankAccountFixture[];
  transactions: BankTransactionFixture[];
  monthlySummary: { month: string; inflowMinor: number; outflowMinor: number; closingBalanceMinor: number }[];
}

export interface BankHistoryOptions {
  seed: string;
  months?: number;
  currency?: string;
  /** End of the history (exclusive of later days). */
  asOf?: Date;
  openingBalanceMinor?: number;
  /** Monthly recurring revenue at the start, in minor units. */
  startMrrMinor?: number;
  /** Month-over-month MRR growth, e.g. 0.07. */
  growth?: number;
  companyName?: string;
}

const SOFTWARE_VENDORS = [
  ["GitHub", 4400],
  ["Vercel", 2000],
  ["Supabase", 2500],
  ["Google Workspace", 1440],
  ["Notion Labs", 1600],
  ["Linear", 1000],
  ["Slack", 1750],
  ["Figma", 1500],
  ["1Password", 798],
  ["Sentry", 2600],
  ["Anthropic", 18_000],
] as const;

export function generateBankHistory(opts: BankHistoryOptions): BankHistory {
  const months = opts.months ?? 24;
  const currency = opts.currency ?? "EUR";
  const asOf = opts.asOf ?? new Date("2026-10-01T00:00:00.000Z");
  const rng = createRng(`bank:${opts.seed}`);
  const company = opts.companyName ?? "Northwind Skincare";
  const checkingId = uuidFromSeed("bank", opts.seed, "checking");
  const savingsId = uuidFromSeed("bank", opts.seed, "savings");
  const iban = (suffix: string) => `DE${rng.int(10, 99)}3704${rng.int(1000, 9999)}0${suffix.padStart(9, "0")}`;

  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - months, 1));
  const transactions: BankTransactionFixture[] = [];
  let seq = 0;
  const push = (accountId: string, date: Date, amountMinor: number, description: string, counterparty: string, category: BankTransactionFixture["category"]) => {
    if (date >= asOf) return;
    seq += 1;
    transactions.push({
      id: uuidFromSeed("bank-tx", opts.seed, seq),
      accountId,
      bookedDate: isoDay(date),
      valueDate: isoDay(date),
      amountMinor: Math.round(amountMinor),
      currency,
      description,
      counterparty,
      category,
      status: "booked",
      reference: `${category.toUpperCase().slice(0, 3)}-${String(seq).padStart(5, "0")}`,
    });
  };

  let mrr = opts.startMrrMinor ?? 420_000; // €4,200
  const growth = opts.growth ?? 0.07;
  const salaries = [ { name: "Payroll — founder", amount: 450_000 }, { name: "Payroll — engineer", amount: 520_000 } ];

  for (let m = 0; m < months; m++) {
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1));
    const daysInMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
    const day = (d: number) => addDays(monthStart, Math.min(d, daysInMonth) - 1);

    // Revenue: weekly payouts (Stripe) summing roughly to MRR with noise; a few direct invoices.
    const payoutDays = [3, 10, 17, 24];
    for (const d of payoutDays) {
      const share = mrr / payoutDays.length;
      push(checkingId, day(d), Math.max(0, rng.gaussian(share, share * 0.12)), "STRIPE PAYOUT", "Stripe Payments Europe", "revenue");
    }
    if (m >= 4 && rng.bool(0.5)) push(checkingId, day(rng.int(5, 26)), rng.int(90_000, 600_000), `Invoice ${company} #${1000 + m}`, rng.pick(["Acme GmbH", "Lumen Retail", "Nordlicht AB", "Bright Dental", "Hallbergs Hud"]), "revenue");

    // Fixed costs
    push(checkingId, day(1), -165_000, "Office rent", "Kontorshotell Vasastan AB", "rent");
    push(checkingId, day(25), -salaries[0]!.amount, salaries[0]!.name, company, "payroll");
    if (m >= 6) push(checkingId, day(25), -salaries[1]!.amount, salaries[1]!.name, company, "payroll");
    if (m >= 6) push(checkingId, day(12), -Math.round((salaries[0]!.amount + salaries[1]!.amount) * 0.3142), "Employer contributions", "Skatteverket", "tax");
    else push(checkingId, day(12), -Math.round(salaries[0]!.amount * 0.3142), "Employer contributions", "Skatteverket", "tax");
    push(checkingId, day(2), -8_900, "Business insurance", "Hiscox", "insurance");
    push(checkingId, day(daysInMonth), -1_250, "Account fee", "Bank", "fees");

    // Software — a subset each month, Anthropic grows with usage
    for (const [vendor, base] of SOFTWARE_VENDORS) {
      if (vendor === "Anthropic") push(checkingId, day(rng.int(6, 9)), -Math.round(base * (1 + m * 0.08) * rng.gaussian(1, 0.1)), "ANTHROPIC API", "Anthropic PBC", "software");
      else if (rng.bool(0.92)) push(checkingId, day(rng.int(3, 20)), -base, vendor.toUpperCase(), vendor, "software");
    }

    // Contractors / marketing / travel
    if (rng.bool(0.55)) push(checkingId, day(rng.int(8, 28)), -rng.int(60_000, 240_000), "Contractor invoice — design", rng.pick(["Studio Nord", "Pixelwerk", "Maren Lind"]), "contractors");
    if (m >= 8 && rng.bool(0.7)) push(checkingId, day(rng.int(2, 27)), -rng.int(40_000, 180_000), "Ads spend", rng.pick(["Google Ads", "Meta Platforms Ireland"]), "marketing");
    if (rng.bool(0.25)) push(checkingId, day(rng.int(2, 27)), -rng.int(12_000, 95_000), "Travel", rng.pick(["SJ AB", "SAS", "Deutsche Bahn", "Scandic Hotels"]), "travel");

    // Quarterly VAT (net payable), paid in the month after the quarter
    if (m % 3 === 1) push(checkingId, day(12), -Math.round(mrr * 3 * 0.2 * 0.45), "VAT payment", "Skatteverket", "tax");

    // One-offs
    if (m === 2) {
      push(checkingId, day(14), 25_000_000, "Seed investment", "Nordic Seed Partners I", "funding");
      push(checkingId, day(15), -15_000_000, "Transfer to savings", company, "transfer");
      push(savingsId, day(15), 15_000_000, "Transfer from current", company, "transfer");
    }
    if (m === 5) push(checkingId, day(9), -489_000, "Laptops ×2", "Apple Retail", "equipment");
    if (m === 14) {
      push(savingsId, day(20), -6_000_000, "Transfer to current", company, "transfer");
      push(checkingId, day(20), 6_000_000, "Transfer from savings", company, "transfer");
    }
    if (m % 6 === 5) push(savingsId, day(daysInMonth), Math.round(15_000_000 * 0.0175 / 2), "Interest", "Bank", "revenue");

    mrr = Math.round(mrr * (1 + growth + rng.gaussian(0, 0.015)));
  }

  transactions.sort((a, b) => (a.bookedDate < b.bookedDate ? -1 : a.bookedDate > b.bookedDate ? 1 : a.id < b.id ? -1 : 1));

  const opening = opts.openingBalanceMinor ?? 3_200_000;
  const balances: Record<string, number> = { [checkingId]: opening, [savingsId]: 0 };
  const monthly = new Map<string, { inflowMinor: number; outflowMinor: number; closingBalanceMinor: number }>();
  for (const t of transactions) {
    balances[t.accountId] = (balances[t.accountId] ?? 0) + t.amountMinor;
    const month = t.bookedDate.slice(0, 7);
    const row = monthly.get(month) ?? { inflowMinor: 0, outflowMinor: 0, closingBalanceMinor: 0 };
    if (t.amountMinor >= 0) row.inflowMinor += t.amountMinor;
    else row.outflowMinor += -t.amountMinor;
    row.closingBalanceMinor = (balances[checkingId] ?? 0) + (balances[savingsId] ?? 0);
    monthly.set(month, row);
  }

  const accounts: BankAccountFixture[] = [
    { id: checkingId, externalId: `acc_${checkingId.slice(0, 12)}`, name: "Business current account", type: "checking", currency, iban: iban("1"), balanceMinor: balances[checkingId] ?? 0, availableMinor: (balances[checkingId] ?? 0) - 120_000, asOf: asOf.toISOString() },
    { id: savingsId, externalId: `acc_${savingsId.slice(0, 12)}`, name: "Savings", type: "savings", currency, iban: iban("2"), balanceMinor: balances[savingsId] ?? 0, availableMinor: balances[savingsId] ?? 0, asOf: asOf.toISOString() },
  ];

  return {
    seed: opts.seed,
    currency,
    accounts,
    transactions,
    monthlySummary: [...monthly.entries()].map(([month, v]) => ({ month, ...v })),
  };
}

/** Filter helpers used by both banking mocks. */
export function filterTransactions(history: BankHistory, filter: { accountId?: string; from?: string; to?: string }): BankTransactionFixture[] {
  return history.transactions.filter((t) => (!filter.accountId || t.accountId === filter.accountId) && (!filter.from || t.bookedDate >= filter.from) && (!filter.to || t.bookedDate <= filter.to));
}
