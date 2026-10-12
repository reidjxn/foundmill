/**
 * `createBusinessModelClient` (BUILD §10.2 step 3, §10.4): a business on credits runs on the platform client; a business on
 * its own key runs on a client built from that key (decrypted here, cached per key, re-read after the ttl) and books to
 * `byok`; in live mode a business on its own key with no readable key is refused rather than run on the platform's
 * credits; under MODEL_MODE=mock it gets a mock client that books to `byok`. A business on credits whose month is used
 * up is refused on the platform client before the call is sent.
 */
import { includedCreditsMinor } from "@foundmill/config";
import { BYOK_CREDENTIAL_KIND, periodOf, repos } from "@foundmill/db";
import { createModelClient, ModelRequestError, type ModelClient, type UsageEvent } from "@foundmill/models";
import { CreditsExhaustedError } from "@foundmill/shared";
import { buildAad, createVault, encryptJson, generateMasterKey } from "@foundmill/shared/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  it("a business on credits whose month is used up is refused on the platform client before the call is sent", async () => {
    const events: UsageEvent[] = [];
    const platform = createModelClient({ mode: "mock", onUsage: (e) => void events.push(e) });
    const client = createBusinessModelClient(platform, { db: t.db, vault: null, mode: "mock", onUsage: (e) => void events.push(e) });
    const period = periodOf(new Date());
    const { balance } = await repos.usage.ensurePeriodCredits(t.db, t.businessId, period, includedCreditsMinor("free"));
    await repos.usage.chargeCredits(t.db, t.businessId, period, Number(balance.balanceMinor));
    try {
      const refused = await client.complete(ask(t.businessId)).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(CreditsExhaustedError);
      expect(refused).toMatchObject({ code: "credits_exhausted", details: { tier: "free", period, balanceMinor: 0, currency: "USD" } });
      await expect(client.streamStructured!(ask(t.businessId) as never)).rejects.toBeInstanceOf(CreditsExhaustedError);
      expect(events).toHaveLength(0);
      // A call for no business is not the business's to pay for.
      await client.complete(ask(undefined));
      expect(events).toHaveLength(1);
      // On its own key the business never touches credits, so its calls run.
      await repos.businesses.update(t.db, t.businessId, { modelBilling: "byok" });
      client.forget(t.businessId);
      await client.complete(ask(t.businessId));
      expect(events.at(-1)?.billedTo).toBe("byok");
      await repos.businesses.update(t.db, t.businessId, { modelBilling: "credits" });
      client.forget(t.businessId);
      await expect(client.complete(ask(t.businessId))).rejects.toBeInstanceOf(CreditsExhaustedError);
      // A top-up lifts the ceiling at once: the verdict is never cached with the route.
      await repos.usage.grantCredits(t.db, t.businessId, period, 100);
      await client.complete(ask(t.businessId));
      expect(events.at(-1)?.billedTo).toBe("credits");
    } finally {
      await repos.businesses.update(t.db, t.businessId, { modelBilling: "credits" });
      await repos.usage.grantCredits(t.db, t.businessId, period, includedCreditsMinor("free"));
    }
  });
});
