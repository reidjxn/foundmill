import { buildMockConnector } from "../../define";
import { decimalFromMinor, MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { makeWebhookRequest, ReplayGuard } from "../../webhooks";
import { MOCK_SHOP_DOMAIN, MOCK_SHOPIFY_WEBHOOK_SECRET, SH_CUSTOMERS, SH_ORDERS, SH_PRODUCTS, SH_SHOP } from "./fixtures/shop";
import { mapCustomer, mapDraftOrder, mapOrder, mapProduct, mapShop, SHOPIFY_KEY, SHOPIFY_RATE_LIMITS, SHOPIFY_SCOPES, shopifyTools, type ShDraftOrder, type ShOrder } from "./tools";
import { createShopifyWebhook, normaliseShopifyEvent, SHOPIFY_HMAC_HEADER, SHOPIFY_SHOP_HEADER, SHOPIFY_TOPIC_HEADER, SHOPIFY_WEBHOOK_ID_HEADER, shopifyHmac } from "./webhooks";

const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { status: 404 });

/** A correctly signed Shopify delivery (tests and simulations). */
export function signedShopifyRequest(businessId: string, topic: string, payload: unknown, opts: { secret?: string; webhookId?: string; shop?: string } = {}): Request {
  const body = JSON.stringify(payload);
  return makeWebhookRequest(`https://ingest.example/webhooks/${SHOPIFY_KEY}/${businessId}`, body, {
    "content-type": "application/json",
    [SHOPIFY_HMAC_HEADER]: shopifyHmac(opts.secret ?? MOCK_SHOPIFY_WEBHOOK_SECRET, body),
    [SHOPIFY_TOPIC_HEADER]: topic,
    [SHOPIFY_SHOP_HEADER]: opts.shop ?? MOCK_SHOP_DOMAIN,
    [SHOPIFY_WEBHOOK_ID_HEADER]: opts.webhookId ?? stableHash(["shopify-delivery", topic, body], 32),
    "x-shopify-api-version": "2025-10",
  });
}

export function createShopifyMock() {
  const orders = new Map<string, ShOrder>(SH_ORDERS.map((o) => [String(o.id), structuredClone(o)]));
  const drafts = new Map<string, ShDraftOrder>();
  const webhook = createShopifyWebhook({ secretFor: async () => MOCK_SHOPIFY_WEBHOOK_SECRET, replay: new ReplayGuard({ now: () => MOCK_NOW.getTime() }), now: () => MOCK_NOW });

  const connector = buildMockConnector({
    key: SHOPIFY_KEY,
    displayName: "Shopify",
    phase: 2,
    auth: { kind: "oauth", scopes: SHOPIFY_SCOPES },
    tools: shopifyTools,
    rateLimits: SHOPIFY_RATE_LIMITS,
    now: () => MOCK_NOW,
    webhooks: [webhook],
    handlers: {
      get_shop: async () => mapShop(SH_SHOP),
      list_orders: async ({ financialStatus, createdAtMin, limit }) => ({ items: [...orders.values()].filter((o) => (financialStatus === "any" || o.financial_status === financialStatus) && (!createdAtMin || o.created_at >= createdAtMin)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit).map(mapOrder) }),
      get_order: async ({ orderId }) => {
        const o = orders.get(orderId);
        if (!o) throw notFound(`order ${orderId}`);
        return mapOrder(o);
      },
      list_products: async ({ status, limit }) => ({ items: SH_PRODUCTS.filter((p) => !status || p.status === status).slice(0, limit).map(mapProduct) }),
      list_customers: async ({ email, limit }) => ({ items: SH_CUSTOMERS.filter((c) => !email || c.email?.toLowerCase() === email.toLowerCase()).slice(0, limit).map(mapCustomer) }),
      create_draft_order: async ({ email, lineItems, discountPercent, note, tags }) => {
        const id = stableHash(["draft", email, lineItems, discountPercent], 12);
        const existing = drafts.get(id);
        if (existing) return mapDraftOrder(existing);
        const items = lineItems.map((l) => {
          const variant = l.variantId ? SH_PRODUCTS.flatMap((p) => p.variants.map((v) => ({ v, p }))).find(({ v }) => String(v.id) === l.variantId) : undefined;
          if (l.variantId && !variant) throw notFound(`variant ${l.variantId}`);
          const unit = variant ? Math.round(Number.parseFloat(variant.v.price) * 100) : (l.priceMinor ?? 0);
          return { title: variant?.p.title ?? l.title ?? "Custom item", quantity: l.quantity, variant_id: variant ? variant.v.id : null, unitMinor: unit };
        });
        const gross = items.reduce((a, i) => a + i.unitMinor * i.quantity, 0);
        const total = Math.round(gross * (1 - (discountPercent ?? 0) / 100));
        const d: ShDraftOrder = { id: Number.parseInt(id.slice(0, 10), 16), name: `#D${id.slice(0, 4).toUpperCase()}`, status: "open", invoice_url: `https://${MOCK_SHOP_DOMAIN}/invoices/${id}`, currency: "EUR", total_price: decimalFromMinor(total), line_items: items.map(({ title, quantity, variant_id }) => ({ title, quantity, variant_id })), note: note ?? null, tags: tags.join(", ") };
        drafts.set(id, d);
        return mapDraftOrder(d);
      },
      cancel_order: async ({ orderId }) => {
        const o = orders.get(orderId);
        if (!o) throw notFound(`order ${orderId}`);
        if (o.cancelled_at) throw Object.assign(new Error(`order ${orderId} is already cancelled`), { status: 422 });
        if (o.fulfillment_status === "fulfilled") throw Object.assign(new Error(`order ${orderId} is fulfilled and cannot be cancelled`), { status: 422 });
        o.cancelled_at = MOCK_NOW.toISOString();
        return { cancelled: true as const, orderId, cancelledAt: o.cancelled_at };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(SHOPIFY_KEY, businessId, { accountLabel: `${SH_SHOP.name} (${MOCK_SHOP_DOMAIN}, mock)`, externalAccountId: MOCK_SHOP_DOMAIN, scopes: SHOPIFY_SCOPES, config: { shop: MOCK_SHOP_DOMAIN, currency: "EUR" } }),
    healthcheck: async () => mockHealth(SHOPIFY_KEY, { shop: MOCK_SHOP_DOMAIN, orders: orders.size }),
    simulations: {
      "payment.received": (params) => {
        const base = SH_ORDERS[0]!;
        const seed = String(params.seed ?? "default");
        const order: ShOrder = { ...base, id: 5_600_000_000 + (Number.parseInt(stableHash([params.businessId, seed], 8), 16) % 100_000_000), created_at: (params.occurredAt ?? MOCK_NOW).toISOString(), total_price: typeof params.amountMinor === "number" ? decimalFromMinor(params.amountMinor) : base.total_price, customer: { ...base.customer!, email: typeof params.email === "string" ? params.email : base.customer!.email, orders_count: typeof params.firstPayment === "boolean" && !params.firstPayment ? 2 : 1 } };
        return normaliseShopifyEvent("orders/paid", order, params.businessId, () => MOCK_NOW);
      },
      "signup.created": (params) => normaliseShopifyEvent("customers/create", { ...SH_CUSTOMERS[2]!, id: 6_200_000_000 + (Number.parseInt(stableHash([params.businessId, String(params.seed ?? "default")], 8), 16) % 100_000_000), created_at: (params.occurredAt ?? MOCK_NOW).toISOString() }, params.businessId, () => MOCK_NOW),
    },
  });
  return Object.assign(connector, { drafts });
}

export const shopifyMock = createShopifyMock();
