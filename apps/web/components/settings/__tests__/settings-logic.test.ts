import { describe, expect, it, vi } from "vitest";
import { PRICE_TBA_LABEL } from "@foundmill/config";
import { tierPriceLabel } from "../BillingTab";
import { glossaryRows, rowsToGlossary } from "../GlossaryTab";
import { postSimulation, SIMULATIONS } from "../IntegrationsTab";
import { GAME_MODE_REVIEW } from "../ModeTab";

describe("settings logic", () => {
  it("renders Price to be announced for TBD tiers and Free for the free tier", () => {
    expect(tierPriceLabel("free")).toBe("Free");
    expect(tierPriceLabel("pro")).toBe(PRICE_TBA_LABEL);
    expect(tierPriceLabel("scale")).toBe(PRICE_TBA_LABEL);
  });

  it("round-trips the glossary and drops blank rows", () => {
    const rows = glossaryRows({ customer: "client", lead: "patient" });
    expect(rows.map((r) => r.term)).toEqual(["customer", "lead"]);
    expect(rowsToGlossary([...rows, { id: 9, term: "  Order ", replacement: " booking " }, { id: 10, term: "x", replacement: "" }])).toEqual({ customer: "client", lead: "patient", order: "booking" });
  });

  it("posts simulations to the ingest service and parses the answer", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({ written: 1, label: "Simulated", url: String(url), body: init?.body }), { status: 200 }));
    const r = await postSimulation("http://ingest.test", "payment.received", { businessId: "b1", connector: "stripe" }, fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect(r.body).toMatchObject({ written: 1, label: "Simulated", url: "http://ingest.test/simulate/payment.received", body: JSON.stringify({ businessId: "b1", connector: "stripe" }) });
    const refused = await postSimulation("http://ingest.test", "x", {}, (async () => new Response("Not found", { status: 404 })) as unknown as typeof fetch);
    expect(refused).toEqual({ ok: false, status: 404, body: "Not found" });
    expect(SIMULATIONS.map((s) => s.name)).toContain("payment.received");
  });

  it("the game-mode review lists what changes both ways", () => {
    expect(GAME_MODE_REVIEW.live.length).toBeGreaterThan(2);
    expect(GAME_MODE_REVIEW.personal.join(" ")).toMatch(/15 minutes/);
  });
});
