/**
 * billing_checkouts (0033): credit top-ups paid through Stripe Checkout on the platform account (BUILD §10.5).
 *
 * The api opens a row (`create`), asks the gateway for the session and records it (`attachSession`), or records why it
 * could not (`markFailed`). Settling it (granting the credits) is `settleCreditCheckout` in ../payments.ts, which locks
 * the row with `lockForSettlement` so a session announced twice is granted once. Rows are written with the service role
 * (app roles only read this table); the api checks the caller's role and billing section first.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { BILLING_CHECKOUT_KINDS, BILLING_CHECKOUT_MODES, BILLING_CHECKOUT_RESUME, billingCheckouts, type BillingCheckout } from "../schema";
import { Id, maybeOne, MinorAmount, one, parseInput, rowsOf, type Executor } from "./_shared";

export const CreateCheckoutInput = z.object({
  mode: z.enum(BILLING_CHECKOUT_MODES),
  amountMinor: MinorAmount.positive(),
  createdBy: Id.nullable().optional(),
  /** 0140: `subscription` is the entry plan's checkout; default `credits` (a top-up or a credit pack). */
  kind: z.enum(BILLING_CHECKOUT_KINDS).default("credits"),
  /** 0140: what a credit pack grants when it differs from its price (omitted: the amount paid). */
  creditsMinor: MinorAmount.positive().optional(),
  /** 0140: what the checkout unblocks once paid ('continue': the next round of work starts by itself). */
  resume: z.enum(BILLING_CHECKOUT_RESUME).nullable().optional(),
});
export type CreateCheckoutInput = z.input<typeof CreateCheckoutInput>;

export const AttachSessionInput = z.object({
  mode: z.enum(BILLING_CHECKOUT_MODES),
  externalId: z.string().min(1).max(255),
  checkoutUrl: z.string().min(1).max(2000),
  expiresAt: z.coerce.date().nullable().optional(),
});
export type AttachSessionInput = z.input<typeof AttachSessionInput>;

export interface PaidSettlement {
  paidAt: Date;
  paidEventId: string;
  /** Where the credits went; null for the entry plan's checkout, which grants none itself. */
  grantedPeriod: string | null;
  creditBalanceId: string | null;
}

