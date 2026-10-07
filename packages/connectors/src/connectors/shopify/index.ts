/**
 * Live Shopify connector over the REST Admin API (2025-10) with `X-Shopify-Access-Token`. The per-business
 * credential is the shop's offline access token (OAuth code exchange in `connect()` with the platform app's
 * client id/secret); the shop domain lives in `integration.externalAccountId`. Webhooks verify with the app
 * client secret, or a per-shop secret (`shopify_webhook_secret`) when the founder uses a custom app.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, type Connector, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { shopifyMock } from "./mock";
import { mapCustomer, mapDraftOrder, mapOrder, mapProduct, mapShop, shopBaseUrl, ShopDomain, SHOPIFY_KEY, SHOPIFY_RATE_LIMITS, SHOPIFY_SCOPES, shopifyTools, type ShCustomer, type ShDraftOrder, type ShOrder, type ShProduct, type ShShop } from "./tools";
import { createShopifyWebhook } from "./webhooks";

export function createShopifyConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now, getBusinessSecret, resolveBusinessId } = resolveLiveOptions(options);

  const http = (ctx: ToolContext): HttpClient => {
    const shop = ctx.integration.externalAccountId ?? (ctx.integration.config as { shop?: string }).shop;
    if (!shop || !ShopDomain.safeParse(shop).success) throw new ConfigError(SHOPIFY_KEY, "shop domain", "connect the Shopify store in Settings → Integrations");
    if (!ctx.credential?.secret) throw new ConfigError(SHOPIFY_KEY, "Shopify access token", "reconnect the Shopify store (OAuth)");
    return createHttp({ connectorKey: SHOPIFY_KEY, baseUrl: shopBaseUrl(shop), fetch, headers: { "x-shopify-access-token": ctx.credential.secret } });
  };

  const webhook = createShopifyWebhook({
    secretFor: async (businessId) => (businessId && getBusinessSecret ? await getBusinessSecret(businessId, "shopify_webhook_secret") : null) ?? secrets.shopifyClientSecret ?? null,
    resolveBusinessId,
    now,
  });

  return buildLiveConnector(
    {
      key: SHOPIFY_KEY,
      displayName: "Shopify",
      phase: 2,
      auth: { kind: "oauth", scopes: SHOPIFY_SCOPES },
      tools: shopifyTools,
      rateLimits: SHOPIFY_RATE_LIMITS,
      now,
      webhooks: [webhook],
      handlers: {
        get_shop: async (_a, ctx) => mapShop((await http(ctx).json<{ shop: ShShop }>("GET", "/shop.json")).shop),
        list_orders: async ({ financialStatus, createdAtMin, limit }, ctx) => ({ items: (await http(ctx).json<{ orders: ShOrder[] }>("GET", "/orders.json", { query: { status: "any", financial_status: financialStatus, created_at_min: createdAtMin, limit, order: "created_at desc" } })).orders.map(mapOrder) }),
        get_order: async ({ orderId }, ctx) => mapOrder((await http(ctx).json<{ order: ShOrder }>("GET", `/orders/${orderId}.json`)).order),
        list_products: async ({ status, limit }, ctx) => ({ items: (await http(ctx).json<{ products: ShProduct[] }>("GET", "/products.json", { query: { status, limit } })).products.map(mapProduct) }),
        list_customers: async ({ email, limit }, ctx) => {
          const h = http(ctx);
          const res = email ? await h.json<{ customers: ShCustomer[] }>("GET", "/customers/search.json", { query: { query: `email:${email}`, limit } }) : await h.json<{ customers: ShCustomer[] }>("GET", "/customers.json", { query: { limit } });
          return { items: res.customers.map(mapCustomer) };
        },
        create_draft_order: async ({ email, lineItems, discountPercent, note, tags }, ctx) => {
          const body = {
            draft_order: {
              email,
              note,
              tags: tags.join(", "),
              line_items: lineItems.map((l) => (l.variantId ? { variant_id: Number(l.variantId), quantity: l.quantity } : { title: l.title, quantity: l.quantity, price: ((l.priceMinor ?? 0) / 100).toFixed(2) })),
              ...(discountPercent !== undefined ? { applied_discount: { value_type: "percentage", value: String(discountPercent), title: "Agent discount" } } : {}),
              use_customer_default_address: true,
            },
          };
          return mapDraftOrder((await http(ctx).json<{ draft_order: ShDraftOrder }>("POST", "/draft_orders.json", { body })).draft_order);
        },
        cancel_order: async ({ orderId, reason }, ctx) => {
          const res = await http(ctx).json<{ order: ShOrder }>("POST", `/orders/${orderId}/cancel.json`, { body: { reason, email: false } });
          return { cancelled: true as const, orderId, cancelledAt: res.order?.cancelled_at ?? now().toISOString() };
        },
      },
      connect: async (businessId, input) => {
        const i = typeof input === "object" && input ? (input as { shop?: unknown; code?: unknown; accessToken?: unknown }) : {};
        const shop = ShopDomain.safeParse(i.shop);
        if (!shop.success) throw new ConfigError(SHOPIFY_KEY, "shop domain", "connect() expects { shop: 'x.myshopify.com', code } from the OAuth redirect (or { shop, accessToken } for a custom app)");
        let accessToken = typeof i.accessToken === "string" ? i.accessToken : undefined;
        let scope = SHOPIFY_SCOPES.join(",");
        if (!accessToken) {
          if (typeof i.code !== "string") throw new ConfigError(SHOPIFY_KEY, "OAuth code", "connect() expects { shop, code } from the OAuth redirect");
          if (!secrets.shopifyClientId || !secrets.shopifyClientSecret) throw new ConfigError(SHOPIFY_KEY, "SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET");
          const res = await createHttp({ connectorKey: SHOPIFY_KEY, baseUrl: `https://${shop.data}`, fetch }).json<{ access_token: string; scope: string }>("POST", "/admin/oauth/access_token", { body: { client_id: secrets.shopifyClientId, client_secret: secrets.shopifyClientSecret, code: i.code } });
          accessToken = res.access_token;
          scope = res.scope;
        }
        const info = (await createHttp({ connectorKey: SHOPIFY_KEY, baseUrl: shopBaseUrl(shop.data), fetch, headers: { "x-shopify-access-token": accessToken } }).json<{ shop: ShShop }>("GET", "/shop.json")).shop;
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: SHOPIFY_KEY, status: "connected", scopes: scope.split(","), accountLabel: `${info.name} (${shop.data})`, externalAccountId: shop.data, config: { shop: shop.data, currency: info.currency.toUpperCase(), planName: info.plan_name ?? null }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
          credentialToStore: { kind: "oauth", secret: accessToken, accountId: shop.data },
        };
      },
      healthcheck: async (integration) => {
        const startedAt = now().getTime();
        if (!integration.externalAccountId) return healthResult("disconnected", startedAt, { now, message: "no shop domain on the integration" });
        // The access token is a per-business credential the host injects per call; without one, only the shop's reachability can be checked.
        try {
          const res = await fetch(`${shopBaseUrl(integration.externalAccountId)}/shop.json`, { method: "GET", headers: { accept: "application/json" } });
          return healthResult(res.status === 401 || res.status === 403 || res.ok ? "connected" : "degraded", startedAt, { now, details: { status: res.status } });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    shopifyMock,
  );
}

export { shopifyMock, createShopifyMock, signedShopifyRequest } from "./mock";
export { shopifyTools, SHOPIFY_KEY } from "./tools";
export { createShopifyWebhook, normaliseShopifyEvent, shopifyHmac } from "./webhooks";
