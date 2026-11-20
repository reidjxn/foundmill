/**
 * `createBusinessModelClient` (BUILD §10.2 step 3, §10.4): a business on credits runs on the platform client; a business on
 * its own key runs on a client built from that key (decrypted here, cached per key, re-read after the ttl) and books to
 * `byok`; in live mode a business on its own key with no readable key is refused rather than run on the platform's
 * credits; under MODEL_MODE=mock it gets a mock client that books to `byok`. A platform-key call for a business whose
 * credits are used up is refused before it is made (SEC2 S2), and a top-up lifts that at once.
 */
import { BYOK_CREDENTIAL_KIND, periodOf, repos } from "@foundmill/db";
import { batchEnded, collectBatch, createModelClient, ModelRequestError, submitBatch, type ModelClient, type UsageEvent } from "@foundmill/models";
import { buildAad, createVault, encryptJson, generateMasterKey } from "@foundmill/shared/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { usageSink } from "../deps";
import { createBusinessModelClient } from "../models";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "bmc" });
});
afterAll(async () => {
  await t?.close();
});

const ask = (businessId: string | undefined) => ({ route: "classifier" as const, system: "s", messages: [{ role: "user" as const, content: "classify this" }], attribution: businessId ? { businessId, kind: "test" } : undefined });

