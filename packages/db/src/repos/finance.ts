/**
 * accounts, transactions, ledger_snapshots, forecasts — the Finance module's data (BUILD §11.8; routers
 * finance.overview / pnl / transactions.recategorise / forecast.update).
 *
 * Read-only module: nothing here moves money. Bank rows are produced by the open-banking connectors
 * (`upsertAccount`, `upsertTransactions` are idempotent on the provider's ids); the founder's
 * recategorisations are written with `categorySource: "user"` and become rules upstream. Every derived
 * number (`cashPosition`, `monthlyTotals`, `categoryTotals`) is a cash-basis aggregate the UI labels
 * "Estimate" unless a ledger snapshot exists.
 */
import { NON_OPERATING_CATEGORY_KEYS, ValidationError } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  accounts, CATEGORY_SOURCES, FORECAST_SCENARIOS, forecasts, LEDGER_BASES, ledgerSnapshots, transactions,
  type Account, type Forecast, type LedgerSnapshot, type Transaction,
} from "../schema";
import { Currency, DateRange, defined, Id, IsoDateInput, JsonArray, JsonObject, MinorAmount, one, PageInput, parseInput, timeKeyset, timeRange, toPage, type Executor, type Page } from "./_shared";

export const UpsertAccountInput = z.object({
  provider: z.string().min(1).max(40),
  externalId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  currency: Currency.optional(),
  balanceMinor: MinorAmount.optional(),
  balanceAt: IsoDateInput.nullable().optional(),
  consentExpiresAt: IsoDateInput.nullable().optional(),
  integrationId: Id.nullable().optional(),
});
export type UpsertAccountInput = z.input<typeof UpsertAccountInput>;

export const UpsertTransactionInput = z.object({
  accountId: Id,
  externalId: z.string().min(1).max(200).nullable().optional(),
  bookedAt: IsoDateInput,
  amountMinor: MinorAmount,
  currency: Currency.optional(),
  counterparty: z.string().max(200).nullable().optional(),
  counterpartyEntityId: Id.nullable().optional(),
  description: z.string().max(1000).default(""),
  category: z.string().max(80).nullable().optional(),
  categorySource: z.enum(CATEGORY_SOURCES).nullable().optional(),
});
export type UpsertTransactionInput = z.input<typeof UpsertTransactionInput>;

export const TransactionListFilter = PageInput.extend(DateRange.shape).extend({
  accountId: Id.optional(),
  category: z.union([z.string(), z.array(z.string())]).optional(),
  uncategorised: z.boolean().optional(),
  categorySource: z.enum(CATEGORY_SOURCES).optional(),
  counterpartyEntityId: Id.optional(),
  /** Case-insensitive substring over counterparty and description. */
  q: z.string().trim().max(200).optional(),
  minAmountMinor: MinorAmount.optional(),
  maxAmountMinor: MinorAmount.optional(),
  direction: z.enum(["in", "out"]).optional(),
});
export type TransactionListFilter = z.input<typeof TransactionListFilter>;

export const UpsertLedgerSnapshotInput = z.object({
  /** YYYY-MM for months, YYYY-Qn for quarters, YYYY for years. */
  period: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2])|-Q[1-4])?$/),
  basis: z.enum(LEDGER_BASES).default("cash"),
  currency: Currency.optional(),
  pnl: JsonObject,
  source: z.string().max(80).nullable().optional(),
});
export type UpsertLedgerSnapshotInput = z.input<typeof UpsertLedgerSnapshotInput>;

export const CreateForecastInput = z.object({
  scenario: z.enum(FORECAST_SCENARIOS),
  currency: Currency.optional(),
  drivers: JsonObject.default({}),
  series: JsonArray.default([]),
  generatedByAgentId: Id.nullable().optional(),
});
export type CreateForecastInput = z.input<typeof CreateForecastInput>;

export interface CashPosition {
  /** Sum of latest balances per currency (no FX applied here; the module converts at the ECB rate and labels it). */
  byCurrency: { currency: string; balanceMinor: number; accounts: number; oldestBalanceAt: Date | null }[];
  accounts: Account[];
}

export interface MonthlyTotal {
  month: string;
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
  count: number;
  /** Inflows that are operating cash flow: financing and transfers between the business's own accounts left out. */
  operatingInflowMinor: number;
  /** Outflows that are operating cash flow (loan repayments and transfers left out): gross burn's input. */
  operatingOutflowMinor: number;
}

export interface CategoryTotal {
  category: string | null;
  inflowMinor: number;
  outflowMinor: number;
  count: number;
}

