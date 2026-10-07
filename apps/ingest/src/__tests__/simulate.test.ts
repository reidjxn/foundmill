/**
 * Dev-only Simulate panel: gated by environment, served by the mock connectors' `simulate()`, written through the
 * same outbox path as webhooks (so a simulated payment has a conversion, a journey and `customer.converted`).
 * Driven through `app.request()`; no port is needed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { SIMULATE_EVENT_NAMES } from "@foundmill/connectors";
import { simulateEnabledFor } from "../simulate";
import type { BuiltIngest } from "../index";
import { createIngestHarness, type IngestHarness } from "./harness";

let hz: IngestHarness;
let baseB: Record<string, number>;

beforeAll(async () => {
  hz = await createIngestHarness("simulate");
  baseB = await repos.journeys.countConversions(hz.db, hz.B.businessId);
}, 120_000);

afterAll(async () => {
  await hz.close();
});

const post = (built: BuiltIngest, path: string, body: unknown) => built.app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const asJson = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;

describe("gating", () => {
  it("is on in development and staging when the flag is set, never in test or production", () => {
    expect(simulateEnabledFor("development", true)).toBe(true);
    expect(simulateEnabledFor("staging", true)).toBe(true);
    expect(simulateEnabledFor("test", true)).toBe(false);
    expect(simulateEnabledFor("production", true)).toBe(false);
    expect(simulateEnabledFor("development", false)).toBe(false);
  });

  it("the routes do not exist when disabled (production) and /health says so", async () => {
    const prod = hz.build({ env: { APP_ENV: "production", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" } as BuiltIngest["env"], simulateEnabled: undefined });
    expect(prod.deps.simulateEnabled).toBe(false);
    const res = await post(prod, "/simulate/payment.received", { businessId: hz.A.businessId });
    expect(res.status).toBe(404);
    expect(await asJson(res)).toMatchObject({ ok: false, error: "not_found" });
    expect((await prod.app.request("/simulate")).status).toBe(404);
    expect(await asJson(await prod.app.request("/health"))).toMatchObject({ simulate: false });
  });

  it("the routes exist in development with the flag on", async () => {
    const dev = hz.build({ env: { APP_ENV: "development", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" } as BuiltIngest["env"], simulateEnabled: undefined });
    expect(dev.deps.simulateEnabled).toBe(true);
    const res = await dev.app.request("/simulate");
    expect(res.status).toBe(200);
    const body = await asJson<{ enabled: boolean; simulations: { name: string; connectors: string[] }[] }>(res);
    expect(body.enabled).toBe(true);
    expect(body.simulations.map((s) => s.name)).toEqual([...SIMULATE_EVENT_NAMES]);
    const byName = Object.fromEntries(body.simulations.map((s) => [s.name, s.connectors]));
    expect(byName["payment.received"]).toContain("stripe");
    expect(byName["lead.replied"]).toContain("sendgrid");
    expect(byName["bank.sync"]).toEqual(expect.arrayContaining(["tink", "plaid"]));
    expect(byName["credential.expiry"]!.length).toBeGreaterThan(0);
  });
});

describe("simulations", () => {
  it("payment.received through the Stripe mock records a payment, a conversion, a journey and customer.converted", async () => {
    const res = await post(hz.built, "/simulate/payment.received", { businessId: hz.B.businessId, seed: "panel-1", params: { amountMinor: 12_000 } });
    expect(res.status).toBe(200);
    const body = await asJson<{ ok: boolean; connector: string; written: number; duplicates: number; eventIds: string[]; events: { type: string; conversionId: string | null; journeyId: string | null; nthOfKind: number | null }[]; label: string }>(res);
    expect(body).toMatchObject({ ok: true, connector: "stripe", written: 1, duplicates: 0, label: "Simulated" });
    expect(body.events[0]).toMatchObject({ type: "payment.received" });
    // The fixture's conversions are dated "now"; the simulated one is dated MOCK_NOW, so it ranks by time, not by insertion.
    expect(body.events[0]!.nthOfKind).toBeGreaterThanOrEqual(1);
    expect(body.events[0]!.nthOfKind).toBeLessThanOrEqual(baseB.payment! + 1);
    expect(body.events[0]!.conversionId).toBeTruthy();
    expect(body.events[0]!.journeyId).toBeTruthy();

    const payments = await hz.events(hz.B.businessId, "payment.received");
    expect(payments).toHaveLength(1);
    expect(payments[0]!.actor).toEqual({ kind: "system", id: "simulate" });
    expect(payments[0]!.payload).toMatchObject({ provider: "stripe", amount: { amountMinor: 12_000, currency: "EUR" } });
    const converted = await hz.events(hz.B.businessId, "customer.converted");
    expect(converted).toHaveLength(1);
    expect(converted[0]!.payload).toMatchObject({ kind: "payment", matchdayLevel: "cup", journeyId: body.events[0]!.journeyId, conversionId: body.events[0]!.conversionId });
  });

  it("is deterministic and idempotent: the same seed twice is a duplicate, a new seed is a new event", async () => {
    const again = await post(hz.built, "/simulate/payment.received", { businessId: hz.B.businessId, seed: "panel-1", params: { amountMinor: 12_000 } });
    expect(await asJson(again)).toMatchObject({ written: 0, duplicates: 1 });
    expect(await hz.events(hz.B.businessId, "payment.received")).toHaveLength(1);
    const fresh = await post(hz.built, "/simulate/payment.received", { businessId: hz.B.businessId, seed: "panel-2" });
    expect(await asJson(fresh)).toMatchObject({ written: 1, duplicates: 0 });
    expect(await hz.events(hz.B.businessId, "payment.received")).toHaveLength(2);
  });

  it("serves every panel action: lead.replied, signup.created, bank sync, CPA spike, credential expiry", async () => {
    const expectations: [string, string][] = [
      ["lead.replied", "lead.replied"],
      ["signup.created", "signup.created"],
      ["bank.sync", "bank.balance_updated"],
      ["cpa.spike", "channel.threshold_breached"],
      ["credential.expiry", "credential.expiring"],
    ];
    for (const [name, emits] of expectations) {
      const res = await post(hz.built, `/simulate/${name}`, { businessId: hz.A.businessId, seed: `all-${name}` });
      expect(res.status, name).toBe(200);
      const body = await asJson<{ written: number; events: { type: string }[] }>(res);
      expect(body.written, name).toBeGreaterThanOrEqual(1);
      expect(body.events.map((e) => e.type), name).toContain(emits);
      expect((await hz.events(hz.A.businessId, emits as never)).length, name).toBeGreaterThanOrEqual(1);
    }
    // The signup became a friendly Match Day; the others are not conversions.
    const signups = await hz.events(hz.A.businessId, "customer.converted");
    expect(signups.map((e) => (e.payload as { kind: string }).kind)).toEqual(["signup"]);
  });

  it("honours an explicit connector and rejects one that cannot simulate the event", async () => {
    const shop = await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId, connector: "shopify", seed: "shop-1" });
    expect(shop.status).toBe(200);
    expect(await asJson(shop)).toMatchObject({ connector: "shopify", written: 1 });
    const payments = await hz.events(hz.A.businessId, "payment.received");
    expect(payments.some((p) => (p.payload as { provider: string }).provider === "shopify")).toBe(true);

    const wrong = await post(hz.built, "/simulate/bank.sync", { businessId: hz.A.businessId, connector: "stripe" });
    expect(wrong.status).toBe(400);
    expect(await asJson(wrong)).toMatchObject({ error: "unknown_simulation" });
    const unknown = await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId, connector: "nope" });
    expect(unknown.status).toBe(404);
  });

  it("validates the body and the event name", async () => {
    expect((await post(hz.built, "/simulate/payment.received", { businessId: "nope" })).status).toBe(400);
    expect((await hz.built.app.request("/simulate/payment.received", { method: "POST", body: "{" })).status).toBe(400);
    const ghost = await post(hz.built, "/simulate/payment.received", { businessId: "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60" });
    expect(ghost.status).toBe(404);
    const unknownEvent = await post(hz.built, "/simulate/meteor.strike", { businessId: hz.A.businessId });
    expect(unknownEvent.status).toBe(404);
  });
});
