/**
 * Portraits for anthropomorphic agents (services/personas.ts): `ensurePortraits` answers at once and generates the missing
 * faces in the background; a key in flight is not started twice, three images at most are made at a time, a failure is
 * logged and retried by a later call (never in a loop), a stored face is never made again, and mock mode draws the
 * placeholder here with no gateway while live mode asks the gateway with the key alone.
 */
import { repos } from "@foundmill/db";
import { PERSONAS } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiGatewayClient, GatewayPortrait } from "../services/gateway";
import { ensurePortraits, generatePortraitFor, PORTRAIT_CONCURRENCY, PORTRAIT_RETRY_MS, portraitsIdle, resetPortraitState, type PortraitDeps } from "../services/personas";
import { createApiHarness, type ApiHarness } from "./harness";

const WEBP_BYTES = Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", "latin1");
const IMAGE: GatewayPortrait = { mime: "image/webp", base64: WEBP_BYTES.toString("base64"), model: "test-image-model" };
const KEYS = PERSONAS.map((p) => p.key);

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "personas-service" });
}, 120_000);
afterAll(() => hz.close());

interface Call {
  key: string;
  businessId: string | undefined;
  release(image?: GatewayPortrait): void;
  fail(message: string): void;
}

/** A gateway whose portraits wait until the test releases them. */
function controlledGateway() {
  const calls: Call[] = [];
  let running = 0;
  let peak = 0;
  const gateway = {
    connect: async () => {
      throw new Error("unused");
    },
    health: async () => {
      throw new Error("unused");
    },
    createCheckout: async () => {
      throw new Error("unused");
    },
    checkDomains: async () => {
      throw new Error("unused");
    },
    generatePortrait: (key: string, businessId?: string) =>
      new Promise<GatewayPortrait>((resolve, reject) => {
        running += 1;
        peak = Math.max(peak, running);
        calls.push({
          key,
          businessId,
          release: (image = IMAGE) => {
            running -= 1;
            resolve(image);
          },
          fail: (message) => {
            running -= 1;
            reject(new Error(message));
          },
        });
      }),
  } satisfies ApiGatewayClient;
  return { gateway, calls, peak: () => peak };
}

const logs: { level: "info" | "warn"; obj: Record<string, unknown> }[] = [];
const log = { info: (obj: Record<string, unknown>) => void logs.push({ level: "info", obj }), warn: (obj: Record<string, unknown>) => void logs.push({ level: "warn", obj }) } as unknown as PortraitDeps["log"];

let clock = 1_000_000;
const depsWith = (gateway: ApiGatewayClient, env: PortraitDeps["env"] = { INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "" }): PortraitDeps => ({ db: hz.db, env, gateway, log, now: () => clock });
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(async () => {
  resetPortraitState();
  logs.length = 0;
  clock = 1_000_000;
  // The portraits table starts empty for every test (platform asset: no business scoping to respect).
  const { sql } = await import("drizzle-orm");
  await hz.db.execute(sql`delete from persona_portraits`);
});