/**
 * Category keys that are not operating cash flow (BUILD §11.8: net burn is "operating outflows − operating inflows,
 * financing excluded"): raising or repaying money, and moving it between the business's own accounts. Matched on the
 * normalized key (lower case, `_` and `-` read as spaces). The list lives in packages/shared, where the finance module's
 * chart of accounts files exactly these under Financing and Transfers, so the burn tiles and the P&L agree on what a
 * raise is.
 */
const NON_OPERATING_KEYS: readonly string[] = [...NON_OPERATING_CATEGORY_KEYS.financing, ...NON_OPERATING_CATEGORY_KEYS.transfers];

/** True for a category that is not operating cash flow (null and unknown categories are operating). */
export function isNonOperatingCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return NON_OPERATING_KEYS.includes(category.trim().toLowerCase().replace(/[_\s-]+/g, " "));
}

/** SQL twin of `isNonOperatingCategory` over `transactions.category`. */
const nonOperating = sql`coalesce(regexp_replace(lower(trim(${transactions.category})), '[_[:space:]-]+', ' ', 'g') in (${sql.join(NON_OPERATING_KEYS.map((k) => sql`${k}`), sql`, `)}), false)`;

const scopedAccount = (businessId: string, accountId: string) => and(eq(accounts.businessId, businessId), eq(accounts.id, accountId));
const scopedTx = (businessId: string, txId: string) => and(eq(transactions.businessId, businessId), eq(transactions.id, txId));
const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

