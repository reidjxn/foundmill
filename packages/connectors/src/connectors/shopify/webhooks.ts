/**
 * Shopify webhooks (shopify.dev/docs/apps/build/webhooks/subscribe/https#step-5-verify-the-webhook): the
 * `X-Shopify-Hmac-Sha256` header is base64(HMAC-SHA256(app client secret, raw body)). `X-Shopify-Webhook-Id`
 * is unique per delivery (replay guard), `X-Shopify-Topic` names the event and `X-Shopify-Shop-Domain` the
 * shop (used to resolve the business when the URL does not carry one). `orders/create` (when already paid)
 * and `orders/paid` → `payment.received`; `customers/create` → `signup.created`.
 */
import type { ConnectorWebhook, PlatformEvent } from "../../contract";
import { makeEvent, minorFromDecimal, uuidFromSeed } from "../../mock-utils";
import { header, hmacSha256, parseJsonBody, rawBody, ReplayGuard, resolveBusinessId, safeEqual, webhookPath, type BusinessResolver } from "../../webhooks";
import { SHOPIFY_KEY, type ShCustomer, type ShOrder } from "./tools";

export const SHOPIFY_HMAC_HEADER = "x-shopify-hmac-sha256";
export const SHOPIFY_TOPIC_HEADER = "x-shopify-topic";
export const SHOPIFY_SHOP_HEADER = "x-shopify-shop-domain";
export const SHOPIFY_WEBHOOK_ID_HEADER = "x-shopify-webhook-id";

export const shopifyHmac = (secret: string, body: string | Buffer): string => hmacSha256(secret, body, "base64");

export interface ShopifyWebhookDeps {
  /** App client secret (platform) or the per-shop secret when the founder brought a custom app. */
  secretFor(businessId: string | null, shopDomain: string | null): Promise<string | null>;
  resolveBusinessId?: BusinessResolver;
  replay?: ReplayGuard;
  now?: () => Date;
}

export function createShopifyWebhook(deps: ShopifyWebhookDeps): ConnectorWebhook {
  const replay = deps.replay ?? new ReplayGuard();
  return {
    path: webhookPath(SHOPIFY_KEY),
    async verify(req) {
      const hmac = header(req, SHOPIFY_HMAC_HEADER);
      const webhookId = header(req, SHOPIFY_WEBHOOK_ID_HEADER);
      const shop = header(req, SHOPIFY_SHOP_HEADER);
      if (!hmac || !webhookId) return false;
      const businessId = await resolveBusinessId(req, SHOPIFY_KEY, shop, deps.resolveBusinessId);
      const secret = await deps.secretFor(businessId, shop);
      if (!secret) return false;
      const body = await rawBody(req);
      if (!safeEqual(shopifyHmac(secret, body), hmac)) return false;
      return replay.check(webhookId);
    },
    async normalise(req) {
      const payload = parseJsonBody<unknown>(await rawBody(req));
      if (!payload || typeof payload !== "object") return [];
      const businessId = await resolveBusinessId(req, SHOPIFY_KEY, header(req, SHOPIFY_SHOP_HEADER), deps.resolveBusinessId);
      if (!businessId) return [];
      return normaliseShopifyEvent(header(req, SHOPIFY_TOPIC_HEADER) ?? "", payload, businessId, deps.now);
    },
  };
}

export const shopifyEntityId = (customer: { id?: number | string | null; email?: string | null } | null | undefined): string =>
  uuidFromSeed("entity", "shopify", customer?.id ? `customer:${customer.id}` : `email:${(customer?.email ?? "unknown").toLowerCase()}`);

export function normaliseShopifyEvent(topic: string, payload: unknown, businessId: string, now: () => Date = () => new Date()): PlatformEvent[] {
  const actor = { kind: "webhook" as const, id: SHOPIFY_KEY };
  if (topic === "orders/create" || topic === "orders/paid") {
    const o = payload as ShOrder;
    if (!o?.id || !o.total_price || !o.currency) return [];
    if (o.financial_status !== "paid" && o.financial_status !== "partially_paid") return [];
    const amountMinor = minorFromDecimal(o.total_price);
    if (amountMinor <= 0) return [];
    const customer = o.customer ?? (o.email ? { email: o.email } : null);
    const entityId = shopifyEntityId(customer);
    const ordersCount = o.customer?.orders_count ?? null;
    return [
      makeEvent("payment.received", {
        businessId,
        occurredAt: o.created_at ? new Date(o.created_at) : now(),
        actor,
        entityIds: [entityId],
        seed: `order:${o.id}`,
        payload: {
          entityId,
          conversionId: uuidFromSeed("conversion", "shopify", String(o.id)),
          amount: { amountMinor, currency: o.currency.toUpperCase() },
          provider: "shopify",
          externalId: String(o.id),
          firstPayment: ordersCount === null ? true : ordersCount <= 1,
          recurring: false,
          productRef: o.line_items[0]?.title ?? null,
          fee: null,
        },
      }),
    ];
  }
  if (topic === "customers/create") {
    const c = payload as ShCustomer;
    if (!c?.id) return [];
    const entityId = shopifyEntityId(c);
    const consent = c.email_marketing_consent?.state === "subscribed" || c.accepts_marketing ? "granted" : c.email_marketing_consent?.state === "unsubscribed" ? "denied" : "unknown";
    return [
      makeEvent("signup.created", {
        businessId,
        occurredAt: c.created_at ? new Date(c.created_at) : now(),
        actor,
        entityIds: [entityId],
        seed: `customer:${c.id}`,
        payload: { entityId, conversionId: uuidFromSeed("conversion", "shopify-customer", String(c.id)), visitorId: null, channelKey: null, campaignId: null, source: { utmSource: null, utmMedium: null, utmCampaign: null, referrer: null, code: null }, provider: "shopify", consentState: consent },
      }),
    ];
  }
  return [];
}
