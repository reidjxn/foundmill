/**
 * billing.plan/changeTier/partner.join/topUp/checkout.status/checkout.completeMock/usage (BUILD §10.5, §11.15). Plans,
 * prices and what each plan includes are config (`TIERS`, `EARLY_ACCESS_STAGE`: packages/config, WP-14 T14); usage is
 * metered and labeled Estimate. Paying is a hard gate the founder completes personally (services/payments.ts):
 *   - `topUp` opens a Stripe Checkout session on the platform account through the gateway and returns the page to send
 *     the founder to; credits arrive only when the platform Stripe webhook (apps/ingest) reports the session paid. In
 *     mock mode the page is the Billing tab's simulated checkout, completed with `checkout.completeMock` (labeled; no
 *     money moves), and refused where it would fund live model calls.
 *   - `changeTier` refuses Founder and Studio while they are not on sale (outside development and test), and never
 *     opens a checkout: no subscription is charged while sign-up is invite-only.
 *   - `partner.join` records the owner, the project and consent on the Partner waitlist. Nothing is charged.
 *
 * Credits and platform costs are US dollars (`CREDITS_CURRENCY`, the model price list's currency), whatever the
 * business's own currency: `plan` and `usage` say so (`creditsCurrency`, `usage.currency`), list third-party spend
 * booked in another currency apart, and a top-up is in US dollars only.
 */
import { CREDIT_PACKS_MINOR, creditPackCreditsMinor, CREDITS_CURRENCY, EARLY_ACCESS_STAGE, ENTRY_PLAN, PARTNER_PLAN, planName, TIERS } from "@foundmill/config";
import { CREDITS_ZERO_STILL_WORKS, CREDITS_ZERO_STOPPED, MOCK_TOP_UP_LABEL, periodOf, periodRange, platformCredits, repos, settleCreditCheckout, waysToContinue } from "@foundmill/db";
import { AppError, PLAN_TIERS, ValidationError } from "@foundmill/shared";
import { z } from "zod";
import { costByDepartment } from "../services/billing-usage";
import { startCycle } from "../services/cycle";
import { emitResumed, restartAfterResume } from "../services/killswitch";
import { modelLimited } from "../services/model-limits";
import { assertTierAvailable, checkoutModeFor, checkoutView, entryPlanOpen, MOCK_PAYMENTS_OFF_MESSAGE, mockPaymentsAllowed, paidEntry, startCreditCheckout, tierAvailability, TOP_UP_MAX_MINOR, TOP_UP_MIN_MINOR, TOP_UP_OPTIONS_MINOR, topUpAvailability, topUpCredits } from "../services/payments";
import { audit, Id, ownerProcedure, router, sectionRead } from "../trpc";

const read = sectionRead("billing");
/** What a checkout unblocks once paid: `continue` starts the next round of work by itself (the pay-and-resume loop). */
const Resume = z.enum(["continue"]).nullable().optional();
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const currentPeriod = () => new Date().toISOString().slice(0, 7);
/** Credits are sold in US dollars only; another currency is refused, never merged into the balance. */
const CreditsCurrency = z
  .string()
  .length(3)
  .toUpperCase()
  .refine((c) => c === CREDITS_CURRENCY, { message: `Credits are sold in US dollars (${CREDITS_CURRENCY})` })
  .default(CREDITS_CURRENCY);

/** Starts the next round after a paid checkout, as a press of Continue would; null (and the reason logged) when it cannot. */
async function continueAfterPayment(ctx: Parameters<typeof startCycle>[0]): Promise<{ started: boolean; summary: string | null }> {
  try {
    const r = await startCycle(ctx);
    return { started: r.action !== "already_running", summary: r.summary.plainHeadline };
  } catch (err) {
    ctx.log.info({ businessId: ctx.businessId, err: (err as Error).message }, "paid; the next round waits for Continue");
    return { started: false, summary: null };
  }
}

