/**
 * Live mode against the integration rows the api writes (apps/api `integrations.connect`):
 * - platform-key connectors (registries, Voyage, E2B, Anthropic on credits, Stripe Connect) store no credential when
 *   connected and must still run on the platform's key (GPC-10);
 * - the connector's own configuration sits under `settings.config`, and the gateway must hand exactly that to the
 *   connector as `IntegrationRecord.config`, so Stripe Connect keeps its Stripe-Account header (GPC-11).
 */
import { describe, expect, it } from "vitest";
import { createStripeConnector, jsonResponse, routedFetch, type ToolContext } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { connectorConfigOf, storeCredential, toIntegrationRecord } from "../credentials";
import { platformKeyConnected } from "../pipeline";
import type { AllowResponse, CallResponse } from "../types";
import { setupGateway, silentLog, TEST_CONNECTOR } from "./harness";

const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome).toBe("allow");
  return r as AllowResponse;
};

describe("live mode: platform-key connectors", () => {
  it("run on the platform's key once connected, with no stored credential, and stop when disconnected", async () => {
    const live = await setupGateway({ mode: "live", connector: { platformKey: true } });
    try {
      const token = await live.token();
      const call = () => live.client.call(token, { connector: "test", tool: "note", args: {} });
      // The api's connect() for these connectors writes a connected row and no credential.
      const r = asAllow(await call());
      expect(r.result.ok).toBe(true);
      expect(live.seen.at(-1)).toMatchObject({ mode: "live", credentialSecret: null, integrationStatus: "connected" });
      // A business that stored its own key still uses it.
      await storeCredential(live.db, live.vault, live.businessId, live.integrationId, { kind: "api_key", secret: "own-key-123456" });
      asAllow(await call());
      expect(live.seen.at(-1)).toMatchObject({ credentialSecret: "own-key-123456" });
      // Disconnecting stops the platform key as well.
      await repos.integrations.disconnect(live.db, live.businessId, live.integrationId);
      await expect(call()).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
    } finally {
      await live.close();
    }
  });

  it("is refused without a connected integration row", async () => {
    const live = await setupGateway({ mode: "live", connector: { platformKey: true } });
    try {
      await repos.integrations.archive(live.db, live.businessId, live.integrationId);
      await expect(live.client.call(await live.token(), { connector: "test", tool: "note", args: {} })).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
    } finally {
      await live.close();
    }
  });

  it("a founder-keyed connector still needs the business's own credential", async () => {
    const live = await setupGateway({ mode: "live" });
    try {
      await expect(live.client.call(await live.token(), { connector: "test", tool: "note", args: {} })).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
    } finally {
      await live.close();
    }
  });

  it("counts only connected or degraded rows that are not archived", () => {
    expect(platformKeyConnected({ status: "connected", archivedAt: null })).toBe(true);
    expect(platformKeyConnected({ status: "degraded", archivedAt: null })).toBe(true);
    for (const status of ["disconnected", "expired", "mock"] as const) expect(platformKeyConnected({ status, archivedAt: null })).toBe(false);
    expect(platformKeyConnected({ status: "connected", archivedAt: new Date() })).toBe(false);
  });
});

describe("live mode: the connector's config is settings.config", () => {
  it("hands the connector the config the api stored, not the whole settings object", async () => {
    const live = await setupGateway({ mode: "live", connector: { platformKey: true } });
    try {
      // The shape apps/api integrations.connect writes.
      await repos.integrations.upsert(live.db, live.businessId, { connectorKey: TEST_CONNECTOR, status: "connected", authKind: "api_key", settings: { externalAccountId: "acct_business123", config: { kind: "connect", country: "SE" }, expiresAt: null } });
      asAllow(await live.client.call(await live.token(), { connector: "test", tool: "note", args: {} }));
      expect(live.seen.at(-1)?.integrationConfig).toEqual({ kind: "connect", country: "SE" });
    } finally {
      await live.close();
    }
  });

  it("Stripe Connect sends Stripe-Account for the business's connected account", async () => {
    const live = await setupGateway({ mode: "live" });
    try {
      const row = await repos.integrations.upsert(live.db, live.businessId, { connectorKey: "stripe", status: "connected", authKind: "oauth", settings: { externalAccountId: "acct_business123", config: { kind: "connect", country: "SE", defaultCurrency: "SEK" }, expiresAt: null } });
      const integration = toIntegrationRecord(row, null);
      expect(integration).toMatchObject({ externalAccountId: "acct_business123", config: { kind: "connect" } });
      let account: string | null = null;
      const stripe = createStripeConnector({
        secrets: { stripeSecretKey: "sk_test_platform" },
        fetch: routedFetch({ "GET https://api.stripe.com/v1/customers": (req) => ((account = req.headers.get("stripe-account")), jsonResponse({ object: "list", data: [], has_more: false })) }),
      });
      const ctx: ToolContext = { businessId: live.businessId, agentId: live.agentId, sessionId: live.sessionId, integration, log: silentLog, mode: "live" };
      const r = await stripe.callTool("list_customers", {}, ctx);
      expect(r.ok, JSON.stringify(r.error)).toBe(true);
      expect(account).toBe("acct_business123");
    } finally {
      await live.close();
    }
  });

  it("keeps a flat settings object from before the nested shape", () => {
    expect(connectorConfigOf({ shop: "x.myshopify.com" })).toEqual({ shop: "x.myshopify.com" });
    expect(connectorConfigOf({ externalAccountId: "1", config: { installationId: 1 } })).toEqual({ installationId: 1 });
    expect(connectorConfigOf(null)).toEqual({});
  });
});
