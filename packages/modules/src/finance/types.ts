/**
 * Structural types for the tRPC responses the finance screens read through `useWidgetQuery` (BUILD §8.3
 * `finance.*`, apps/api/src/routers/finance.ts). Declared here, not imported from apps/api, so the package depends
 * only on wave-1 packages. Dates arrive as ISO strings on the wire; money is in minor units.
 */
import type { SecurityKind } from "@foundmill/shared";
import type { ChannelsListResponse, FinanceOverview, ForecastRecord, Page, TaskRow, TeamAgentRow } from "@foundmill/widgets";

export type { ChannelsListResponse, FinanceOverview, ForecastRecord, Page, TaskRow, TeamAgentRow };

export type Iso = string;

/* finance.accounts.list (proposed; see PROGRESS) */
export interface AccountRow {
  id: string;
  provider: string;
  externalId?: string;
  name: string;
  currency: string;
  balanceMinor: number;
  balanceAt: Iso | null;
  consentExpiresAt: Iso | null;
  integrationId?: string | null;
  archivedAt?: Iso | null;
}
export type AccountsListResponse = AccountRow[] | { accounts: AccountRow[] };

/* finance.transactions.list */
export type CategorySource = "rule" | "model" | "ledger" | "user";
export interface TransactionRow {
  id: string;
  accountId: string;
  externalId?: string | null;
  bookedAt: Iso;
  amountMinor: number;
  currency: string;
  counterparty: string | null;
  counterpartyEntityId: string | null;
  description: string;
  category: string | null;
  categorySource: CategorySource | null;
}
export type TransactionsListResponse = Page<TransactionRow>;

/* finance.pnl */
export interface MonthlyTotal {
  month: string;
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
  count: number;
}
export interface CategoryTotal {
  category: string | null;
  inflowMinor: number;
  outflowMinor: number;
  count: number;
}
export interface LedgerSnapshotRow {
  id: string;
  period: string;
  basis: "accrual" | "cash" | string;
  currency: string;
  pnl: Record<string, unknown>;
  source: string | null;
  updatedAt?: Iso;
}
export interface PnlResponse {
  monthly: MonthlyTotal[];
  categories: CategoryTotal[];
  snapshots: LedgerSnapshotRow[];
  source: "ledger" | "bank_categorised" | string;
  label: string;
}

/* finance.forecast.list / finance.forecast.update */
export type ForecastScenario = "base" | "upside" | "downside";
export const FORECAST_SCENARIOS: readonly ForecastScenario[] = ["base", "upside", "downside"];

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
export interface ForecastRow {
  id: string;
  scenario: ForecastScenario | string;
  currency: string;
  drivers: Record<string, unknown>;
  series: unknown[];
  generatedByAgentId?: string | null;
  createdAt: Iso;
  archivedAt?: Iso | null;
}

/* finance.capTable.get */
export interface SecurityRow {
  id: string;
  class: string;
  kind: SecurityKind;
  terms: Record<string, unknown>;
  authorisedQuantity: number | string | null;
  currency: string;
}
export interface CapTableEntryRow {
  id: string;
  holderEntityId: string;
  securityId: string;
  quantity: number | string;
  priceMinor: number | null;
  currency: string;
  vesting: Record<string, unknown> | null;
  issuedAt: string | null;
  createdAt?: Iso;
  updatedAt?: Iso;
  archivedAt?: Iso | null;
  holder: { id: string; displayName: string; kind: string };
  security: { id: string; class: string; kind: SecurityKind };
}
export interface CapTableSummary {
  totalQuantity: number;
  byClass: { securityId: string; class: string; kind: SecurityKind; quantity: number; holders: number; authorisedQuantity: number | null; fullyDilutedPct: number }[];
  byHolder: { holderEntityId: string; displayName: string; quantity: number; fullyDilutedPct: number; positions: { securityId: string; class: string; quantity: number }[] }[];
}
export interface CapTableResponse {
  securities: SecurityRow[];
  entries: CapTableEntryRow[];
  summary: CapTableSummary;
}

/* finance.wages */
export interface WageRow {
  agentId: string | null;
  name: string | null;
  costMinor: number;
  tokens: number;
  sandboxMinutes: number;
  toolCalls: number;
  trainingMinor: number;
  wageCapMinor: number | null;
}
export interface WagesResponse {
  period: string;
  label: "Estimate";
  rows: WageRow[];
  totalMinor: number;
}

/* dev.tasks.list */
export interface TasksListResponse extends Page<TaskRow> {
  counts?: Record<string, number>;
}

/* team.humans.list */
export interface MembershipRow {
  id: string;
  userId: string;
  role: string;
  createdAt?: Iso;
  displayName?: string | null;
  email?: string | null;
}
