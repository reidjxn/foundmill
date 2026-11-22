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
 *
 * Precision (0039, DECISIONS 2026-10-05 "sum costMicroMinor, round once"): a row keeps its exact cost in millionths of a
 * cent (`costMicroMinor`) beside the rounded `costMinor`; every sum here adds the exact costs and rounds once, and
 * credits are charged through a per-period carry (`chargeCreditsMicro`), so calls under half a cent are counted.
 */
import { CREDITS_CURRENCY } from "@foundmill/config";
import { MODEL_BILLING, MODEL_KEYS, USAGE_KINDS, ValidationError, type UsageKind } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { agentSessions, agents, businesses, creditBalances, creditLots, ownerCredits, usageLedger, type CreditBalance, type CreditLot, type OwnerCredits, type UsageEntry } from "../schema";
import { Currency, DateRange, Id, IsoDateInput, JsonObject, MinorAmount, one, PageInput, parseInput, timeKeyset, timeRange, toPage, type Executor, type Page } from "./_shared";

/** Millionths of a minor unit per minor unit (the meter's `costMicroMinor`, packages/models pricing.ts). */
export const MICRO_PER_MINOR = 1_000_000;

/** Minor units from summed micro-minor units, rounded once. */
export const microToMinor = (micro: number): number => Math.round(micro / MICRO_PER_MINOR);

/** A row's exact cost: `cost_micro_minor`, or `cost_minor` × 1,000,000 on a row written before 0039. */
const exactCost = sql<number>`coalesce(${usageLedger.costMicroMinor}, ${usageLedger.costMinor} * ${MICRO_PER_MINOR})`;

