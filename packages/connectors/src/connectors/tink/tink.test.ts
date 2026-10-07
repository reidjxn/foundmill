import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { MOCK_NOW } from "../../mock-utils";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { createTinkConnector } from "./index";
import { createTinkMock, tinkMock, tinkMockOptions } from "./mock";
import { tinkAmountMinor } from "./tools";

type Sync = { accounts: { booked: { amountMinor: number } }[]; newTransactions: unknown[]; cursor: string; consentExpiresAt: string | null };

describeConnectorContract("tink (mock)", {
  connector: tinkMock,
  mode: "mock",
  calls: [
    { tool: "list_accounts", args: {}, check: (r) => expect((r.data as { items: { type: string; iban: string | null }[] }).items.map((a) => a.type)).toEqual(["checking", "savings"]) },
    { tool: "list_transactions", args: { pageSize: 10 }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[]; nextPageToken: string | null })).toMatchObject({ nextPageToken: "10" }) },
    { tool: "list_transactions", args: { accountId: "nope" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
    { tool: "sync", args: {}, check: (r) => expect(isUntrusted(r.data) && (r.data.content as Sync).newTransactions.length).toBeGreaterThan(5) },
    { tool: "get_consent_status", args: {}, check: (r) => expect(r.data).toMatchObject({ status: "active", daysRemaining: 62, institution: "SEB" }) },
  ],
});

describe("tink mock: 24 months of realistic history", () => {
  it("generates two years of transactions with payroll, rent, VAT and payouts, deterministically per business", async () => {
    const history = tinkMockOptions(TEST_BUSINESS_ID).history;
    const months = new Set(history.transactions.map((t) => t.bookedDate.slice(0, 7)));
    expect(months.size).toBe(24);
    expect(history.transactions.length).toBeGreaterThan(400);
    for (const category of ["revenue", "payroll", "rent", "tax", "software", "funding"]) expect(history.transactions.some((t) => t.category === category)).toBe(true);
    expect(tinkMockOptions(TEST_BUSINESS_ID).history).toEqual(history);
    expect(tinkMockOptions("another-business").history.transactions[0]!.id).not.toBe(history.transactions[0]!.id);
  });
  it("sync is incremental from a date cursor and reports consent expiry", async () => {
    const mock = createTinkMock(TEST_BUSINESS_ID);
    const ctx = makeToolContext(mock);
    const first = await mock.callTool("sync", {}, ctx);
    const data = isUntrusted(first.data) ? (first.data.content as Sync) : null;
    expect(data?.cursor).toBe("2026-10-05");
    expect(data?.consentExpiresAt).toBe("2026-12-06T09:00:00.000Z");
    const second = await mock.callTool("sync", { cursor: data!.cursor }, ctx);
    expect(isUntrusted(second.data) && (second.data.content as Sync).newTransactions).toHaveLength(0);
    expect(mock.policyHints).not.toHaveProperty("initiate_payment");
    expect(Object.values(mock.policyHints).some((h) => h.spendsMoney)).toBe(false);
  });
  it("start_consent is a hard gate pointing at Tink Link; simulations are deterministic", async () => {
    const r = await tinkMock.callTool("start_consent", {}, makeToolContext(tinkMock));
    expect(r.error?.code).toBe("hard_gate");
    expect(r.data).toMatchObject({ url: expect.stringContaining("link.tink.com") });
    const a = await tinkMock.simulate("bank.sync", { businessId: TEST_BUSINESS_ID, seed: "s" });
    expect(a).toEqual(await tinkMock.simulate("bank.sync", { businessId: TEST_BUSINESS_ID, seed: "s" }));
    expect(a[0]!.type).toBe("bank.balance_updated");
    expect(a[0]!.payload).toMatchObject({ provider: "tink", accountName: "Business current account", balance: { currency: "EUR" } });
    const exp = await tinkMock.simulate("credential.expiry", { businessId: TEST_BUSINESS_ID, daysRemaining: 3 });
    expect(exp[0]!.payload).toMatchObject({ connectorKey: "tink", daysRemaining: 3, expired: false });
  });
});

describe("tink live (canned responses)", () => {
  it("mints a user token through the authorization-grant flow and maps Data API v2 shapes", async () => {
    const seen: string[] = [];
    const connector = createTinkConnector({
      secrets: { tinkClientId: "cid", tinkClientSecret: "csecret" },
      now: () => MOCK_NOW,
      fetch: routedFetch({
        "POST https://api.tink.com/api/v1/oauth/token": async (req) => {
          const form = new URLSearchParams(await req.text());
          seen.push(`token:${form.get("grant_type")}`);
          return jsonResponse({ access_token: form.get("grant_type") === "client_credentials" ? "client-tok" : "user-tok", expires_in: 1800 });
        },
        "POST https://api.tink.com/api/v1/oauth/authorization-grant": (req) => (seen.push(`grant:${req.headers.get("authorization")}`), jsonResponse({ code: "grant-code" })),
        "GET https://api.tink.com/data/v2/accounts": (req) => (seen.push(`accounts:${req.headers.get("authorization")}`), jsonResponse({ accounts: [{ id: "acc1", name: "Företagskonto", type: "CHECKING", balances: { booked: { amount: { value: { unscaledValue: "1842055", scale: "2" }, currencyCode: "SEK" } }, available: { amount: { value: { unscaledValue: "18420", scale: "0" }, currencyCode: "SEK" } } }, identifiers: { iban: { iban: "SE4550000000058398257466" } }, dates: { lastRefreshed: "2026-10-05T08:00:00Z" } }] })),
      }),
    });
    const ctx = makeToolContext(connector, { mode: "live", credential: { kind: "oauth", secret: "expired", expiresAt: "2026-10-01T00:00:00Z", extra: { userId: "u1" } } });
    const r = await connector.callTool("list_accounts", {}, ctx);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(seen).toEqual(["token:client_credentials", "grant:Bearer client-tok", "token:authorization_code", "accounts:Bearer user-tok"]);
    expect(r.data).toMatchObject({ items: [{ id: "acc1", type: "checking", currency: "SEK", booked: { amountMinor: 1_842_055 }, available: { amountMinor: 1_842_000 }, mask: "7466" }] });
    expect(tinkAmountMinor({ value: { unscaledValue: "-12345", scale: "3" }, currencyCode: "EUR" })).toBe(-1235);
  });
  it("throws ConfigError without platform keys or a Tink user", async () => {
    const c = createTinkConnector({ secrets: {} });
    await expect(c.callTool("list_accounts", {}, makeToolContext(c, { mode: "live", credential: { kind: "oauth", secret: "", extra: { userId: "u1" } } }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    const withKeys = createTinkConnector({ secrets: { tinkClientId: "a", tinkClientSecret: "b" } });
    await expect(withKeys.callTool("list_accounts", {}, makeToolContext(withKeys, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe.skipIf(!envKeysPresent("TINK_CLIENT_ID", "TINK_CLIENT_SECRET", "TINK_TEST_USER_ID"))("tink (live)", () => {
  const connector = createTinkConnector({ secrets: { tinkClientId: process.env.TINK_CLIENT_ID, tinkClientSecret: process.env.TINK_CLIENT_SECRET } });
  describeConnectorContract("tink live", { connector, mode: "live", deterministic: false, skipConnect: true, credential: { kind: "oauth", secret: "", extra: { userId: process.env.TINK_TEST_USER_ID! } }, calls: [{ tool: "list_accounts", args: {} }] });
});
