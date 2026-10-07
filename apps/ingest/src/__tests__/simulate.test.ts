/**
 * Dev-only Simulate panel: gated by environment, locked behind the service token apps/api mints (SEC-2), served by
 * the mock connectors' `simulate()`, written through the same outbox path as webhooks (so a simulated payment has a
 * conversion, a journey and `customer.converted`). Driven through `app.request()`; no port is needed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { MOCK_NOW, SIMULATE_EVENT_NAMES } from "@foundmill/connectors";
import { SIMULATE_TOKEN_AUDIENCE, SIMULATE_TOKEN_ISSUER } from "@foundmill/config";
import { simulateEnabledFor, simulateRoutesMounted } from "../simulate";
import { signSimulateToken, verifySimulateToken } from "../simulate-token";
import type { BuiltIngest } from "../index";
import { createIngestHarness, SIMULATE_TEST_SECRET, simulateToken, type IngestHarness } from "./harness";

let hz: IngestHarness;
let baseB: Record<string, number>;

beforeAll(async () => {
  hz = await createIngestHarness("simulate");
  baseB = await repos.journeys.countConversions(hz.db, hz.B.businessId);
}, 120_000);

afterAll(async () => {
  await hz.close();
});

type PostOptions = { token?: string | null; headers?: Record<string, string> };

/** POST with the service token for `body.businessId` unless `token` says otherwise (`null` = no Authorization header). */
const post = (built: BuiltIngest, path: string, body: Record<string, unknown>, opts: PostOptions = {}) => {
  const token = opts.token === undefined ? simulateToken(String(body.businessId)) : opts.token;
  return built.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) }, body: JSON.stringify(body) });
};
const asJson = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;
const secondsAfterMockNow = (s: number) => () => new Date(MOCK_NOW.getTime() + s * 1000);