describe("ensurePortraits", () => {
  it("answers at once with what is ready and pending, and never waits for the images", async () => {
    const { gateway, calls } = controlledGateway();
    const deps = depsWith(gateway);
    await repos.personaPortraits.put(hz.db, { key: KEYS[0]!, mime: "image/webp", content: WEBP_BYTES, model: "x" });
    const status = await ensurePortraits(deps, [KEYS[0], KEYS[1], KEYS[2], KEYS[1], null, "not-a-persona"]);
    expect(status).toEqual({ ready: [KEYS[0]], pending: [KEYS[1], KEYS[2]] });
    await tick();
    expect(calls.map((c) => c.key)).toEqual([KEYS[1], KEYS[2]]);
    // The request has returned while both images are still being made.
    calls.forEach((c) => c.release());
    await portraitsIdle();
    expect(await repos.personaPortraits.readyKeys(hz.db, [KEYS[0]!, KEYS[1]!, KEYS[2]!])).toEqual([KEYS[0], KEYS[1], KEYS[2]]);
  });

  it("stores the bytes, mime and model the gateway returned", async () => {
    const { gateway, calls } = controlledGateway();
    await ensurePortraits(depsWith(gateway), [KEYS[5]!]);
    await tick();
    calls[0]!.release();
    await portraitsIdle();
    const stored = await repos.personaPortraits.get(hz.db, KEYS[5]!);
    expect(stored).toMatchObject({ key: KEYS[5], mime: "image/webp", model: "test-image-model" });
    expect(Buffer.from(stored!.content).equals(WEBP_BYTES)).toBe(true);
    expect(logs.find((l) => l.level === "info")?.obj).toMatchObject({ personaKey: KEYS[5], model: "test-image-model" });
  });

  it("starts a key in flight once, however many calls ask for it", async () => {
    const { gateway, calls } = controlledGateway();
    const deps = depsWith(gateway);
    const results = await Promise.all([ensurePortraits(deps, [KEYS[7]!]), ensurePortraits(deps, [KEYS[7]!]), ensurePortraits(deps, [KEYS[7]!, KEYS[8]!])]);
    await ensurePortraits(deps, [KEYS[7]!]);
    await tick();
    expect(calls.map((c) => c.key).sort()).toEqual([KEYS[7], KEYS[8]].sort());
    for (const r of results) expect(r.ready).toEqual([]);
    calls.forEach((c) => c.release());
    await portraitsIdle();
  });

  it("makes at most three images at a time and the rest wait their turn", async () => {
    const { gateway, calls, peak } = controlledGateway();
    const batch = KEYS.slice(20, 28);
    await ensurePortraits(depsWith(gateway), batch);
    await tick();
    expect(PORTRAIT_CONCURRENCY).toBe(3);
    expect(calls).toHaveLength(3);
    calls[0]!.release();
    await tick();
    expect(calls).toHaveLength(4);
    // Drain the rest, releasing whatever is running until all eight are stored.
    for (let i = 1; i < 8; i++) {
      while (calls.length <= i) await tick();
      calls[i]!.release();
      await tick();
    }
    await portraitsIdle();
    expect(peak()).toBe(3);
    expect(calls.map((c) => c.key)).toEqual(batch);
    expect(await repos.personaPortraits.readyKeys(hz.db, batch)).toEqual(batch);
  });

  it("logs a failure without the prompt and retries on a later call, not in a loop", async () => {
    const { gateway, calls } = controlledGateway();
    const deps = depsWith(gateway);
    await ensurePortraits(deps, [KEYS[9]!]);
    await tick();
    calls[0]!.fail("The gateway did not answer");
    await portraitsIdle();
    expect(calls).toHaveLength(1);
    expect(logs.filter((l) => l.level === "warn")).toHaveLength(1);
    expect(logs[0]!.obj).toMatchObject({ personaKey: KEYS[9], err: "The gateway did not answer" });
    expect(JSON.stringify(logs)).not.toMatch(/headshot|base64/);

    // Asked again at once: the failure is still cooling down, so nothing starts and the key stays pending.
    expect(await ensurePortraits(deps, [KEYS[9]!])).toEqual({ ready: [], pending: [KEYS[9]] });
    await tick();
    expect(calls).toHaveLength(1);

    // Asked again after the window: tried once more, and this time it works.
    clock += PORTRAIT_RETRY_MS;
    await ensurePortraits(deps, [KEYS[9]!]);
    await tick();
    expect(calls).toHaveLength(2);
    calls[1]!.release();
    await portraitsIdle();
    expect(await ensurePortraits(deps, [KEYS[9]!])).toEqual({ ready: [KEYS[9]], pending: [] });
    expect(calls).toHaveLength(2);
  });

  it("never makes a stored face again, and skips a queued key another replica stored meanwhile", async () => {
    const { gateway, calls } = controlledGateway();
    const deps = depsWith(gateway);
    const batch = KEYS.slice(40, 45);
    await ensurePortraits(deps, batch);
    await tick();
    expect(calls).toHaveLength(3);
    // Another replica stores the fourth key while it waits in the queue.
    await repos.personaPortraits.put(hz.db, { key: batch[3]!, mime: "image/webp", content: WEBP_BYTES, model: "other-replica" });
    calls.forEach((c) => c.release());
    await tick();
    await tick();
    while (calls.length < 4) await tick();
    calls[3]!.release();
    await portraitsIdle();
    expect(calls.map((c) => c.key)).toEqual([batch[0], batch[1], batch[2], batch[4]]);
    expect((await repos.personaPortraits.get(hz.db, batch[3]!))?.model).toBe("other-replica");
  });

  it("passes the business to the gateway only to attribute its audit row, and sends no prompt", async () => {
    const { gateway, calls } = controlledGateway();
    await ensurePortraits(depsWith(gateway), [KEYS[50]!], { businessId: hz.A.businessId });
    await tick();
    expect(calls[0]).toMatchObject({ key: KEYS[50], businessId: hz.A.businessId });
    expect(Object.keys(calls[0]!).sort()).toEqual(["businessId", "fail", "key", "release"]);
    calls[0]!.release();
    await portraitsIdle();
  });
});

describe("mock mode", () => {
  it("draws the placeholder here, with no gateway, and stores it like any portrait", async () => {
    const { gateway, calls } = controlledGateway();
    const deps = depsWith(gateway, { INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "" });
    const status = await ensurePortraits(deps, [KEYS[60]!, KEYS[61]!]);
    expect(status.pending).toEqual([KEYS[60], KEYS[61]]);
    await portraitsIdle();
    expect(calls).toHaveLength(0);
    const stored = await repos.personaPortraits.get(hz.db, KEYS[60]!);
    expect(stored).toMatchObject({ mime: "image/png", model: "mock-portrait" });
    expect(Buffer.from(stored!.content).subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(await ensurePortraits(deps, [KEYS[60]!, KEYS[61]!])).toEqual({ ready: [KEYS[60], KEYS[61]], pending: [] });
  });

  it("LIVE_CONNECTORS=openai_images turns it live while everything else stays mock", async () => {
    const { gateway, calls } = controlledGateway();
    await ensurePortraits(depsWith(gateway, { INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "openai_images" }), [KEYS[62]!]);
    await tick();
    expect(calls.map((c) => c.key)).toEqual([KEYS[62]]);
    calls[0]!.release();
    await portraitsIdle();
    const other = controlledGateway();
    await ensurePortraits(depsWith(other.gateway, { INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "stripe" }), [KEYS[63]!]);
    await portraitsIdle();
    expect(other.calls).toHaveLength(0);
  });

  it("the placeholder is deterministic per key", async () => {
    const deps = depsWith(controlledGateway().gateway, { INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "" });
    const a = await generatePortraitFor(deps, KEYS[64]!);
    const b = await generatePortraitFor(deps, KEYS[64]!);
    const c = await generatePortraitFor(deps, KEYS[65]!);
    expect(b).toEqual(a);
    expect(c.base64).not.toEqual(a.base64);
    await expect(generatePortraitFor(deps, "not-a-persona")).rejects.toThrow(/catalog/);
  });
});
