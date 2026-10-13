/**
 * OAuth connectors start with the founder's consent (GPC-12): connect() without a code answers the vendor's consent page
 * built from the platform client id, the redirect URI and the state the api signed, and stores nothing; with the code
 * the vendor sent back it exchanges it with the same redirect URI.
 */
import { describe, expect, it } from "vitest";
import { MOCK_NOW } from "../mock-utils";
import { jsonResponse, routedFetch } from "../http";
import { createGmailConnector } from "../connectors/gmail";
import { createGoogleCalendarConnector } from "../connectors/google_calendar";
import { createGoogleDriveConnector } from "../connectors/google_drive";
import { createNotionConnector } from "../connectors/notion";
import { createShopifyConnector } from "../connectors/shopify";
import { TEST_BUSINESS_ID } from "../testing/contract-suite";

const STATE = "eyJiIjoiYiIsImMiOiJnbWFpbCJ9.c2lnbmF0dXJl";
const REDIRECT = "https://foundmill.com/integrations/oauth/callback";
const noFetch = async (): Promise<Response> => {
  throw new Error("the first step never calls the vendor");
};

describe("OAuth consent: the first step", () => {
  it("Google connectors answer Google's consent page with offline access for their own scopes", async () => {
    for (const create of [createGmailConnector, createGoogleCalendarConnector, createGoogleDriveConnector]) {
      const c = create({ secrets: { googleClientId: "google-client", googleClientSecret: "s" }, fetch: noFetch, now: () => MOCK_NOW });
      const record = await c.connect(TEST_BUSINESS_ID, { state: STATE, redirectUri: REDIRECT });
      expect(record).toMatchObject({ businessId: TEST_BUSINESS_ID, connectorKey: c.key, status: "disconnected", credentialRef: null });
      expect(record.credentialToStore).toBeUndefined();
      const url = new URL(String(record.config.authorizeUrl));
      expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "google-client", redirect_uri: REDIRECT, response_type: "code", access_type: "offline", prompt: "consent", state: STATE });
      for (const scope of c.auth.scopes ?? []) expect(url.searchParams.get("scope")).toContain(scope);
    }
  });

  it("Notion answers its consent page", async () => {
    const c = createNotionConnector({ secrets: { notionClientId: "notion-client", notionClientSecret: "s" }, fetch: noFetch, now: () => MOCK_NOW });
    const url = new URL(String((await c.connect(TEST_BUSINESS_ID, { state: STATE, redirectUri: REDIRECT })).config.authorizeUrl));
    expect(url.origin + url.pathname).toBe("https://api.notion.com/v1/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "notion-client", response_type: "code", owner: "user", redirect_uri: REDIRECT, state: STATE });
  });

  it("Shopify answers the store's own consent page for the platform app", async () => {
    const c = createShopifyConnector({ secrets: { shopifyClientId: "shopify-client", shopifyClientSecret: "s" }, fetch: noFetch, now: () => MOCK_NOW });
    const url = new URL(String((await c.connect(TEST_BUSINESS_ID, { shop: "northwind.myshopify.com", state: STATE, redirectUri: REDIRECT })).config.authorizeUrl));
    expect(url.origin + url.pathname).toBe("https://northwind.myshopify.com/admin/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "shopify-client", redirect_uri: REDIRECT, state: STATE });
    await expect(c.connect(TEST_BUSINESS_ID, { state: STATE, redirectUri: REDIRECT })).rejects.toMatchObject({ status: 400 });
  });

  it("needs the api's signed state and an https callback, and the platform client id", async () => {
    const google = createGmailConnector({ secrets: { googleClientId: "google-client" }, fetch: noFetch });
    await expect(google.connect(TEST_BUSINESS_ID, {})).rejects.toMatchObject({ status: 400 });
    await expect(google.connect(TEST_BUSINESS_ID, { state: STATE, redirectUri: "http://evil.example/cb" })).rejects.toMatchObject({ status: 400 });
    const unconfigured = createNotionConnector({ secrets: {}, fetch: noFetch });
    await expect(unconfigured.connect(TEST_BUSINESS_ID, { state: STATE, redirectUri: REDIRECT })).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe("OAuth consent: the second step", () => {
  it("Google exchanges the code with the same redirect URI and stores the token", async () => {
    let form: URLSearchParams | null = null;
    const c = createGmailConnector({
      secrets: { googleClientId: "google-client", googleClientSecret: "google-secret" },
      now: () => MOCK_NOW,
      fetch: routedFetch({
        "POST https://oauth2.googleapis.com/token": async (req) => ((form = new URLSearchParams(await req.text())), jsonResponse({ access_token: "ya29.token", refresh_token: "1//refresh", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.modify" })),
        "GET https://openidconnect.googleapis.com/v1/userinfo": () => jsonResponse({ email: "founder@northwind.example", sub: "123" }),
      }),
    });
    const record = await c.connect(TEST_BUSINESS_ID, { code: "4/auth-code", redirectUri: REDIRECT });
    expect(form!.get("redirect_uri")).toBe(REDIRECT);
    expect(form!.get("code")).toBe("4/auth-code");
    expect(record).toMatchObject({ status: "connected", accountLabel: "founder@northwind.example", config: { email: "founder@northwind.example" }, credentialToStore: { kind: "oauth", secret: "ya29.token", refreshToken: "1//refresh" } });
  });
});
