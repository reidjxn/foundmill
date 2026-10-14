/**
 * Settling a credit top-up (BUILD §10.5 "credits"; audit 2026-10-12 #22). A top-up is a Stripe Checkout session on the
 * platform account (`billing_checkouts`, 0033). It is settled by exactly two callers:
 *   - apps/ingest's platform Stripe webhook (`POST /billing/stripe`), on a signed `checkout.session.completed` or
 *     `checkout.session.async_payment_succeeded` whose payment is `paid`;
 *   - apps/api's `billing.checkout.completeMock`, the simulated payment of a checkout opened in mock mode (labeled; no
 *     money moves).
 * Both go through `settleCreditCheckout`, which locks the checkout row and, in one transaction, grants the amount to
 * the current period's credit balance (USD, contract 5), marks the row paid with what settled it and writes the audit
 * row. A row that is already paid is answered `duplicate` (Stripe retries, both completion events), so credits are
 * granted once. A settlement that disagrees with the row (another session, amount, currency or mode) grants nothing,
 * is audited as `billing.checkout_mismatch` and is answered `mismatch`. Credits that bring the balance above zero lift a
 * stop for used-up credits in the same transaction (`resumeBusinessAgents`, reason `credits_exhausted` only: never Stop
 * all agents or a revoked key); the caller announces the resumed agents and restarts the channel engines.
 */
import { includedCreditsMinor } from "@foundmill/config";
import { resumeBusinessAgents, type ResumeBusinessResult } from "./controls";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import { periodOf } from "./repos/usage";
import type { BillingCheckout, BillingCheckoutMode, CreditBalance } from "./schema";

export const MOCK_TOP_UP_LABEL = "Mock top-up (no money moved)";

export interface SettleCheckoutInput {
  businessId: string;
  checkoutId: string;
  /** The Stripe Checkout session that was paid; must be the row's own when the row recorded one. */
  externalId: string | null;
  /** What settled it: the Stripe event id, or `mock:<checkout id>`. */
  eventId: string;
  /** What was paid, as Stripe reports it (minor units and ISO currency); must equal the row's amount in USD. */
  amountMinor: number;
  currency: string;
  mode: BillingCheckoutMode;
  paidAt: Date;
  /** Who settled it, for the audit row: the webhook, or the founder completing a mock checkout. */
  actor: { kind: "webhook" | "user"; id?: string | null };
}

export type SettleCheckoutResult =
  | { outcome: "granted"; checkout: BillingCheckout; balance: CreditBalance; resumed: Pick<ResumeBusinessResult, "reason" | "agentIds"> | null }
  | { outcome: "duplicate"; checkout: BillingCheckout }
  | { outcome: "mismatch"; checkout: BillingCheckout; reason: string }
  | { outcome: "unknown" };

/** Grants a paid checkout's credits once (see the module comment). */
export async function settleCreditCheckout(db: Executor, input: SettleCheckoutInput): Promise<SettleCheckoutResult> {
  return db.transaction(async (tx) => {
    const row = await repos.checkouts.lockForSettlement(tx, input.businessId, input.checkoutId);
    if (!row) return { outcome: "unknown" as const };
    if (row.status === "paid") return { outcome: "duplicate" as const, checkout: row };
    const reason =
      row.mode !== input.mode
        ? `a ${input.mode} payment cannot settle a ${row.mode} checkout`
        : row.externalId && input.externalId && row.externalId !== input.externalId
          ? "the paid session is not this checkout's session"
          : Number(row.amountMinor) !== input.amountMinor || input.currency.toUpperCase() !== row.currency
            ? `paid ${input.amountMinor} ${input.currency.toUpperCase()}, expected ${row.amountMinor} ${row.currency}`
            : null;
    if (reason) {
      await repos.audit.append(tx, input.businessId, {
        actorKind: input.actor.kind,
        actorId: input.actor.kind === "user" ? (input.actor.id ?? null) : null,
        action: "billing.checkout_mismatch",
        target: { kind: "billing_checkout", id: row.id },
        details: { reason, externalId: input.externalId, eventId: input.eventId, amountMinor: input.amountMinor, currency: input.currency.toUpperCase(), mode: input.mode },
      });
      return { outcome: "mismatch" as const, checkout: row, reason };
    }
    // A payment that arrives after the row was closed (the gateway timed out, the session expired) still pays for credits.
    const period = periodOf(input.paidAt);
    // A top-up comes on top of the month's included credits: the period's row starts with them when the top-up is the
    // first thing in the month (a team paused at the end of last month makes no charge to create it).
    const business = await repos.businesses.get(tx, input.businessId, { includeArchived: true });
    await repos.usage.ensurePeriodCredits(tx, input.businessId, period, includedCreditsMinor(business.planTier));
    const balance = await repos.usage.grantCredits(tx, input.businessId, period, Number(row.amountMinor), row.currency);
    const checkout = await repos.checkouts.markPaid(tx, input.businessId, row.id, { paidAt: input.paidAt, paidEventId: input.eventId, grantedPeriod: period, creditBalanceId: balance.id });
    await repos.audit.append(tx, input.businessId, {
      actorKind: input.actor.kind,
      actorId: input.actor.kind === "user" ? (input.actor.id ?? null) : null,
      action: "billing.credits_purchased",
      target: { kind: "billing_checkout", id: row.id },
      details: {
        amountMinor: Number(row.amountMinor),
        currency: row.currency,
        mode: row.mode,
        externalId: row.externalId,
        eventId: input.eventId,
        period,
        creditBalanceId: balance.id,
        ...(row.mode === "mock" ? { label: MOCK_TOP_UP_LABEL } : {}),
      },
    });
    const r = Number(balance.balanceMinor) > 0 ? await resumeBusinessAgents(tx, input.businessId, { reason: "credits_exhausted" }) : null;
    return { outcome: "granted" as const, checkout, balance, resumed: r?.resumed ? { reason: r.reason, agentIds: r.agentIds } : null };
  });
}
