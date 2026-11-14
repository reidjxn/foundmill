/**
 * API-key connectors connect live with the founder's own key (audit MLSL-24): Settings › Integrations renders their
 * `connectFields`, and `connect()` uses exactly the key it was given. It never falls back to the platform's key, which
 * would mark the integration Connected on the platform's account (and, for Cloudflare, list the platform's zones).
 */
import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../catalogue";
import { ConnectInputError, type Connector } from "../contract";
import { jsonResponse, routedFetch } from "../http";
import { createCloudflareDnsConnector } from "../connectors/cloudflare_dns";
import { createDropboxSignConnector } from "../connectors/dropbox_sign";
import { createSendgridConnector } from "../connectors/sendgrid";
import { createStripeConnector } from "../connectors/stripe";
import { TEST_BUSINESS_ID } from "../testing/contract-suite";

const PLATFORM = { sendgridApiKey: "SG.platform", dropboxSignApiKey: "platform-dbx", cloudflareApiToken: "platform-cf", stripeSecretKey: "sk_live_platform" };

describe("connect fields for API-key connectors", () => {
  it("the catalogue lists each live connector's fields, also in mock mode (for LIVE_CONNECTORS)", () => {
    const registry = createDefaultRegistry({ secrets: {} });
    for (const mode of ["mock", "live"] as const) {
      const fields = Object.fromEntries(registry.catalogue(mode).map((c) => [c.key, c.connectFields.map((f) => `${f.name}${f.secret ? "*" : ""}${f.required ? "!" : ""}`)]));
      expect(fields).toMatchObject({ sendgrid: ["apiKey*!"], dropbox_sign: ["apiKey*!"], cloudflare_dns: ["apiToken*!"], stripe: ["apiKey*!"], gmail: [], github: [] });
    }
  });

  it("the connectors that run on the founder's own key declare it, and none may use a platform key (founder, 2026-11-12)", () => {
    const registry = createDefaultRegistry({ secrets: {} });
    const own = ["openai", "gemini", "perplexity", "serpapi", "firecrawl", "indexnow", "apollo", "vercel", "posthog", "resend", "runway", "elevenlabs_voice"];
    for (const mode of ["mock", "live"] as const) {
      const byKey = new Map(registry.catalogue(mode).map((c) => [c.key, c]));
      for (const key of own) {
        const entry = byKey.get(key)!;
        expect(entry.auth, key).toEqual({ kind: "api_key" });
        expect(entry.connectFields.some((f) => f.required), key).toBe(true);
        expect(entry.rateLimits.perMinute, key).toBeGreaterThan(0);
        expect(entry.rateLimits.perDay, key).toBeGreaterThan(0);
      }
      expect(byKey.get("indexnow")!.connectFields.map((f) => `${f.name}${f.required ? "!" : ""}`)).toEqual(["host", "key!", "keyLocation"]);
      const fieldsOf = (key: string) => byKey.get(key)!.connectFields.map((f) => `${f.name}${f.secret ? "*" : ""}${f.required ? "!" : ""}`);
      expect(fieldsOf("apollo")).toEqual(["apiKey*!"]);
      expect(fieldsOf("vercel")).toEqual(["apiToken*!", "teamId"]);
      expect(fieldsOf("posthog")).toEqual(["apiKey*!", "projectId!", "region!"]);
      expect(fieldsOf("resend")).toEqual(["apiKey*!"]);
      expect(fieldsOf("runway")).toEqual(["apiKey*!"]);
      expect(fieldsOf("elevenlabs_voice")).toEqual(["apiKey*!", "voiceId"]);
      for (const key of ["openai", "gemini", "perplexity", "serpapi", "firecrawl"]) expect(byKey.get(key)!.connectFields.map((f) => `${f.name}${f.secret ? "*" : ""}${f.required ? "!" : ""}`), key).toEqual(["apiKey*!"]);
    }
  });

  const cases: { name: string; field: string; build: (seen: string[]) => Connector }[] = [
    {
      name: "sendgrid",
      field: "apiKey",
      build: (seen) => createSendgridConnector({ secrets: PLATFORM, fetch: routedFetch({ "GET https://api.sendgrid.com/v3/verified_senders": (req) => (seen.push(req.headers.get("authorization") ?? ""), jsonResponse({ results: [{ id: 1, from_email: "hello@northwind.example", verified: true }] })) }) }),
    },
    {
      name: "dropbox_sign",
      field: "apiKey",
      build: (seen) => createDropboxSignConnector({ secrets: PLATFORM, fetch: routedFetch({ "GET https://api.hellosign.com/v3/account": (req) => (seen.push(req.headers.get("authorization") ?? ""), jsonResponse({ account: { account_id: "acc1", email_address: "reid@northwind.example" } })) }) }),
    },
    {
      name: "cloudflare_dns",
      field: "apiToken",
      build: (seen) => createCloudflareDnsConnector({ secrets: PLATFORM, fetch: routedFetch({ "GET https://api.cloudflare.com/client/v4/zones": (req) => (seen.push(req.headers.get("authorization") ?? ""), jsonResponse({ success: true, errors: [], result: [{ id: "z1", name: "northwind.example", status: "active", name_servers: [] }] })) }) }),
    },
    {
      name: "stripe",
      field: "apiKey",
      build: (seen) => createStripeConnector({ secrets: PLATFORM, fetch: routedFetch({ "GET https://api.stripe.com/v1/account": (req) => (seen.push(req.headers.get("authorization") ?? ""), jsonResponse({ id: "acct_founder", object: "account", business_profile: { name: "Northwind" }, charges_enabled: true, payouts_enabled: true })) }) }),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: connects with the founder's key and never with the platform's`, async () => {
      const seen: string[] = [];
      const connector = c.build(seen);
      await expect(connector.connect(TEST_BUSINESS_ID, {})).rejects.toBeInstanceOf(ConnectInputError);
      await expect(connector.connect(TEST_BUSINESS_ID, { [c.field]: "   " })).rejects.toMatchObject({ code: "connect_input_required", status: 400 });
      expect(seen).toEqual([]);
      const record = await connector.connect(TEST_BUSINESS_ID, { [c.field]: "founder-own-key" });
      expect(seen.length).toBeGreaterThan(0);
      for (const auth of seen) {
        expect(auth).toContain(c.name === "dropbox_sign" ? Buffer.from("founder-own-key:").toString("base64") : "founder-own-key");
        expect(auth).not.toMatch(/platform/);
      }
      expect(record.credentialToStore).toEqual({ kind: "api_key", secret: "founder-own-key" });
      expect(JSON.stringify({ ...record, credentialToStore: undefined })).not.toContain("founder-own-key");
    });
  }
});
