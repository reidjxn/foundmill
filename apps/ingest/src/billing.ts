/**
 * The platform Stripe webhook for Foundmill's own billing (audit 2026-10-12 #22): `POST /billing/stripe`.
 *
 * A credit top-up is a Stripe Checkout session on the platform account (apps/api `billing.topUp`, apps/gateway
 * billing.ts). This endpoint is the only way a live one is paid out in credits:
 *   1. The delivery must carry a `Stripe-Signature` that verifies with STRIPE_BILLING_WEBHOOK_SECRET (a secret of its
 *      own, never a fixture and never the businesses' STRIPE_WEBHOOK_SECRET) within the replay window; without the
 *      secret every delivery is refused (503), in every mode.
 *   2. The event id is claimed in the nonce store (a captured delivery replayed is 409), and released when the write
 *      fails so Stripe's retry is accepted.
 *   3. `checkout.session.completed` or `checkout.session.async_payment_succeeded` with `payment_status: "paid"` settles
 *      the checkout named in the session's metadata through `settleCreditCheckout` (packages/db): the USD credits are
 *      granted once and audited; a duplicate, a session that disagrees with the checkout, or a checkout this database
 *      does not know (another environment on the same Stripe account) is acknowledged without granting anything. A
 *      grant that lifted a stop for used-up credits restarts the engines and queued training runs (followups.ts).
 *      `checkout.session.expired` closes the checkout, and `checkout.session.async_payment_failed` (a bank debit that
 *      bounced) closes it as failed.
 *   4. The $5 entry plan (WP-09 T16) is a subscription-mode session (`foundmill_kind: "subscription"`): its paid
 *      completion activates the plan of the account that opened it, with no credit grant. The subscription's later
 *      events (`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` / `.deleted`) move that plan's
 *      status; a subscription no account holds is acknowledged and ignored. Everything else is acknowledged and ignored.
 */
import { verifyStripeSignature } from "@foundmill/connectors";
import { repos, settleCreditCheckout, type AccountPlanStatus } from "@foundmill/db";
import { isUuid } from "@foundmill/shared";
import { nonceKey } from "./nonce-store";
import type { IngestDeps } from "./types";

export const BILLING_WEBHOOK_PATH = "/billing/stripe";
const NONCE_SCOPE = "billing-stripe";

/** The session fields this endpoint reads (Stripe's `checkout.session` object). */
interface BillingSession {
  id?: string;
  mode?: string;
  /** Subscription mode: the subscription and customer Stripe created (ids, unexpanded). */
  subscription?: string | null;
  customer?: string | null;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

interface BillingEvent {
  id?: string;
  type?: string;
  created?: number;
  data?: { object?: BillingSession & SubscriptionObject };
}

/** The fields read from a `subscription` or an `invoice` object (both API shapes: before and after 2025-03 basil). */
interface SubscriptionObject {
  object?: string;
  status?: string;
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> } | null;
  /** invoice: the subscription it bills, top-level on older API versions and under `parent` on newer ones. */
  parent?: { subscription_details?: { subscription?: string | null } | null } | null;
  lines?: { data?: Array<{ period?: { end?: number | null } | null }> } | null;
}

