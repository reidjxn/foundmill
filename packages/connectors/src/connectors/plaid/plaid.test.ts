import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { MOCK_NOW } from "../../mock-utils";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { createPlaidConnector } from "./index";
import { createPlaidMock, plaidMock, plaidMockOptions } from "./mock";

describeConnectorContract("plaid (mock)", {
  connector: plaidMock,
  mode: "mock",
  calls: [
    { tool: "list_accounts", args: {}, check: (r) => expect((r.data as { items: { currency: string; institution: string }[] }).items[0]).toMatchObject({ currency: "USD", institution: "Mercury" }) },
    { tool: "list_transactions", args: { from: "2026-09-01", to: "2026-09-30", pageSize: 500 }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: { bookedDate: string }[] }).items.every((t) => t.bookedDate.startsWith("2026-09"))).toBe(true) },
    { tool: "sync", args: { cursor: "2026-09-28" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { newTransactions: { bookedDate: string }[] }).newTransactions.every((t) => t.bookedDate > "2026-09-28")).toBe(true) },
    { tool: "get_consent_status", args: {}, check: (r) => expect(r.data).toMatchObject({ status: "active", daysRemaining: 120 }) },
  ],
});

describe("plaid mock and simulations", () => {
  it("serves a different 24-month history than Tink (USD, Ledgerly) and is deterministic", () => {
    const h = plaidMockOptions(TEST_BUSINESS_ID).history;
    expect(h.currency).toBe("USD");
    expect(new Set(h.transactions.map((t) => t.bookedDate.slice(0, 7))).size).toBe(24);
    expect(h.transactions.some((t) => t.description.includes("Ledgerly Inc"))).toBe(true);
    expect(plaidMockOptions(TEST_BUSINESS_ID).history).toEqual(h);
  });
  it("has no money-moving tool and hard-gates consent", async () => {
    const mock = createPlaidMock(TEST_BUSINESS_ID);
    expect(Object.values(mock.policyHints).some((h) => h.spendsMoney)).toBe(false);
    const r = await mock.callTool("start_consent", { reason: "Finance module needs balances" }, makeToolContext(mock));
    expect(r.error?.code).toBe("hard_gate");
    expect((r.data as { instructions: string }).instructions).toContain("Plaid Link");
    const sync = await plaidMock.simulate("bank.sync", { businessId: TEST_BUSINESS_ID, deltaMinor: -250_000, newTransactions: 4 });
    expect(sync[0]!.payload).toMatchObject({ provider: "plaid", delta: { amountMinor: -250_000, currency: "USD" }, newTransactions: 4 });
    expect(sync).toEqual(await plaidMock.simulate("bank.sync", { businessId: TEST_BUSINESS_ID, deltaMinor: -250_000, newTransactions: 4 }));
  });
});

describe("plaid live (canned responses)", () => {
  it("posts client credentials in the body, pages transactions/sync and flips Plaid's amount sign", async () => {
    const bodies: Record<string, unknown>[] = [];
    const connector = createPlaidConnector({
      secrets: { plaidClientId: "cid", plaidSecret: "sec", plaidEnv: "sandbox" },
      now: () => MOCK_NOW,
      fetch: routedFetch({
        "POST https://sandbox.plaid.com/transactions/sync": async (req) => {
          const body = (await req.json()) as Record<string, unknown>;
          bodies.push(body);
          const first = !body.cursor;
          return jsonResponse({ added: [{ transaction_id: first ? "t1" : "t2", account_id: "a1", amount: first ? 42.5 : -1200, iso_currency_code: "USD", date: "2026-10-03", name: first ? "GITHUB" : "STRIPE PAYOUT", merchant_name: first ? "GitHub" : "Stripe", pending: false, personal_finance_category: { primary: first ? "GENERAL_SERVICES" : "INCOME" } }], modified: [], removed: [], next_cursor: first ? "c1" : "c2", has_more: first });
        },
        "POST https://sandbox.plaid.com/item/get": () => jsonResponse({ item: { item_id: "item1", institution_name: "Mercury", consent_expiration_time: "2027-01-01T00:00:00Z" } }),
        "POST https://sandbox.plaid.com/accounts/balance/get": () => jsonResponse({ accounts: [{ account_id: "a1", name: "Checking", type: "depository", subtype: "checking", mask: "0001", balances: { available: 1000, current: 1250.75, iso_currency_code: "USD" } }] }),
      }),
    });
    const r = await connector.callTool("sync", {}, makeToolContext(connector, { mode: "live", credential: { kind: "oauth", secret: "access-sandbox-1" } }));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(bodies[0]).toMatchObject({ client_id: "cid", secret: "sec", access_token: "access-sandbox-1" });
    expect(bodies[1]).toMatchObject({ cursor: "c1" });
    expect(isUntrusted(r.data) && r.data.content).toMatchObject({ cursor: "c2", hasMore: false, consentExpiresAt: "2027-01-01T00:00:00Z", accounts: [{ type: "checking", booked: { amountMinor: 125_075 }, available: { amountMinor: 100_000 }, institution: "Mercury" }], newTransactions: [{ id: "t1", amount: { amountMinor: -4250 }, category: "GENERAL_SERVICES" }, { id: "t2", amount: { amountMinor: 120_000 } }] });
  });
  it("throws ConfigError without keys or an access token", async () => {
    const c = createPlaidConnector({ secrets: {} });
    await expect(c.callTool("list_accounts", {}, makeToolContext(c, { mode: "live", credential: { kind: "oauth", secret: "x" } }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    const keyed = createPlaidConnector({ secrets: { plaidClientId: "a", plaidSecret: "b" } });
    await expect(keyed.callTool("list_accounts", {}, makeToolContext(keyed, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe.skipIf(!envKeysPresent("PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_TEST_ACCESS_TOKEN"))("plaid (live sandbox)", () => {
  const connector = createPlaidConnector({ secrets: { plaidClientId: process.env.PLAID_CLIENT_ID, plaidSecret: process.env.PLAID_SECRET, plaidEnv: "sandbox" } });
  describeConnectorContract("plaid live", { connector, mode: "live", deterministic: false, skipConnect: true, credential: { kind: "oauth", secret: process.env.PLAID_TEST_ACCESS_TOKEN! }, calls: [{ tool: "list_accounts", args: {} }] });
});
