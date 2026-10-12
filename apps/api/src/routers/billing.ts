/**
 * billing.plan/changeTier/topUp/usage (BUILD §10.5, §11.15). Prices are config (`TIERS`) and may be "TBD"; usage is
 * metered and labeled Estimate. Paying is a hard gate: `topUp` never charges anything from here — in live mode it
 * returns the checkout the founder completes personally; in mock mode credits are granted and labeled.
 *
 * Credits and platform costs are US dollars (`CREDITS_CURRENCY`, the model price list's currency), whatever the
 * business's own currency: `plan` and `usage` say so (`creditsCurrency`, `usage.currency`), list third-party spend
 * booked in another currency apart, and a top-up is in US dollars only.
 */
import { CREDITS_CURRENCY, includedCreditsMinor, PRICE_TBA_LABEL, TIERS } from "@foundmill/config";
import { creditsState, periodRange, repos } from "@foundmill/db";
import { PLAN_TIERS, ValidationError } from "@foundmill/shared";
import { z } from "zod";
import { audit, ownerProcedure, router, sectionRead } from "../trpc";

const read = sectionRead("billing");
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const currentPeriod = () => new Date().toISOString().slice(0, 7);
/** Credits are sold in US dollars only; another currency is refused, never merged into the balance. */
const CreditsCurrency = z
  .string()
  .length(3)
  .toUpperCase()
  .refine((c) => c === CREDITS_CURRENCY, { message: `Credits are sold in US dollars (${CREDITS_CURRENCY})` })
  .default(CREDITS_CURRENCY);

export const billingRouter = router({
  plan: read.query(({ ctx }) =>
    ctx.rls(async (tx) => {
      const period = currentPeriod();
      const [balance, credits, usage] = await Promise.all([repos.usage.creditBalance(tx, ctx.businessId, period), creditsState(tx, ctx.business, period), repos.usage.totals(tx, ctx.businessId, periodRange(period))]);
      return {
        tier: ctx.business.planTier,
        modelBilling: ctx.business.modelBilling,
        tiers: TIERS,
        priceLabel: PRICE_TBA_LABEL,
        period,
        /** Every credits amount below is in this currency (USD). */
        creditsCurrency: CREDITS_CURRENCY,
        /** The monthly platform credit the business's tier includes (granted on the first charge of a month). */
        includedCreditsMinor: includedCreditsMinor(ctx.business.planTier),
        balance,
        /** Where credits stand this month (null for a business on its own key, which never touches credits). */
        credits,
        usage: { ...usage, label: "Estimate" as const },
      };
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

  topUp: ownerProcedure.input(z.object({ amountMinor: z.number().int().positive().max(1_000_000_00), currency: CreditsCurrency })).mutation(async ({ ctx, input }) => {
    const period = currentPeriod();
    if (ctx.env.INTEGRATIONS_MODE === "mock") {
      // credit_balances is service-written; the owner check already ran. A business on its own key keeps the balance
      // for when it goes back to credits; its own key is still what pays for its calls.
      const balance = await ctx.db.transaction(async (tx) => {
        const b = await repos.usage.grantCredits(tx, ctx.businessId, period, input.amountMinor, input.currency);
        await audit(tx, ctx, { action: "billing.top_up", target: { kind: "credit_balance", id: b.id }, details: { amountMinor: input.amountMinor, currency: input.currency, mode: "mock" } });
        return b;
      });
      return { granted: true as const, balance, label: "Mock top-up (no money moved)" as const, checkoutUrl: null };
    }
    await ctx.rls((tx) => audit(tx, ctx, { action: "billing.top_up_requested", target: { kind: "business", id: ctx.businessId }, details: { amountMinor: input.amountMinor, currency: input.currency } }));
    return { granted: false as const, balance: null, label: "Complete the payment yourself; credits are granted by the payment webhook" as const, checkoutUrl: null, hardGate: "move_money" as const };
  }),

  usage: read.input(z.object({ period: Period.optional() })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const period = input?.period ?? currentPeriod();
      const range = periodRange(period);
      const [totals, daily, wages, departments, agents] = await Promise.all([repos.usage.totals(tx, ctx.businessId, range), repos.usage.daily(tx, ctx.businessId, range), repos.usage.wages(tx, ctx.businessId, period), repos.departments.list(tx, ctx.businessId), repos.agents.list(tx, ctx.businessId, { limit: 500 })]);
      const byDepartment = departments.map((d) => ({ departmentId: d.id, name: d.name, costMinor: wages.filter((w) => w.agentId && agents.items.find((a) => a.id === w.agentId)?.departmentIds.includes(d.id)).reduce((s, w) => s + w.costMinor, 0) }));
      return { period, label: "Estimate" as const, currency: CREDITS_CURRENCY, totals, daily, byAgent: wages, byDepartment };
    }),
  ),
});