describe("createBusinessModelClient", () => {
  it("a business on credits, and a call with no business, run on the platform client and book to credits", async () => {
    const events: UsageEvent[] = [];
    const platform = createModelClient({ mode: "mock", onUsage: (e) => void events.push(e) });
    const client = createBusinessModelClient(platform, { db: t.db, vault: null, mode: "mock", onUsage: (e) => void events.push(e) });
    await client.complete(ask(t.businessId));
    await client.complete(ask(undefined));
    expect(events.map((e) => e.billedTo)).toEqual(["credits", "credits"]);
    expect(await client.routeFor(t.businessId)).toEqual({ billedTo: "credits", source: "platform" });
    expect(await client.routeFor(undefined)).toEqual({ billedTo: "credits", source: "platform" });
  });

  it("in mock mode a business on its own key gets a mock client that books to byok; the route is cached for the ttl", async () => {
    let now = 1_000;
    const events: UsageEvent[] = [];
    const platform = createModelClient({ mode: "mock", onUsage: (e) => void events.push(e) });
    const client = createBusinessModelClient(platform, { db: t.db, vault: null, mode: "mock", onUsage: (e) => void events.push(e), ttlMs: 100, now: () => now });
    expect((await client.routeFor(t.businessId)).source).toBe("platform");
    await repos.businesses.update(t.db, t.businessId, { modelBilling: "byok" });
    // Still the cached verdict…
    expect((await client.routeFor(t.businessId)).source).toBe("platform");
    now += 101;
    // …then the business's own (mock) key.
    expect(await client.routeFor(t.businessId)).toEqual({ billedTo: "byok", source: "mock" });
    await client.complete(ask(t.businessId));
    expect(events.at(-1)?.billedTo).toBe("byok");
    const row = (await repos.usage.list(t.db, t.businessId, { limit: 5 })).items;
    expect(row).toHaveLength(0); // the harness sink is this test's array, not the ledger
    await repos.businesses.update(t.db, t.businessId, { modelBilling: "credits" });
    client.forget(t.businessId);
    expect((await client.routeFor(t.businessId)).source).toBe("platform");
  });

  it("in live mode a business on its own key is refused without a vault or a stored key, and runs on its key once stored", async () => {
    const vault = createVault({ DEV_MASTER_KEY: generateMasterKey(), APP_ENV: "test" });
    const built: { apiKey: string | null }[] = [];
    const events: UsageEvent[] = [];
    const platform = createModelClient({ mode: "mock", onUsage: (e) => void events.push(e) });
    const createClient = (opts: { apiKey: string | null }): ModelClient => {
      built.push({ apiKey: opts.apiKey });
      return createModelClient({ mode: "mock", billedTo: "byok", onUsage: (e) => void events.push(e) });
    };
    await repos.businesses.update(t.db, t.businessId, { modelBilling: "byok" });
    try {
      const noVault = createBusinessModelClient(platform, { db: t.db, vault: null, mode: "live", createClient, ttlMs: 0 });
      await expect(noVault.complete(ask(t.businessId))).rejects.toMatchObject({ apiErrorType: "missing_api_key" });
      await expect(noVault.complete(ask(t.businessId))).rejects.toBeInstanceOf(ModelRequestError);

      const client = createBusinessModelClient(platform, { db: t.db, vault, mode: "live", createClient, ttlMs: 0 });
      await expect(client.routeFor(t.businessId)).rejects.toMatchObject({ apiErrorType: "missing_api_key" });
      expect(built).toHaveLength(0);

      // Store a key the way apps/api keys.ts does.
      const integration = await repos.integrations.upsert(t.db, t.businessId, { connectorKey: "anthropic", status: "connected", authKind: "api_key", accountLabel: "sk-a***" });
      const payload = { kind: "api_key", secret: "sk-ant-own-key-1234" };
      const meta = await repos.credentials.store(t.db, t.businessId, { integrationId: integration.id, kind: BYOK_CREDENTIAL_KIND, record: await encryptJson(vault, payload, buildAad(t.businessId, "credentials", "pending")) });
      await repos.credentials.rotate(t.db, t.businessId, meta.id, await encryptJson(vault, payload, buildAad(t.businessId, "credentials", meta.id)));

      expect(await client.routeFor(t.businessId)).toEqual({ billedTo: "byok", source: "byok" });
      await client.complete(ask(t.businessId));
      await client.complete(ask(t.businessId));
      expect(built).toEqual([{ apiKey: "sk-ant-own-key-1234" }]); // one client per key
      expect(events.filter((e) => e.billedTo === "byok")).toHaveLength(2);
      expect(JSON.stringify(events)).not.toContain("sk-ant-own-key");

      // Revoked: refused again, never the platform key.
      await repos.credentials.revoke(t.db, t.businessId, meta.id);
      await repos.integrations.disconnect(t.db, t.businessId, integration.id);
      await expect(client.complete(ask(t.businessId))).rejects.toMatchObject({ apiErrorType: "missing_api_key" });
      await expect(platform.complete(ask(t.businessId))).resolves.toBeTruthy();
    } finally {
      await repos.businesses.update(t.db, t.businessId, { modelBilling: "credits" });
    }
  });

  it("a platform-key call for a business whose credits are used up is refused before it is made, as a non-retryable request error (SEC2 S2)", async () => {
    const events: UsageEvent[] = [];
    const platform = createModelClient({ mode: "mock", onUsage: (e) => void events.push(e) });
    const client = createBusinessModelClient(platform, { db: t.db, vault: null, mode: "mock", onUsage: (e) => void events.push(e), ttlMs: 0 });
    const period = periodOf(new Date());
    await repos.usage.chargeCredits(t.db, t.businessId, period, 10_000_000, { includedMinor: 500 });
    try {
      const refused = await client.complete(ask(t.businessId)).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(ModelRequestError);
      expect(refused).toMatchObject({ code: "request", status: 402, apiErrorType: "credits_exhausted", message: expect.stringMatching(/^The team is resting: this month's team budget is used/) });
      expect(events).toHaveLength(0);
      // A call with no business has nothing to charge; a business on its own key runs on its key, credits or not.
      await client.complete(ask(undefined));
      expect(events).toHaveLength(1);
      await repos.businesses.update(t.db, t.businessId, { modelBilling: "byok" });
      await client.complete(ask(t.businessId));
      expect(events.at(-1)?.billedTo).toBe("byok");
      // Back on credits it is refused again (streamed calls too); a top-up lifts the ceiling at once, nothing is cached.
      await repos.businesses.update(t.db, t.businessId, { modelBilling: "credits" });
      client.forget(t.businessId);
      await expect(client.streamStructured!(ask(t.businessId) as never)).rejects.toMatchObject({ status: 402, apiErrorType: "credits_exhausted" });
      await repos.usage.grantCredits(t.db, t.businessId, period, 10_000_100);
      await client.complete(ask(t.businessId));
      expect(events.at(-1)?.billedTo).toBe("credits");
    } finally {
      await repos.businesses.update(t.db, t.businessId, { modelBilling: "credits" });
      await repos.usage.grantCredits(t.db, t.businessId, period, 100_000);
    }
  });
});

describe("batches (WP-09 T8)", () => {
  it("run on the business's key end to end in mock mode, and a sink books a batch result once however often it is collected", async () => {
    const platform = createModelClient({ mode: "mock" });
    const client = createBusinessModelClient(platform, { db: t.db, vault: null, mode: "mock" });
    const items = [{ customId: "one", request: ask(t.businessId) }, { customId: "two", request: ask(t.businessId) }];
    const { batchId, count } = await submitBatch(client, items);
    expect(count).toBe(2);
    expect(await batchEnded(client, batchId, t.businessId)).toBe(true);
    const results = await collectBatch(client, batchId, items);
    expect(results.every((r) => r.ok)).toBe(true);

    const log = { debug() {}, info() {}, warn() {}, error() {} };
    const sink = usageSink(t.db, log as never);
    const before = (await repos.usage.list(t.db, t.businessId, { limit: 500 })).items.length;
    const event = { route: "classifier", model: "m", modelKey: "haiku", mode: "live", usage: { inputTokens: 10, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, cost: { costMinorInt: 0, costMicroMinor: 5, currency: "USD", label: "Estimate" }, attribution: { businessId: t.businessId, kind: "test" }, billedTo: "credits", occurredAt: new Date().toISOString(), attempt: 0, durationMs: 0, batch: { id: batchId, customId: "one" } } as unknown as UsageEvent;
    await sink(event);
    await sink(event);
    const after = (await repos.usage.list(t.db, t.businessId, { limit: 500 })).items;
    expect(after.length).toBe(before + 1);
    expect(after.find((u) => (u.details as { batch?: { customId?: string } }).batch?.customId === "one")).toBeTruthy();
  });
});

