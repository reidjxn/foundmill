/**
 * Forged webhooks on a public ingest (audit SIEC-1 / SECX-1 / GPC-06): staging runs INTEGRATIONS_MODE=mock on a public
 * URL, and the mock verifiers check signatures against secrets committed to the repository. Outside development and
 * test, mock webhooks are not mounted at all (404, nothing written); a connector in LIVE_CONNECTORS is verified by its
 * live webhook with the real secret, and only for a business that connected it. Simulate keeps working behind its
 * service token.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { buildAad, encryptJson, generateMasterKey, LocalVault } from "@foundmill/shared/crypto";
import { createDefaultRegistry, MOCK_NOW, sendgridInboundParseRequest, signedGithubDeliveryRequest, signedShopifyRequest, signedStripeRequest, stripeSignatureHeader } from "@foundmill/connectors";
import { MOCK_INSTALLATION_ID } from "@foundmill/connectors/connectors/github/fixtures/repos";
import { mergedPullRequestPayload } from "@foundmill/connectors/connectors/github/mock";
import { SH_ORDERS } from "@foundmill/connectors/connectors/shopify/fixtures/shop";
import { ST_INVOICES } from "@foundmill/connectors/connectors/stripe/fixtures/stripe";
import { stripeEvent } from "@foundmill/connectors/connectors/stripe/mock";
import { accountBusinessResolver, type BuiltIngest } from "../index";
import { createBusinessSecretResolver } from "../secrets";
import { accountMismatch, STRIPE_ACCESS_REMOVED } from "../webhooks";
import { silentLogger } from "../types";
import { createIngestHarness, json, simulateToken, type IngestHarness } from "./harness";

const GITHUB_SECRET = "gh-real-webhook-secret-from-env";

let hz: IngestHarness;
let staging: BuiltIngest;
let production: BuiltIngest;
beforeAll(async () => {
  hz = await createIngestHarness("staging");
  const registry = createDefaultRegistry({ now: () => MOCK_NOW, secrets: { githubWebhookSecret: GITHUB_SECRET } });
  staging = hz.build({ env: { APP_ENV: "staging", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "github", MODEL_MODE: "mock" } as BuiltIngest["env"], registry });
  production = hz.build({ env: { APP_ENV: "production", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "", MODEL_MODE: "mock" } as BuiltIngest["env"], registry, simulateEnabled: false });
}, 120_000);
afterAll(async () => {
  await hz.close();
});

const send = (built: BuiltIngest, req: Request) => built.app.fetch(req);
const written = async (businessId: string) => (await hz.events(businessId)).length;

describe("mock webhooks outside development and test", () => {
  it("refuses a Shopify order signed with the committed mock secret: 404 and nothing written", async () => {
    const before = await written(hz.A.businessId);
    for (const built of [staging, production]) {
      const res = await send(built, signedShopifyRequest(hz.A.businessId, "orders/paid", SH_ORDERS[0], { webhookId: `forged-${built.env.APP_ENV}` }));
      expect(res.status).toBe(404);
      expect(await json(res)).toMatchObject({ ok: false, error: "unknown_connector", connector: "shopify" });
    }
    expect(await written(hz.A.businessId)).toBe(before);
  });

  it("refuses Stripe, SendGrid Inbound Parse and a mock-signed GitHub delivery the same way", async () => {
    const before = await written(hz.A.businessId);
    expect((await send(staging, signedStripeRequest(hz.A.businessId, stripeEvent("invoice.paid", ST_INVOICES[0]!, "evt_forged")))).status).toBe(404);
    expect((await send(staging, sendgridInboundParseRequest(hz.A.businessId, { from: "lead@example.com", subject: "Re: hello", text: "Yes, let's talk" }))).status).toBe(404);
    // GitHub runs live here (LIVE_CONNECTORS): a delivery signed with the committed mock secret fails the real one.
    const forgedPr = await send(staging, signedGithubDeliveryRequest(hz.A.businessId, "pull_request", mergedPullRequestPayload(), { deliveryId: "forged-gh" }));
    expect(forgedPr.status).toBe(401);
    expect(await written(hz.A.businessId)).toBe(before);
  });

  it("/health says which webhooks are mounted and which mock webhooks are refused", async () => {
    const res = await staging.app.request("/health");
    const body = await json<{ env: string; webhooks: { connector: string; mode: string }[]; refusedMockWebhooks: string[] }>(res);
    expect(body.env).toBe("staging");
    expect(body.webhooks).toEqual([{ connector: "github", path: "/webhooks/github/:businessId", mode: "live" }]);
    expect(body.refusedMockWebhooks.sort()).toEqual(["dropbox_sign", "sendgrid", "shopify", "stripe"]);
  });
});

describe("live webhooks in staging", () => {
  it("accepts a really signed delivery only for a business that connected the connector", async () => {
    const delivery = (id: string) => signedGithubDeliveryRequest(hz.B.businessId, "pull_request", mergedPullRequestPayload(), { secret: GITHUB_SECRET, deliveryId: id });
    const refused = await send(staging, delivery("real-1"));
    expect(refused.status).toBe(404);
    expect(await json(refused)).toMatchObject({ error: "not_connected", connector: "github" });
    expect(await hz.events(hz.B.businessId, "pr.merged")).toHaveLength(0);

    // Connected, but to another installation than the delivery names: the App's secret is shared by every business,
    // so a signature alone does not say whose delivery this is (SECURITY_REVIEW SEC-10).
    await repos.integrations.upsert(hz.db, hz.B.businessId, { connectorKey: "github", status: "connected", authKind: "app", settings: { externalAccountId: "999001", config: {} } });
    await repos.integrations.recordVerifiedInstallation(hz.db, hz.B.businessId, { connectorKey: "github", installationId: "999001", accountLabel: "someone-else", verifiedBy: "founder-login", verifiedAt: new Date() });
    const foreign = await send(staging, delivery("real-2"));
    expect(foreign.status).toBe(422);
    expect(await json(foreign)).toMatchObject({ error: "business_mismatch", connector: "github" });
    expect(await hz.events(hz.B.businessId, "pr.merged")).toHaveLength(0);

    // The installation the gateway verified for this business is the one the delivery names: accepted, and the same
    // delivery id that was refused above can be retried (its nonce was released).
    await repos.integrations.recordVerifiedInstallation(hz.db, hz.B.businessId, { connectorKey: "github", installationId: String(MOCK_INSTALLATION_ID), accountLabel: "acme", verifiedBy: "founder-login", verifiedAt: new Date() });
    const accepted = await send(staging, delivery("real-2"));
    expect(accepted.status).toBe(200);
    expect(await json(accepted)).toMatchObject({ ok: true, connector: "github", written: 1 });
    expect(await hz.events(hz.B.businessId, "pr.merged")).toHaveLength(1);
  });
});

describe("a delivery belongs to the account the business connected (accountMismatch)", () => {
  const row = async (businessId: string, connectorKey: string, settings: Record<string, unknown>) => (await repos.integrations.upsert(hz.db, businessId, { connectorKey, status: "connected", authKind: "oauth", settings }), (await repos.integrations.getByKey(hz.db, businessId, connectorKey))!);

  it("Shopify: only the shop the business connected, whatever the letter case; no shop named is refused", async () => {
    const shop = await row(hz.A.businessId, "shopify", { externalAccountId: "Northwind-Skincare.myshopify.com", config: {} });
    expect(await accountMismatch(hz, shop, "shopify", "northwind-skincare.myshopify.com")).toBeNull();
    expect(await accountMismatch(hz, shop, "shopify", "another-shop.myshopify.com")).toMatch(/another account/);
    expect(await accountMismatch(hz, shop, "shopify", null)).toMatch(/another account/);
  });

  it("Stripe through the platform: only the connected account", async () => {
    const connect = await row(hz.A.businessId, "stripe", { externalAccountId: "acct_A", config: { kind: "connect" } });
    expect(await accountMismatch(hz, connect, "stripe", "acct_A")).toBeNull();
    expect(await accountMismatch(hz, connect, "stripe", "acct_B")).toMatch(/another account/);
    expect(await accountMismatch(hz, connect, "stripe", null)).toMatch(/another account/); // a platform event names no account: not this business's
  });

  it("Stripe on the founder's own key: refused without the business's own endpoint secret, and for another account", async () => {
    const own = await row(hz.B.businessId, "stripe", { externalAccountId: "acct_B", config: { kind: "own" } });
    expect(await accountMismatch(hz, own, "stripe", "acct_A")).toMatch(/another Stripe account/);
    // No endpoint secret stored for this business: the delivery can only have passed on the platform's secret.
    expect(await accountMismatch(hz, own, "stripe", null)).toMatch(/no endpoint secret of its own/);
  });
});

describe("a founder's own Stripe account in staging (WP-11 T20)", () => {
  const HOOK = "whsec_founder_own_endpoint_secret_0123456789";
  it("writes a payment signed with the project's stored endpoint secret, for that project only", async () => {
    const vault = new LocalVault(generateMasterKey());
    // The registry with ingest's own per-project secret resolver (apps/ingest secrets.ts) over this vault.
    const registry = createDefaultRegistry({ now: () => MOCK_NOW, secrets: {}, getBusinessSecret: createBusinessSecretResolver(hz.db, vault) });
    const live = hz.build({ env: { APP_ENV: "staging", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "stripe", MODEL_MODE: "mock" } as BuiltIngest["env"], registry, vault });
    // What the gateway's connect stores (apps/gateway integrations.ts): the integration, then the secret sealed under the
    // AAD bound to its own credential row.
    const integration = await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "stripe", status: "connected", authKind: "api_key", settings: { externalAccountId: "acct_own_A", config: { kind: "own" } } });
    const meta = await repos.credentials.store(hz.db, hz.A.businessId, { integrationId: integration.id, kind: "stripe_webhook_secret", record: await encryptJson(vault, { secret: HOOK }, buildAad(hz.A.businessId, "credentials", "provisional")), expiresAt: null });
    await repos.credentials.rotate(hz.db, hz.A.businessId, meta.id, await encryptJson(vault, { secret: HOOK }, buildAad(hz.A.businessId, "credentials", meta.id)));

    const before = (await hz.events(hz.A.businessId, "payment.received")).length;
    // An event from the founder's own endpoint names no `account` (only a Connect event does).
    const event = (id: string) => ({ ...stripeEvent("invoice.paid", { ...ST_INVOICES[1]! }, id), account: undefined });
    const forged = await send(live, signedStripeRequest(hz.A.businessId, event("evt_own_forged"), { secret: "whsec_someone_else_entirely_0000" }));
    expect(forged.status).toBe(401);
    const accepted = await send(live, signedStripeRequest(hz.A.businessId, event("evt_own_1"), { secret: HOOK }));
    expect(accepted.status).toBe(200);
    expect((await hz.events(hz.A.businessId, "payment.received")).length).toBe(before + 1);
    // The same delivery sent to another project's address is not that project's.
    const elsewhere = await send(live, signedStripeRequest(hz.B.businessId, event("evt_own_2"), { secret: HOOK }));
    expect(elsewhere.status).toBeGreaterThanOrEqual(400);
    expect(await hz.events(hz.B.businessId, "payment.received")).toHaveLength(0);
  });
});

describe("Sign in with Stripe: the platform endpoint in staging (WP-11, Nov 17, 2026)", () => {
  const PLATFORM = "whsec_platform_connect_endpoint_secret_0123";
  const ACCOUNT = "acct_1SignedIn0000001";
  /** A delivery to the platform endpoint (no project in the address), as Stripe signs it for a connected account. */
  const platformDelivery = (event: Record<string, unknown>, secret = PLATFORM) => {
    const body = JSON.stringify({ created: Math.floor(MOCK_NOW.getTime() / 1000), livemode: false, ...event });
    return new Request("https://ingest.example/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": stripeSignatureHeader(secret, body, Math.floor(MOCK_NOW.getTime() / 1000)) }, body });
  };

  it("routes a signed-in account's payment to its one project, writes nothing for an account no project signed in with, and marks the connection expired when the founder removes access in Stripe", async () => {
    const registry = createDefaultRegistry({ now: () => MOCK_NOW, secrets: { stripeWebhookSecret: PLATFORM }, resolveBusinessId: accountBusinessResolver(hz.db, silentLogger) });
    const live = hz.build({ env: { APP_ENV: "staging", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "stripe", MODEL_MODE: "mock" } as BuiltIngest["env"], registry });
    const integration = await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "stripe", status: "connected", authKind: "oauth", settings: { externalAccountId: ACCOUNT, config: { kind: "connect" } } });
    const before = (await hz.events(hz.A.businessId, "payment.received")).length;

    const paid = await send(live, platformDelivery({ ...stripeEvent("invoice.paid", { ...ST_INVOICES[2]! }, "evt_connect_1"), account: ACCOUNT }));
    expect(paid.status).toBe(200);
    expect((await hz.events(hz.A.businessId, "payment.received")).length).toBe(before + 1);

    const stranger = await send(live, platformDelivery({ ...stripeEvent("invoice.paid", { ...ST_INVOICES[2]! }, "evt_connect_2"), account: "acct_1NobodySigned0002" }));
    // Acknowledged so Stripe stops retrying, and written nowhere.
    expect(stranger.status).toBe(200);
    expect(await json(stranger)).toMatchObject({ accepted: 0, written: 0 });
    expect((await hz.events(hz.A.businessId, "payment.received")).length).toBe(before + 1);
    expect(await hz.events(hz.B.businessId, "payment.received")).toHaveLength(0);
    const forged = await send(live, platformDelivery({ ...stripeEvent("invoice.paid", { ...ST_INVOICES[2]! }, "evt_connect_3"), account: ACCOUNT }, "whsec_not_the_platform_secret_00000"));
    expect(forged.status).toBe(401);

    // Another account's withdrawal changes nothing here; this account's marks the connection expired.
    const other = await send(live, platformDelivery({ ...stripeEvent("account.application.deauthorized", { id: "ca_test", object: "application" }, "evt_connect_4"), account: "acct_1NobodySigned0002" }));
    expect(other.status).toBe(200);
    expect((await repos.integrations.get(hz.db, hz.A.businessId, integration.id)).status).toBe("connected");
    const removed = await send(live, platformDelivery({ ...stripeEvent("account.application.deauthorized", { id: "ca_test", object: "application" }, "evt_connect_5"), account: ACCOUNT }));
    expect(removed.status).toBe(200);
    const after = await repos.integrations.get(hz.db, hz.A.businessId, integration.id);
    expect(after.status).toBe("expired");
    expect(after.lastError).toBe(STRIPE_ACCESS_REMOVED);
  });
});

describe("Simulate in staging", () => {
  it("is refused even behind the service token: production runs APP_ENV=staging (Nov 17, 2026)", async () => {
    const res = await staging.app.request("/simulate/payment.received", { method: "POST", headers: { authorization: `Bearer ${simulateToken(hz.A.businessId)}`, "content-type": "application/json" }, body: JSON.stringify({ businessId: hz.A.businessId, seed: "staging-sim" }) });
    expect(res.status).toBe(404);
  });
});
