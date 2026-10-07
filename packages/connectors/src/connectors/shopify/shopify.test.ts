import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { MOCK_SHOP_DOMAIN, SH_CUSTOMERS, SH_ORDERS } from "./fixtures/shop";
import { createShopifyConnector } from "./index";
import { createShopifyMock, shopifyMock, signedShopifyRequest } from "./mock";

let n = 0;
const wid = () => `wh-${++n}`;

describeConnectorContract("shopify (mock)", {
  connector: shopifyMock,
  mode: "mock",
  calls: [
    { tool: "get_shop", args: {}, check: (r) => expect(r.data).toMatchObject({ myshopifyDomain: MOCK_SHOP_DOMAIN, currency: "EUR" }) },
    { tool: "list_orders", args: {}, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: { name: string }[] }).items.map((o) => o.name)).toEqual(["#1031", "#1030", "#1029"]) },
    { tool: "list_orders", args: { financialStatus: "paid" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(2) },
    { tool: "get_order", args: { orderId: "5500000031" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ total: { amountMinor: 4900, currency: "EUR" }, discountCodes: ["MAJA10"], lineItems: [{ sku: "NW-KIT-AUT" }] }) },
    { tool: "get_order", args: { orderId: "1" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
    { tool: "get_order", args: { orderId: "abc" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "list_products", args: { status: "active" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(3) },
    { tool: "list_customers", args: { email: "anna.lind@example.com" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: { ordersCount: number; acceptsMarketing: boolean }[] }).items[0]).toMatchObject({ ordersCount: 3, acceptsMarketing: true }) },
    { tool: "create_draft_order", args: { email: "maja@sensitiveskinclub.se", lineItems: [{ variantId: "44003" }, { title: "Handwritten note", priceMinor: 0 }], discountPercent: 100, tags: ["seeding"] }, check: (r) => expect(r.data).toMatchObject({ status: "open", total: { amountMinor: 0, currency: "EUR" }, lineItems: [{ title: "Autumn Routine Kit", variantId: "44003" }, { title: "Handwritten note", variantId: null }] }) },
    { tool: "create_draft_order", args: { email: "x@example.com", lineItems: [{ variantId: "1" }] }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
    { tool: "create_draft_order", args: { email: "x@example.com", lineItems: [{ title: "No price" }] }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "cancel_order", args: { orderId: "5500000030" }, expectOk: false, check: (r) => expect(r.error?.status).toBe(422) },
  ],
  webhooks: [
    {
      name: "orders/create (paid)",
      valid: () => signedShopifyRequest(TEST_BUSINESS_ID, "orders/create", SH_ORDERS[0], { webhookId: wid() }),
      tampered: () => signedShopifyRequest(TEST_BUSINESS_ID, "orders/create", SH_ORDERS[0], { secret: "wrong", webhookId: wid() }),
      replay: true,
      expectEvents: 1,
      expectTypes: ["payment.received"],
    },
    { name: "orders/create (pending → no event)", valid: () => signedShopifyRequest(TEST_BUSINESS_ID, "orders/create", SH_ORDERS[2], { webhookId: wid() }), expectEvents: 0 },
    { name: "orders/paid (repeat customer)", valid: () => signedShopifyRequest(TEST_BUSINESS_ID, "orders/paid", SH_ORDERS[1], { webhookId: wid() }), expectEvents: 1, expectTypes: ["payment.received"] },
    { name: "customers/create", valid: () => signedShopifyRequest(TEST_BUSINESS_ID, "customers/create", SH_CUSTOMERS[2], { webhookId: wid() }), expectEvents: 1, expectTypes: ["signup.created"] },
    { name: "products/update (no event)", valid: () => signedShopifyRequest(TEST_BUSINESS_ID, "products/update", { id: 1 }, { webhookId: wid() }), expectEvents: 0 },
  ],
});

describe("shopify normalisation, hard gate and state", () => {
  it("maps orders into payment.received with first-payment from orders_count", async () => {
    const webhook = shopifyMock.webhooks![0]!;
    const [first] = await webhook.normalise(signedShopifyRequest(TEST_BUSINESS_ID, "orders/create", SH_ORDERS[0]));
    expect(first!.payload).toMatchObject({ provider: "shopify", externalId: "5500000031", amount: { amountMinor: 4900, currency: "EUR" }, firstPayment: true, recurring: false, productRef: "Autumn Routine Kit" });
    expect(first!.occurredAt.toISOString()).toBe("2026-10-02T13:46:10.000Z");
    const [repeat] = await webhook.normalise(signedShopifyRequest(TEST_BUSINESS_ID, "orders/paid", SH_ORDERS[1]));
    expect(repeat!.payload).toMatchObject({ firstPayment: false });
    const [signup] = await webhook.normalise(signedShopifyRequest(TEST_BUSINESS_ID, "customers/create", SH_CUSTOMERS[1]));
    expect(signup!.payload).toMatchObject({ provider: "shopify", consentState: "unknown" });
  });
  it("refund_order is a hard gate; cancel_order is irreversible and works once", async () => {
    const mock = createShopifyMock();
    const ctx = makeToolContext(mock);
    const refund = await mock.callTool("refund_order", { orderId: "5500000031", amountMinor: 4900 }, ctx);
    expect(refund.error?.code).toBe("hard_gate");
    expect(refund.data).toMatchObject({ url: "https://admin.shopify.com/orders/5500000031" });
    expect(mock.policyHints.refund_order).toEqual({ hardGate: true, spendsMoney: true, irreversible: true });
    expect(mock.policyHints.cancel_order).toEqual({ irreversible: true });
    const cancel = await mock.callTool("cancel_order", { orderId: "5500000031", reason: "customer" }, ctx);
    expect(cancel.ok).toBe(true);
    expect((await mock.callTool("cancel_order", { orderId: "5500000031" }, ctx)).error?.status).toBe(422);
  });
  it("rejects unsigned deliveries and missing webhook ids", async () => {
    const webhook = shopifyMock.webhooks![0]!;
    const unsigned = new Request(`https://ingest.example/webhooks/shopify/${TEST_BUSINESS_ID}`, { method: "POST", body: "{}", headers: { "x-shopify-topic": "orders/create" } });
    expect(await webhook.verify(unsigned)).toBe(false);
    const req = signedShopifyRequest(TEST_BUSINESS_ID, "orders/create", SH_ORDERS[0]);
    const noId = new Request(req.url, { method: "POST", body: await req.text(), headers: { "x-shopify-hmac-sha256": req.headers.get("x-shopify-hmac-sha256")!, "x-shopify-topic": "orders/create" } });
    expect(await webhook.verify(noId)).toBe(false);
  });
  it("simulations are deterministic and honour overrides", async () => {
    const a = await shopifyMock.simulate("payment.received", { businessId: TEST_BUSINESS_ID, seed: "z", amountMinor: 8800, email: "new@example.com" });
    const b = await shopifyMock.simulate("payment.received", { businessId: TEST_BUSINESS_ID, seed: "z", amountMinor: 8800, email: "new@example.com" });
    expect(a).toEqual(b);
    expect(a[0]!.payload).toMatchObject({ amount: { amountMinor: 8800 }, firstPayment: true, provider: "shopify" });
    expect((await shopifyMock.simulate("signup.created", { businessId: TEST_BUSINESS_ID }))[0]!.type).toBe("signup.created");
  });
});

