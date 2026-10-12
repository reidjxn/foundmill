/**
 * Ledgerly fixtures for the finance screens: hand-computed so the tests can assert to the minor unit (AC-11.8.1,
 * AC-11.8.4). Clock is 7 October 2026 (fake-source NOW): trailing 3 months are Jul–Sep, "this month" is 2026-10.
 */
import type { ChannelsListResponse, FinanceOverview, TeamAgentRow } from "@foundmill/widgets";
import type { AccountRow, CapTableResponse, CategoryTotal, ForecastRow, MembershipRow, MonthlyTotal, PnlResponse, TasksListResponse, TransactionRow, TransactionsListResponse, WagesResponse } from "../types";

export const BID = "00000000-0000-4000-8000-000000000001";
export const ACCOUNT = { ops: "11111111-1111-4111-8111-111111111111", savings: "11111111-1111-4111-8111-111111111112" } as const;
export const ENTITY = { stripe: "22222222-2222-4222-8222-222222222221", aws: "22222222-2222-4222-8222-222222222222", mara: "33333333-3333-4333-8333-333333333331", tomas: "33333333-3333-4333-8333-333333333332", northcap: "33333333-3333-4333-8333-333333333333", pool: "33333333-3333-4333-8333-333333333334", lena: "33333333-3333-4333-8333-333333333335" } as const;
export const SECURITY = { common: "44444444-4444-4444-8444-444444444441", options: "44444444-4444-4444-8444-444444444442", safe: "44444444-4444-4444-8444-444444444443" } as const;
export const AGENT = { atlas: "55555555-5555-4555-8555-555555555551", nova: "55555555-5555-4555-8555-555555555552", pip: "55555555-5555-4555-8555-555555555553" } as const;
export const TX = { stripe: "66666666-6666-4666-8666-666666666661", aws: "66666666-6666-4666-8666-666666666662", unknown: "66666666-6666-4666-8666-666666666663", payroll: "66666666-6666-4666-8666-666666666664", safe: "66666666-6666-4666-8666-666666666665" } as const;

/* Monthly totals Apr–Sep 2026: inflow, outflow (minor units, EUR). */
export const monthly: MonthlyTotal[] = [
  { month: "2026-04", inflowMinor: 1_200_000, outflowMinor: 3_000_000, netMinor: -1_800_000, count: 40 },
  { month: "2026-05", inflowMinor: 1_500_000, outflowMinor: 3_100_000, netMinor: -1_600_000, count: 42 },
  { month: "2026-06", inflowMinor: 1_700_000, outflowMinor: 3_300_000, netMinor: -1_600_000, count: 45 },
  { month: "2026-07", inflowMinor: 1_800_000, outflowMinor: 3_400_000, netMinor: -1_600_000, count: 48 },
  // August carries the €100,000 SAFE: in the plain totals, out of the operating ones (net burn never reads a raise).
  { month: "2026-08", inflowMinor: 12_000_000, outflowMinor: 3_500_000, netMinor: 8_500_000, count: 51, operatingInflowMinor: 2_000_000, operatingOutflowMinor: 3_500_000 },
  { month: "2026-09", inflowMinor: 2_200_000, outflowMinor: 3_600_000, netMinor: -1_400_000, count: 53 },
];