export const billingRouter = router({
  plan: read.query(async ({ ctx }) => {
    // Paid entry's facts are read on the service connection, before the RLS transaction: whether any founder holds the
    // plan crosses accounts (a person's client role sees only their own row, and never its Stripe ids).
    const entryFacts = paidEntry(ctx.env) ? { open: await entryPlanOpen(ctx.db, ctx.env, ctx.businessId), mine: await repos.accountPlans.forUser(ctx.db, ctx.userId) } : null;
    return ctx.rls(async (tx) => {
      const period = currentPeriod();
      const [balance, credits, usage, partner] = await Promise.all([repos.usage.creditBalance(tx, ctx.businessId, period), platformCredits(tx, ctx.business, period), repos.usage.totals(tx, ctx.businessId, periodRange(period)), repos.partnerWaitlist.entry(tx, ctx.businessId, ctx.userId)]);
      return {
        tier: ctx.business.planTier,
        modelBilling: ctx.business.modelBilling,
        /** `invite_only` or `open`: what the plans' labels and checks follow (packages/config `EARLY_ACCESS_STAGE`). */
        stage: EARLY_ACCESS_STAGE,
        /**
         * Resting (WP-14 T1): the month's budget is used, or what is left is too little for another task, so nothing
         * new starts until `until` (the day the budget resets), a top-up or the founder's own key. Null otherwise. A
         * team waiting at the platform's monthly cap is not resting.
         */
        resting: credits.exhausted || (ctx.business.agentsStoppedReason === "credits_exhausted" && ctx.business.agentsStoppedAt !== null && periodOf(ctx.business.agentsStoppedAt) === period) ? { until: periodRange(period).to } : null,
        /** Whether the caller is on this project's Partner waitlist (an owner or admin reads it; anyone else sees null). */
        partner: { joinedAt: partner?.createdAt ?? null },
        period,
        /** Every credits amount below is in this currency (USD). */
        creditsCurrency: CREDITS_CURRENCY,
        /** The monthly platform credit this business gets: its tier's, unless the founder's other businesses took the month's (SEC2 S6). */
        includedCreditsMinor: credits.includedMinor,
        balance,
        /**
         * Where credits stand this month. Every business has them: on credits they pay for the agents too; on its own key
         * they pay for conversations, Refresh and planning, which run on the platform key (SEC2 S2). `mockMinor` came from
         * a simulated payment and never pays for live model calls.
         */
        credits,
        usage: { ...usage, label: "Estimate" as const },
        /** Which tiers can be chosen here, and why not. */
        tierChanges: PLAN_TIERS.map((tier) => tierAvailability(ctx.env, tier)),
        /** Whether a top-up can be bought here, how it is paid, and the amounts offered (USD cents). */
        topUp: { ...topUpAvailability(ctx.env), currency: "USD" as const, options: paidEntry(ctx.env) ? CREDIT_PACKS_MINOR : TOP_UP_OPTIONS_MINOR, minMinor: TOP_UP_MIN_MINOR, maxMinor: TOP_UP_MAX_MINOR },
        /**
         * The entry plan (WP-09 T16): null while sign-up is invitation-only and free (`PAID_ENTRY` off). With it on, what
         * it costs and includes, whether this project's AI runs are open (an owner holds the plan), and the credit packs
         * with what each grants (Estimate until the price per credit is set).
         */
        entryPlan: paidEntry(ctx.env)
          ? {
              name: ENTRY_PLAN.name,
              priceMonthlyMinor: ENTRY_PLAN.priceMonthlyMinor,
              includedCreditsMinor: ENTRY_PLAN.includedCreditsMinor,
              open: entryFacts?.open ?? false,
              mine: entryFacts?.mine ? { status: entryFacts.mine.status, mode: entryFacts.mine.mode, currentPeriodEnd: entryFacts.mine.currentPeriodEnd } : null,
              available: topUpAvailability(ctx.env).available,
              packs: CREDIT_PACKS_MINOR.map((priceMinor) => ({ priceMinor, creditsMinor: creditPackCreditsMinor(priceMinor) ?? priceMinor })),
            }
          : null,
        /** At zero credits: what stopped, what still works and the ways on, as the Inbox note says them (WP-09 T13). */
        atZero: credits.exhausted
          ? { stopped: CREDITS_ZERO_STOPPED, stillWorks: CREDITS_ZERO_STILL_WORKS, ways: waysToContinue({ topUps: topUpAvailability(ctx.env).available, nextCreditsOn: periodRange(period).to, ownKey: ctx.business.modelBilling === "byok" }) }
          : null,
      };
    });
  }),

  changeTier: ownerProcedure.input(z.object({ tier: z.enum(PLAN_TIERS) })).mutation(({ ctx, input }) => {
    assertTierAvailable(ctx.env, input.tier);
    return ctx.rls(async (tx) => {
      if (input.tier === ctx.business.planTier) throw new ValidationError(`Already on ${planName(input.tier)}`);
      const business = await repos.businesses.update(tx, ctx.businessId, { planTier: input.tier });
      await audit(tx, ctx, { action: "billing.change_tier", target: { kind: "business", id: ctx.businessId }, details: { from: ctx.business.planTier, to: input.tier } });
      return business;
    });
  }),

  partner: router({
    /**
     * "Join the Partner waitlist": records the owner, the project and their consent to be contacted about the plan, once.
     * Nothing is charged and nothing is promised: reviews begin once the plan opens.
     */
    join: ownerProcedure.input(z.object({ consent: z.literal(true) })).mutation(async ({ ctx }) => {
      // partner_waitlist is service-written; the owner check already ran. The audit row is the founder's own.
      const { entry, created } = await repos.partnerWaitlist.join(ctx.db, ctx.businessId, { userId: ctx.userId });
      if (created) await ctx.rls((tx) => audit(tx, ctx, { action: "billing.partner_waitlist_joined", target: { kind: "business", id: ctx.businessId }, details: { plan: PARTNER_PLAN.name } }));
      return { joinedAt: entry.createdAt, created };
    }),
  }),

  /** Opens a checkout for a credit top-up and returns the page to send the founder to (nothing is granted here). */
  topUp: ownerProcedure.input(z.object({ amountMinor: z.number().int().min(TOP_UP_MIN_MINOR).max(TOP_UP_MAX_MINOR), currency: CreditsCurrency, resume: Resume })).use(modelLimited("checkout")).mutation(async ({ ctx, input }) => {
    // With paid entry on, credits are sold as the packs only, each granting what config says it carries.
    const { creditsMinor } = topUpCredits(ctx.env, input.amountMinor);
    const started = await startCreditCheckout({ db: ctx.db, env: ctx.env, gateway: ctx.gateway }, { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email, amountMinor: input.amountMinor, creditsMinor, resume: input.resume ?? null });
    // billing_checkouts is service-written; the owner check already ran. The audit row is the founder's own.
    await ctx.rls((tx) => audit(tx, ctx, { action: "billing.checkout_started", target: { kind: "billing_checkout", id: started.checkout.id }, details: { amountMinor: input.amountMinor, ...(creditsMinor ? { creditsMinor } : {}), currency: "USD", mode: started.mode } }));
    return { checkout: checkoutView(started.checkout), checkoutUrl: started.checkoutUrl, mode: started.mode, label: started.mode === "mock" ? ("Mock checkout (no money moves)" as const) : null };
  }),

  /**
   * Opens the entry plan's subscription checkout (WP-09 T16) and returns Stripe's page: the person subscribes there,
   * with their own press. Only while `PAID_ENTRY` is on, and not while this account already holds an active plan.
   */
  subscribe: ownerProcedure.input(z.object({ resume: Resume })).use(modelLimited("checkout")).mutation(async ({ ctx, input }) => {
    if (!paidEntry(ctx.env)) throw new AppError("plan_not_offered", "There is nothing to subscribe to here yet.", 412);
    const mine = await repos.accountPlans.forUser(ctx.db, ctx.userId);
    // One subscription per person: an active one, or one behind on a payment (it is still billing), is managed on Stripe.
    if (mine && mine.status !== "canceled" && (mine.mode === "live" || checkoutModeFor(ctx.env) === "mock")) {
      throw new ValidationError(mine.status === "active" ? `You already have the ${ENTRY_PLAN.name} plan.` : `Your ${ENTRY_PLAN.name} plan has a payment due: update your card from Stripe's email about it, and the plan opens again by itself.`);
    }
    // A second press while a checkout is still open goes back to it, never to a second subscription.
    const open = await repos.accountPlans.openSubscriptionCheckout(ctx.db, ctx.userId, checkoutModeFor(ctx.env), new Date());
    if (open?.checkoutUrl) return { checkout: checkoutView(open), checkoutUrl: open.checkoutUrl, mode: open.mode, label: open.mode === "mock" ? ("Mock checkout (no money moves)" as const) : null };
    const started = await startCreditCheckout({ db: ctx.db, env: ctx.env, gateway: ctx.gateway }, { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email, amountMinor: ENTRY_PLAN.priceMonthlyMinor, kind: "subscription", resume: input?.resume ?? null });
    await ctx.rls((tx) => audit(tx, ctx, { action: "billing.checkout_started", target: { kind: "billing_checkout", id: started.checkout.id }, details: { kind: "subscription", amountMinor: ENTRY_PLAN.priceMonthlyMinor, currency: "USD", mode: started.mode } }));
    return { checkout: checkoutView(started.checkout), checkoutUrl: started.checkoutUrl, mode: started.mode, label: started.mode === "mock" ? ("Mock checkout (no money moves)" as const) : null };
  }),

  /**
   * Manage or cancel the entry plan (founder, Nov 18, 2026: canceling is never harder than subscribing). Live: Stripe's
   * customer portal, where the person changes the card or cancels; the subscription's events reach ingest as usual.
   * Mock: the simulated plan is canceled here and now (labeled; no money moves).
   */
  manage: ownerProcedure.use(modelLimited("checkout")).mutation(async ({ ctx }) => {
    const mine = await repos.accountPlans.forUser(ctx.db, ctx.userId);
    if (!mine || mine.status === "canceled") throw new ValidationError(`You have no ${ENTRY_PLAN.name} plan to manage.`);
    if (mine.mode === "mock") {
      await repos.accountPlans.cancelMock(ctx.db, ctx.userId, new Date());
      await ctx.rls((tx) => audit(tx, ctx, { action: "billing.entry_plan_canceled", target: { kind: "business", id: ctx.businessId }, details: { mode: "mock" } }));
      return { mode: "mock" as const, url: null, canceled: true, label: "Mock cancel (no money moves)" as const };
    }
    if (!mine.stripeCustomerId || !ctx.gateway.createPortal) throw new AppError("payments_unconfigured", "Stripe's billing page cannot be opened from here yet. Stripe's emails about your plan carry the same link.", 503);
    const { url } = await ctx.gateway.createPortal({ businessId: ctx.businessId, customerId: mine.stripeCustomerId, returnUrl: new URL(`/b/${ctx.businessId}/settings/billing`, ctx.env.APP_URL).toString() });
    await ctx.rls((tx) => audit(tx, ctx, { action: "billing.portal_opened", target: { kind: "business", id: ctx.businessId }, details: { mode: "live" } }));
    return { mode: "live" as const, url, canceled: false, label: null };
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
        await restartAfterResume(ctx);
      }
      // The pay-and-resume loop (founder, Nov 17, 2026): a checkout opened to unblock the next round starts it now, as
      // ingest does for a real payment. Only on this settlement (a second completion is a duplicate and starts nothing).
      const continued = (settled.outcome === "granted" || settled.outcome === "subscribed") && settled.checkout.resume === "continue" ? await continueAfterPayment(ctx) : null;
      if (settled.outcome === "subscribed") return { checkout: checkoutView(settled.checkout), balance: await repos.usage.creditBalance(ctx.db, ctx.businessId, currentPeriod()), granted: false, subscribed: true, resumed: null, continued, label: MOCK_TOP_UP_LABEL };
      const balance = settled.outcome === "granted" ? settled.balance : await repos.usage.creditBalance(ctx.db, ctx.businessId, currentPeriod());
      return { checkout: checkoutView(settled.checkout), balance, granted: settled.outcome === "granted", subscribed: false, continued, resumed: settled.outcome === "granted" && settled.resumed ? { reason: settled.resumed.reason, agents: settled.resumed.agentIds.length } : null, label: MOCK_TOP_UP_LABEL };
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
