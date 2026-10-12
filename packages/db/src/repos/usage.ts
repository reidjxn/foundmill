/**
 * usage_ledger + credit_balances — what the team costs (BUILD §10.4, §10.5, §11.8 "Payroll"; routers
 * billing.usage / finance.wages).
 *
 * `record` is the one write path (orchestrator after every model call, sandbox minute, tool call or
 * training run); `wages` and `totals` are the Payroll tab's numbers, every one an "Estimate" because
 * the founder's Anthropic invoice is the only real cost (DECISIONS "Prices are config"). Credits: one
 * balance row per period, debited inside a transaction so it can never go negative unnoticed.
 *
 * Currencies (0024): platform costs (tokens, sandbox minutes, training) are metered in US dollars, the model price
 * list's currency (`CREDITS_CURRENCY`), and a row written without a currency is USD. A tool row keeps its vendor's
 * currency. Sums never add amounts in different currencies: `totals`, `daily`, `wages` and `agentSpend` count USD rows,
 * and `totals.otherCurrencies` lists what was booked in anything else. A credit balance is always USD.
 */
import { CREDITS_CURRENCY } from "@foundmill/config";
import { MODEL_BILLING, MODEL_KEYS, USAGE_KINDS, ValidationError, type UsageKind } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, businesses, creditBalances, usageLedger, type CreditBalance, type UsageEntry } from "../schema";
import { Currency, DateRange, Id, IsoDateInput, JsonObject, MinorAmount, one, PageInput, parseInput, timeKeyset, timeRange, toPage, type Executor, type Page } from "./_shared";

export const RecordUsageInput = z.object({
  agentId: Id.nullable().optional(),
  sessionId: Id.nullable().optional(),
  kind: z.enum(USAGE_KINDS),
  modelKey: z.enum(MODEL_KEYS).nullable().optional(),
  quantity: z.number().int().nonnegative().default(0),
  unit: z.string().max(20).default("tokens"),
  costMinor: MinorAmount.nonnegative().default(0),
  currency: Currency.optional(),
  billedTo: z.enum(MODEL_BILLING).default("credits"),
  occurredAt: IsoDateInput.optional(),
  details: JsonObject.default({}),
});
export type RecordUsageInput = z.input<typeof RecordUsageInput>;

export const UsageListFilter = PageInput.extend(DateRange.shape).extend({
  agentId: Id.optional(),
  sessionId: Id.optional(),
  kind: z.union([z.enum(USAGE_KINDS), z.array(z.enum(USAGE_KINDS))]).optional(),
  billedTo: z.enum(MODEL_BILLING).optional(),
});
export type UsageListFilter = z.input<typeof UsageListFilter>;

export const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period is YYYY-MM");
const CreditsCurrency = Currency.refine((c) => c === CREDITS_CURRENCY, { message: `credits are kept in US dollars (${CREDITS_CURRENCY})` });

export interface UsageTotals {
  /** Every cost below is in this currency (USD): the rows booked in it. */
  currency: typeof CREDITS_CURRENCY;
  costMinor: number;
  quantity: number;
  entries: number;
  byKind: Record<UsageKind, { costMinor: number; quantity: number }>;
  byBilledTo: Record<(typeof MODEL_BILLING)[number], number>;
  /** Rows booked in another currency (third-party tool spend in the vendor's currency), never added to `costMinor`. */
  otherCurrencies: { currency: string; costMinor: number }[];
}

export interface AgentWage {
  agentId: string | null;
  name: string | null;
  /** USD (`CREDITS_CURRENCY`): rows in another currency are not added in. */
  costMinor: number;
  tokens: number;
  sandboxMinutes: number;
  toolCalls: number;
  trainingMinor: number;
}

const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