describe("gating", () => {
  it("is on in development and staging when the flag is set, never in test or production", () => {
    expect(simulateEnabledFor("development", true)).toBe(true);
    expect(simulateEnabledFor("staging", true)).toBe(true);
    expect(simulateEnabledFor("test", true)).toBe(false);
    expect(simulateEnabledFor("production", true)).toBe(false);
    expect(simulateEnabledFor("development", false)).toBe(false);
    // Forcing the routes on cannot override production.
    expect(simulateRoutesMounted({ env: { APP_ENV: "production" }, simulateEnabled: true })).toBe(false);
    expect(simulateRoutesMounted({ env: { APP_ENV: "staging" }, simulateEnabled: true })).toBe(true);
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

  it("production always answers 404, even with the flag forced on and a valid service token", async () => {
    const forced = hz.build({ env: { APP_ENV: "production", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" } as BuiltIngest["env"], simulateEnabled: true });
    const before = (await hz.events(hz.A.businessId, "payment.received")).length;
    const res = await post(forced, "/simulate/payment.received", { businessId: hz.A.businessId, seed: "prod-forced" });
    expect(res.status).toBe(404);
    expect((await forced.app.request("/simulate", { headers: { authorization: `Bearer ${simulateToken(hz.A.businessId)}` } })).status).toBe(404);
    expect((await hz.events(hz.A.businessId, "payment.received")).length).toBe(before);
  });

  it("the routes exist in development with the flag on, behind the service token", async () => {
    const dev = hz.build({ env: { APP_ENV: "development", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" } as BuiltIngest["env"], simulateEnabled: undefined });
    expect(dev.deps.simulateEnabled).toBe(true);
    expect((await dev.app.request("/simulate")).status).toBe(401);
    const res = await dev.app.request("/simulate", { headers: { authorization: `Bearer ${simulateToken(hz.A.businessId)}` } });
    expect(res.status).toBe(200);
    const body = await asJson<{ enabled: boolean; businessId: string; simulations: { name: string; connectors: string[] }[] }>(res);
    expect(body.enabled).toBe(true);
    expect(body.businessId).toBe(hz.A.businessId);
    expect(body.simulations.map((s) => s.name)).toEqual([...SIMULATE_EVENT_NAMES]);
    const byName = Object.fromEntries(body.simulations.map((s) => [s.name, s.connectors]));
    expect(byName["payment.received"]).toContain("stripe");
    expect(byName["lead.replied"]).toContain("sendgrid");
    expect(byName["bank.sync"]).toEqual(expect.arrayContaining(["tink", "plaid"]));
    expect(byName["credential.expiry"]!.length).toBeGreaterThan(0);
  });

  it("staging honours the token too (the flag is on there), test does not", async () => {
    const staging = hz.build({ env: { APP_ENV: "staging", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" } as BuiltIngest["env"], simulateEnabled: undefined });
    expect(staging.deps.simulateEnabled).toBe(true);
    expect((await staging.app.request("/simulate")).status).toBe(401);
    expect((await staging.app.request("/simulate", { headers: { authorization: `Bearer ${simulateToken(hz.A.businessId)}` } })).status).toBe(200);
    const test = hz.build({ env: { APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" } as BuiltIngest["env"], simulateEnabled: undefined });
    expect(test.deps.simulateEnabled).toBe(false);
    expect((await test.app.request("/simulate", { headers: { authorization: `Bearer ${simulateToken(hz.A.businessId)}` } })).status).toBe(404);
  });
});

describe("service token (SEC-2)", () => {
  const countA = () => hz.events(hz.A.businessId, "payment.received").then((e) => e.length);

  it("refuses a request without a token with 401 and writes nothing", async () => {
    const before = await countA();
    const res = await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId, seed: "no-token" }, { token: null });
    expect(res.status).toBe(401);
    expect(await asJson(res)).toMatchObject({ ok: false, error: "unauthorized" });
    expect(await countA()).toBe(before);
    // Neither a bare value nor another scheme counts as a Bearer token.
    expect((await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId }, { token: null, headers: { authorization: simulateToken(hz.A.businessId) } })).status).toBe(401);
    expect((await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId }, { token: null, headers: { authorization: `Basic ${simulateToken(hz.A.businessId)}` } })).status).toBe(401);
    expect(await countA()).toBe(before);
  });

  it("refuses a token for another audience, another issuer, the wrong secret or a tampered body", async () => {
    const before = await countA();
    const cases: [string, string][] = [
      ["gateway audience", simulateToken(hz.A.businessId, { audience: "foundmill-gateway/service" })],
      ["session audience", simulateToken(hz.A.businessId, { audience: "foundmill-gateway/session" })],
      ["other issuer", simulateToken(hz.A.businessId, { issuer: "foundmill-gateway" })],
      ["wrong secret", simulateToken(hz.A.businessId, {}, "another-secret-of-sixteen-chars")],
      ["garbage", "not.a.jwt"],
      ["empty", ""],
    ];
    for (const [name, token] of cases) {
      const res = await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId, seed: `bad-${name}` }, { token });
      expect(res.status, name).toBe(401);
    }
    // A valid signature over a payload that was swapped for business B.
    const good = simulateToken(hz.A.businessId);
    const [h, , s] = good.split(".") as [string, string, string];
    const swapped = Buffer.from(JSON.stringify({ businessId: hz.A.businessId, svc: "api", iss: SIMULATE_TOKEN_ISSUER, aud: SIMULATE_TOKEN_AUDIENCE, iat: Math.floor(MOCK_NOW.getTime() / 1000), exp: Math.floor(MOCK_NOW.getTime() / 1000) + 60 })).toString("base64url");
    expect((await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId }, { token: `${h}.${swapped}.${s}` })).status).toBe(401);
    // alg:none is not an algorithm.
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    expect((await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId }, { token: `${noneHeader}.${swapped}.` })).status).toBe(401);
    expect(await countA()).toBe(before);
  });

  it("refuses an expired token and one that would live longer than five minutes", async () => {
    const before = await countA();
    const expired = simulateToken(hz.A.businessId, { ttlSeconds: 60 }, SIMULATE_TEST_SECRET, secondsAfterMockNow(-120));
    const res = await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId, seed: "expired" }, { token: expired });
    expect(res.status).toBe(401);
    expect((await asJson(res)).message).toMatch(/expired/);
    const tooLong = simulateToken(hz.A.businessId, { ttlSeconds: 6 * 60 });
    expect((await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId, seed: "too-long" }, { token: tooLong })).status).toBe(401);
    // Backdating iat does not buy extra life either.
    const backdated = simulateToken(hz.A.businessId, { ttlSeconds: 5 * 60 }, SIMULATE_TEST_SECRET, secondsAfterMockNow(-4 * 60));
    expect((await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId, seed: "backdated" }, { token: backdated })).status).toBe(200);
    const future = simulateToken(hz.A.businessId, { ttlSeconds: 60 }, SIMULATE_TEST_SECRET, secondsAfterMockNow(5 * 60));
    expect((await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId, seed: "future" }, { token: future })).status).toBe(401);
    expect(await countA()).toBe(before + 1);
  });

  it("binds the token to one business: a token for B cannot simulate into A (403, nothing written)", async () => {
    const before = await countA();
    const res = await post(hz.built, "/simulate/payment.received", { businessId: hz.A.businessId, seed: "cross-tenant" }, { token: simulateToken(hz.B.businessId) });
    expect(res.status).toBe(403);
    expect(await asJson(res)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await countA()).toBe(before);
  });

  it("fails closed when the ingest has no secret configured", async () => {
    const noSecret = hz.build({ simulateTokenSecret: null });
    expect((await post(noSecret, "/simulate/payment.received", { businessId: hz.A.businessId, seed: "no-secret" })).status).toBe(401);
    const shortSecret = hz.build({ simulateTokenSecret: "short" });
    expect((await post(shortSecret, "/simulate/payment.received", { businessId: hz.A.businessId, seed: "short-secret" }, { token: signSimulateToken("short-but-sixteen-chars", { businessId: hz.A.businessId }) })).status).toBe(401);
  });

  it("verifySimulateToken returns the claims apps/api minted (contract shared with the api's jose signer)", () => {
    const token = simulateToken(hz.A.businessId, { userId: hz.A.ownerId });
    const claims = verifySimulateToken(SIMULATE_TEST_SECRET, token, () => MOCK_NOW);
    expect(claims).toMatchObject({ businessId: hz.A.businessId, svc: "api", userId: hz.A.ownerId });
    expect(claims.exp - claims.iat).toBe(60);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => verifySimulateToken(SIMULATE_TEST_SECRET, token, secondsAfterMockNow(61))).toThrow(/expired/);
    expect(() => verifySimulateToken("another-secret-of-sixteen-chars", token, () => MOCK_NOW)).toThrow(/signature/);
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
    // The signup became a brief Customer Update; the payments above (token tests) are the other wins; the rest are not conversions.
    const wins = await hz.events(hz.A.businessId, "customer.converted");
    expect(wins.map((e) => (e.payload as { kind: string }).kind)).toContain("signup");
    expect(wins.every((e) => ["signup", "payment"].includes((e.payload as { kind: string }).kind))).toBe(true);
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
    expect((await post(hz.built, "/simulate/payment.received", { businessId: "nope" }, { token: simulateToken(hz.A.businessId) })).status).toBe(400);
    expect((await hz.built.app.request("/simulate/payment.received", { method: "POST", headers: { authorization: `Bearer ${simulateToken(hz.A.businessId)}` }, body: "{" })).status).toBe(400);
    const ghost = await post(hz.built, "/simulate/payment.received", { businessId: "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60" });
    expect(ghost.status).toBe(404);
    const unknownEvent = await post(hz.built, "/simulate/meteor.strike", { businessId: hz.A.businessId });
    expect(unknownEvent.status).toBe(404);
  });
});
