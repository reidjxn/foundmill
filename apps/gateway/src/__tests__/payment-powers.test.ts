/**
 * Payment powers through the gateway (founder, Nov 16, 2026): Stripe's create_invoice asks in augmented and assisted
 * mode; in automated mode, and on vacation, it asks unless the business gave agents the inbound power. A mock invoice
 * is reported as simulated, never as created. No outbound tool becomes callable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ST_CUSTOMERS } from "@foundmill/connectors/connectors/stripe/fixtures/stripe";
import { stripeMock } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { PAYMENT_RECORD_TOOLS, toolAttributes } from "../pipeline";
import { setupGateway, type GatewayFixture } from "./harness";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway({ connectors: [stripeMock] });
  await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "stripe", status: "connected", authKind: "api_key", settings: { externalAccountId: "acct_own", config: { kind: "own" } } });
}, 120_000);
afterAll(async () => {
  await g.close();
});

const invoice = async () => {
  const token = await g.token({ allowedTools: ["stripe:*"] });
  return g.client.call(token, { connector: "stripe", tool: "create_invoice", args: { customerId: ST_CUSTOMERS[0]!.id, currency: "EUR", lines: [{ description: "Kit", amountMinor: 1000 }] } });
};

describe("payment powers at the gateway", () => {
  it("names the payment-record tools; no outbound tool is one", () => {
    expect(toolAttributes("stripe", "create_invoice").paymentRecord).toBe(true);
    expect(toolAttributes("stripe", "create_checkout_session").paymentRecord).toBe(true);
    for (const t of ["create_payout", "create_transfer", "refund_payment"]) expect(PAYMENT_RECORD_TOOLS.has(`stripe:${t}`)).toBe(false);
  });

  it("asks in assisted mode, power or not", async () => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, "assisted");
    await repos.businesses.setPaymentPowers(g.db, g.businessId, ["inbound"]);
    expect((await invoice()).outcome).toBe("ask");
  });

  it("automated: asks without the inbound power; runs with it, and a mock invoice is simulated", async () => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, "automated");
    await repos.businesses.setPaymentPowers(g.db, g.businessId, []);
    expect((await invoice()).outcome).toBe("ask");
    await repos.businesses.setPaymentPowers(g.db, g.businessId, ["inbound"]);
    const ran = await invoice();
    expect(ran.outcome).toBe("allow");
    expect(JSON.stringify(ran)).toMatch(/simulated/i);
  });

  it("a payout stays refused with the power on", async () => {
    const token = await g.token({ allowedTools: ["stripe:*"] });
    const r = await g.client.call(token, { connector: "stripe", tool: "create_payout", args: { amountMinor: 1000, currency: "EUR" } });
    expect(r.outcome).toBe("deny");
  });
});
