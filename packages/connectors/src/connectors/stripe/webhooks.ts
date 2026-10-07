/**
 * Stripe webhooks (docs.stripe.com/webhooks#verify-manually). `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]`;
 * the signed payload is `${t}.${rawBody}` and the expected signature HMAC-SHA256(endpoint secret) in hex. The
 * timestamp must be within the tolerance (5 min, Stripe's library default) and the event id feeds the replay
 * guard. Normalisation (BUILD §11.4): `invoice.paid` and one-off `checkout.session.completed` →
 * `payment.received`; `customer.subscription.created` in trial → `signup.created`; the other
 * `customer.subscription.*` events verify and parse but map to no catalogue event yet.
 */
import type { ConnectorWebhook, PlatformEvent } from "../../contract";
import { makeEvent, uuidFromSeed } from "../../mock-utils";
import { DEFAULT_TOLERANCE_SECONDS, header, hmacSha256, parseJsonBody, rawBody, ReplayGuard, resolveBusinessId, safeEqual, webhookPath, withinTolerance, type BusinessResolver } from "../../webhooks";
import { invoiceProductRef, invoiceSubscriptionId, refId, STRIPE_KEY, type StCheckoutSession, type StEvent, type StInvoice, type StSubscription } from "./tools";

export const STRIPE_SIGNATURE_HEADER = "stripe-signature";

export function parseStripeSignature(headerValue: string): { timestamp: number; signatures: string[] } | null {
  let timestamp = Number.NaN;
  const signatures: string[] = [];
  for (const part of headerValue.split(",")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") timestamp = Number.parseInt(v, 10);
    else if (k === "v1") signatures.push(v);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export const stripeSignedPayload = (timestamp: number, body: string): string => `${timestamp}.${body}`;

/** Build a `Stripe-Signature` header value for a body (tests, mock simulations). */
export function stripeSignatureHeader(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmacSha256(secret, stripeSignedPayload(timestamp, body), "hex")}`;
}

export function verifyStripeSignature(secret: string, body: string, headerValue: string, nowMs: number, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS): boolean {
  const parsed = parseStripeSignature(headerValue);
  if (!parsed) return false;
  if (!withinTolerance(parsed.timestamp, nowMs, toleranceSeconds)) return false;
  const expected = hmacSha256(secret, stripeSignedPayload(parsed.timestamp, body), "hex");
  return parsed.signatures.some((s) => safeEqual(expected, s));
}

export interface StripeWebhookDeps {
  /** Endpoint secret for a business (per-business endpoint) or the platform endpoint (`businessId` null). */
  secretFor(businessId: string | null): Promise<string | null>;
  resolveBusinessId?: BusinessResolver;
  replay?: ReplayGuard;
  now?: () => Date;
  toleranceSeconds?: number;
}

export function createStripeWebhook(deps: StripeWebhookDeps): ConnectorWebhook {
  const replay = deps.replay ?? new ReplayGuard();
  const now = deps.now ?? (() => new Date());
  const businessFor = async (req: Request, event: StEvent | null) => resolveBusinessId(req, STRIPE_KEY, event?.account ?? null, deps.resolveBusinessId);
  return {
    path: webhookPath(STRIPE_KEY),
    async verify(req) {
      const sig = header(req, STRIPE_SIGNATURE_HEADER);
      if (!sig) return false;
      const body = await rawBody(req);
      const event = parseJsonBody<StEvent>(body);
      if (!event?.id || !event.type) return false;
      const businessId = await businessFor(req, event);
      const secret = await deps.secretFor(businessId);
      if (!secret) return false;
      if (!verifyStripeSignature(secret, body, sig, now().getTime(), deps.toleranceSeconds)) return false;
      return replay.check(`${event.account ?? "platform"}:${event.id}`);
    },
    async normalise(req) {
      const event = parseJsonBody<StEvent>(await rawBody(req));
      if (!event) return [];
      const businessId = await businessFor(req, event);
      if (!businessId) return [];
      return normaliseStripeEvent(event, businessId);
    },
  };
}

export const stripeCustomerEntityId = (customerId: string | null, email: string | null): string => uuidFromSeed("entity", "stripe", customerId ?? `email:${(email ?? "unknown").toLowerCase()}`);

export function normaliseStripeEvent(event: StEvent, businessId: string): PlatformEvent[] {
  const occurredAt = new Date(event.created * 1000);
  const actor = { kind: "webhook" as const, id: STRIPE_KEY };
  switch (event.type) {
    case "invoice.paid": {
      const inv = event.data.object as StInvoice;
      if (!inv?.id || inv.amount_paid <= 0) return [];
      const customerId = refId(inv.customer);
      const entityId = stripeCustomerEntityId(customerId, inv.customer_email ?? null);
      const subscriptionId = invoiceSubscriptionId(inv);
      return [
        makeEvent("payment.received", {
          businessId,
          occurredAt: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : occurredAt,
          actor,
          entityIds: [entityId],
          seed: inv.id,
          payload: {
            entityId,
            conversionId: uuidFromSeed("conversion", "stripe", inv.id),
            amount: { amountMinor: inv.amount_paid, currency: inv.currency.toUpperCase() },
            provider: "stripe",
            externalId: inv.id,
            // First invoice of a subscription or a stand-alone invoice; later invoices are renewals.
            firstPayment: inv.billing_reason === "subscription_create" || inv.billing_reason === "manual" || !subscriptionId,
            recurring: subscriptionId !== null,
            productRef: invoiceProductRef(inv),
            fee: null,
          },
        }),
      ];
    }
    case "checkout.session.completed": {
      const s = event.data.object as StCheckoutSession;
      // Subscription checkouts are followed by invoice.paid; counting both would double the match.
      if (!s?.id || s.mode !== "payment" || s.payment_status !== "paid" || !s.amount_total || !s.currency) return [];
      const email = s.customer_details?.email ?? s.customer_email ?? null;
      const entityId = stripeCustomerEntityId(refId(s.customer), email);
      return [
        makeEvent("payment.received", {
          businessId,
          occurredAt,
          actor,
          entityIds: [entityId],
          seed: s.id,
          payload: { entityId, conversionId: uuidFromSeed("conversion", "stripe", s.id), amount: { amountMinor: s.amount_total, currency: s.currency.toUpperCase() }, provider: "stripe", externalId: s.id, firstPayment: true, recurring: false, productRef: s.metadata?.productRef ?? null, fee: null },
        }),
      ];
    }
    case "customer.subscription.created": {
      const sub = event.data.object as StSubscription;
      if (!sub?.id || sub.status !== "trialing") return [];
      const customerId = refId(sub.customer);
      const entityId = stripeCustomerEntityId(customerId, null);
      return [
        makeEvent("signup.created", {
          businessId,
          occurredAt,
          actor,
          entityIds: [entityId],
          seed: sub.id,
          payload: { entityId, conversionId: uuidFromSeed("conversion", "stripe-trial", sub.id), visitorId: null, channelKey: null, campaignId: null, source: { utmSource: sub.metadata?.utm_source ?? null, utmMedium: sub.metadata?.utm_medium ?? null, utmCampaign: sub.metadata?.utm_campaign ?? null, referrer: null, code: sub.metadata?.promo_code ?? null }, provider: "stripe", consentState: "unknown" },
        }),
      ];
    }
    default:
      return [];
  }
}