export const RecordUsageInput = z.object({
  agentId: Id.nullable().optional(),
  sessionId: Id.nullable().optional(),
  kind: z.enum(USAGE_KINDS),
  modelKey: z.enum(MODEL_KEYS).nullable().optional(),
  quantity: z.number().int().nonnegative().default(0),
  unit: z.string().max(20).default("tokens"),
  /** The rounded cost; derived from `costMicroMinor` when only that is given. */
  costMinor: MinorAmount.nonnegative().optional(),
  /** The exact cost in millionths of a minor unit (a model call's `cost.costMicroMinor`); `costMinor` × 1,000,000 when omitted. */
  costMicroMinor: MinorAmount.nonnegative().optional(),
  currency: Currency.optional(),
  billedTo: z.enum(MODEL_BILLING).default("credits"),
  occurredAt: IsoDateInput.optional(),
  details: JsonObject.default({}),
  /** What the row settles (`session:<id>:sandbox`, a tool call id): a booking with a known key is not written again (0036). */
  idempotencyKey: z.string().min(1).max(200).nullable().optional(),
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

/** How long bought credits last (founder, 2026-11-13). */
export const CREDIT_LOT_MONTHS = 12;

/** When a lot bought at `purchasedAt` expires: the same moment `CREDIT_LOT_MONTHS` later (the month's last day when shorter). */
export function creditLotExpiry(purchasedAt: Date): Date {
  const d = new Date(purchasedAt.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + CREDIT_LOT_MONTHS);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** The live lots of a business, the one that expires first first, locked for the caller's transaction. */
async function lockLiveLots(tx: Executor, businessId: string, now: Date): Promise<CreditLot[]> {
  return tx
    .select()
    .from(creditLots)
    .where(and(eq(creditLots.businessId, businessId), sql`${creditLots.remainingMinor} > 0`, sql`${creditLots.expiresAt} > ${now}`))
    .orderBy(asc(creditLots.expiresAt), asc(creditLots.createdAt))
    .for("update");
}

/**
 * How a charge finds its credits. `includedMinor`: the project's own month opens with this many included credits (a
 * business with no recorded owner). `owner`: the month's included budget is the owner's, shared by all their projects
 * (0151): `budgetMinor` is what it is when the owner's row opens (their plan then), asked only when the row is missing.
 */
export interface ChargeOptions {
  includedMinor?: number | ((tx: Executor) => Promise<number>);
  owner?: { userId: string; budgetMinor: (tx: Executor) => Promise<number> };
}

export const usageRepo = {
  async record(db: Executor, businessId: string, input: RecordUsageInput): Promise<UsageEntry> {
    return (await usageRepo.recordOnce(db, businessId, input)).entry;
  },

  /**
   * Write a usage row once: with an `idempotencyKey` a repeat (a retried activity) returns the row already booked under
   * that key and `created: false`, so the caller charges nothing again (audit O-33, BILL-20). Without a key every call
   * writes a row.
   */
  async recordOnce(db: Executor, businessId: string, input: RecordUsageInput): Promise<{ entry: UsageEntry; created: boolean }> {
    const v = parseInput(RecordUsageInput, input, "usage entry");
    const costMicroMinor = v.costMicroMinor ?? (v.costMinor ?? 0) * MICRO_PER_MINOR;
    const key = v.idempotencyKey ?? null;
    const booked = async () => (key ? await db.select().from(usageLedger).where(and(eq(usageLedger.businessId, businessId), eq(usageLedger.idempotencyKey, key))).limit(1) : []);
    const before = (await booked())[0];
    if (before) return { entry: before, created: false };
    const [row] = await db
      .insert(usageLedger)
      .values({
        businessId,
        agentId: v.agentId ?? null,
        // Linked only to a session that exists: a gateway call made outside a session (an import read, a plan action)
        // carries a token id that has no `agent_sessions` row, and the foreign key must not turn that into a failed call.
        sessionId: v.sessionId ? sql<string | null>`(select ${agentSessions.id} from ${agentSessions} where ${agentSessions.id} = ${v.sessionId})` : null,
        kind: v.kind,
        modelKey: v.modelKey ?? null,
        quantity: v.quantity,
        unit: v.unit,
        costMinor: v.costMinor ?? microToMinor(costMicroMinor),
        costMicroMinor,
        // Platform costs are US cents; a sink that names no currency books USD, never the old EUR column default.
        currency: v.currency ?? CREDITS_CURRENCY,
        billedTo: v.billedTo,
        occurredAt: v.occurredAt ?? new Date(),
        details: v.details,
        idempotencyKey: key,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return { entry: row, created: true };
    // A concurrent booking with the same key won the insert: return that one.
    return { entry: one(await booked(), "usage entry"), created: false };
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
      .select({ kind: usageLedger.kind, billedTo: usageLedger.billedTo, currency: usageLedger.currency, micro: sql<number>`coalesce(sum(${exactCost}), 0)::bigint`, quantity: sql<number>`coalesce(sum(${usageLedger.quantity}), 0)::bigint`, n: sql<number>`count(*)::int` })
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
    // Exact costs are added per figure and each figure is rounded once (calls under half a cent still count).
    const other = new Map<string, number>();
    const byKind = new Map<UsageKind, number>();
    const byBilledTo = new Map<(typeof MODEL_BILLING)[number], number>();
    let total = 0;
    for (const row of rows) {
      const micro = Number(row.micro);
      const qty = Number(row.quantity);
      out.quantity += qty;
      out.entries += Number(row.n);
      out.byKind[row.kind].quantity += qty;
      if (row.currency !== CREDITS_CURRENCY) {
        if (micro) other.set(row.currency, (other.get(row.currency) ?? 0) + micro);
        continue;
      }
      total += micro;
      byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + micro);
      byBilledTo.set(row.billedTo, (byBilledTo.get(row.billedTo) ?? 0) + micro);
    }
    out.costMinor = microToMinor(total);
    for (const [kind, micro] of byKind) out.byKind[kind].costMinor = microToMinor(micro);
    for (const [billedTo, micro] of byBilledTo) out.byBilledTo[billedTo] = microToMinor(micro);
    out.otherCurrencies = [...other].map(([currency, micro]) => ({ currency, costMinor: microToMinor(micro) })).sort((a, b) => a.currency.localeCompare(b.currency));
    return out;
  },

  /** USD cost per day (the budget chart; alerts at 50/80/100 % are computed by the caller against the monthly budget). */
  async daily(db: Executor, businessId: string, range: DateRange = {}): Promise<{ day: string; costMinor: number }[]> {
    const r = parseInput(DateRange, range, "date range");
    const day = sql<string>`to_char(${usageLedger.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const rows = await db
      .select({ day, micro: sql<number>`coalesce(sum(${exactCost}), 0)::bigint` })
      .from(usageLedger)
      .where(and(eq(usageLedger.businessId, businessId), eq(usageLedger.currency, CREDITS_CURRENCY), timeRange(usageLedger.occurredAt, r)))
      .groupBy(day)
      .orderBy(day);
    return rows.map((x) => ({ day: x.day, costMinor: microToMinor(Number(x.micro)) }));
  },

  /** Payroll: per-agent cost for a month (tokens, sandbox minutes, tool calls, training) in USD, highest first. */
  async wages(db: Executor, businessId: string, period: string): Promise<AgentWage[]> {
    const { from, to } = periodRange(period);
    const usd = sql`${usageLedger.currency} = ${CREDITS_CURRENCY}`;
    const cost = sql<number>`coalesce(sum(case when ${usd} then ${exactCost} else 0 end), 0)::bigint`;
    const rows = await db
      .select({
        agentId: usageLedger.agentId,
        name: agents.name,
        cost,
        tokens: sql<number>`coalesce(sum(case when ${usageLedger.kind} = 'tokens' then ${usageLedger.quantity} else 0 end), 0)::bigint`,
        sandbox: sql<number>`coalesce(sum(case when ${usageLedger.kind} = 'sandbox' then ${usageLedger.quantity} else 0 end), 0)::bigint`,
        tools: sql<number>`coalesce(sum(case when ${usageLedger.kind} = 'tool' then ${usageLedger.quantity} else 0 end), 0)::bigint`,
        // Training is the model calls a run made (the candidate's answers and the grader's scores, booked per call as
        // `tokens` rows whose details.kind says so), part of `cost`, not on top of it (audit O-19). The run's own row is
        // a count of tests at no cost; a pre-0039 summary row that still carries one is zeroed by the migration.
        training: sql<number>`coalesce(sum(case when ${usd} and (${usageLedger.kind} = 'training' or ${usageLedger.details}->>'kind' in ('training', 'skill_grader')) then ${exactCost} else 0 end), 0)::bigint`,
      })
      .from(usageLedger)
      .leftJoin(agents, eq(agents.id, usageLedger.agentId))
      .where(and(eq(usageLedger.businessId, businessId), timeRange(usageLedger.occurredAt, { from, to })))
      .groupBy(usageLedger.agentId, agents.name)
      .orderBy(desc(cost), asc(agents.name));
    return rows.map((x) => ({ agentId: x.agentId, name: x.name, costMinor: microToMinor(Number(x.cost)), tokens: Number(x.tokens), sandboxMinutes: Number(x.sandbox), toolCalls: Number(x.tools), trainingMinor: microToMinor(Number(x.training)) }));
  },

  /** Month-to-date USD spend for an agent against its wage cap, which is in US dollars too (null cap = uncapped). */
  async agentSpend(db: Executor, businessId: string, agentId: string, period: string): Promise<{ costMinor: number; wageCapMinor: number | null; remainingMinor: number | null }> {
    const { from, to } = periodRange(period);
    const [row] = await db
      .select({ micro: sql<number>`coalesce(sum(${exactCost}), 0)::bigint` })
      .from(usageLedger)
      .where(and(eq(usageLedger.businessId, businessId), eq(usageLedger.agentId, agentId), eq(usageLedger.currency, CREDITS_CURRENCY), timeRange(usageLedger.occurredAt, { from, to })));
    const agent = one(await db.select({ cap: agents.wageCapMinor }).from(agents).where(and(eq(agents.businessId, businessId), eq(agents.id, agentId))).limit(1), "agent", agentId);
    const cost = microToMinor(Number(row?.micro ?? 0));
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
      // Only the session's own rows (the Agent SDK's, booked as it ran): rows another service books under the session id
      // (the gateway's reader, a web search) are not in the SDK's totals, so they must not shrink its final booking (WP-09 T3).
      .where(and(eq(usageLedger.businessId, businessId), eq(usageLedger.sessionId, sessionId), eq(usageLedger.kind, "tokens"), eq(usageLedger.currency, CREDITS_CURRENCY), sql`${usageLedger.details}->>'source' = 'claude-agent-sdk'`));
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
   * Records a paid top-up as a lot (0098): `amountMinor` bought at `purchasedAt`, live for 12 months. The caller grants
   * the same amount to the month's balance (`grantCredits`) in the same transaction; a checkout makes one lot only.
   */
  async addCreditLot(db: Executor, businessId: string, input: { amountMinor: number; purchasedAt: Date; checkoutId?: string | null }): Promise<CreditLot> {
    const v = parseInput(z.object({ amountMinor: MinorAmount.positive() }), { amountMinor: input.amountMinor }, "credit lot");
    return one(
      await db
        .insert(creditLots)
        .values({ businessId, checkoutId: input.checkoutId ?? null, amountMinor: v.amountMinor, remainingMinor: v.amountMinor, currency: CREDITS_CURRENCY, purchasedAt: input.purchasedAt, expiresAt: creditLotExpiry(input.purchasedAt) })
        .returning(),
      "credit lot",
    );
  },

  /** The bought credit still live for a business (what a new month carries over), in cents. */
  async liveLotCredits(db: Executor, businessId: string, now = new Date()): Promise<number> {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${creditLots.remainingMinor}), 0)` })
      .from(creditLots)
      .where(and(eq(creditLots.businessId, businessId), sql`${creditLots.remainingMinor} > 0`, sql`${creditLots.expiresAt} > ${now}`));
    return Number(row?.total ?? 0);
  },

  /** A business's lots, newest first (Billing shows what is left of each purchase and when it expires). */
  async creditLots(db: Executor, businessId: string): Promise<CreditLot[]> {
    return db.select().from(creditLots).where(eq(creditLots.businessId, businessId)).orderBy(desc(creditLots.purchasedAt));
  },

  /**
   * Takes what is left of every expired lot out of the period's balance (never below zero) and empties those lots, in
   * the caller's transaction. Returns how many cents expired. `chargeCreditsMicro` runs it with the period row locked.
   */
  async expireCreditLots(tx: Executor, businessId: string, period: string, now = new Date()): Promise<number> {
    const expired = await tx
      .select({ id: creditLots.id, remaining: creditLots.remainingMinor })
      .from(creditLots)
      .where(and(eq(creditLots.businessId, businessId), sql`${creditLots.remainingMinor} > 0`, sql`${creditLots.expiresAt} <= ${now}`))
      .for("update");
    if (expired.length === 0) return 0;
    const total = expired.reduce((sum, l) => sum + Number(l.remaining), 0);
    await tx.update(creditLots).set({ remainingMinor: 0, updatedAt: now }).where(inArray(creditLots.id, expired.map((l) => l.id)));
    await tx
      .update(creditBalances)
      .set({ balanceMinor: sql`greatest(0, ${creditBalances.balanceMinor} - ${total})` })
      .where(and(eq(creditBalances.businessId, businessId), eq(creditBalances.period, period)));
    return total;
  },

  /**
   * The period's balance row, created with the tier's included credits (`includedCreditsMinor`, packages/config) when
   * the period has none yet: at commit, and on the first charge of every month, plus the bought credit still live from
   * earlier months (0098: bought credits last 12 months). `created` is true only for the call that inserted it; an
   * existing row (a top-up came first) is returned untouched.
   */
  async ensurePeriodCredits(db: Executor, businessId: string, period: string, includedMinor: number, now = new Date()): Promise<{ balance: CreditBalance; created: boolean }> {
    const v = parseInput(z.object({ period: Period, includedMinor: MinorAmount.nonnegative() }), { period, includedMinor }, "included credits");
    // Bought credit still live carries over into the new month on top of its included credits (0098).
    const carried = await usageRepo.liveLotCredits(db, businessId, now);
    const opening = v.includedMinor + carried;
    const inserted = await db
      .insert(creditBalances)
      .values({ businessId, period: v.period, balanceMinor: opening, grantedMinor: opening, spentMinor: 0, currency: CREDITS_CURRENCY })
      .onConflictDoNothing({ target: [creditBalances.businessId, creditBalances.period] })
      .returning();
    if (inserted[0]) return { balance: inserted[0], created: true };
    const existing = await usageRepo.creditBalance(db, businessId, v.period);
    return { balance: one(existing ? [existing] : [], "credit balance"), created: false };
  },

  /**
   * Serializes the charges of one owner's projects (the shared budget, `chargeCreditsMicro`), so two of their projects
   * charging at once cannot both spend the same credits. Transaction-scoped.
   */
  async lockIncludedCredits(db: Executor, creatorId: string): Promise<void> {
    const id = parseInput(Id, creatorId, "user id");
    await db.execute(sql`select pg_advisory_xact_lock(hashtext('included_credits'), hashtext(${id}::text))`);
  },

  /** The owner's shared included budget for `period` (0151), or null before their first charge of the month. */
  async ownerCredits(db: Executor, userId: string, period: string): Promise<OwnerCredits | null> {
    const v = parseInput(z.object({ userId: Id, period: Period }), { userId, period }, "owner credits");
    const rows = await db.select().from(ownerCredits).where(and(eq(ownerCredits.userId, v.userId), eq(ownerCredits.period, v.period))).limit(1);
    return rows[0] ?? null;
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
  async chargeCredits(db: Executor, businessId: string, period: string, amountMinor: number, options: ChargeOptions = {}): Promise<{ balance: CreditBalance; exhausted: "now" | "already" | null } | null> {
    const v = parseInput(z.object({ period: Period, amountMinor: MinorAmount.nonnegative() }), { period, amountMinor }, "credit charge");
    return usageRepo.chargeCreditsMicro(db, businessId, v.period, v.amountMinor * MICRO_PER_MINOR, options);
  },

  /**
   * `chargeCredits` for an exact cost in millionths of a cent (a ledger row's `costMicroMinor`, 0039): the period's carry
   * plus this amount is charged in whole cents and what is left below a cent is carried to the next charge, so a stream
   * of calls under half a cent is charged what it costs. `chargedMinor` is what this charge took from the balance.
   */
  async chargeCreditsMicro(db: Executor, businessId: string, period: string, microMinor: number, options: ChargeOptions = {}): Promise<{ balance: CreditBalance; exhausted: "now" | "already" | null; chargedMinor: number } | null> {
    const v = parseInput(z.object({ period: Period, microMinor: MinorAmount.nonnegative() }), { period, microMinor }, "credit charge");
    return db.transaction(async (tx) => {
      // One owner's projects charge one after another: the shared budget is read and spent under this lock.
      if (options.owner) await usageRepo.lockIncludedCredits(tx, options.owner.userId);
      const lockRow = async () => (await tx.select().from(creditBalances).where(and(eq(creditBalances.businessId, businessId), eq(creditBalances.period, v.period))).for("update").limit(1))[0];
      let current = await lockRow();
      let created = false;
      if (!current && (options.owner || options.includedMinor !== undefined)) {
        // With a shared owner budget the project's own row opens with what it carries from bought credit only.
        const included = options.owner ? 0 : typeof options.includedMinor === "function" ? await options.includedMinor(tx) : (options.includedMinor ?? 0);
        created = (await usageRepo.ensurePeriodCredits(tx, businessId, v.period, included)).created && !options.owner;
        current = await lockRow();
      }
      if (!current) return null;
      let owner: OwnerCredits | undefined;
      if (options.owner) {
        const lockOwner = async () => (await tx.select().from(ownerCredits).where(and(eq(ownerCredits.userId, options.owner!.userId), eq(ownerCredits.period, v.period))).for("update").limit(1))[0];
        owner = await lockOwner();
        if (!owner) {
          const budget = await options.owner.budgetMinor(tx);
          await tx.insert(ownerCredits).values({ userId: options.owner.userId, period: v.period, grantedMinor: budget, balanceMinor: budget, spentMinor: 0 }).onConflictDoNothing({ target: [ownerCredits.userId, ownerCredits.period] });
          owner = await lockOwner();
          created = true;
        }
      }
      // Bought credit past its 12 months leaves the balance first (0098).
      const now = new Date();
      if (await usageRepo.expireCreditLots(tx, businessId, v.period, now)) current = (await lockRow())!;
      const carried = Number(current.carryMicroMinor ?? 0) + v.microMinor;
      const amountMinor = Math.floor(carried / MICRO_PER_MINOR);
      // The shared budget goes first; what it cannot cover comes out of the project's own balance (what it bought).
      const ownerBefore = owner ? Number(owner.balanceMinor) : 0;
      const ownerTake = Math.min(ownerBefore, amountMinor);
      const balanceBefore = Number(current.balanceMinor);
      const balanceAfter = Math.max(0, balanceBefore - (amountMinor - ownerTake));
      // The project's own included credits (no owner) go first; what they cannot cover comes out of the lots, the one expiring first first.
      if (balanceAfter < balanceBefore) {
        const lots = await lockLiveLots(tx, businessId, now);
        const lotTotal = lots.reduce((sum, l) => sum + Number(l.remainingMinor), 0);
        let fromLots = Math.max(0, balanceBefore - balanceAfter - Math.max(0, balanceBefore - lotTotal));
        for (const lot of lots) {
          if (fromLots <= 0) break;
          const take = Math.min(fromLots, Number(lot.remainingMinor));
          await tx.update(creditLots).set({ remainingMinor: Number(lot.remainingMinor) - take, updatedAt: now }).where(eq(creditLots.id, lot.id));
          fromLots -= take;
        }
      }
      const [row] = await tx
        .update(creditBalances)
        .set({ balanceMinor: balanceAfter, spentMinor: sql`${creditBalances.spentMinor} + ${amountMinor}`, carryMicroMinor: carried - amountMinor * MICRO_PER_MINOR })
        .where(eq(creditBalances.id, current.id))
        .returning();
      let balance = one(row ? [row] : [], "credit balance");
      if (owner && ownerTake > 0) await tx.update(ownerCredits).set({ balanceMinor: ownerBefore - ownerTake, spentMinor: Number(owner.spentMinor) + ownerTake }).where(eq(ownerCredits.id, owner.id));
      const ownerAfter = ownerBefore - ownerTake;
      // What the caller reads is the project's whole balance: its own credits and what is left of the shared budget.
      if (owner) balance = { ...balance, balanceMinor: balanceAfter + ownerAfter, grantedMinor: Number(balance.grantedMinor) + Number(owner.grantedMinor) };
      const totalBefore = balanceBefore + ownerBefore;
      const totalAfter = balanceAfter + ownerAfter;
      const exhausted = totalAfter > 0 || amountMinor === 0 ? null : totalBefore > 0 || created ? "now" : "already";
      return { balance, exhausted, chargedMinor: amountMinor };
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