const SUBSCRIPTION_EVENTS = new Set(["invoice.paid", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"]);

/** Stripe's subscription status as the plan's own (0140): paying, behind on a payment, or over. */
function planStatusOf(stripeStatus: string | undefined): AccountPlanStatus | null {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "active";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid" || stripeStatus === "incomplete" || stripeStatus === "paused") return "past_due";
  if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired") return "canceled";
  return null;
}

const dateOf = (seconds: number | null | undefined): Date | undefined => (typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000) : undefined);

export type BillingOutcome = "granted" | "subscribed" | "plan_updated" | "duplicate" | "mismatch" | "unknown" | "expired" | "failed" | "awaiting_payment" | "ignored";

/** What the Billing tab says of a delayed payment that did not go through (`checkout.session.async_payment_failed`). */
export const ASYNC_PAYMENT_FAILED_MESSAGE = "The payment did not go through, so no credits were added. Try again with another payment method.";

export type BillingWebhookResult =
  | { status: 200; body: { ok: true; eventId: string; outcome: BillingOutcome } }
  | { status: 400 | 401 | 409 | 503; body: { ok: false; error: string; message: string } };

const refuse = (status: 400 | 401 | 409 | 503, error: string, message: string): BillingWebhookResult => ({ status, body: { ok: false, error, message } });

/** The checkout and business a session names in its metadata (apps/gateway `CHECKOUT_METADATA`), when both are ids. */
function checkoutOf(session: BillingSession): { checkoutId: string; businessId: string; kind: "credits" | "subscription" } | null {
  const checkoutId = session.metadata?.foundmill_checkout_id;
  const businessId = session.metadata?.foundmill_business_id;
  const kind = session.metadata?.foundmill_kind;
  if ((kind !== "credits" && kind !== "subscription") || !checkoutId || !businessId || !isUuid(checkoutId) || !isUuid(businessId)) return null;
  // Each kind arrives only in its own session mode: a credits checkout is a payment, the entry plan a subscription.
  if (session.mode !== (kind === "credits" ? "payment" : "subscription")) return null;
  return { checkoutId, businessId, kind };
}

/** A subscription event's subscription id, the plan status it reports, and the paid period's end when it says. */
function subscriptionUpdateOf(type: string, obj: SubscriptionObject & { id?: string; subscription?: string | null }): { subscriptionId: string; status: AccountPlanStatus; periodEnd?: Date } | null {
  if (type.startsWith("customer.subscription.")) {
    const status = type === "customer.subscription.deleted" ? "canceled" : planStatusOf(obj.status);
    if (!obj.id || !status) return null;
    return { subscriptionId: obj.id, status, periodEnd: dateOf(obj.current_period_end ?? obj.items?.data?.[0]?.current_period_end) };
  }
  const subscriptionId = obj.subscription ?? obj.parent?.subscription_details?.subscription ?? null;
  if (!subscriptionId) return null;
  if (type === "invoice.payment_failed") return { subscriptionId, status: "past_due" };
  return { subscriptionId, status: "active", periodEnd: dateOf(obj.lines?.data?.[0]?.period?.end) };
}

export async function handleBillingWebhook(deps: Pick<IngestDeps, "db" | "log" | "now" | "nonces" | "nonceTtlMs" | "replayWindowSeconds" | "billingWebhookSecret" | "followups">, req: Request): Promise<BillingWebhookResult> {
  const secret = deps.billingWebhookSecret ?? null;
  if (!secret) return refuse(503, "billing_webhook_unconfigured", "STRIPE_BILLING_WEBHOOK_SECRET is not set on ingest; no billing delivery is accepted");
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature || !verifyStripeSignature(secret, body, signature, deps.now().getTime(), deps.replayWindowSeconds)) {
    deps.log.warn({ path: BILLING_WEBHOOK_PATH }, "billing webhook signature verification failed");
    return refuse(401, "invalid_signature", "Signature verification failed");
  }
  let event: BillingEvent;
  try {
    event = JSON.parse(body) as BillingEvent;
  } catch {
    return refuse(400, "invalid_payload", "Body must be a Stripe event");
  }
  if (!event?.id || !event.type) return refuse(400, "invalid_payload", "Body must be a Stripe event");
  const eventId = event.id;
  const nonce = nonceKey(NONCE_SCOPE, eventId);
  if (!(await deps.nonces.claim(nonce, deps.nonceTtlMs))) return refuse(409, "replayed", "This delivery was already accepted");
  const ok = (outcome: BillingOutcome): BillingWebhookResult => ({ status: 200, body: { ok: true, eventId, outcome } });

  try {
    const session = event.data?.object ?? {};
    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const update = subscriptionUpdateOf(event.type, session);
      if (!update) return ok("ignored");
      const eventAt = typeof event.created === "number" ? new Date(event.created * 1000) : deps.now();
      const plan = await repos.accountPlans.setStatusBySubscription(deps.db, update.subscriptionId, update.status, eventAt, update.periodEnd);
      if (plan) deps.log.info({ eventId, status: update.status }, "entry plan status updated");
      return ok(plan ? "plan_updated" : "ignored");
    }
    const named = checkoutOf(session);
    if (!named) return ok("ignored");
    if (event.type === "checkout.session.expired") {
      const closed = await repos.checkouts.markExpired(deps.db, named.businessId, named.checkoutId).catch(() => null);
      return ok(closed ? "expired" : "ignored");
    }
    // A bank debit that bounced: the session completed but no money arrived, and it never expires, so close it here.
    if (event.type === "checkout.session.async_payment_failed") {
      const closed = await repos.checkouts.markFailed(deps.db, named.businessId, named.checkoutId, ASYNC_PAYMENT_FAILED_MESSAGE).catch(() => null);
      return ok(closed ? "failed" : "ignored");
    }
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return ok("ignored");
    // A bank debit completes the session first and pays later (async_payment_succeeded).
    if (session.payment_status !== "paid") return ok("awaiting_payment");
    const settled = await settleCreditCheckout(deps.db, {
      businessId: named.businessId,
      checkoutId: named.checkoutId,
      externalId: session.id ?? null,
      eventId,
      amountMinor: Number(session.amount_total ?? 0),
      currency: session.currency ?? "",
      mode: "live",
      paidAt: typeof event.created === "number" ? new Date(event.created * 1000) : deps.now(),
      actor: { kind: "webhook" },
      kind: named.kind,
      ...(named.kind === "subscription"
        ? { subscription: { stripeSubscriptionId: session.subscription ?? null, stripeCustomerId: session.customer ?? null, currentPeriodEnd: null } }
        : {}),
    });
    if (settled.outcome === "mismatch") deps.log.warn({ eventId, checkoutId: named.checkoutId, reason: settled.reason }, "billing webhook: the paid session does not match its checkout; nothing granted");
    if (settled.outcome === "unknown") deps.log.warn({ eventId, checkoutId: named.checkoutId }, "billing webhook: no such checkout here (another environment on the same Stripe account?)");
    if (settled.outcome === "granted") deps.log.info({ eventId, checkoutId: named.checkoutId, businessId: named.businessId, amountMinor: Number(settled.checkout.amountMinor) }, "credits granted for a paid checkout");
    // The grant lifted a stop for used-up credits: the engines it ended and the retests queued meanwhile start again,
    // as after every other way back (apps/api killswitch.ts `restartAfterResume`). After the commit, never awaited.
    if (settled.outcome === "granted" && settled.resumed) deps.followups.resumed(named.businessId);
    // The pay-and-resume loop (founder, Nov 17, 2026): a checkout opened to unblock the next round starts it now.
    if ((settled.outcome === "granted" || settled.outcome === "subscribed") && settled.checkout.resume === "continue") deps.followups.continueAfterPayment(named.businessId, named.checkoutId);
    return ok(settled.outcome);
  } catch (e) {
    await deps.nonces.release(nonce);
    throw e;
  }
}

/** The most a delivery to Foundmill's own billing webhook may carry before it is read (WP-11 T15). */
export const BILLING_WEBHOOK_MAX_BYTES = 1024 * 1024;