describe("shopify live (canned responses)", () => {
  it("calls the shop's Admin API with the access token and verifies webhooks with the app secret", async () => {
    let token = "";
    const connector = createShopifyConnector({
      secrets: { shopifyClientId: "cid", shopifyClientSecret: "app-secret" },
      fetch: routedFetch({ [`GET https://${MOCK_SHOP_DOMAIN}/admin/api/2025-10/orders/5500000031.json`]: (req) => ((token = req.headers.get("x-shopify-access-token") ?? ""), jsonResponse({ order: SH_ORDERS[0] })) }),
    });
    const ctx = makeToolContext(connector, { mode: "live", credential: { kind: "oauth", secret: "shpat_live" } });
    ctx.integration = { ...ctx.integration, externalAccountId: MOCK_SHOP_DOMAIN };
    const r = await connector.callTool("get_order", { orderId: "5500000031" }, ctx);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(token).toBe("shpat_live");
    expect(isUntrusted(r.data) && r.data.content).toMatchObject({ name: "#1031", total: { amountMinor: 4900 } });
    const webhook = connector.webhooks![0]!;
    expect(await webhook.verify(signedShopifyRequest(TEST_BUSINESS_ID, "orders/create", SH_ORDERS[0], { secret: "app-secret", webhookId: "live-1" }))).toBe(true);
    expect(await webhook.verify(signedShopifyRequest(TEST_BUSINESS_ID, "orders/create", SH_ORDERS[0], { secret: "other", webhookId: "live-2" }))).toBe(false);
  });
  it("exchanges the OAuth code on connect and stores the token for the gateway", async () => {
    const connector = createShopifyConnector({
      secrets: { shopifyClientId: "cid", shopifyClientSecret: "app-secret" },
      fetch: routedFetch({
        [`POST https://${MOCK_SHOP_DOMAIN}/admin/oauth/access_token`]: async (req) => (expect(await req.json()).toMatchObject({ client_id: "cid", client_secret: "app-secret", code: "c0de" }), jsonResponse({ access_token: "shpat_new", scope: "read_orders,read_products" })),
        [`GET https://${MOCK_SHOP_DOMAIN}/admin/api/2025-10/shop.json`]: () => jsonResponse({ shop: { id: 1, name: "Northwind Skincare", domain: "shop.northwindskincare.com", myshopify_domain: MOCK_SHOP_DOMAIN, currency: "eur" } }),
      }),
    });
    const record = await connector.connect(TEST_BUSINESS_ID, { shop: MOCK_SHOP_DOMAIN, code: "c0de" });
    expect(record).toMatchObject({ status: "connected", externalAccountId: MOCK_SHOP_DOMAIN, scopes: ["read_orders", "read_products"], credentialToStore: { kind: "oauth", secret: "shpat_new" }, config: { currency: "EUR" } });
  });
  it("throws ConfigError without a token or shop", async () => {
    const c = createShopifyConnector({ secrets: {} });
    await expect(c.callTool("get_shop", {}, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    await expect(c.connect(TEST_BUSINESS_ID, { shop: "not a shop" })).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(await c.webhooks![0]!.verify(signedShopifyRequest(TEST_BUSINESS_ID, "orders/create", SH_ORDERS[0]))).toBe(false);
  });
});

describe.skipIf(!envKeysPresent("SHOPIFY_TEST_SHOP", "SHOPIFY_TEST_ACCESS_TOKEN"))("shopify (live)", () => {
  const connector = createShopifyConnector({ secrets: { shopifyClientSecret: process.env.SHOPIFY_CLIENT_SECRET } });
  const ctx = makeToolContext(connector, { mode: "live", credential: { kind: "oauth", secret: process.env.SHOPIFY_TEST_ACCESS_TOKEN! } });
  describeConnectorContract("shopify live", { connector, mode: "live", deterministic: false, skipConnect: true, integration: { ...ctx.integration, externalAccountId: process.env.SHOPIFY_TEST_SHOP! }, credential: ctx.credential, calls: [{ tool: "get_shop", args: {} }] });
});
