/**
 * OAuth connects (GPC-12) and the health check (ARB-32).
 * - Google, Notion and Shopify start on the vendor's consent page with a state signed for the founder, the business and
 *   the connector, write nothing until the code comes back, and accept the code only with that state.
 * - integrations.health needs settings administration and reports a disconnected integration without calling anything.
 */
import { createDefaultRegistry, jsonResponse, routedFetch } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { oauthRedirectUri, signConnectState, verifyConnectState } from "../services/install-state";
import { createApiHarness, TEST_SESSION_TOKEN_SECRET, type ApiHarness } from "./harness";

const APP_URL = "https://foundmill.test";
const REDIRECT = oauthRedirectUri(APP_URL);
const exchanges: { connector: string; body: string }[] = [];

describe("integrations.connect for OAuth connectors", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "oauth", env: { LIVE_CONNECTORS: "notion,gmail,shopify", APP_URL } });
    hz.deps.connectors = createDefaultRegistry({
      secrets: { notionClientId: "notion-client", notionClientSecret: "notion-secret", googleClientId: "google-client", googleClientSecret: "google-secret", shopifyClientId: "shopify-client", shopifyClientSecret: "shopify-secret" },
      fetch: routedFetch({
        "POST https://api.notion.com/v1/oauth/token": async (req) => (exchanges.push({ connector: "notion", body: await req.text() }), jsonResponse({ access_token: "secret_notion_token", workspace_name: "Northwind HQ", workspace_id: "ws-1", bot_id: "bot-1" })),
        "POST https://northwind.myshopify.com/admin/oauth/access_token": async (req) => (exchanges.push({ connector: "shopify", body: await req.text() }), jsonResponse({ access_token: "shpat_token", scope: "read_orders" })),
        "GET https://northwind.myshopify.com/admin/api/2025-10/shop.json": () => jsonResponse({ shop: { id: 1, name: "Northwind", domain: "northwind.example", myshopify_domain: "northwind.myshopify.com", currency: "usd" } }),
      }),
    });
  }, 120_000);
  afterAll(() => hz.close());
  beforeEach(() => {
    exchanges.length = 0;
  });

  const start = async (userId: string, businessId: string, connectorKey: string, input: Record<string, unknown> = {}) => {
    const r = await hz.caller({ userId }).integrations.connect({ businessId, connectorKey, input });
    return { r, url: new URL(r.consentUrl!) };
  };

  it("opens the vendor's consent page with the api's redirect URI and a signed state, and writes nothing", async () => {
    const { businessId, ownerId } = hz.A;
    const { r, url } = await start(ownerId, businessId, "notion", { redirectUri: "https://evil.example/steal" });
    expect(r).toMatchObject({ integration: null, founderConsentRequired: true, record: { status: "disconnected" } });
    expect(url.origin).toBe("https://api.notion.com");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    const state = url.searchParams.get("state")!;
    expect(verifyConnectState(TEST_SESSION_TOKEN_SECRET, state, { userId: ownerId, businessId, connectorKey: "notion" })).toEqual({ account: null });
    expect(await repos.integrations.getByKey(hz.db, businessId, "notion")).toBeNull();
    const google = await start(ownerId, businessId, "gmail");
    expect(google.url.origin).toBe("https://accounts.google.com");
  });

  it("connects with the code only for the founder, business and connector the state was signed for", async () => {
    const { businessId, ownerId, adminId } = hz.A;
    const { url } = await start(ownerId, businessId, "notion");
    const state = url.searchParams.get("state")!;
    const finish = (userId: string, b: string, connectorKey: string, s = state) => hz.caller({ userId }).integrations.connect({ businessId: b, connectorKey, input: { code: "notion-code", state: s } });
    await expect(finish(adminId, businessId, "notion")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(finish(hz.B.ownerId, hz.B.businessId, "notion")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(finish(ownerId, businessId, "gmail")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(finish(ownerId, businessId, "notion", signConnectState("another-secret-of-sixteen-plus", { userId: ownerId, businessId, connectorKey: "notion" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(exchanges).toEqual([]);

    const r = await finish(ownerId, businessId, "notion");
    expect(r.integration).toMatchObject({ status: "connected", accountLabel: "Northwind HQ" });
    expect(JSON.parse(exchanges[0]!.body)).toMatchObject({ grant_type: "authorization_code", code: "notion-code", redirect_uri: REDIRECT });
    const metas = await repos.credentials.listMetadata(hz.db, businessId, { integrationId: r.integration!.id });
    expect(metas).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("secret_notion_token");
  });

  it("Shopify asks the store named at the start and refuses a code for another store", async () => {
    const { businessId, ownerId } = hz.A;
    const { url } = await start(ownerId, businessId, "shopify", { shop: "Northwind.myshopify.com" });
    expect(url.origin).toBe("https://northwind.myshopify.com");
    const state = url.searchParams.get("state")!;
    const owner = hz.caller({ userId: ownerId });
    await expect(owner.integrations.connect({ businessId, connectorKey: "shopify", input: { code: "abc123", state, shop: "other.myshopify.com" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const r = await owner.integrations.connect({ businessId, connectorKey: "shopify", input: { code: "abc123", state, shop: "northwind.myshopify.com" } });
    expect(r.integration).toMatchObject({ status: "connected", accountLabel: "Northwind (northwind.myshopify.com)" });
  });
});

describe("integrations.health", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "inthealth" });
  }, 120_000);
  afterAll(() => hz.close());

  it("needs settings administration: a viewer cannot run it", async () => {
    const { businessId, ownerId, viewerId } = hz.A;
    const { integration } = await hz.caller({ userId: ownerId }).integrations.connect({ businessId, connectorKey: "stripe", input: {} });
    await expect(hz.caller({ userId: viewerId }).integrations.health({ businessId, integrationId: integration!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const r = await hz.caller({ userId: ownerId }).integrations.health({ businessId, integrationId: integration!.id });
    expect(r.health.ok).toBe(true);
  });

  it("reports a disconnected integration as disconnected, without a check and without touching the row", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    const { integration } = await owner.integrations.connect({ businessId, connectorKey: "sendgrid", input: {} });
    const off = await owner.integrations.disconnect({ businessId, integrationId: integration!.id });
    const r = await owner.integrations.health({ businessId, integrationId: integration!.id });
    expect(r.health).toMatchObject({ ok: false, status: "disconnected" });
    const row = await repos.integrations.get(hz.db, businessId, integration!.id);
    expect(row.status).toBe("disconnected");
    expect(row.lastHealthAt?.getTime() ?? null).toBe(off.lastHealthAt?.getTime() ?? null);
  });
});
