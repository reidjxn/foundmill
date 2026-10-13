/**
 * billing.plan/changeTier/topUp/checkout.status/checkout.completeMock/usage (BUILD §10.5, §11.15). Prices are config
 * (`TIERS`) and may be "TBD"; usage is metered and labeled Estimate. Paying is a hard gate the founder completes
 * personally (services/payments.ts):
 *   - `topUp` opens a Stripe Checkout session on the platform account through the gateway and returns the page to send
 *     the founder to; credits arrive only when the platform Stripe webhook (apps/ingest) reports the session paid. In
 *     mock mode the page is the Billing tab's simulated checkout, completed with `checkout.completeMock` (labeled; no
 *     money moves), and refused where it would fund live model calls.
 *   - `changeTier` refuses a paid tier while its price is "to be announced" (outside development and test).
 *
 * Credits and platform costs are US dollars (`CREDITS_CURRENCY`, the model price list's currency), whatever the
 * business's own currency: `plan` and `usage` say so (`creditsCurrency`, `usage.currency`), list third-party spend
 * booked in another currency apart, and a top-up is in US dollars only.
 */
import { CREDITS_CURRENCY, includedCreditsMinor, PRICE_TBA_LABEL, TIERS } from "@foundmill/config";
import { creditsState, MOCK_TOP_UP_LABEL, periodRange, repos, settleCreditCheckout } from "@foundmill/db";
import { AppError, PLAN_TIERS, ValidationError } from "@foundmill/shared";
import { z } from "zod";
import { costByDepartment } from "../services/billing-usage";
import { emitResumed, restartEngines } from "../services/killswitch";
import { modelLimited } from "../services/model-limits";
import { assertTierAvailable, checkoutView, MOCK_PAYMENTS_OFF_MESSAGE, mockPaymentsAllowed, startCreditCheckout, tierAvailability, TOP_UP_MAX_MINOR, TOP_UP_MIN_MINOR, TOP_UP_OPTIONS_MINOR, topUpAvailability } from "../services/payments";
import { audit, Id, ownerProcedure, router, sectionRead } from "../trpc";

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
        /** Which tiers can be chosen here, and why not. */
        tierChanges: PLAN_TIERS.map((tier) => tierAvailability(ctx.env, tier)),
        /** Whether a top-up can be bought here, how it is paid, and the amounts offered (USD cents). */
        topUp: { ...topUpAvailability(ctx.env), currency: "USD" as const, options: TOP_UP_OPTIONS_MINOR, minMinor: TOP_UP_MIN_MINOR, maxMinor: TOP_UP_MAX_MINOR },
      };
    }),
  ),

  changeTier: ownerProcedure.input(z.object({ tier: z.enum(PLAN_TIERS) })).mutation(({ ctx, input }) => {
    assertTierAvailable(ctx.env, input.tier);
    return ctx.rls(async (tx) => {
      if (input.tier === ctx.business.planTier) throw new ValidationError(`Already on the ${input.tier} tier`);
      const business = await repos.businesses.update(tx, ctx.businessId, { planTier: input.tier });
      await audit(tx, ctx, { action: "billing.change_tier", target: { kind: "business", id: ctx.businessId }, details: { from: ctx.business.planTier, to: input.tier } });
      return business;
    });
  }),

  /** Opens a checkout for a credit top-up and returns the page to send the founder to (nothing is granted here). */
  topUp: ownerProcedure.input(z.object({ amountMinor: z.number().int().min(TOP_UP_MIN_MINOR).max(TOP_UP_MAX_MINOR), currency: CreditsCurrency })).use(modelLimited("checkout")).mutation(async ({ ctx, input }) => {
    const started = await startCreditCheckout({ db: ctx.db, env: ctx.env, gateway: ctx.gateway }, { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email, amountMinor: input.amountMinor });
    // billing_checkouts is service-written; the owner check already ran. The audit row is the founder's own.
    await ctx.rls((tx) => audit(tx, ctx, { action: "billing.checkout_started", target: { kind: "billing_checkout", id: started.checkout.id }, details: { amountMinor: input.amountMinor, currency: "USD", mode: started.mode } }));
    return { checkout: checkoutView(started.checkout), checkoutUrl: started.checkoutUrl, mode: started.mode, label: started.mode === "mock" ? ("Mock checkout (no money moves)" as const) : null };
  }),

  checkout: router({
    /** Where a checkout stands (the Billing tab polls it after Stripe sends the founder back), with this month's credits. */
    status: read.input(z.object({ checkoutId: Id })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const checkout = await repos.checkouts.get(tx, ctx.businessId, input.checkoutId);
        const balance = await repos.usage.creditBalance(tx, ctx.businessId, currentPeriod());
        return { checkout: checkoutView(checkout), balance, label: checkout.mode === "mock" ? MOCK_TOP_UP_LABEL : null };
      }),
    ),

    /** The simulated payment of a checkout opened in mock mode: settled exactly as the webhook settles a real one. */
    completeMock: ownerProcedure.input(z.object({ checkoutId: Id })).mutation(async ({ ctx, input }) => {
      const checkout = await repos.checkouts.get(ctx.db, ctx.businessId, input.checkoutId);
      if (checkout.mode !== "mock") throw new ValidationError("A real payment is confirmed by Stripe, not from here");
      if (!mockPaymentsAllowed(ctx.env)) throw new AppError("payments_unavailable", MOCK_PAYMENTS_OFF_MESSAGE, 412);
      const settled = await settleCreditCheckout(ctx.db, {
        businessId: ctx.businessId,
        checkoutId: checkout.id,
        externalId: checkout.externalId,
        eventId: `mock:${checkout.id}`,
        amountMinor: Number(checkout.amountMinor),
        currency: checkout.currency,
        mode: "mock",
        paidAt: new Date(),
        actor: { kind: "user", id: ctx.userId },
      });
      if (settled.outcome === "unknown" || settled.outcome === "mismatch") throw new ValidationError("This checkout cannot be completed");
      // Credits back: a team stopped because they ran out resumes by itself (settleCreditCheckout lifted the stop).
      if (settled.outcome === "granted" && settled.resumed) {
        const agentIds = settled.resumed.agentIds;
        await ctx.rls((tx) => emitResumed(tx, ctx, agentIds, "Resumed: credits topped up"));
        await restartEngines(ctx);
      }
      const balance = settled.outcome === "granted" ? settled.balance : await repos.usage.creditBalance(ctx.db, ctx.businessId, currentPeriod());
      return { checkout: checkoutView(settled.checkout), balance, granted: settled.outcome === "granted", resumed: settled.outcome === "granted" && settled.resumed ? { reason: settled.resumed.reason, agents: settled.resumed.agentIds.length } : null, label: MOCK_TOP_UP_LABEL };
    }),
  }),

  usage: read.input(z.object({ period: Period.optional() })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const period = input?.period ?? currentPeriod();
      const range = periodRange(period);
      const [totals, daily, wages, departments, agents] = await Promise.all([repos.usage.totals(tx, ctx.businessId, range), repos.usage.daily(tx, ctx.businessId, range), repos.usage.wages(tx, ctx.businessId, period), repos.departments.list(tx, ctx.businessId), repos.agents.list(tx, ctx.businessId, { limit: 500 })]);
      // Each agent's cost counts once, in its primary department, so the departments add up to the agents' total.
      const byDepartment = costByDepartment(departments, agents.items, wages);
      return { period, label: "Estimate" as const, currency: CREDITS_CURRENCY, totals, daily, byAgent: wages, byDepartment };
    }),
  ),
});
