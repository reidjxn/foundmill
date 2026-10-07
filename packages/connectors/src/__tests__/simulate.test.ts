import { describe, expect, it } from "vitest";
import { safeParseEvent } from "@foundmill/events/catalogue";
import { createAllConnectors } from "../catalogue";
import { isMockConnector } from "../define";
import { createRng, deterministicEmbedding, minorFromDecimal, SIMULATE_EVENTS, simulate, stableHash, uuidFromSeed } from "../mock-utils";
import { TEST_BUSINESS_ID } from "../testing/contract-suite";

describe("simulate(): the dev Simulate panel", () => {
  it("covers the BUILD §13.3 list and every event validates against the catalogue", () => {
    expect(SIMULATE_EVENTS.map((e) => e.name)).toEqual(["signup.created", "payment.received", "lead.replied", "bank.sync", "cpa.spike", "credential.expiry"]);
    for (const e of SIMULATE_EVENTS) {
      const events = simulate(e.name, { businessId: TEST_BUSINESS_ID });
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe(e.emits);
      expect(events[0]!.businessId).toBe(TEST_BUSINESS_ID);
      const parsed = safeParseEvent(events[0]!);
      expect(parsed.ok, parsed.ok ? "" : parsed.error.message).toBe(true);
    }
  });
  it("is deterministic in (event, business, seed) and changes with the seed", () => {
    const a = simulate("payment.received", { businessId: TEST_BUSINESS_ID, seed: "a" });
    expect(a).toEqual(simulate("payment.received", { businessId: TEST_BUSINESS_ID, seed: "a" }));
    expect(a[0]!.id).not.toBe(simulate("payment.received", { businessId: TEST_BUSINESS_ID, seed: "b" })[0]!.id);
    expect(a[0]!.id).not.toBe(simulate("payment.received", { businessId: uuidFromSeed("other"), seed: "a" })[0]!.id);
  });
  it("honours overrides and rejects unknown names", () => {
    const [p] = simulate("payment.received", { businessId: TEST_BUSINESS_ID, amountMinor: 12_900, currency: "SEK", firstPayment: false });
    expect(p!.payload).toMatchObject({ amount: { amountMinor: 12_900, currency: "SEK" }, firstPayment: false });
    const [c] = simulate("cpa.spike", { businessId: TEST_BUSINESS_ID, threshold: 5_000, value: 9_000, action: "alerted" });
    expect(c!.payload).toMatchObject({ metric: "cpa", threshold: 5_000, value: 9_000, action: "alerted", direction: "above" });
    const [x] = simulate("credential.expiry", { businessId: TEST_BUSINESS_ID, connectorKey: "tink", daysRemaining: 0 });
    expect(x!.payload).toMatchObject({ connectorKey: "tink", expired: true });
    expect(() => simulate("not.a.thing", { businessId: TEST_BUSINESS_ID })).toThrow(/unknown event/);
  });
  it("every connector simulation returns catalogue-valid, deterministic events", async () => {
    const mocks = createAllConnectors({ secrets: {} }).map((c) => c.mock).filter(isMockConnector);
    const names = new Set<string>();
    for (const mock of mocks) {
      for (const name of mock.simulations) {
        names.add(name);
        const events = await mock.simulate(name, { businessId: TEST_BUSINESS_ID, seed: "sim" });
        expect(events.length, `${mock.key}:${name}`).toBeGreaterThan(0);
        for (const e of events) {
          const parsed = safeParseEvent(e);
          expect(parsed.ok, `${mock.key}:${name} ${parsed.ok ? "" : parsed.error.message}`).toBe(true);
        }
        expect(await mock.simulate(name, { businessId: TEST_BUSINESS_ID, seed: "sim" }), `${mock.key}:${name} determinism`).toEqual(events);
      }
    }
    for (const required of ["signup.created", "payment.received", "lead.replied", "bank.sync", "credential.expiry", "pr.merged", "contract.signed"]) expect([...names]).toContain(required);
  });
});

describe("mock-utils: deterministic primitives", () => {
  it("seeded rng, hashes and uuids are stable", () => {
    const a = createRng("seed");
    const b = createRng("seed");
    expect([a.int(1, 100), a.next(), a.pick(["x", "y", "z"]), a.uuid()]).toEqual([b.int(1, 100), b.next(), b.pick(["x", "y", "z"]), b.uuid()]);
    expect(stableHash({ b: 1, a: [2, 3] })).toBe(stableHash({ a: [2, 3], b: 1 }));
    expect(uuidFromSeed("x", 1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(minorFromDecimal("12.34")).toBe(1234);
  });
  it("embeddings are unit vectors of the requested dimension and differ between inputs", () => {
    const e = deterministicEmbedding("hello", 1024);
    expect(e).toHaveLength(1024);
    expect(Math.sqrt(e.reduce((acc, x) => acc + x * x, 0))).toBeCloseTo(1, 5);
    expect(e).toEqual(deterministicEmbedding("hello", 1024));
    expect(e).not.toEqual(deterministicEmbedding("hello!", 1024));
    expect(deterministicEmbedding("x", 256)).toHaveLength(256);
  });
});