export const checkoutsRepo = {
  /** Opens a top-up for `amountMinor` USD cents (credits are USD). */
  async create(db: Executor, businessId: string, input: CreateCheckoutInput): Promise<BillingCheckout> {
    const v = parseInput(CreateCheckoutInput, input, "checkout");
    return one(
      await db
        .insert(billingCheckouts)
        .values({ businessId, kind: v.kind, status: "open", mode: v.mode, amountMinor: v.amountMinor, creditsMinor: v.creditsMinor ?? null, resume: v.resume ?? null, currency: "USD", createdBy: v.createdBy ?? null })
        .returning(),
      "checkout",
    );
  },

  /** Records the Checkout session the gateway created for an open row. */
  async attachSession(db: Executor, businessId: string, checkoutId: string, input: AttachSessionInput): Promise<BillingCheckout> {
    const v = parseInput(AttachSessionInput, input, "checkout session");
    const rows = await db
      .update(billingCheckouts)
      .set({ mode: v.mode, externalId: v.externalId, checkoutUrl: v.checkoutUrl, expiresAt: v.expiresAt ?? null })
      .where(and(eq(billingCheckouts.businessId, businessId), eq(billingCheckouts.id, checkoutId), eq(billingCheckouts.status, "open")))
      .returning();
    return one(rows, "checkout", checkoutId);
  },

  /** No session could be created (payments not set up, the gateway or Stripe refused): the row is closed with why. */
  async markFailed(db: Executor, businessId: string, checkoutId: string, failure: string): Promise<BillingCheckout | null> {
    const rows = await db
      .update(billingCheckouts)
      .set({ status: "failed", failure: failure.slice(0, 500) })
      .where(and(eq(billingCheckouts.businessId, businessId), eq(billingCheckouts.id, checkoutId), eq(billingCheckouts.status, "open")))
      .returning();
    return maybeOne(rows);
  },

  /** Stripe closed the session unpaid (`checkout.session.expired`). A paid row is left as it is. */
  async markExpired(db: Executor, businessId: string, checkoutId: string): Promise<BillingCheckout | null> {
    const rows = await db
      .update(billingCheckouts)
      .set({ status: "expired" })
      .where(and(eq(billingCheckouts.businessId, businessId), eq(billingCheckouts.id, checkoutId), eq(billingCheckouts.status, "open")))
      .returning();
    return maybeOne(rows);
  },

  async get(db: Executor, businessId: string, checkoutId: string): Promise<BillingCheckout> {
    const id = parseInput(Id, checkoutId, "checkout id");
    return one(await db.select().from(billingCheckouts).where(and(eq(billingCheckouts.businessId, businessId), eq(billingCheckouts.id, id))).limit(1), "checkout", checkoutId);
  },

  /** The business's latest top-ups, newest first (the Billing tab). */
  async listRecent(db: Executor, businessId: string, limit = 10): Promise<BillingCheckout[]> {
    return db.select().from(billingCheckouts).where(eq(billingCheckouts.businessId, businessId)).orderBy(desc(billingCheckouts.createdAt)).limit(Math.max(1, Math.min(50, limit)));
  },

  /**
   * USD cents granted to `period` by simulated payments (mock checkouts marked paid). Those credits are labeled and
   * never pay for live model calls (../billing.ts `platformCredits`).
   */
  async mockGrantedMinor(db: Executor, businessId: string, period: string): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${billingCheckouts.amountMinor}), 0)::bigint` })
      .from(billingCheckouts)
      .where(and(eq(billingCheckouts.businessId, businessId), eq(billingCheckouts.mode, "mock"), eq(billingCheckouts.status, "paid"), eq(billingCheckouts.grantedPeriod, period)));
    return Number(row?.total ?? 0);
  },

  /**
   * Whether the person who took charge of `businessId` has themselves bought a credit pack of `minMinor` US cents or more
   * with a real payment, on any project they took charge of (#274, WP-14 A16: from the day sign-up opens such a pack opens
   * Opus and Sonnet to a Try project). Only that person's own purchases count: a pack a cofounder bought on another of
   * their projects does not. A simulated payment never counts.
   */
  async ownerHasPack(db: Executor, businessId: string, minMinor: number): Promise<boolean> {
    const result = await db.execute(sql`
      select 1 from billing_checkouts c join businesses b on b.id = c.business_id
        join businesses own on own.id = ${businessId}
       where c.status = 'paid' and c.mode = 'live' and c.amount_minor >= ${minMinor}
         and own.created_by is not null and b.created_by = own.created_by and c.created_by = own.created_by
       limit 1`);
    return rowsOf(result).length > 0;
  },

  /** The row, locked until the caller's transaction ends (settlement reads and writes it once). */
  async lockForSettlement(tx: Executor, businessId: string, checkoutId: string): Promise<BillingCheckout | null> {
    const rows = await tx.select().from(billingCheckouts).where(and(eq(billingCheckouts.businessId, businessId), eq(billingCheckouts.id, checkoutId))).for("update").limit(1);
    return maybeOne(rows);
  },

  /** open → paid, with what settled it (call inside the transaction that granted the credits). */
  async markPaid(tx: Executor, businessId: string, checkoutId: string, s: PaidSettlement): Promise<BillingCheckout> {
    const rows = await tx
      .update(billingCheckouts)
      .set({ status: "paid", paidAt: s.paidAt, paidEventId: s.paidEventId, grantedPeriod: s.grantedPeriod, creditBalanceId: s.creditBalanceId })
      .where(and(eq(billingCheckouts.businessId, businessId), eq(billingCheckouts.id, checkoutId)))
      .returning();
    return one(rows, "checkout", checkoutId);
  },
};