export const financeRepo = {
  // accounts ----------------------------------------------------------------------------------------------------------
  async listAccounts(db: Executor, businessId: string, options: { includeArchived?: boolean } = {}): Promise<Account[]> {
    return db
      .select()
      .from(accounts)
      .where(and(eq(accounts.businessId, businessId), options.includeArchived ? undefined : isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.provider), asc(accounts.name));
  },

  async getAccount(db: Executor, businessId: string, accountId: string): Promise<Account> {
    return one(await db.select().from(accounts).where(scopedAccount(businessId, accountId)).limit(1), "account", accountId);
  },

  /** Idempotent on (provider, external_id): the connector's sync calls this for every account it sees. */
  async upsertAccount(db: Executor, businessId: string, input: UpsertAccountInput): Promise<Account> {
    const v = parseInput(UpsertAccountInput, input, "account");
    const patch = defined({ name: v.name, currency: v.currency, balanceMinor: v.balanceMinor, balanceAt: v.balanceAt, consentExpiresAt: v.consentExpiresAt, integrationId: v.integrationId, archivedAt: null });
    return one(
      await db
        .insert(accounts)
        .values({ businessId, provider: v.provider, externalId: v.externalId, ...patch, name: v.name })
        .onConflictDoUpdate({ target: [accounts.businessId, accounts.provider, accounts.externalId], set: patch })
        .returning(),
      "account",
    );
  },

  async updateBalance(db: Executor, businessId: string, accountId: string, balanceMinor: number, balanceAt: Date = new Date()): Promise<Account> {
    const v = parseInput(z.object({ balanceMinor: MinorAmount, balanceAt: IsoDateInput }), { balanceMinor, balanceAt }, "balance");
    return one(await db.update(accounts).set({ balanceMinor: v.balanceMinor, balanceAt: v.balanceAt }).where(scopedAccount(businessId, accountId)).returning(), "account", accountId);
  },

  async archiveAccount(db: Executor, businessId: string, accountId: string): Promise<Account> {
    return one(await db.update(accounts).set({ archivedAt: new Date() }).where(scopedAccount(businessId, accountId)).returning(), "account", accountId);
  },

  /** Accounts whose open-banking consent lapses before `before` (AC-11.8.2: reminder 7 days ahead). */
  async consentsExpiring(db: Executor, businessId: string, before: Date): Promise<Account[]> {
    return db
      .select()
      .from(accounts)
      .where(and(eq(accounts.businessId, businessId), isNull(accounts.archivedAt), sql`${accounts.consentExpiresAt} is not null and ${accounts.consentExpiresAt} <= ${before.toISOString()}`))
      .orderBy(asc(accounts.consentExpiresAt));
  },

  /** Cash in bank per currency from the latest balance of every live account. */
  async cashPosition(db: Executor, businessId: string): Promise<CashPosition> {
    const rows = await financeRepo.listAccounts(db, businessId);
    const byCurrency = new Map<string, CashPosition["byCurrency"][number]>();
    for (const a of rows) {
      const acc = byCurrency.get(a.currency) ?? { currency: a.currency, balanceMinor: 0, accounts: 0, oldestBalanceAt: null };
      acc.balanceMinor += Number(a.balanceMinor);
      acc.accounts += 1;
      if (a.balanceAt && (!acc.oldestBalanceAt || a.balanceAt < acc.oldestBalanceAt)) acc.oldestBalanceAt = a.balanceAt;
      byCurrency.set(a.currency, acc);
    }
    return { byCurrency: [...byCurrency.values()].sort((x, y) => x.currency.localeCompare(y.currency)), accounts: rows };
  },

  // transactions ------------------------------------------------------------------------------------------------------
  async listTransactions(db: Executor, businessId: string, filter: TransactionListFilter = {}): Promise<Page<Transaction>> {
    const f = parseInput(TransactionListFilter, filter, "transaction filter");
    const ks = timeKeyset<Transaction>(transactions.bookedAt, transactions.id, (r) => ({ at: r.bookedAt, id: r.id }));
    const categories = toArray(f.category);
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.businessId, businessId),
          f.accountId ? eq(transactions.accountId, f.accountId) : undefined,
          categories?.length ? inArray(transactions.category, categories) : undefined,
          f.uncategorised ? isNull(transactions.category) : undefined,
          f.categorySource ? eq(transactions.categorySource, f.categorySource) : undefined,
          f.counterpartyEntityId ? eq(transactions.counterpartyEntityId, f.counterpartyEntityId) : undefined,
          f.q ? sql`(${transactions.counterparty} ilike ${"%" + f.q + "%"} or ${transactions.description} ilike ${"%" + f.q + "%"})` : undefined,
          f.minAmountMinor !== undefined ? sql`${transactions.amountMinor} >= ${f.minAmountMinor}` : undefined,
          f.maxAmountMinor !== undefined ? sql`${transactions.amountMinor} <= ${f.maxAmountMinor}` : undefined,
          f.direction === "in" ? sql`${transactions.amountMinor} > 0` : f.direction === "out" ? sql`${transactions.amountMinor} < 0` : undefined,
          timeRange(transactions.bookedAt, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  async getTransaction(db: Executor, businessId: string, txId: string): Promise<Transaction> {
    return one(await db.select().from(transactions).where(scopedTx(businessId, txId)).limit(1), "transaction", txId);
  },

  /**
   * Idempotent bulk upsert on (account_id, external_id). Rows without an external id are always inserted.
   * A user-set category is never overwritten by a sync. Returns the number of rows written.
   */
  async upsertTransactions(db: Executor, businessId: string, inputs: UpsertTransactionInput[]): Promise<number> {
    const parsed = inputs.map((i) => parseInput(UpsertTransactionInput, i, "transaction"));
    if (parsed.length === 0) return 0;
    return db.transaction(async (tx) => {
      const accountIds = [...new Set(parsed.map((p) => p.accountId))];
      const owned = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.businessId, businessId), inArray(accounts.id, accountIds)));
      if (owned.length !== accountIds.length) throw new ValidationError("Every accountId must be an account of this business", { accountIds });
      let written = 0;
      for (const v of parsed) {
        const values = {
          businessId,
          accountId: v.accountId,
          externalId: v.externalId ?? null,
          bookedAt: v.bookedAt,
          amountMinor: v.amountMinor,
          ...(v.currency ? { currency: v.currency } : {}),
          counterparty: v.counterparty ?? null,
          counterpartyEntityId: v.counterpartyEntityId ?? null,
          description: v.description,
          category: v.category ?? null,
          categorySource: v.categorySource ?? null,
        };
        if (v.externalId) {
          await tx
            .insert(transactions)
            .values(values)
            .onConflictDoUpdate({
              target: [transactions.accountId, transactions.externalId],
              set: {
                bookedAt: values.bookedAt,
                amountMinor: values.amountMinor,
                counterparty: values.counterparty,
                description: values.description,
                category: sql`case when ${transactions.categorySource} = 'user' then ${transactions.category} else coalesce(${values.category}, ${transactions.category}) end`,
                categorySource: sql`case when ${transactions.categorySource} = 'user' then ${transactions.categorySource} else coalesce(${values.categorySource}, ${transactions.categorySource}) end`,
              },
              setWhere: eq(transactions.businessId, businessId),
            });
        } else {
          await tx.insert(transactions).values(values);
        }
        written += 1;
      }
      return written;
    });
  },

  /** Categorises one transaction; `source: "user"` marks a founder decision that syncs must keep. */
  async recategorise(db: Executor, businessId: string, txId: string, category: string | null, source: (typeof CATEGORY_SOURCES)[number] = "user"): Promise<Transaction> {
    const v = parseInput(z.object({ category: z.string().trim().min(1).max(80).nullable(), source: z.enum(CATEGORY_SOURCES) }), { category, source }, "recategorise");
    return one(
      await db.update(transactions).set({ category: v.category, categorySource: v.category ? v.source : null }).where(scopedTx(businessId, txId)).returning(),
      "transaction",
      txId,
    );
  },

  /** Applies a category to every transaction of a counterparty that was not set by the founder (a rule). */
  async recategoriseCounterparty(db: Executor, businessId: string, counterparty: string, category: string, source: (typeof CATEGORY_SOURCES)[number] = "rule"): Promise<number> {
    const v = parseInput(z.object({ counterparty: z.string().min(1), category: z.string().min(1).max(80), source: z.enum(CATEGORY_SOURCES) }), { counterparty, category, source }, "recategorize rule");
    const rows = await db
      .update(transactions)
      .set({ category: v.category, categorySource: v.source })
      .where(and(eq(transactions.businessId, businessId), sql`lower(${transactions.counterparty}) = lower(${v.counterparty})`, sql`${transactions.categorySource} is distinct from 'user'`))
      .returning({ id: transactions.id });
    return rows.length;
  },

  async linkCounterparty(db: Executor, businessId: string, txId: string, counterpartyEntityId: string | null): Promise<Transaction> {
    return one(await db.update(transactions).set({ counterpartyEntityId }).where(scopedTx(businessId, txId)).returning(), "transaction", txId);
  },

  /**
   * Inflows/outflows per calendar month (UTC) in a range — the cash-basis P&L and burn inputs. The plain totals carry
   * every transaction (cash history walks back through them); the operating totals leave financing and transfers out.
   */
  async monthlyTotals(db: Executor, businessId: string, range: DateRange & { accountId?: string } = {}): Promise<MonthlyTotal[]> {
    const r = parseInput(DateRange.extend({ accountId: Id.optional() }), range, "date range");
    const month = sql<string>`to_char(${transactions.bookedAt} at time zone 'UTC', 'YYYY-MM')`;
    const rows = await db
      .select({
        month,
        inflow: sql<number>`coalesce(sum(case when ${transactions.amountMinor} > 0 then ${transactions.amountMinor} else 0 end), 0)::bigint`,
        outflow: sql<number>`coalesce(sum(case when ${transactions.amountMinor} < 0 then -${transactions.amountMinor} else 0 end), 0)::bigint`,
        count: sql<number>`count(*)::int`,
        operatingInflow: sql<number>`coalesce(sum(case when ${transactions.amountMinor} > 0 and not ${nonOperating} then ${transactions.amountMinor} else 0 end), 0)::bigint`,
        operatingOutflow: sql<number>`coalesce(sum(case when ${transactions.amountMinor} < 0 and not ${nonOperating} then -${transactions.amountMinor} else 0 end), 0)::bigint`,
      })
      .from(transactions)
      .where(and(eq(transactions.businessId, businessId), r.accountId ? eq(transactions.accountId, r.accountId) : undefined, timeRange(transactions.bookedAt, r)))
      .groupBy(month)
      .orderBy(month);
    return rows.map((x) => ({
      month: x.month,
      inflowMinor: Number(x.inflow),
      outflowMinor: Number(x.outflow),
      netMinor: Number(x.inflow) - Number(x.outflow),
      count: Number(x.count),
      operatingInflowMinor: Number(x.operatingInflow),
      operatingOutflowMinor: Number(x.operatingOutflow),
    }));
  },

  /** Totals per category in a range (the management P&L lines; null category = uncategorised). */
  async categoryTotals(db: Executor, businessId: string, range: DateRange = {}): Promise<CategoryTotal[]> {
    const r = parseInput(DateRange, range, "date range");
    const rows = await db
      .select({
        category: transactions.category,
        inflow: sql<number>`coalesce(sum(case when ${transactions.amountMinor} > 0 then ${transactions.amountMinor} else 0 end), 0)::bigint`,
        outflow: sql<number>`coalesce(sum(case when ${transactions.amountMinor} < 0 then -${transactions.amountMinor} else 0 end), 0)::bigint`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(and(eq(transactions.businessId, businessId), timeRange(transactions.bookedAt, r)))
      .groupBy(transactions.category)
      .orderBy(desc(sql`sum(abs(${transactions.amountMinor}))`));
    return rows.map((x) => ({ category: x.category, inflowMinor: Number(x.inflow), outflowMinor: Number(x.outflow), count: Number(x.count) }));
  },

  /**
   * Net burn = trailing average of (operating outflows − operating inflows) over the last `months` full months; positive
   * means burning. Gross burn = operating outflows per month. Financing (a raise, a director loan, its repayment) and
   * transfers between the business's own accounts are not operating cash flow (BUILD §11.8), so a raise never turns net
   * burn negative and hides the runway warnings. Label "Estimate".
   */
  async netBurn(db: Executor, businessId: string, options: { months?: number; asOf?: Date } = {}): Promise<{ netBurnMinor: number; grossBurnMinor: number; months: number }> {
    const months = options.months ?? 3;
    const asOf = options.asOf ?? new Date();
    const to = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
    const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - months, 1));
    const totals = await financeRepo.monthlyTotals(db, businessId, { from, to });
    const outflow = totals.reduce((n, t) => n + t.operatingOutflowMinor, 0);
    const inflow = totals.reduce((n, t) => n + t.operatingInflowMinor, 0);
    return { netBurnMinor: Math.round((outflow - inflow) / months), grossBurnMinor: Math.round(outflow / months), months };
  },

  // ledger snapshots --------------------------------------------------------------------------------------------------
  async listSnapshots(db: Executor, businessId: string, basis?: (typeof LEDGER_BASES)[number]): Promise<LedgerSnapshot[]> {
    return db
      .select()
      .from(ledgerSnapshots)
      .where(and(eq(ledgerSnapshots.businessId, businessId), basis ? eq(ledgerSnapshots.basis, basis) : undefined))
      .orderBy(desc(ledgerSnapshots.period));
  },

  async getSnapshot(db: Executor, businessId: string, period: string, basis: (typeof LEDGER_BASES)[number] = "cash"): Promise<LedgerSnapshot | null> {
    const rows = await db.select().from(ledgerSnapshots).where(and(eq(ledgerSnapshots.businessId, businessId), eq(ledgerSnapshots.period, period), eq(ledgerSnapshots.basis, basis))).limit(1);
    return rows[0] ?? null;
  },

  async upsertSnapshot(db: Executor, businessId: string, input: UpsertLedgerSnapshotInput): Promise<LedgerSnapshot> {
    const v = parseInput(UpsertLedgerSnapshotInput, input, "ledger snapshot");
    const set = { pnl: v.pnl, source: v.source ?? null, ...(v.currency ? { currency: v.currency } : {}) };
    return one(
      await db
        .insert(ledgerSnapshots)
        .values({ businessId, period: v.period, basis: v.basis, ...set })
        .onConflictDoUpdate({ target: [ledgerSnapshots.businessId, ledgerSnapshots.period, ledgerSnapshots.basis], set })
        .returning(),
      "ledger snapshot",
    );
  },

  // forecasts ---------------------------------------------------------------------------------------------------------
  async listForecasts(db: Executor, businessId: string, scenario?: (typeof FORECAST_SCENARIOS)[number]): Promise<Forecast[]> {
    return db
      .select()
      .from(forecasts)
      .where(and(eq(forecasts.businessId, businessId), isNull(forecasts.archivedAt), scenario ? eq(forecasts.scenario, scenario) : undefined))
      .orderBy(asc(forecasts.scenario), desc(forecasts.createdAt));
  },

  /** The current forecast per scenario (latest non-archived). */
  async latestForecasts(db: Executor, businessId: string): Promise<Partial<Record<(typeof FORECAST_SCENARIOS)[number], Forecast>>> {
    const rows = await financeRepo.listForecasts(db, businessId);
    const out: Partial<Record<(typeof FORECAST_SCENARIOS)[number], Forecast>> = {};
    for (const f of rows) if (!out[f.scenario]) out[f.scenario] = f;
    return out;
  },

  /** A new forecast version; the previous one for the scenario is archived so `latestForecasts` is unambiguous. */
  async createForecast(db: Executor, businessId: string, input: CreateForecastInput): Promise<Forecast> {
    const v = parseInput(CreateForecastInput, input, "forecast");
    return db.transaction(async (tx) => {
      await tx.update(forecasts).set({ archivedAt: new Date() }).where(and(eq(forecasts.businessId, businessId), eq(forecasts.scenario, v.scenario), isNull(forecasts.archivedAt)));
      return one(
        await tx
          .insert(forecasts)
          .values({ businessId, scenario: v.scenario, ...(v.currency ? { currency: v.currency } : {}), drivers: v.drivers, series: v.series, generatedByAgentId: v.generatedByAgentId ?? null })
          .returning(),
        "forecast",
      );
    });
  },

  async getForecast(db: Executor, businessId: string, forecastId: string): Promise<Forecast> {
    return one(await db.select().from(forecasts).where(and(eq(forecasts.businessId, businessId), eq(forecasts.id, forecastId))).limit(1), "forecast", forecastId);
  },
};