/** [first day of the month, first day of the next month) in UTC. */
export function periodRange(period: string): { from: Date; to: Date } {
  const p = parseInput(Period, period, "period");
  const [y, m] = p.split("-").map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const usageRepo = {
  async record(db: Executor, businessId: string, input: RecordUsageInput): Promise<UsageEntry> {
    const v = parseInput(RecordUsageInput, input, "usage entry");
    return one(
      await db
        .insert(usageLedger)
        .values({
          businessId,
          agentId: v.agentId ?? null,
          sessionId: v.sessionId ?? null,
          kind: v.kind,
          modelKey: v.modelKey ?? null,
          quantity: v.quantity,
          unit: v.unit,
          costMinor: v.costMinor,
          // Platform costs are US cents; a sink that names no currency books USD, never the old EUR column default.
          currency: v.currency ?? CREDITS_CURRENCY,
          billedTo: v.billedTo,
          occurredAt: v.occurredAt ?? new Date(),
          details: v.details,
        })
        .returning(),
      "usage entry",
    );
  },

  async list(db: Executor, businessId: string, filter: UsageListFilter = {}): Promise<Page<UsageEntry>> {
    const f = parseInput(UsageListFilter, filter, "usage filter");
    const ks = timeKeyset<UsageEntry>(usageLedger.occurredAt, usageLedger.id, (r) => ({ at: r.occurredAt, id: r.id }));
    const kinds = toArray(f.kind);
    const rows = await db
      .select()
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.businessId, businessId),
          f.agentId ? eq(usageLedger.agentId, f.agentId) : undefined,
          f.sessionId ? eq(usageLedger.sessionId, f.sessionId) : undefined,
          kinds?.length ? inArray(usageLedger.kind, kinds) : undefined,
          f.billedTo ? eq(usageLedger.billedTo, f.billedTo) : undefined,
          timeRange(usageLedger.occurredAt, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  /** Cost and quantity totals in a range, split by kind and by who is billed. Costs are USD; see `otherCurrencies`. */
  async totals(db: Executor, businessId: string, range: DateRange & { agentId?: string } = {}): Promise<UsageTotals> {
    const r = parseInput(DateRange.extend({ agentId: Id.optional() }), range, "date range");
    const rows = await db
      .select({ kind: usageLedger.kind, billedTo: usageLedger.billedTo, currency: usageLedger.currency, cost: sql<number>`coalesce(sum(${usageLedger.costMinor}), 0)::bigint`, quantity: sql<number>`coalesce(sum(${usageLedger.quantity}), 0)::bigint`, n: sql<number>`count(*)::int` })
      .from(usageLedger)
      .where(and(eq(usageLedger.businessId, businessId), r.agentId ? eq(usageLedger.agentId, r.agentId) : undefined, timeRange(usageLedger.occurredAt, r)))
      .groupBy(usageLedger.kind, usageLedger.billedTo, usageLedger.currency);
    const out: UsageTotals = {
      currency: CREDITS_CURRENCY,
      costMinor: 0,
      quantity: 0,
      entries: 0,
      byKind: Object.fromEntries(USAGE_KINDS.map((k) => [k, { costMinor: 0, quantity: 0 }])) as UsageTotals["byKind"],
      byBilledTo: Object.fromEntries(MODEL_BILLING.map((b) => [b, 0])) as UsageTotals["byBilledTo"],
      otherCurrencies: [],
    };
    const other = new Map<string, number>();
    for (const row of rows) {
      const cost = Number(row.cost);
      const qty = Number(row.quantity);
      out.quantity += qty;
      out.entries += Number(row.n);
      out.byKind[row.kind].quantity += qty;
      if (row.currency !== CREDITS_CURRENCY) {
        if (cost) other.set(row.currency, (other.get(row.currency) ?? 0) + cost);
        continue;
      }
      out.costMinor += cost;
      out.byKind[row.kind].costMinor += cost;
      out.byBilledTo[row.billedTo] += cost;
    }
    out.otherCurrencies = [...other].map(([currency, costMinor]) => ({ currency, costMinor })).sort((a, b) => a.currency.localeCompare(b.currency));
    return out;
  },

  /** USD cost per day (the budget chart; alerts at 50/80/100 % are computed by the caller against the monthly budget). */
  async daily(db: Executor, businessId: string, range: DateRange = {}): Promise<{ day: string; costMinor: number }[]> {
    const r = parseInput(DateRange, range, "date range");
    const day = sql<string>`to_char(${usageLedger.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const rows = await db
      .select({ day, cost: sql<number>`coalesce(sum(${usageLedger.costMinor}), 0)::bigint` })
      .from(usageLedger)
      .where(and(eq(usageLedger.businessId, businessId), eq(usageLedger.currency, CREDITS_CURRENCY), timeRange(usageLedger.occurredAt, r)))
      .groupBy(day)
      .orderBy(day);
    return rows.map((x) => ({ day: x.day, costMinor: Number(x.cost) }));
  },

  /** Payroll: per-agent cost for a month (tokens, sandbox minutes, tool calls, training) in USD, highest first. */
  async wages(db: Executor, businessId: string, period: string): Promise<AgentWage[]> {
    const { from, to } = periodRange(period);
    const usd = sql`${usageLedger.currency} = ${CREDITS_CURRENCY}`;
    const cost = sql<number>`coalesce(sum(case when ${usd} then ${usageLedger.costMinor} else 0 end), 0)::bigint`;
    const rows = await db
      .select({
        agentId: usageLedger.agentId,
        name: agents.name,
        cost,
        tokens: sql<number>`coalesce(sum(case when ${usageLedger.kind} = 'tokens' then ${usageLedger.quantity} else 0 end), 0)::bigint`,
        sandbox: sql<number>`coalesce(sum(case when ${usageLedger.kind} = 'sandbox' then ${usageLedger.quantity} else 0 end), 0)::bigint`,
        tools: sql<number>`coalesce(sum(case when ${usageLedger.kind} = 'tool' then ${usageLedger.quantity} else 0 end), 0)::bigint`,
        training: sql<number>`coalesce(sum(case when ${usageLedger.kind} = 'training' and ${usd} then ${usageLedger.costMinor} else 0 end), 0)::bigint`,
      })
      .from(usageLedger)
      .leftJoin(agents, eq(agents.id, usageLedger.agentId))
      .where(and(eq(usageLedger.businessId, businessId), timeRange(usageLedger.occurredAt, { from, to })))
      .groupBy(usageLedger.agentId, agents.name)
      .orderBy(desc(cost), asc(agents.name));
    return rows.map((x) => ({ agentId: x.agentId, name: x.name, costMinor: Number(x.cost), tokens: Number(x.tokens), sandboxMinutes: Number(x.sandbox), toolCalls: Number(x.tools), trainingMinor: Number(x.training) }));
  },

  /** Month-to-date USD spend for an agent against its wage cap (null cap = uncapped). */
  async agentSpend(db: Executor, businessId: string, agentId: string, period: string): Promise<{ costMinor: number; wageCapMinor: number | null; remainingMinor: number | null }> {
    const { from, to } = periodRange(period);
    const [row] = await db
      .select({ cost: sql<number>`coalesce(sum(${usageLedger.costMinor}), 0)::bigint` })
      .from(usageLedger)
      .where(and(eq(usageLedger.businessId, businessId), eq(usageLedger.agentId, agentId), eq(usageLedger.currency, CREDITS_CURRENCY), timeRange(usageLedger.occurredAt, { from, to })));
    const agent = one(await db.select({ cap: agents.wageCapMinor }).from(agents).where(and(eq(agents.businessId, businessId), eq(agents.id, agentId))).limit(1), "agent", agentId);
    const cost = Number(row?.cost ?? 0);
    const cap = agent.cap === null ? null : Number(agent.cap);
    return { costMinor: cost, wageCapMinor: cap, remainingMinor: cap === null ? null : Math.max(0, cap - cost) };
  },

  /**
   * Model tokens already booked for one agent session, cost in USD: a live session on the platform key books as it goes
   * (so concurrent sessions and the api see one balance), and the session's finish books only what is left.
   */
  async sessionTokens(db: Executor, businessId: string, sessionId: string): Promise<{ costMinor: number; quantity: number }> {
    const [row] = await db
      .select({ cost: sql<number>`coalesce(sum(${usageLedger.costMinor}), 0)::bigint`, quantity: sql<number>`coalesce(sum(${usageLedger.quantity}), 0)::bigint` })
      .from(usageLedger)
      .where(and(eq(usageLedger.businessId, businessId), eq(usageLedger.sessionId, sessionId), eq(usageLedger.kind, "tokens"), eq(usageLedger.currency, CREDITS_CURRENCY)));
    return { costMinor: Number(row?.cost ?? 0), quantity: Number(row?.quantity ?? 0) };
  },

  // credits -----------------------------------------------------------------------------------------------------------
  async creditBalance(db: Executor, businessId: string, period: string): Promise<CreditBalance | null> {
    const p = parseInput(Period, period, "period");
    const rows = await db.select().from(creditBalances).where(and(eq(creditBalances.businessId, businessId), eq(creditBalances.period, p))).limit(1);
    return rows[0] ?? null;
  },

  async listCreditBalances(db: Executor, businessId: string): Promise<CreditBalance[]> {
    return db.select().from(creditBalances).where(eq(creditBalances.businessId, businessId)).orderBy(desc(creditBalances.period));
  },

  /**
   * Grants credits for a period (a top-up, or a grant on top of the included credits): adds to granted and balance.
   * Credits are US dollars (`CREDITS_CURRENCY`); an amount in any other currency is refused, never merged.
   */
  async grantCredits(db: Executor, businessId: string, period: string, amountMinor: number, currency: string = CREDITS_CURRENCY): Promise<CreditBalance> {
    const v = parseInput(z.object({ period: Period, amountMinor: MinorAmount.positive(), currency: CreditsCurrency }), { period, amountMinor, currency }, "credit grant");
    return one(
      await db
        .insert(creditBalances)
        .values({ businessId, period: v.period, balanceMinor: v.amountMinor, grantedMinor: v.amountMinor, spentMinor: 0, currency: v.currency })
        .onConflictDoUpdate({
          target: [creditBalances.businessId, creditBalances.period],
          set: { balanceMinor: sql`${creditBalances.balanceMinor} + ${v.amountMinor}`, grantedMinor: sql`${creditBalances.grantedMinor} + ${v.amountMinor}` },
        })
        .returning(),
      "credit balance",
    );
  },

  /**
   * The period's balance row, created with the tier's included credits (`includedCreditsMinor`, packages/config) when
   * the period has none yet: at commit, and on the first charge of every month. `created` is true only for the call
   * that inserted it; an existing row (a top-up came first) is returned untouched.
   */
  async ensurePeriodCredits(db: Executor, businessId: string, period: string, includedMinor: number): Promise<{ balance: CreditBalance; created: boolean }> {
    const v = parseInput(z.object({ period: Period, includedMinor: MinorAmount.nonnegative() }), { period, includedMinor }, "included credits");
    const inserted = await db
      .insert(creditBalances)
      .values({ businessId, period: v.period, balanceMinor: v.includedMinor, grantedMinor: v.includedMinor, spentMinor: 0, currency: CREDITS_CURRENCY })
      .onConflictDoNothing({ target: [creditBalances.businessId, creditBalances.period] })
      .returning();
    if (inserted[0]) return { balance: inserted[0], created: true };
    const existing = await usageRepo.creditBalance(db, businessId, v.period);
    return { balance: one(existing ? [existing] : [], "credit balance"), created: false };
  },

  /**
   * Serializes the included-credit grants of one founder's businesses (../billing.ts `includedCreditsFor`), so two of
   * their businesses opening the same month at once cannot both take the pool's last place. Transaction-scoped.
   */
  async lockIncludedCredits(db: Executor, creatorId: string): Promise<void> {
    const id = parseInput(Id, creatorId, "user id");
    await db.execute(sql`select pg_advisory_xact_lock(hashtext('included_credits'), hashtext(${id}::text))`);
  },

  /**
   * Businesses `creatorId` took charge of, archived ones included, other than `exceptBusinessId`, that were granted
   * credits for `period` (a balance row with something granted): the places of the founder's monthly pool of included
   * credits already taken. A row granted only by a top-up counts too (the ledger cannot tell them apart), which errs
   * toward granting less.
   */
  async includedCreditPlacesTaken(db: Executor, creatorId: string, period: string, options: { exceptBusinessId?: string } = {}): Promise<number> {
    const v = parseInput(z.object({ creatorId: Id, period: Period }), { creatorId, period }, "included credits");
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${creditBalances.businessId})::int` })
      .from(creditBalances)
      .innerJoin(businesses, eq(businesses.id, creditBalances.businessId))
      .where(and(eq(businesses.createdBy, v.creatorId), eq(creditBalances.period, v.period), sql`${creditBalances.grantedMinor} > 0`, options.exceptBusinessId ? ne(creditBalances.businessId, options.exceptBusinessId) : undefined));
    return Number(row?.n ?? 0);
  },

  /**
   * Charges a metered USD cost to the period's credits after the fact (every sink that books a `credits` row). Unlike
   * `debitCredits` it never refuses: the call already happened, so `spent` grows by the full amount and the balance
   * stops at zero. With `includedMinor` (what `bookUsage` always passes) a period without a row starts with the tier's
   * included credits, so a business on credits is always enforced; without it, a period with no row returns null. A
   * function is asked inside the charge's transaction, only when the row is missing (the owner's monthly pool,
   * ../billing.ts `includedCreditsFor`). `exhausted` says whether this charge used the last credit (`"now"`, also when the
   * period started with nothing included) or the balance was already empty (`"already"`).
   */
  async chargeCredits(db: Executor, businessId: string, period: string, amountMinor: number, options: { includedMinor?: number | ((tx: Executor) => Promise<number>) } = {}): Promise<{ balance: CreditBalance; exhausted: "now" | "already" | null } | null> {
    const v = parseInput(z.object({ period: Period, amountMinor: MinorAmount.nonnegative() }), { period, amountMinor }, "credit charge");
    return db.transaction(async (tx) => {
      const lockRow = async () => (await tx.select().from(creditBalances).where(and(eq(creditBalances.businessId, businessId), eq(creditBalances.period, v.period))).for("update").limit(1))[0];
      let current = await lockRow();
      let created = false;
      if (!current && options.includedMinor !== undefined) {
        const included = typeof options.includedMinor === "function" ? await options.includedMinor(tx) : options.includedMinor;
        created = (await usageRepo.ensurePeriodCredits(tx, businessId, v.period, included)).created;
        current = await lockRow();
      }
      if (!current) return null;
      const balanceBefore = Number(current.balanceMinor);
      const balanceAfter = Math.max(0, balanceBefore - v.amountMinor);
      const [row] = await tx
        .update(creditBalances)
        .set({ balanceMinor: balanceAfter, spentMinor: sql`${creditBalances.spentMinor} + ${v.amountMinor}` })
        .where(eq(creditBalances.id, current.id))
        .returning();
      const balance = one(row ? [row] : [], "credit balance");
      const exhausted = balanceAfter > 0 || v.amountMinor === 0 ? null : balanceBefore > 0 || created ? "now" : "already";
      return { balance, exhausted };
    });
  },

  /** Debits credits for a period inside a transaction; refuses to go below zero (agents pause, BUILD §10.5). */
  async debitCredits(db: Executor, businessId: string, period: string, amountMinor: number): Promise<CreditBalance> {
    const v = parseInput(z.object({ period: Period, amountMinor: MinorAmount.nonnegative() }), { period, amountMinor }, "credit debit");
    return db.transaction(async (tx) => {
      const rows = await tx
        .update(creditBalances)
        .set({ balanceMinor: sql`${creditBalances.balanceMinor} - ${v.amountMinor}`, spentMinor: sql`${creditBalances.spentMinor} + ${v.amountMinor}` })
        .where(and(eq(creditBalances.businessId, businessId), eq(creditBalances.period, v.period), sql`${creditBalances.balanceMinor} >= ${v.amountMinor}`))
        .returning();
      const row = rows[0];
      if (!row) {
        const current = await usageRepo.creditBalance(tx, businessId, v.period);
        throw new ValidationError("Insufficient credits", { period: v.period, balanceMinor: current?.balanceMinor ?? 0, requested: v.amountMinor });
      }
      return row;
    });
  },
};
