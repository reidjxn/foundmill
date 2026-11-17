/**
 * "Sign in with Stripe" (WP-11, Nov 17, 2026): Stripe Connect OAuth for a founder's own account, beside pasting a
 * restricted key. The sign-in starts on Stripe's page with a state signed for the founder, the project and the connector,
 * the code exchange names the account, one account belongs to one project, a reconnect to another account withdraws the
 * previous one and audits both, and disconnecting withdraws Foundmill's access in Stripe. Only owners and admins connect.
 */
import { createDefaultRegistry, jsonResponse, routedFetch } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STRIPE_ACCOUNT_IN_USE } from "../routers/integrations";
import { verifyConnectState } from "../services/install-state";
import { guardLiveCalls, inProcessGateway } from "./gateway-double";
import { createApiHarness, TEST_SESSION_TOKEN_SECRET, type ApiHarness } from "./harness";

const APP_URL = "https://foundmill.test";
const seen: string[] = [];
let nextAccount = "acct_1FounderA0000001";

describe("integrations.connect: Sign in with Stripe", () => {
  let hz: ApiHarness;
  const gateway = inProcessGateway();
  const guarded = guardLiveCalls(createDefaultRegistry({ secrets: {} }));
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "stripeconnect", env: { LIVE_CONNECTORS: "stripe", APP_URL }, connectors: guarded.registry, gateway: gateway.client });
    const account = (id: string) => jsonResponse({ id, object: "account", business_profile: { name: `Founder ${id.slice(-4)}` }, country: "US", default_currency: "usd", charges_enabled: true, payouts_enabled: true });
    const vendorRegistry = createDefaultRegistry({
      secrets: { stripeSecretKey: "sk_live_billing", stripeConnectSecretKey: "sk_test_connect", stripeConnectClientId: "ca_test_platform" },
      fetch: routedFetch({
        "POST https://connect.stripe.com/oauth/token": () => (seen.push(`token ${nextAccount}`), jsonResponse({ stripe_user_id: nextAccount, access_token: "sk_test_dropped", scope: "read_write", livemode: false })),
        "GET https://api.stripe.com/v1/accounts/acct_1FounderA0000001": () => account("acct_1FounderA0000001"),
        "GET https://api.stripe.com/v1/accounts/acct_1FounderB0000002": () => account("acct_1FounderB0000002"),
        "GET https://api.stripe.com/v1/account": () => account("acct_1PastedKey0000003"),
        "POST https://connect.stripe.com/oauth/deauthorize": async (req) => (seen.push(`deauthorize ${new URLSearchParams(await req.text()).get("stripe_user_id")}`), jsonResponse({ stripe_user_id: "x" })),
      }),
    });
    gateway.bind({ db: hz.db, vault: hz.deps.vault, registry: vendorRegistry, liveConnectors: ["stripe"] });
  }, 120_000);
  afterAll(() => hz.close());
  beforeEach(() => {
    seen.length = 0;
  });
  afterEach(() => expect(guarded.liveCalls).toEqual([]));

  const signIn = async (userId: string, businessId: string, account: string) => {
    const first = await hz.caller({ userId }).integrations.connect({ businessId, connectorKey: "stripe", input: {} });
    const state = new URL(first.consentUrl!).searchParams.get("state")!;
    nextAccount = account;
    return hz.caller({ userId }).integrations.connect({ businessId, connectorKey: "stripe", input: { code: "ac_TestCode123", state } });
  };

  it("starts on Stripe's sign-in page with a state signed for this founder, project and connector, and writes nothing", async () => {
    const { businessId, ownerId } = hz.A;
    const before = await repos.integrations.getByKey(hz.db, businessId, "stripe");
    const r = await hz.caller({ userId: ownerId }).integrations.connect({ businessId, connectorKey: "stripe", input: {} });
    const url = new URL(r.consentUrl!);
    expect(`${url.origin}${url.pathname}`).toBe("https://connect.stripe.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("ca_test_platform");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP_URL}/integrations/oauth/callback`);
    expect(verifyConnectState(TEST_SESSION_TOKEN_SECRET, url.searchParams.get("state")!, { userId: ownerId, businessId, connectorKey: "stripe" })).toEqual({ account: null });
    expect(await repos.integrations.getByKey(hz.db, businessId, "stripe")).toEqual(before);
    expect(seen).toEqual([]);
  });

  it("refuses a code with another founder's, project's or forged state before Stripe is asked", async () => {
    const { businessId, ownerId, adminId } = hz.A;
    const first = await hz.caller({ userId: ownerId }).integrations.connect({ businessId, connectorKey: "stripe", input: {} });
    const state = new URL(first.consentUrl!).searchParams.get("state")!;
    const finish = (userId: string, b: string, s = state) => hz.caller({ userId }).integrations.connect({ businessId: b, connectorKey: "stripe", input: { code: "ac_TestCode123", state: s } });
    await expect(finish(adminId, businessId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(finish(hz.B.ownerId, hz.B.businessId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(finish(ownerId, businessId, `${state.split(".")[0]}.AAAA`)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(seen).toEqual([]);
  });

  it("connects the account Stripe names, keeps no Stripe token, gives one account to one project, and audits a reconnect", async () => {
    const { businessId, ownerId } = hz.A;
    const r = await signIn(ownerId, businessId, "acct_1FounderA0000001");
    expect(r.integration).toMatchObject({ status: "connected", settings: { externalAccountId: "acct_1FounderA0000001", config: { kind: "connect" } } });
    expect(JSON.stringify(r)).not.toContain("sk_test_dropped");
    expect(await repos.credentials.listMetadata(hz.db, businessId, { integrationId: r.integration!.id })).toHaveLength(0);

    // Another project signing in to the same account is refused with the plain sentence, and nothing is withdrawn.
    await expect(signIn(hz.B.ownerId, hz.B.businessId, "acct_1FounderA0000001")).rejects.toMatchObject({ message: STRIPE_ACCOUNT_IN_USE });
    expect(seen.filter((x) => x.startsWith("deauthorize"))).toEqual([]);

    // Signing in to another account withdraws the first one and the audit names both.
    await signIn(ownerId, businessId, "acct_1FounderB0000002");
    expect(seen).toContain("deauthorize acct_1FounderA0000001");
    const audits = JSON.stringify(await repos.audit.list(hz.db, businessId, { limit: 50 }));
    expect(audits).toContain("acct_1FounderA0000001");
    expect(audits).toContain("acct_1FounderB0000002");
    // The first account is free again for the other project.
    await expect(signIn(hz.B.ownerId, hz.B.businessId, "acct_1FounderA0000001")).resolves.toMatchObject({ integration: { status: "connected" } });
  });

  it("a pasted restricted key is the second way in; an account id alone only starts the sign-in", async () => {
    // Project B holds acct_1FounderA0000001 through a sign-in (the test above); a pasted key replaces it.
    const { businessId, ownerId } = hz.B;
    // An account id alone connects nothing: it only starts the sign-in, where Stripe names the account.
    const byId = await hz.caller({ userId: ownerId }).integrations.connect({ businessId, connectorKey: "stripe", input: { accountId: "acct_1FounderB0000002" } });
    expect(byId.consentUrl).toMatch(/^https:\/\/connect\.stripe\.com\/oauth\/authorize/);
    expect(byId.consentUrl).not.toContain("acct_1FounderB0000002");
    expect(seen.filter((x) => x.startsWith("token"))).toEqual([]);
    const r = await hz.caller({ userId: ownerId }).integrations.connect({ businessId, connectorKey: "stripe", input: { apiKey: "rk_test_founder_key" } });
    expect(r.integration).toMatchObject({ status: "connected", settings: { externalAccountId: "acct_1PastedKey0000003", config: { kind: "own" } } });
    expect(r.consentUrl).toBeNull();
    expect(seen).toContain("deauthorize acct_1FounderA0000001");
    expect(await repos.credentials.listMetadata(hz.db, businessId, { integrationId: r.integration!.id })).toHaveLength(1);
    // Signing in over the pasted key revokes it in the same save.
    await signIn(ownerId, businessId, "acct_1FounderA0000001");
    expect(await repos.credentials.listMetadata(hz.db, businessId, { integrationId: r.integration!.id })).toHaveLength(0);
  });

  it("disconnecting a sign-in withdraws Foundmill's access in Stripe first and audits it; collaborators cannot", async () => {
    const { businessId, ownerId } = hz.A;
    const row = (await repos.integrations.getByKey(hz.db, businessId, "stripe"))!;
    await expect(hz.caller({ userId: hz.A.memberId }).integrations.disconnect({ businessId, integrationId: row.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.A.memberId }).integrations.connect({ businessId, connectorKey: "stripe", input: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(seen).toEqual([]);
    await hz.caller({ userId: ownerId }).integrations.disconnect({ businessId, integrationId: row.id });
    expect(seen).toEqual(["deauthorize acct_1FounderB0000002"]);
    expect((await repos.integrations.get(hz.db, businessId, row.id)).status).toBe("disconnected");
    expect(JSON.stringify(await repos.audit.list(hz.db, businessId, { limit: 20 }))).toContain("vendorAccessReleased");
  });
});
