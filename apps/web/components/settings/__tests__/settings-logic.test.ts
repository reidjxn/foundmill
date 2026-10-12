import { describe, expect, it } from "vitest";
import { PRICE_TBA_LABEL } from "@foundmill/config";
import { includedCreditsFact, periodLabel, tierFacts, tierPriceLabel } from "../BillingTab";
import { glossaryRows, rowsToGlossary } from "../GlossaryTab";
import { connectorDetail, formatSimulateResult, simulateInput, simulateRefusalMessage, SIMULATIONS } from "../IntegrationsTab";
import { GAME_MODE_REVIEW } from "../ModeTab";

describe("settings logic", () => {
  it("renders Price to be announced for TBD tiers and Free for the free tier", () => {
    expect(tierPriceLabel("free")).toBe("Free");
    expect(tierPriceLabel("pro")).toBe(PRICE_TBA_LABEL);
    expect(tierPriceLabel("scale")).toBe(PRICE_TBA_LABEL);
  });

  it("states each tier's limits and its monthly model credits in US dollars", () => {
    expect(tierFacts("free")).toEqual(["1 business", "4 agents at once", "1 seat", "$5.00 of model credits a month", "Then credits or your key"]);
    expect(includedCreditsFact("pro")).toBe("Monthly credits to be announced (at least $5.00)");
    expect(tierFacts("scale")[0]).toBe("Unlimited businesses");
  });

  it("dates billing periods and connector checks in the person's own format (Settings › Preferences)", () => {
    expect(periodLabel("2026-10")).toBe("October 2026");
    expect(periodLabel("2026-10", { date: "day_first", time: "24h" })).toBe("October 2026");
    expect(periodLabel("2026-10", { date: "iso", time: "24h" })).toBe("2026-10");
    expect(periodLabel("this month")).toBe("this month");
    const integ = { accountLabel: "acct_1", scopes: ["read"], lastHealthAt: "2026-10-07T15:45:00Z" };
    expect(connectorDetail({ tools: [1, 2] }, integ)).toBe("acct_1 · 2 agent actions · 1 permission · checked Oct 7, 3:45 PM UTC");
    expect(connectorDetail({ tools: [1, 2] }, integ, { date: "iso", time: "24h" })).toBe("acct_1 · 2 agent actions · 1 permission · checked 10-07 15:45 UTC");
    expect(connectorDetail({ tools: [1, 2] }, integ, { date: "day_first", time: "24h" })).toBe("acct_1 · 2 agent actions · 1 permission · checked 7 Oct, 15:45 UTC");
  });

  it("round-trips the glossary and drops blank rows", () => {
    const rows = glossaryRows({ customer: "client", lead: "patient" });
    expect(rows.map((r) => r.term)).toEqual(["customer", "lead"]);
    expect(rowsToGlossary([...rows, { id: 9, term: "  Order ", replacement: " booking " }, { id: 10, term: "x", replacement: "" }])).toEqual({ customer: "client", lead: "patient", order: "booking" });
  });

  it("builds the dev.simulate input (no credential of its own) and renders the API's answer verbatim", () => {
    expect(simulateInput("b1", "payment.received", "stripe")).toEqual({ businessId: "b1", eventName: "payment.received", connector: "stripe" });
    expect(simulateInput("b1", "payment.received", "")).toEqual({ businessId: "b1", eventName: "payment.received" });
    expect(formatSimulateResult("payment.received", { ok: true, status: 200, body: { written: 1 } })).toBe('payment.received → 200\n{\n  "written": 1\n}');
    expect(formatSimulateResult("x", { ok: false, status: 404, body: "Not found" })).toBe("x → 404\nNot found");
    expect(simulateRefusalMessage({ ok: false, status: 400, body: { error: "unknown_simulation" } })).toBe('400: {"error":"unknown_simulation"}');
    expect(SIMULATIONS.map((s) => s.name)).toContain("payment.received");
  });

  it("the game-mode review lists what changes both ways", () => {
    expect(GAME_MODE_REVIEW.live.length).toBeGreaterThan(2);
    expect(GAME_MODE_REVIEW.personal.join(" ")).toMatch(/15 minutes/);
  });
});
