/**
 * billing.plan/changeTier/topUp/usage (BUILD §10.5, §11.15). Prices are config (`TIERS`) and may be "TBD"; usage is
 * metered and labelled Estimate. Paying is a hard gate: `topUp` never charges anything from here — in live mode it
 * returns the checkout the founder completes personally; in mock mode credits are granted and labelled.
 */
import { PRICE_TBA_LABEL, TIERS } from "@foundmill/config";
import { periodRange, repos, resumeBusinessAgents } from "@foundmill/db";
import { PLAN_TIERS, ValidationError } from "@foundmill/shared";
import { z } from "zod";
import { emitResumed, restartEngines } from "../services/killswitch";
import { audit, ownerProcedure, router, sectionRead } from "../trpc";

const read = sectionRead("billing");
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const currentPeriod = () => new Date().toISOString().slice(0, 7);

export const billingRouter = router({
  plan: read.query(({ ctx }) =>
    ctx.rls(async (tx) => {
      const period = currentPeriod();
      const [balance, usage] = await Promise.all([repos.usage.creditBalance(tx, ctx.businessId, period), repos.usage.totals(tx, ctx.businessId, periodRange(period))]);
      return { tier: ctx.business.planTier, modelBilling: ctx.business.modelBilling, tiers: TIERS, priceLabel: PRICE_TBA_LABEL, period, balance, usage: { ...usage, label: "Estimate" as const } };
    }),
  ),

  changeTier: ownerProcedure.input(z.object({ tier: z.enum(PLAN_TIERS) })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      if (input.tier === ctx.business.planTier) throw new ValidationError(`Already on the ${input.tier} tier`);
      const business = await repos.businesses.update(tx, ctx.businessId, { planTier: input.tier });
      await audit(tx, ctx, { action: "billing.change_tier", target: { kind: "business", id: ctx.businessId }, details: { from: ctx.business.planTier, to: input.tier } });
      return business;
    }),
  ),

  topUp: ownerProcedure.input(z.object({ amountMinor: z.number().int().positive().max(1_000_000_00), currency: z.string().length(3).default("EUR") })).mutation(async ({ ctx, input }) => {
    const period = currentPeriod();
    if (ctx.env.INTEGRATIONS_MODE === "mock") {
      // credit_balances is service-written; the owner check already ran.
      const { balance, resumed } = await ctx.db.transaction(async (tx) => {
        const b = await repos.usage.grantCredits(tx, ctx.businessId, period, input.amountMinor, input.currency);
        // Credits back: a team stopped because they ran out resumes by itself (never Stop all agents or a revoked key).
        const r = Number(b.balanceMinor) > 0 ? await resumeBusinessAgents(tx, ctx.businessId, { reason: "credits_exhausted" }) : null;
        if (r?.resumed) await emitResumed(tx, ctx, r.agentIds, "Resumed: credits topped up");
        await audit(tx, ctx, { action: "billing.top_up", target: { kind: "credit_balance", id: b.id }, details: { amountMinor: input.amountMinor, currency: input.currency, mode: "mock", resumedAgents: r?.resumed ? r.agentIds.length : null } });
        return { balance: b, resumed: r?.resumed ? { reason: r.reason, agents: r.agentIds.length } : null };
      });
      if (resumed) await restartEngines(ctx);
      return { granted: true as const, balance, resumed, label: "Mock top-up (no money moved)" as const, checkoutUrl: null };
    }
    await ctx.rls((tx) => audit(tx, ctx, { action: "billing.top_up_requested", target: { kind: "business", id: ctx.businessId }, details: { amountMinor: input.amountMinor, currency: input.currency } }));
    return { granted: false as const, balance: null, resumed: null, label: "Complete the payment yourself; credits are granted by the payment webhook" as const, checkoutUrl: null, hardGate: "move_money" as const };
  }),

  usage: read.input(z.object({ period: Period.optional() })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const period = input?.period ?? currentPeriod();
      const range = periodRange(period);
      const [totals, daily, wages, departments, agents] = await Promise.all([repos.usage.totals(tx, ctx.businessId, range), repos.usage.daily(tx, ctx.businessId, range), repos.usage.wages(tx, ctx.businessId, period), repos.departments.list(tx, ctx.businessId), repos.agents.list(tx, ctx.businessId, { limit: 500 })]);
      const byDepartment = departments.map((d) => ({ departmentId: d.id, name: d.name, costMinor: wages.filter((w) => w.agentId && agents.items.find((a) => a.id === w.agentId)?.departmentIds.includes(d.id)).reduce((s, w) => s + w.costMinor, 0) }));
      return { period, label: "Estimate" as const, totals, daily, byAgent: wages, byDepartment };
    }),
  ),
});
