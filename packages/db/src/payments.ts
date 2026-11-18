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
import type { BillingCheckout, BillingCheckoutMode, CreditBalance, InboxItem } from "./schema";

export const MOCK_TOP_UP_LABEL = "Mock top-up (no money moved)";

/**
 * The pay-and-resume loop's request at the first run (WP-09 T16; founder, Nov 17, 2026): one Chief of Staff note that
 * says what is bought, why the team needs it now and what it costs, written once while paid entry's plan is missing and
 * archived when it is paid. It never holds Continue (the press itself is what asks for the plan).
 */
export const ENTRY_PLAN_REQUEST_SUBJECT = "Your team is ready to start";

/** Writes the request once (an open one is returned as it is); null when the business has no Chief of Staff. */
export async function postEntryPlanRequest(db: Executor, businessId: string, bodyMd: string): Promise<InboxItem | null> {
  const open = await repos.inbox.openBySubject(db, businessId, ENTRY_PLAN_REQUEST_SUBJECT);
  if (open[0]) return open[0];
  const chief = await repos.agents.chiefOfStaff(db, businessId);
  if (!chief) return null;
  const item = await repos.inbox.createItem(db, businessId, { type: "update", from_agent_id: chief.id, subject: ENTRY_PLAN_REQUEST_SUBJECT, body_md: bodyMd, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] });
  await repos.events.write(db, businessId, { type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, entityIds: [item.id], payload: { inboxItemId: item.id, type: item.type, fromAgentId: chief.id, subject: item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
  return item;
}

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
  /** The entry plan's checkout (0140): the subscription Stripe created, and its customer and paid period. */
  subscription?: { stripeSubscriptionId: string | null; stripeCustomerId: string | null; currentPeriodEnd: Date | null };
  /** The kind the paid session says it was for (its metadata); omitted by the mock completion, which reads the row. */
  kind?: "credits" | "subscription";
}

export type SettleCheckoutResult =
  | { outcome: "granted"; checkout: BillingCheckout; balance: CreditBalance; resumed: Pick<ResumeBusinessResult, "reason" | "agentIds"> | null }
  | { outcome: "subscribed"; checkout: BillingCheckout }
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
            : input.kind && input.kind !== row.kind
              ? `a ${input.kind} session cannot settle a ${row.kind} checkout`
              : row.kind === "subscription" && row.mode === "live" && !/^sub_/.test(input.subscription?.stripeSubscriptionId ?? "")
                ? "a paid entry-plan session without its subscription"
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
    // The entry plan's checkout (0140) grants no credits itself: the account's plan becomes active, and the month's
    // included credits come as they always do. It needs the person who opened it.
    if (row.kind === "subscription") {
      if (!row.createdBy) return { outcome: "mismatch" as const, checkout: row, reason: "an entry-plan checkout with no account" };
      const checkout = await repos.checkouts.markPaid(tx, input.businessId, row.id, { paidAt: input.paidAt, paidEventId: input.eventId, grantedPeriod: null, creditBalanceId: null });
      await repos.accountPlans.activate(tx, {
        userId: row.createdBy,
        mode: row.mode,
        checkoutId: row.id,
        stripeCustomerId: input.subscription?.stripeCustomerId ?? null,
        stripeSubscriptionId: input.subscription?.stripeSubscriptionId ?? null,
        currentPeriodEnd: input.subscription?.currentPeriodEnd ?? null,
        statusAt: input.paidAt,
      });
      await repos.audit.append(tx, input.businessId, {
        actorKind: input.actor.kind,
        actorId: input.actor.kind === "user" ? (input.actor.id ?? null) : null,
        action: "billing.entry_plan_started",
        target: { kind: "billing_checkout", id: row.id },
        details: { amountMinor: Number(row.amountMinor), currency: row.currency, mode: row.mode, externalId: row.externalId, eventId: input.eventId, ...(row.mode === "mock" ? { label: MOCK_TOP_UP_LABEL } : {}) },
      });
      // The request at the first run is answered: it leaves the Inbox.
      for (const item of await repos.inbox.openBySubject(tx, input.businessId, ENTRY_PLAN_REQUEST_SUBJECT)) await repos.inbox.archive(tx, input.businessId, item.id, { force: true });
      return { outcome: "subscribed" as const, checkout };
    }
    // A payment that arrives after the row was closed (the gateway timed out, the session expired) still pays for credits.
    const period = periodOf(input.paidAt);
    // A credit pack can carry more credit than its price (0140); a top-up carries what was paid.
    const creditsMinor = Number(row.creditsMinor ?? row.amountMinor);
    // A top-up comes on top of the month's included credits: the period's row starts with them when the top-up is the
    // first thing in the month (a team paused at the end of last month makes no charge to create it).
    const business = await repos.businesses.get(tx, input.businessId, { includeArchived: true });
    await repos.usage.ensurePeriodCredits(tx, input.businessId, period, includedCreditsMinor(business.planTier));
    const balance = await repos.usage.grantCredits(tx, input.businessId, period, creditsMinor, row.currency);
    // Bought credit lasts 12 months (founder, 2026-11-13; 0098): the lot carries it over from month to month.
    await repos.usage.addCreditLot(tx, input.businessId, { amountMinor: creditsMinor, purchasedAt: input.paidAt, checkoutId: row.id });
    const checkout = await repos.checkouts.markPaid(tx, input.businessId, row.id, { paidAt: input.paidAt, paidEventId: input.eventId, grantedPeriod: period, creditBalanceId: balance.id });
    await repos.audit.append(tx, input.businessId, {
      actorKind: input.actor.kind,
      actorId: input.actor.kind === "user" ? (input.actor.id ?? null) : null,
      action: "billing.credits_purchased",
      target: { kind: "billing_checkout", id: row.id },
      details: {
        amountMinor: Number(row.amountMinor),
        ...(creditsMinor !== Number(row.amountMinor) ? { creditsMinor } : {}),
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
