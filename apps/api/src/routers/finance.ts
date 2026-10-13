/**
 * finance.overview / pnl / transactions.recategorise / forecast.update / capTable.(get, create*, update*) / wages (BUILD §11.8). Read-only module in
 * v1: no procedure here can initiate a payment (AC-11.8.5). Every derived number is labelled Estimate/Forecast.
 */
import { CREDITS_CURRENCY, LIMITS } from "@foundmill/config";
import { CreateEntryInput, CreateForecastInput, CreateSecurityInput, UpdateEntryInput, repos } from "@foundmill/db";
import { z } from "zod";
import { Id, audit, emit, router, sectionAdmin, sectionRead, sectionWrite } from "../trpc";

const read = sectionRead("finance");
const write = sectionWrite("finance");
const admin = sectionAdmin("finance");

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period is YYYY-MM");
const currentPeriod = () => new Date().toISOString().slice(0, 7);

/** A forecast's `drivers.runway_months`: months, null for "cash lasts past the horizon", undefined when it never said. */
function runwayOf(drivers: unknown): number | null | undefined {
  const v = (drivers as Record<string, unknown> | null | undefined)?.runway_months;
  return typeof v === "number" && Number.isFinite(v) ? v : v === null ? null : undefined;
}

/**
 * The runway threshold a new Base forecast crossed on the way down, or null. A crossing is relative to the Base
 * forecast it replaces: the previous runway was at or above the threshold (or past the horizon, or there was no
 * previous forecast) and the new one is below it. A save that stays under a threshold, or improves, crosses nothing.
 * When several thresholds are crossed at once the lowest (most urgent) is reported.
 */
export function runwayThresholdCrossed(previous: number | null | undefined, next: number | null | undefined): number | null {
  if (next === null || next === undefined) return null;
  const before = previous === null || previous === undefined ? Number.POSITIVE_INFINITY : previous;
  const crossed = [...LIMITS.runwayWarnMonths, LIMITS.runwayBlockMonths].filter((m) => next < m && before >= m).sort((a, b) => a - b);
  return crossed[0] ?? null;
}

