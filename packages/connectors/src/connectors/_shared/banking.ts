/**
 * Open banking surface shared by Tink and Plaid (BUILD §11.8 Finance: read-only — AC-11.8.5 "no Finance
 * tool has a payment-initiation capability"). Both vendors map to the same account / transaction shapes;
 * each mock serves the deterministic 24-month history in `fixtures/bank-history.ts`. Granting the bank
 * consent is an OAuth consent the founder gives in Tink Link / Plaid Link (hard gate, BUILD §2.2).
 */
import { z } from "zod";
import { defineTool, type AnyToolSpec } from "../../define";
import { addDays, isoDay, makeEvent, MOCK_NOW, uuidFromSeed } from "../../mock-utils";
import { filterTransactions, type BankHistory } from "../../fixtures/bank-history";
import type { PlatformEvent, SimulateParams } from "../../contract";

const Money = z.object({ amountMinor: z.number().int(), currency: z.string().length(3) });

export const BankAccount = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["checking", "savings", "credit_card", "loan", "investment", "other"]),
  currency: z.string().length(3),
  iban: z.string().nullable(),
  mask: z.string().nullable(),
  booked: Money,
  available: Money.nullable(),
  balanceAt: z.string(),
  institution: z.string().nullable(),
});
export type BankAccountT = z.infer<typeof BankAccount>;

export const BankTransaction = z.object({
  id: z.string(),
  accountId: z.string(),
  /** Signed: inflows positive, outflows negative (Plaid's sign is flipped in the mapper). */
  amount: Money,
  bookedDate: z.string(),
  valueDate: z.string().nullable(),
  description: z.string(),
  counterparty: z.string().nullable(),
  status: z.enum(["booked", "pending"]),
  reference: z.string().nullable(),
  /** Vendor category when provided; the finance module's categoriser decides the ledger account. */
  category: z.string().nullable(),
});
export type BankTransactionT = z.infer<typeof BankTransaction>;

export const ConsentStatus = z.object({ status: z.enum(["active", "expiring", "expired", "revoked", "unknown"]), expiresAt: z.string().nullable(), daysRemaining: z.number().int().nullable(), institution: z.string().nullable(), accountIds: z.array(z.string()) });

export const SyncResult = z.object({ accounts: z.array(BankAccount), newTransactions: z.array(BankTransaction), cursor: z.string(), hasMore: z.boolean(), balanceAt: z.string(), consentExpiresAt: z.string().nullable() });

export interface BankingVendor {
  key: string;
  linkName: string;
  linkUrl: string;
}

/** The tool set, identical for every open-banking connector apart from vendor wording. */
export function makeBankingTools(v: BankingVendor) {
  return [
    defineTool({ name: "list_accounts", description: `Connected bank accounts with booked and available balances (${v.linkName}).`, input: z.object({}), output: z.object({ items: z.array(BankAccount) }), hints: {}, annotations: { readOnlyHint: true } }),
    defineTool({
      name: "list_transactions",
      description: "Booked and pending transactions for a date range (default: last 90 days), newest first. Descriptions come from the bank and are quarantined.",
      input: z.object({ accountId: z.string().min(1).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(), pageSize: z.number().int().min(1).max(500).default(100), pageToken: z.string().optional() }),
      output: z.object({ items: z.array(BankTransaction), nextPageToken: z.string().nullable() }),
      hints: {},
      untrusted: "api",
      untrustedRef: (a) => `transactions:${a.accountId ?? "all"}:${a.from ?? ""}:${a.to ?? ""}`,
      annotations: { readOnlyHint: true },
    }),
    defineTool({
      name: "sync",
      description: "Incremental sync: balances for every account plus transactions added since the cursor (first run: last 30 days). The finance module writes bank.balance_updated from the result.",
      input: z.object({ cursor: z.string().optional() }),
      output: SyncResult,
      hints: {},
      untrusted: "api",
      untrustedRef: (a) => `sync:${a.cursor ?? "initial"}`,
      annotations: { readOnlyHint: true },
    }),
    defineTool({ name: "get_consent_status", description: "Whether the bank consent is active and when it expires (open-banking consents lapse after 90–180 days; AC-11.8.2 warns 7 days before).", input: z.object({}), output: ConsentStatus, hints: {}, annotations: { readOnlyHint: true } }),
    defineTool({
      name: "start_consent",
      description: `HARD GATE (BUILD §2.2): granting bank access is an OAuth consent only the founder can give, in ${v.linkName}.`,
      input: z.object({ reason: z.string().max(1000).optional() }),
      hints: { hardGate: true, irreversible: true },
      humanAction: (a) => ({ title: `Connect your bank in ${v.linkName}`, instructions: `Open Settings → Integrations → ${v.linkName}, choose your bank and approve read-only access to accounts, balances and transactions. Agents never see your bank login.${a.reason ? ` Why: ${a.reason}` : ""}`, url: v.linkUrl }),
    }),
  ] as const;
}

export type BankingTools = ReturnType<typeof makeBankingTools>;

export const BANKING_RATE_LIMITS = { perMinute: 30, perDay: 2_000 };

export function consentStatusFrom(expiresAt: Date | null, now: Date, institution: string | null, accountIds: string[]): z.infer<typeof ConsentStatus> {
  if (!expiresAt) return { status: "unknown", expiresAt: null, daysRemaining: null, institution, accountIds };
  const daysRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000);
  return { status: daysRemaining < 0 ? "expired" : daysRemaining <= 7 ? "expiring" : "active", expiresAt: expiresAt.toISOString(), daysRemaining, institution, accountIds };
}