/** Cash €150,000; net burn €20,000/month → runway 7.5 months → under 12 and 9. */
export const overview: FinanceOverview = {
  cash: { amountMinor: 15_000_000, currency: "EUR", accounts: 2, asOf: "2026-10-07T06:00:00.000Z", label: "Cash in bank" },
  burn: { netBurnMinor: 2_000_000, grossBurnMinor: 3_500_000, months: 3, label: "Estimate", definition: "Operating outflows minus operating inflows, trailing 3-month average, financing excluded" },
  runway: { months: 7.5, label: "Estimate", warnings: [12, 9], blocksContinue: false },
  revenue: { monthly, basis: "cash", label: "Management P&L, unaudited, cash basis" },
  customers30d: 12,
  /** Every customer who paid in Jul–Sep (the payback base), not the 24 the channels acquired in the window. */
  payingCustomers: { count: 120, months: 3, from: "2026-07-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
  forecasts: {
    base: {
      id: "77777777-7777-4777-8777-777777777771",
      scenario: "base",
      currency: "EUR",
      label: "Forecast",
      createdAt: "2026-10-01T09:00:00.000Z",
      series: [
        { month: "2026-10", revenueMinor: 2_000_000, costsMinor: 3_500_000, netMinor: -1_500_000, cashMinor: 13_500_000 },
        { month: "2026-11", revenueMinor: 2_100_000, costsMinor: 3_535_000, netMinor: -1_435_000, cashMinor: 12_065_000 },
        { month: "2026-12", revenueMinor: 2_205_000, costsMinor: 3_570_350, netMinor: -1_365_350, cashMinor: 10_699_650 },
      ],
      ...({ drivers: { startingCashMinor: 15_000_000, monthlyRevenueMinor: 2_000_000, revenueGrowthPct: 5, monthlyCostsMinor: 3_500_000, costGrowthPct: 1, horizonMonths: 24, runway_months: 14.2 } } as object),
    },
  },
};

export const overviewBlocking: FinanceOverview = { ...overview, cash: { ...overview.cash, amountMinor: 5_000_000 }, runway: { months: 2.5, label: "Estimate", warnings: [12, 9, 6, 3], blocksContinue: true } };

/** Trailing Jul–Sep categories (hand-computed totals in metrics.test.ts). */
export const categories: CategoryTotal[] = [
  { category: "Revenue", inflowMinor: 6_000_000, outflowMinor: 0, count: 90 },
  { category: "Hosting", inflowMinor: 0, outflowMinor: 600_000, count: 9 },
  { category: "Payment fees", inflowMinor: 0, outflowMinor: 150_000, count: 30 },
  { category: "Payroll", inflowMinor: 0, outflowMinor: 4_500_000, count: 6 },
  { category: "Software", inflowMinor: 0, outflowMinor: 900_000, count: 24 },
  { category: "Marketing", inflowMinor: 0, outflowMinor: 1_200_000, count: 12 },
  { category: "Financing", inflowMinor: 10_000_000, outflowMinor: 0, count: 1 },
  { category: "Taxes", inflowMinor: 0, outflowMinor: 200_000, count: 1 },
  { category: null, inflowMinor: 0, outflowMinor: 300_000, count: 4 },
];

export const pnl: PnlResponse = { monthly: monthly.slice(3), categories, snapshots: [], source: "bank_categorised", label: "Management P&L, unaudited, cash basis" };

export const pnlLedger: PnlResponse = {
  ...pnl,
  source: "ledger",
  label: "Ledger",
  snapshots: [{ id: "88888888-8888-4888-8888-888888888881", period: "2026-09", basis: "accrual", currency: "EUR", source: "Xero via Codat", pnl: { lines: [{ label: "Revenue", amountMinor: 2_150_000, kind: "subtotal" }, { label: "Subscriptions", amountMinor: 2_150_000, depth: 1 }, { label: "Operating expenses", amountMinor: -3_400_000, kind: "subtotal" }, { label: "Net result", amountMinor: -1_250_000, kind: "total" }] } }],
};

export const accounts: AccountRow[] = [
  { id: ACCOUNT.ops, provider: "tink", externalId: "tink-ops", name: "Ledgerly operating", currency: "EUR", balanceMinor: 11_000_000, balanceAt: "2026-10-07T06:00:00.000Z", consentExpiresAt: "2026-10-12T00:00:00.000Z" },
  { id: ACCOUNT.savings, provider: "tink", externalId: "tink-sav", name: "Ledgerly savings", currency: "EUR", balanceMinor: 4_000_000, balanceAt: "2026-10-07T06:00:00.000Z", consentExpiresAt: "2027-01-15T00:00:00.000Z" },
];

export const transactions: TransactionRow[] = [
  { id: TX.stripe, accountId: ACCOUNT.ops, bookedAt: "2026-10-03T10:00:00.000Z", amountMinor: 740_000, currency: "EUR", counterparty: "Stripe", counterpartyEntityId: ENTITY.stripe, description: "Stripe payout 2026-10-03", category: "Revenue", categorySource: "rule" },
  { id: TX.aws, accountId: ACCOUNT.ops, bookedAt: "2026-10-02T08:00:00.000Z", amountMinor: -210_000, currency: "EUR", counterparty: "Amazon Web Services", counterpartyEntityId: ENTITY.aws, description: "AWS EMEA invoice 4471", category: "Hosting", categorySource: "model" },
  { id: TX.unknown, accountId: ACCOUNT.ops, bookedAt: "2026-10-01T08:00:00.000Z", amountMinor: -45_000, currency: "EUR", counterparty: "Figma Inc", counterpartyEntityId: null, description: "FIGMA 1839-22", category: null, categorySource: null },
  { id: TX.payroll, accountId: ACCOUNT.ops, bookedAt: "2026-09-28T08:00:00.000Z", amountMinor: -1_500_000, currency: "EUR", counterparty: "Payroll run", counterpartyEntityId: null, description: "September salaries", category: "Payroll", categorySource: "user" },
  { id: TX.safe, accountId: ACCOUNT.savings, bookedAt: "2026-08-14T08:00:00.000Z", amountMinor: 10_000_000, currency: "EUR", counterparty: "Northcap Ventures", counterpartyEntityId: ENTITY.northcap, description: "SAFE investment", category: "Financing", categorySource: "user" },
  { id: "66666666-6666-4666-8666-666666666666", accountId: ACCOUNT.ops, bookedAt: "2026-09-15T08:00:00.000Z", amountMinor: -60_000, currency: "EUR", counterparty: "Figma Inc", counterpartyEntityId: null, description: "FIGMA 1839-21", category: "Software", categorySource: "model" },
];

export const transactionsPage: TransactionsListResponse = { items: transactions, nextCursor: null };

export const forecasts: ForecastRow[] = [
  { id: "77777777-7777-4777-8777-777777777771", scenario: "base", currency: "EUR", createdAt: "2026-10-01T09:00:00.000Z", drivers: { startingCashMinor: 15_000_000, monthlyRevenueMinor: 2_000_000, revenueGrowthPct: 5, monthlyCostsMinor: 3_500_000, costGrowthPct: 1, horizonMonths: 24 }, series: [] },
  { id: "77777777-7777-4777-8777-777777777770", scenario: "base", currency: "EUR", createdAt: "2026-09-01T09:00:00.000Z", archivedAt: "2026-10-01T09:00:00.000Z", drivers: { startingCashMinor: 1 }, series: [] },
  { id: "77777777-7777-4777-8777-777777777772", scenario: "downside", currency: "EUR", createdAt: "2026-10-01T09:00:00.000Z", drivers: { startingCashMinor: 15_000_000, monthlyRevenueMinor: 2_000_000, revenueGrowthPct: 0, monthlyCostsMinor: 4_000_000, costGrowthPct: 2, horizonMonths: 24 }, series: [] },
];

export const channels: ChannelsListResponse = {
  channels: [
    { id: "c1", channelKey: "paid_ads", enabled: true, line: "attack", fit: 14, potential: 16, recommended: true, budgetMinor: 400_000, currency: "EUR", meta: { label: "Paid search", line: "attack", coreMetric: "CPA" }, form: { channelId: "c1", channelKey: "paid_ads", line: "attack", spendMinor: 800_000, impressions: 90_000, leads: 300, signups: 80, activations: 40, customers: 16, days: 90 } },
    { id: "c2", channelKey: "content", enabled: true, line: "midfield", fit: 12, potential: 15, recommended: false, budgetMinor: 200_000, currency: "EUR", meta: { label: "Content and SEO", line: "midfield", coreMetric: "signups" }, form: { channelId: "c2", channelKey: "content", line: "midfield", spendMinor: 400_000, impressions: 40_000, leads: 200, signups: 60, activations: 20, customers: 8, days: 90 } },
  ],
  lines: { attack: ["paid_ads"], midfield: ["content"], defence: [], wings: [] },
  blended: { spendMinor: 1_200_000, impressions: 130_000, leads: 500, signups: 140, activations: 60, customers: 24, days: 90 },
};

export const capTable: CapTableResponse = {
  securities: [
    { id: SECURITY.common, class: "Common", kind: "common", terms: {}, authorisedQuantity: 10_000_000, currency: "EUR" },
    { id: SECURITY.options, class: "2026 Option Plan", kind: "option", terms: {}, authorisedQuantity: 1_000_000, currency: "EUR" },
    { id: SECURITY.safe, class: "Post-money SAFE 2026", kind: "safe", terms: { valuationCapMinor: 1_000_000_000, discountPct: 20 }, authorisedQuantity: null, currency: "EUR" },
  ],
  entries: [
    { id: "e1", holderEntityId: ENTITY.mara, securityId: SECURITY.common, quantity: "4500000", priceMinor: 1, currency: "EUR", vesting: { months: 48, cliffMonths: 12, startDate: "2025-10-01" }, issuedAt: "2025-10-01", createdAt: "2025-10-01T10:00:00.000Z", updatedAt: "2025-10-01T10:00:00.000Z", holder: { id: ENTITY.mara, displayName: "Mara Lindqvist", kind: "person" }, security: { id: SECURITY.common, class: "Common", kind: "common" } },
    { id: "e2", holderEntityId: ENTITY.tomas, securityId: SECURITY.common, quantity: "4500000", priceMinor: 1, currency: "EUR", vesting: { months: 48, cliffMonths: 12, startDate: "2025-10-01" }, issuedAt: "2025-10-01", createdAt: "2025-10-01T10:00:00.000Z", updatedAt: "2025-10-01T10:00:00.000Z", holder: { id: ENTITY.tomas, displayName: "Tomas Berg", kind: "person" }, security: { id: SECURITY.common, class: "Common", kind: "common" } },
    { id: "e3", holderEntityId: ENTITY.lena, securityId: SECURITY.options, quantity: "200000", priceMinor: 50, currency: "EUR", vesting: { months: 48, cliffMonths: 12, startDate: "2026-04-01" }, issuedAt: "2026-04-01", createdAt: "2026-04-01T10:00:00.000Z", updatedAt: "2026-04-01T10:00:00.000Z", holder: { id: ENTITY.lena, displayName: "Lena Okafor", kind: "team_member" }, security: { id: SECURITY.options, class: "2026 Option Plan", kind: "option" } },
    { id: "e4", holderEntityId: ENTITY.northcap, securityId: SECURITY.safe, quantity: "1", priceMinor: 10_000_000, currency: "EUR", vesting: null, issuedAt: "2026-08-14", createdAt: "2026-08-14T10:00:00.000Z", updatedAt: "2026-08-14T10:00:00.000Z", holder: { id: ENTITY.northcap, displayName: "Northcap Ventures", kind: "organisation" }, security: { id: SECURITY.safe, class: "Post-money SAFE 2026", kind: "safe" } },
  ],
  summary: {
    totalQuantity: 9_200_001,
    byClass: [
      { securityId: SECURITY.common, class: "Common", kind: "common", quantity: 9_000_000, holders: 2, authorisedQuantity: 10_000_000, fullyDilutedPct: 97.83 },
      { securityId: SECURITY.options, class: "2026 Option Plan", kind: "option", quantity: 200_000, holders: 1, authorisedQuantity: 1_000_000, fullyDilutedPct: 2.17 },
      { securityId: SECURITY.safe, class: "Post-money SAFE 2026", kind: "safe", quantity: 1, holders: 1, authorisedQuantity: null, fullyDilutedPct: 0 },
    ],
    byHolder: [
      { holderEntityId: ENTITY.mara, displayName: "Mara Lindqvist", quantity: 4_500_000, fullyDilutedPct: 48.91, positions: [{ securityId: SECURITY.common, class: "Common", quantity: 4_500_000 }] },
      { holderEntityId: ENTITY.tomas, displayName: "Tomas Berg", quantity: 4_500_000, fullyDilutedPct: 48.91, positions: [{ securityId: SECURITY.common, class: "Common", quantity: 4_500_000 }] },
      { holderEntityId: ENTITY.lena, displayName: "Lena Okafor", quantity: 200_000, fullyDilutedPct: 2.17, positions: [{ securityId: SECURITY.options, class: "2026 Option Plan", quantity: 200_000 }] },
      { holderEntityId: ENTITY.northcap, displayName: "Northcap Ventures", quantity: 1, fullyDilutedPct: 0, positions: [{ securityId: SECURITY.safe, class: "Post-money SAFE 2026", quantity: 1 }] },
    ],
  },
};

export const emptyCapTable: CapTableResponse = { securities: [], entries: [], summary: { totalQuantity: 0, byClass: [], byHolder: [] } };

export const wages: WagesResponse = {
  period: "2026-10",
  label: "Estimate",
  rows: [
    { agentId: AGENT.atlas, name: "Atlas", costMinor: 42_000, tokens: 3_200_000, sandboxMinutes: 180, toolCalls: 420, trainingMinor: 2_000, wageCapMinor: 50_000 },
    { agentId: AGENT.nova, name: "Nova", costMinor: 12_500, tokens: 900_000, sandboxMinutes: 0, toolCalls: 130, trainingMinor: 0, wageCapMinor: 40_000 },
    { agentId: null, name: null, costMinor: 500, tokens: 20_000, sandboxMinutes: 0, toolCalls: 0, trainingMinor: 0, wageCapMinor: null },
  ],
  totalMinor: 55_000,
};

const dept = { id: "d-dev", name: "Development", colourToken: "dept-1" as const };
export const agents: TeamAgentRow[] = [
  { id: AGENT.atlas, name: "Atlas", role: "Engineering lead", status: "healthy", modelKey: "opus", avatarSeed: "atlas", departmentIds: [dept.id], departments: [dept], currentTask: null, skills: [], rating: 15, wage: { costMinor: 42_000, capMinor: 50_000, period: "2026-10", label: "Estimate" } },
  { id: AGENT.nova, name: "Nova", role: "Full-stack engineer", status: "idle", modelKey: "sonnet", avatarSeed: "nova", departmentIds: [dept.id], departments: [dept], currentTask: null, skills: [], rating: 12, wage: { costMinor: 12_500, capMinor: 40_000, period: "2026-10", label: "Estimate" } },
  { id: AGENT.pip, name: "Pip", role: "QA engineer", status: "paused", modelKey: "haiku", avatarSeed: "pip", departmentIds: [dept.id], departments: [dept], currentTask: null, skills: [], rating: 10, wage: { costMinor: 0, capMinor: null, period: "2026-10", label: "Estimate" } },
];
export const agentsResponse = { agents, templates: [] as string[] };

export const tasksDone: TasksListResponse = {
  items: [
    { id: "t1", kind: "code", title: "Usage index", departmentId: dept.id, assigneeAgentId: AGENT.atlas, status: "done", progress: 100, endedAt: "2026-10-03T10:00:00.000Z" },
    { id: "t2", kind: "code", title: "Bundle picker", departmentId: dept.id, assigneeAgentId: AGENT.atlas, status: "done", progress: 100, endedAt: "2026-10-05T10:00:00.000Z" },
    { id: "t3", kind: "code", title: "Invoice PDF", departmentId: dept.id, assigneeAgentId: AGENT.atlas, status: "done", progress: 100, endedAt: "2026-10-06T10:00:00.000Z" },
    { id: "t4", kind: "code", title: "Old task", departmentId: dept.id, assigneeAgentId: AGENT.nova, status: "done", progress: 100, endedAt: "2026-09-20T10:00:00.000Z" },
  ],
  nextCursor: null,
};

export const humans: MembershipRow[] = [
  { id: "m1", userId: "99999999-9999-4999-8999-999999999991", role: "owner", createdAt: "2025-10-01T10:00:00.000Z", displayName: "Mara Lindqvist" },
  { id: "m2", userId: "99999999-9999-4999-8999-999999999992", role: "member", createdAt: "2026-04-01T10:00:00.000Z", displayName: "Lena Okafor" },
];

/** P&L for a single month (wage bill period): payroll + contractors = €16,000. */
export const pnlOctober: PnlResponse = { monthly: [], categories: [{ category: "Payroll", inflowMinor: 0, outflowMinor: 1_500_000, count: 1 }, { category: "Contractors", inflowMinor: 0, outflowMinor: 100_000, count: 2 }, { category: "Revenue", inflowMinor: 740_000, outflowMinor: 0, count: 1 }], snapshots: [], source: "bank_categorised", label: "Management P&L, unaudited, cash basis" };

/** Everything every screen reads, keyed by procedure path. */
export const dataResponses: Record<string, unknown> = {
  "finance.overview": overview,
  "finance.pnl": (input: Record<string, unknown> | undefined) => (typeof input?.from === "string" && input.from.startsWith("2026-10-01") ? pnlOctober : pnl),
  "finance.accounts.list": accounts,
  "finance.transactions.list": transactionsPage,
  "finance.forecast.list": forecasts,
  "finance.capTable.get": capTable,
  "finance.wages": wages,
  "distribution.channels.list": channels,
  "team.agents.list": agentsResponse,
  "dev.tasks.list": tasksDone,
  "team.humans.list": humans,
};

export const emptyResponses: Record<string, unknown> = {
  "finance.overview": { ...overview, cash: { ...overview.cash, amountMinor: 0, accounts: 0, asOf: null }, burn: { ...overview.burn, netBurnMinor: 0, grossBurnMinor: 0 }, runway: { months: null, label: "Estimate", warnings: [], blocksContinue: false }, revenue: { monthly: [], basis: "cash", label: "Management P&L, unaudited, cash basis" }, customers30d: 0, forecasts: {} },
  "finance.pnl": { monthly: [], categories: [], snapshots: [], source: "bank_categorised", label: "Management P&L, unaudited, cash basis" },
  "finance.accounts.list": [],
  "finance.transactions.list": { items: [], nextCursor: null },
  "finance.forecast.list": [],
  "finance.capTable.get": emptyCapTable,
  "finance.wages": { period: "2026-10", label: "Estimate", rows: [], totalMinor: 0 },
  "distribution.channels.list": { channels: [], lines: { attack: [], midfield: [], defence: [], wings: [] }, blended: { spendMinor: 0, impressions: 0, leads: 0, signups: 0, activations: 0, customers: 0, days: 0 } },
  "team.agents.list": { agents: [], templates: [] },
  "dev.tasks.list": { items: [], nextCursor: null },
  "team.humans.list": [],
};
