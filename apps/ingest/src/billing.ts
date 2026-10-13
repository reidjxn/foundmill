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
 *      `checkout.session.expired` closes the checkout. Everything else is acknowledged and ignored.
 */
import { verifyStripeSignature } from "@foundmill/connectors";
import { repos, settleCreditCheckout } from "@foundmill/db";
import { isUuid } from "@foundmill/shared";
import { nonceKey } from "./nonce-store";
import type { IngestDeps } from "./types";

export const BILLING_WEBHOOK_PATH = "/billing/stripe";
const NONCE_SCOPE = "billing-stripe";

/** The session fields this endpoint reads (Stripe's `checkout.session` object). */
interface BillingSession {
  id?: string;
  mode?: string;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

interface BillingEvent {
  id?: string;
  type?: string;
  created?: number;
  data?: { object?: BillingSession };
}

export type BillingOutcome = "granted" | "duplicate" | "mismatch" | "unknown" | "expired" | "awaiting_payment" | "ignored";

export type BillingWebhookResult =
  | { status: 200; body: { ok: true; eventId: string; outcome: BillingOutcome } }
  | { status: 400 | 401 | 409 | 503; body: { ok: false; error: string; message: string } };

const refuse = (status: 400 | 401 | 409 | 503, error: string, message: string): BillingWebhookResult => ({ status, body: { ok: false, error, message } });

/** The checkout and business a session names in its metadata (apps/gateway `CHECKOUT_METADATA`), when both are ids. */
function checkoutOf(session: BillingSession): { checkoutId: string; businessId: string } | null {
  const checkoutId = session.metadata?.foundmill_checkout_id;
  const businessId = session.metadata?.foundmill_business_id;
  if (session.metadata?.foundmill_kind !== "credits" || !checkoutId || !businessId || !isUuid(checkoutId) || !isUuid(businessId)) return null;
  return { checkoutId, businessId };
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
    const named = checkoutOf(session);
    if (!named || session.mode !== "payment") return ok("ignored");
    if (event.type === "checkout.session.expired") {
      const closed = await repos.checkouts.markExpired(deps.db, named.businessId, named.checkoutId).catch(() => null);
      return ok(closed ? "expired" : "ignored");
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
    });
    if (settled.outcome === "mismatch") deps.log.warn({ eventId, checkoutId: named.checkoutId, reason: settled.reason }, "billing webhook: the paid session does not match its checkout; nothing granted");
    if (settled.outcome === "unknown") deps.log.warn({ eventId, checkoutId: named.checkoutId }, "billing webhook: no such checkout here (another environment on the same Stripe account?)");
    if (settled.outcome === "granted") deps.log.info({ eventId, checkoutId: named.checkoutId, businessId: named.businessId, amountMinor: Number(settled.checkout.amountMinor) }, "credits granted for a paid checkout");
    // The grant lifted a stop for used-up credits: the engines it ended and the retests queued meanwhile start again,
    // as after every other way back (apps/api killswitch.ts `restartAfterResume`). After the commit, never awaited.
    if (settled.outcome === "granted" && settled.resumed) deps.followups.resumed(named.businessId);
    return ok(settled.outcome);
  } catch (e) {
    await deps.nonces.release(nonce);
    throw e;
  }
}
