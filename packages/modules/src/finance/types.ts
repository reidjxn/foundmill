/**
 * Structural types for the tRPC responses the finance screens read through `useWidgetQuery` (BUILD §8.3
 * `finance.*`, apps/api/src/routers/finance.ts). Declared here, not imported from apps/api, so the package depends
 * only on wave-1 packages. Dates arrive as ISO strings on the wire; money is in minor units.
 */
import type { SecurityKind } from "@foundmill/shared";
import type { ChannelsListResponse, FinanceOverview, ForecastRecord, Page, TaskRow, TeamAgentRow } from "@foundmill/widgets/shared/types";

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
  /** A Date over the wire (superjson) or an ISO string from a fixture: read it with `toDate`. */
  bookedAt: Iso | Date;
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

/** The driver contract of a forecast version (stored as `forecasts.drivers`) and its projected points. */
export type { ForecastDrivers, ForecastPoint } from "@foundmill/shared/forecast";

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
  /** Fully diluted shares: issued shares and options; SAFEs and notes are left out until they convert. */
  totalQuantity: number;
  /** A convertible (SAFE or note) class has no fully diluted percentage; its `quantity` is principal units. */
  byClass: { securityId: string; class: string; kind: SecurityKind; convertible: boolean; quantity: number; holders: number; authorisedQuantity: number | null; fullyDilutedPct: number | null }[];
  /** `quantity` counts shares and options; `fullyDilutedPct` is null for a holder of convertibles alone. */
  byHolder: { holderEntityId: string; displayName: string; quantity: number; fullyDilutedPct: number | null; positions: { securityId: string; class: string; convertible: boolean; quantity: number }[] }[];
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
  /** The agent's currency, which its wage cap is in. */
  wageCapCurrency?: string | null;
}
export interface WagesResponse {
  period: string;
  label: "Estimate";
  /** The currency every cost here is in: US dollars, the model price list's (absent from older answers). */
  currency?: string;
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
  /** The member's CRM `team_member` record name, or their own profile name for the signed-in member. */
  displayName?: string | null;
  email?: string | null;
  /** The member's CRM `team_member` record (null when the CRM has none: no link then). */
  entityId?: string | null;
}