export const financeRouter = router({
  /** Cash, burn, runway (Estimate), revenue (cash basis) and the latest forecast. */
  overview: read.query(({ ctx }) =>
    ctx.rls(async (tx) => {
      const [cash, burn, forecasts, monthly, conversions] = await Promise.all([
        repos.finance.cashPosition(tx, ctx.businessId),
        repos.finance.netBurn(tx, ctx.businessId, { months: 3 }),
        repos.finance.latestForecasts(tx, ctx.businessId),
        repos.finance.monthlyTotals(tx, ctx.businessId, { from: new Date(Date.now() - 180 * 86_400_000) }),
        repos.journeys.countConversions(tx, ctx.businessId, { from: new Date(Date.now() - 30 * 86_400_000) }),
      ]);
      const base = cash.byCurrency[0];
      const cashMinor = base?.balanceMinor ?? 0;
      const runwayMonths = burn.netBurnMinor > 0 ? Math.round((cashMinor / burn.netBurnMinor) * 10) / 10 : null;
      const warnings = runwayMonths === null ? [] : LIMITS.runwayWarnMonths.filter((m) => runwayMonths < m);
      return {
        cash: { amountMinor: cashMinor, currency: base?.currency ?? "EUR", accounts: cash.accounts.length, asOf: base?.oldestBalanceAt ?? null, label: "Cash in bank" },
        burn: { ...burn, label: "Estimate" as const, definition: "Operating outflows minus operating inflows, trailing 3-month average, financing excluded" },
        runway: { months: runwayMonths, label: "Estimate" as const, warnings, blocksContinue: runwayMonths !== null && runwayMonths < LIMITS.runwayBlockMonths },
        revenue: { monthly, basis: "cash" as const, label: "Management P&L, unaudited, cash basis" },
        customers30d: conversions.payment ?? 0,
        forecasts: Object.fromEntries(Object.entries(forecasts).map(([k, v]) => [k, v ? { ...v, label: "Forecast" as const } : null])),
      };
    }),
  ),

  pnl: read.input(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), period: z.string().optional() })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const range = { from: input?.from, to: input?.to };
      const [monthly, categories, snapshots] = await Promise.all([repos.finance.monthlyTotals(tx, ctx.businessId, range), repos.finance.categoryTotals(tx, ctx.businessId, range), repos.finance.listSnapshots(tx, ctx.businessId)]);
      const ledger = snapshots.find((s) => s.basis !== "cash") ?? null;
      return { monthly, categories, snapshots, source: ledger ? ("ledger" as const) : ("bank_categorised" as const), label: ledger ? "Ledger" : "Management P&L, unaudited, cash basis" };
    }),
  ),

  accounts: router({
    /** Connected bank accounts with their latest balance (read-only; consent expiry shown for open-banking links). */
    list: read.input(z.object({ includeArchived: z.boolean().default(false) })).query(({ ctx, input }) => ctx.rls((tx) => repos.finance.listAccounts(tx, ctx.businessId, { includeArchived: input.includeArchived }))),
  }),

  transactions: router({
    list: read.input(z.object({ accountId: Id.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), uncategorised: z.boolean().optional(), q: z.string().max(200).optional(), limit: z.number().int().min(1).max(500).default(100), cursor: z.string().nullish() })).query(({ ctx, input }) => ctx.rls((tx) => repos.finance.listTransactions(tx, ctx.businessId, input ?? {}))),
    /** Founder recategorisation; `applyToCounterparty` makes it a rule for the same counterparty (BUILD §11.8). */
    recategorise: write.input(z.object({ transactionId: Id, category: z.string().max(80).nullable(), applyToCounterparty: z.boolean().default(false) })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const transaction = await repos.finance.recategorise(tx, ctx.businessId, input.transactionId, input.category, "user");
        let ruleApplied = 0;
        if (input.applyToCounterparty && transaction.counterparty && input.category) ruleApplied = await repos.finance.recategoriseCounterparty(tx, ctx.businessId, transaction.counterparty, input.category, "rule");
        await audit(tx, ctx, { action: "finance.transactions.recategorise", target: { kind: "transaction", id: transaction.id }, details: { category: input.category, ruleApplied } });
        return { transaction, ruleApplied };
      }),
    ),
  }),

  forecast: router({
    list: read.query(({ ctx }) => ctx.rls((tx) => repos.finance.listForecasts(tx, ctx.businessId))),
    /**
     * A new forecast version (drivers + series) for a scenario; always labelled Forecast. Only the Base scenario is the
     * business's runway: when a save takes it below a threshold the previous Base forecast was not below, one
     * `runway.threshold_crossed` is raised (the Upside and Downside scenarios are what-ifs and never raise it).
     */
    update: write.input(CreateForecastInput).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const previous = input.scenario === "base" ? ((await repos.finance.listForecasts(tx, ctx.businessId, "base"))[0] ?? null) : null;
        const forecast = await repos.finance.createForecast(tx, ctx.businessId, input);
        const runway = runwayOf(input.drivers);
        const crossed = input.scenario === "base" ? runwayThresholdCrossed(previous ? runwayOf(previous.drivers) : undefined, runway) : null;
        if (crossed !== null && typeof runway === "number") {
          const [cash, burn] = await Promise.all([repos.finance.cashPosition(tx, ctx.businessId), repos.finance.netBurn(tx, ctx.businessId, { months: 3 })]);
          const currency = cash.byCurrency[0]?.currency ?? input.currency ?? "EUR";
          await emit(tx, ctx, {
            type: "runway.threshold_crossed",
            payload: { runwayMonths: Math.max(0, runway), thresholdMonths: crossed, direction: "below", cash: { amountMinor: cash.byCurrency[0]?.balanceMinor ?? 0, currency }, netBurnMonthly: { amountMinor: burn.netBurnMinor, currency }, scenario: "base", blocksContinue: runway < LIMITS.runwayBlockMonths },
            // One event per crossing: a retried or doubled save that replaces the same Base forecast raises nothing new.
            idempotencyKey: `runway.threshold_crossed:${previous?.id ?? "first"}:${crossed}`,
          });
        }
        await audit(tx, ctx, { action: "finance.forecast.update", target: { kind: "forecast", id: forecast.id }, details: { scenario: input.scenario } });
        return { ...forecast, label: "Forecast" as const };
      }),
    ),
  }),

  capTable: router({
    get: read.query(({ ctx }) =>
      ctx.rls(async (tx) => {
        const [securities, entries, summary] = await Promise.all([repos.capTable.listSecurities(tx, ctx.businessId), repos.capTable.listEntries(tx, ctx.businessId), repos.capTable.summary(tx, ctx.businessId)]);
        return { securities, entries, summary };
      }),
    ),
    createSecurity: admin.input(CreateSecurityInput).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const security = await repos.capTable.createSecurity(tx, ctx.businessId, input);
        await audit(tx, ctx, { action: "finance.cap_table.create_security", target: { kind: "security", id: security.id }, details: { class: input.class, kind: input.kind } });
        return security;
      }),
    ),
    createEntry: admin.input(CreateEntryInput).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const entry = await repos.capTable.createEntry(tx, ctx.businessId, input);
        await audit(tx, ctx, { action: "finance.cap_table.create_entry", target: { kind: "cap_table_entry", id: entry.id }, details: { securityId: input.securityId, quantity: input.quantity } });
        return entry;
      }),
    ),
    updateEntry: admin.input(z.object({ entryId: Id, patch: UpdateEntryInput })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const entry = await repos.capTable.updateEntry(tx, ctx.businessId, input.entryId, input.patch);
        await audit(tx, ctx, { action: "finance.cap_table.update_entry", target: { kind: "cap_table_entry", id: entry.id }, details: { fields: Object.keys(input.patch) } });
        return entry;
      }),
    ),
    archiveEntry: admin.input(z.object({ entryId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const entry = await repos.capTable.archiveEntry(tx, ctx.businessId, input.entryId);
        await audit(tx, ctx, { action: "finance.cap_table.archive_entry", target: { kind: "cap_table_entry", id: entry.id } });
        return entry;
      }),
    ),
    /** Round modelling (pre-money + investment → pro forma); pure arithmetic over the current summary, labelled Estimate. */
    modelRound: read.input(z.object({ preMoneyMinor: z.number().int().positive(), investmentMinor: z.number().int().positive(), poolTopUpPct: z.number().min(0).max(50).default(0) })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const summary = await repos.capTable.summary(tx, ctx.businessId);
        const postMoney = input.preMoneyMinor + input.investmentMinor;
        const investorPct = (input.investmentMinor / postMoney) * 100;
        const poolPct = input.poolTopUpPct;
        const dilution = 1 - (investorPct + poolPct) / 100;
        return {
          label: "Estimate" as const,
          postMoneyMinor: postMoney,
          investorPct: Math.round(investorPct * 100) / 100,
          poolPct,
          // Holders of SAFEs or notes alone have no shares (and no percentage) until the round converts them.
          holders: summary.byHolder.filter((h) => h.fullyDilutedPct !== null).map((h) => ({ holderEntityId: h.holderEntityId, displayName: h.displayName, beforePct: h.fullyDilutedPct ?? 0, afterPct: Math.round((h.fullyDilutedPct ?? 0) * dilution * 100) / 100 })),
        };
      }),
    ),
  }),

  /** Wage bill: per-agent cost this period (tokens, sandbox minutes, tool costs) — metered, labelled Estimate. */
  // The default is a function: a value would be the month the api process started in, for as long as it runs.
  wages: read.input(z.object({ period: Period.default(currentPeriod) })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const period = input?.period ?? currentPeriod();
      const [wages, agents] = await Promise.all([repos.usage.wages(tx, ctx.businessId, period), repos.agents.list(tx, ctx.businessId, { limit: 500 })]);
      // The team's cost is platform spend metered in US dollars (`currency`); a wage cap is in its agent's currency.
      const rows = wages.map((w) => {
        const agent = agents.items.find((a) => a.id === w.agentId);
        return { ...w, wageCapMinor: agent?.wageCapMinor ?? null, wageCapCurrency: agent?.currency ?? null };
      });
      return { period, label: "Estimate" as const, currency: CREDITS_CURRENCY, rows, totalMinor: wages.reduce((a, w) => a + w.costMinor, 0) };
    }),
  ),
});
