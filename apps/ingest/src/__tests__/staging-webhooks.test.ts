/**
 * Forged webhooks on a public ingest (audit SIEC-1 / SECX-1 / GPC-06): staging runs INTEGRATIONS_MODE=mock on a public
 * URL, and the mock verifiers check signatures against secrets committed to the repository. Outside development and
 * test, mock webhooks are not mounted at all (404, nothing written); a connector in LIVE_CONNECTORS is verified by its
 * live webhook with the real secret, and only for a business that connected it. Simulate keeps working behind its
 * service token.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { createDefaultRegistry, MOCK_NOW, sendgridInboundParseRequest, signedGithubDeliveryRequest, signedShopifyRequest, signedStripeRequest } from "@foundmill/connectors";
import { mergedPullRequestPayload } from "@foundmill/connectors/connectors/github/mock";
import { SH_ORDERS } from "@foundmill/connectors/connectors/shopify/fixtures/shop";
import { ST_INVOICES } from "@foundmill/connectors/connectors/stripe/fixtures/stripe";
import { stripeEvent } from "@foundmill/connectors/connectors/stripe/mock";
import type { BuiltIngest } from "../index";
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

    await repos.integrations.upsert(hz.db, hz.B.businessId, { connectorKey: "github", status: "connected", authKind: "app" });
    const accepted = await send(staging, delivery("real-2"));
    expect(accepted.status).toBe(200);
    expect(await json(accepted)).toMatchObject({ ok: true, connector: "github", written: 1 });
    expect(await hz.events(hz.B.businessId, "pr.merged")).toHaveLength(1);
  });
});

describe("Simulate in staging", () => {
  it("still fabricates a payment behind the service token", async () => {
    const res = await staging.app.request("/simulate/payment.received", { method: "POST", headers: { authorization: `Bearer ${simulateToken(hz.A.businessId)}`, "content-type": "application/json" }, body: JSON.stringify({ businessId: hz.A.businessId, seed: "staging-sim" }) });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, written: 1, label: "Simulated" });
  });
});
