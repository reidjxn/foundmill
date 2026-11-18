/**
 * account_plans (0140, WP-09 T16): an account's $5 entry plan, as Foundmill's own Stripe last reported it. Written by
 * services only: the settlement of the plan's checkout (`settleCreditCheckout`, ../payments.ts) and ingest's webhook for
 * the subscription's later events. Read by the api's gate at a project's first AI run, while PAID_ENTRY is on.
 */
import { OWNER_ROLES } from "@foundmill/shared";
import { and, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { accountPlans, billingCheckouts, memberships, type AccountPlan, type AccountPlanStatus, type BillingCheckout, type BillingCheckoutMode } from "../schema";
import { maybeOne, one, type Executor } from "./_shared";

export interface ActivatePlanInput {
  userId: string;
  mode: BillingCheckoutMode;
  checkoutId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: Date | null;
  /** When the payment was made (the settling event's time): later status events must be newer to change it. */
  statusAt?: Date | null;
}

export const accountPlansRepo = {
  /** The account's plan row, or null when it never subscribed. */
  async forUser(db: Executor, userId: string): Promise<AccountPlan | null> {
    return maybeOne(await db.select().from(accountPlans).where(eq(accountPlans.userId, userId)).limit(1));
  },

  /** A paid entry-plan checkout: the account's plan becomes active (a second subscription replaces the first's ids). */
  async activate(db: Executor, input: ActivatePlanInput): Promise<AccountPlan> {
    const values = {
      status: "active" as const,
      mode: input.mode,
      checkoutId: input.checkoutId,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      statusAt: input.statusAt ?? null,
    };
    return one(
      await db
        .insert(accountPlans)
        .values({ userId: input.userId, ...values })
        .onConflictDoUpdate({ target: accountPlans.userId, set: values })
        .returning(),
      "account plan",
    );
  },

  /**
   * A later Stripe event about the subscription (renewed, past due, canceled), created at `eventAt`. Null when no account
   * holds it, or when the event is older than the one that last set the status (Stripe does not deliver in order), or
   * when it would bring a canceled subscription back (a canceled subscription never renews: a new one is a new checkout).
   */
  async setStatusBySubscription(db: Executor, stripeSubscriptionId: string, status: AccountPlanStatus, eventAt: Date, currentPeriodEnd?: Date | null): Promise<AccountPlan | null> {
    const rows = await db
      .update(accountPlans)
      .set({ status, statusAt: eventAt, ...(currentPeriodEnd !== undefined ? { currentPeriodEnd } : {}) })
      .where(and(eq(accountPlans.stripeSubscriptionId, stripeSubscriptionId), or(isNull(accountPlans.statusAt), lte(accountPlans.statusAt, eventAt)), status === "canceled" ? sql`true` : ne(accountPlans.status, "canceled")))
      .returning();
    return maybeOne(rows);
  },

  /**
   * Whether one of the business's founders (an owner or a cofounder, `OWNER_ROLES`) holds an active entry plan. `live`: only a plan paid for on Stripe counts (a
   * simulated one exists only where simulated payments are allowed, and never opens live work).
   */
  async ownerHasActivePlan(db: Executor, businessId: string, opts: { live: boolean }): Promise<boolean> {
    const rows = await db
      .select({ id: accountPlans.id })
      .from(accountPlans)
      .innerJoin(memberships, and(eq(memberships.userId, accountPlans.userId), eq(memberships.businessId, businessId), inArray(memberships.role, [...OWNER_ROLES])))
      .where(and(eq(accountPlans.status, "active"), opts.live ? eq(accountPlans.mode, "live") : sql`true`))
      .limit(1);
    return rows.length > 0;
  },

  /**
   * Whether the account has bought a credit pack: a paid credits checkout it opened. From the day sign-up opens this
   * unlocks Claude models on Foundmill's key (WP-13 T7 reads it) and lets the owner remove the "Built on" mark.
   */
  async boughtPack(db: Executor, userId: string, opts: { live: boolean }): Promise<boolean> {
    const rows = await db
      .select({ id: billingCheckouts.id })
      .from(billingCheckouts)
      .where(and(eq(billingCheckouts.createdBy, userId), eq(billingCheckouts.kind, "credits"), eq(billingCheckouts.status, "paid"), opts.live ? eq(billingCheckouts.mode, "live") : inArray(billingCheckouts.mode, ["live", "mock"])))
      .limit(1);
    return rows.length > 0;
  },

  /** Whether an owner of the business has bought a credit pack (`boughtPack` for any of its owners). */
  async ownerBoughtPack(db: Executor, businessId: string, opts: { live: boolean }): Promise<boolean> {
    const rows = await db
      .select({ id: billingCheckouts.id })
      .from(billingCheckouts)
      .innerJoin(memberships, and(eq(memberships.userId, billingCheckouts.createdBy), eq(memberships.businessId, businessId), inArray(memberships.role, [...OWNER_ROLES])))
      .where(and(eq(billingCheckouts.kind, "credits"), eq(billingCheckouts.status, "paid"), opts.live ? eq(billingCheckouts.mode, "live") : inArray(billingCheckouts.mode, ["live", "mock"])))
      .limit(1);
    return rows.length > 0;
  },

  /**
   * The account's entry-plan checkout that is still open on `mode` and not expired (newest first), so a second press of
   * Subscribe sends the person back to it instead of opening a second subscription.
   */
  async openSubscriptionCheckout(db: Executor, userId: string, mode: BillingCheckoutMode, now: Date): Promise<BillingCheckout | null> {
    return maybeOne(
      await db
        .select()
        .from(billingCheckouts)
        .where(and(eq(billingCheckouts.createdBy, userId), eq(billingCheckouts.kind, "subscription"), eq(billingCheckouts.status, "open"), eq(billingCheckouts.mode, mode), or(isNull(billingCheckouts.expiresAt), gt(billingCheckouts.expiresAt, now))))
        .orderBy(desc(billingCheckouts.createdAt))
        .limit(1),
    );
  },
};