/* ---- Mock side over the shared bank history ---- */

export interface BankingMockOptions {
  provider: string;
  history: BankHistory;
  institution: string;
  consentExpiresAt: Date;
  now?: () => Date;
}

export function mockAccounts(o: BankingMockOptions): BankAccountT[] {
  return o.history.accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, iban: a.iban, mask: a.iban.slice(-4), booked: { amountMinor: a.balanceMinor, currency: a.currency }, available: { amountMinor: a.availableMinor, currency: a.currency }, balanceAt: a.asOf, institution: o.institution }));
}

export const mockTransaction = (t: BankHistory["transactions"][number]): BankTransactionT => ({ id: t.id, accountId: t.accountId, amount: { amountMinor: t.amountMinor, currency: t.currency }, bookedDate: t.bookedDate, valueDate: t.valueDate, description: t.description, counterparty: t.counterparty, status: t.status, reference: t.reference, category: t.category });

/** Handlers for the shared tool set; a connector spreads them into `buildMockConnector`. */
export function bankingMockHandlers(o: BankingMockOptions) {
  const now = o.now ?? (() => MOCK_NOW);
  const asOf = new Date(o.history.accounts[0]?.asOf ?? now().toISOString());
  const accountIds = new Set(o.history.accounts.map((a) => a.id));
  const accountOrThrow = (id: string | undefined) => {
    if (id !== undefined && !accountIds.has(id)) throw Object.assign(new Error(`account ${id} not found`), { status: 404 });
  };
  return {
    list_accounts: async () => ({ items: mockAccounts(o) }),
    list_transactions: async ({ accountId, from, to, pageSize, pageToken }: { accountId?: string; from?: string; to?: string; pageSize: number; pageToken?: string }) => {
      accountOrThrow(accountId);
      const start = from ?? isoDay(addDays(asOf, -90));
      const all = filterTransactions(o.history, { accountId, from: start, to }).reverse();
      const offset = pageToken ? Number.parseInt(pageToken, 10) || 0 : 0;
      const page = all.slice(offset, offset + pageSize);
      return { items: page.map(mockTransaction), nextPageToken: offset + pageSize < all.length ? String(offset + pageSize) : null };
    },
    sync: async ({ cursor }: { cursor?: string }) => {
      const since = cursor && /^\d{4}-\d{2}-\d{2}$/.test(cursor) ? cursor : isoDay(addDays(asOf, -30));
      const added = o.history.transactions.filter((t) => t.bookedDate > since);
      return { accounts: mockAccounts(o), newTransactions: added.map(mockTransaction), cursor: isoDay(asOf), hasMore: false, balanceAt: asOf.toISOString(), consentExpiresAt: o.consentExpiresAt.toISOString() };
    },
    get_consent_status: async () => consentStatusFrom(o.consentExpiresAt, now(), o.institution, [...accountIds]),
  };
}

/** `bank.sync` simulation shared by both mocks: a balance update computed from the history. */
export function bankSyncSimulation(o: BankingMockOptions, params: SimulateParams): PlatformEvent[] {
  const main = o.history.accounts[0]!;
  const occurredAt = params.occurredAt ?? (o.now ?? (() => MOCK_NOW))();
  const newTransactions = typeof params.newTransactions === "number" ? params.newTransactions : o.history.transactions.filter((t) => t.bookedDate > isoDay(addDays(new Date(main.asOf), -7))).length;
  const delta = typeof params.deltaMinor === "number" ? params.deltaMinor : o.history.transactions.filter((t) => t.accountId === main.id && t.bookedDate > isoDay(addDays(new Date(main.asOf), -7))).reduce((a, t) => a + t.amountMinor, 0);
  return [
    makeEvent("bank.balance_updated", {
      businessId: params.businessId,
      occurredAt,
      seed: `${o.provider}:${String(params.seed ?? "default")}`,
      payload: { accountId: main.id, provider: o.provider, accountName: main.name, balance: { amountMinor: main.balanceMinor, currency: main.currency }, previousBalance: { amountMinor: main.balanceMinor - delta, currency: main.currency }, delta: { amountMinor: delta, currency: main.currency }, balanceAt: occurredAt.toISOString(), newTransactions, consentExpiresAt: o.consentExpiresAt.toISOString() },
    }),
  ];
}

export function consentExpirySimulation(o: BankingMockOptions, connectorKey: string, params: SimulateParams): PlatformEvent[] {
  const occurredAt = params.occurredAt ?? (o.now ?? (() => MOCK_NOW))();
  const daysRemaining = typeof params.daysRemaining === "number" ? params.daysRemaining : Math.floor((o.consentExpiresAt.getTime() - occurredAt.getTime()) / 86_400_000);
  return [
    makeEvent("credential.expiring", {
      businessId: params.businessId,
      occurredAt,
      seed: `${connectorKey}:${String(params.seed ?? "default")}`,
      payload: { integrationId: uuidFromSeed("integration", connectorKey, params.businessId), credentialId: uuidFromSeed("credential", connectorKey, params.businessId), connectorKey, accountLabel: `${o.institution} (${connectorKey})`, expiresAt: addDays(occurredAt, daysRemaining).toISOString(), daysRemaining, affectedAgentIds: [uuidFromSeed("sim", params.businessId, "agent", "finance")], expired: daysRemaining <= 0 },
    }),
  ];
}

export type BankingHandlerMap = Record<BankingTools[number]["name"], unknown>;
export const bankingToolNames = (tools: readonly AnyToolSpec[]) => tools.map((t) => t.name);
