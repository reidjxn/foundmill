/**
 * Portraits for anthropomorphic agents (services/personas.ts): `ensurePortraits` answers at once and generates the missing
 * faces in the background; a key in flight is not started twice, three images at most are made at a time, a failure is
 * logged and retried by a later call after an exponential backoff (one minute doubling to a day, shared through Redis
 * when there is one), a refusal for good is reported in `failed` and never retried, a stored face is never made again
 * (a mock placeholder is, once portraits are live), and mock mode draws the placeholder here with no gateway while live
 * mode asks the gateway with the key and the style alone. A character is one key in one style (0069): every state above
 * is per character, and the same key is one row per style.
 */
import { repos } from "@foundmill/db";
import { AGENT_STYLES, PERSONAS } from "@foundmill/shared";
import { OPENAI_IMAGES_GENERATION_TIMEOUT_MS } from "@foundmill/connectors";
import { AppError, type AgentStyle } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PORTRAIT_TIMEOUT_MS, type ApiGatewayClient, type GatewayPortrait } from "../services/gateway";
import {
  cachedPortraitCount,
  ensurePortraits,
  generatePortraitFor,
  invalidateStoredPortrait,
  isPermanentPortraitFailure,
  PORTRAIT_BACKOFF_BASE_MS,
  PORTRAIT_BACKOFF_MAX_MS,
  PORTRAIT_BACKOFF_REDIS_PREFIX,
  PORTRAIT_CONCURRENCY,
  portraitBackoffMs,
  portraitId,
  portraitsIdle,
  resetPortraitState,
  storedPortrait,
  type PortraitDeps,
  type PortraitRedis,
} from "../services/personas";
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
  style: string | undefined;
  release(image?: GatewayPortrait): void;
  fail(message: string | Error): void;
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
    generatePortrait: (key: string, businessId?: string, style?: AgentStyle) =>
      new Promise<GatewayPortrait>((resolve, reject) => {
        running += 1;
        peak = Math.max(peak, running);
        calls.push({
          key,
          businessId,
          style,
          release: (image = IMAGE) => {
            running -= 1;
            resolve(image);
          },
          fail: (message) => {
            running -= 1;
            reject(typeof message === "string" ? new Error(message) : message);
          },
        });
      }),
    repository: async () => {
      throw new Error("unused");
    },
    sendPush: async () => {
      throw new Error("unused");
    },
    validateKey: async () => {
      throw new Error("unused");
    },
    registryLookup: async () => {
      throw new Error("unused");
    },
    confirmFollow: async () => {
      throw new Error("unused");
    },
  } satisfies ApiGatewayClient;
  return { gateway, calls, peak: () => peak };
}

const logs: { level: "info" | "warn" | "error"; obj: Record<string, unknown> }[] = [];
const log = {
  info: (obj: Record<string, unknown>) => void logs.push({ level: "info", obj }),
  warn: (obj: Record<string, unknown>) => void logs.push({ level: "warn", obj }),
  error: (obj: Record<string, unknown>) => void logs.push({ level: "error", obj }),
} as unknown as PortraitDeps["log"];

let clock = 1_000_000;
const depsWith = (gateway: ApiGatewayClient, env: PortraitDeps["env"] = { INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "" }, redis: PortraitRedis | null = null): PortraitDeps => ({ db: hz.db, env, gateway, log, now: () => clock, redis });

/** A Redis double with the three commands the shared backoff uses (PX expiry on the test clock). */
function fakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  let down = false;
  const check = () => {
    if (down) throw new Error("Connection is closed.");
  };
  const redis: PortraitRedis = {
    get: async (key) => {
      check();
      const hit = store.get(key);
      return hit && hit.expiresAt > clock ? hit.value : null;
    },
    set: async (key, value, _px, ms) => {
      check();
      store.set(key, { value, expiresAt: clock + ms });
      return "OK";
    },
    del: async (key) => {
      check();
      return store.delete(key) ? 1 : 0;
    },
  };
  return { redis, store, setDown: (v: boolean) => void (down = v) };
}
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
    expect(status).toEqual({ ready: [KEYS[0]], pending: [KEYS[1], KEYS[2]], failed: [] });
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
    expect(logs[0]!.obj).toMatchObject({ personaKey: KEYS[9], err: "The gateway did not answer", attempts: 1, retryInSeconds: 60 });
    expect(JSON.stringify(logs)).not.toMatch(/headshot|base64/);

    // Asked again at once: the failure is still cooling down, so nothing starts and the key stays pending.
    expect(await ensurePortraits(deps, [KEYS[9]!])).toEqual({ ready: [], pending: [KEYS[9]], failed: [] });
    await tick();
    expect(calls).toHaveLength(1);

    // Asked again after the window: tried once more, and this time it works.
    clock += PORTRAIT_BACKOFF_BASE_MS;
    await ensurePortraits(deps, [KEYS[9]!]);
    await tick();
    expect(calls).toHaveLength(2);
    calls[1]!.release();
    await portraitsIdle();
    expect(await ensurePortraits(deps, [KEYS[9]!])).toEqual({ ready: [KEYS[9]], pending: [], failed: [] });
    expect(calls).toHaveLength(2);
  });

  it("backs off exponentially: one minute, doubling each failure in a row, up to a day", async () => {
    expect([1, 2, 3, 4, 10, 11, 12, 50].map(portraitBackoffMs)).toEqual([60_000, 120_000, 240_000, 480_000, 30_720_000, 61_440_000, PORTRAIT_BACKOFF_MAX_MS, PORTRAIT_BACKOFF_MAX_MS]);
    expect(PORTRAIT_BACKOFF_MAX_MS).toBe(24 * 60 * 60_000);
    const { gateway, calls } = controlledGateway();
    const deps = depsWith(gateway);
    const key = KEYS[10]!;
    const ask = async () => {
      await ensurePortraits(deps, [key]);
      await tick();
    };
    await ask();
    calls[0]!.fail("The gateway did not answer");
    await portraitsIdle();
    for (const [i, wait] of [[1, 60_000], [2, 120_000], [3, 240_000]] as const) {
      // Just short of the window: nothing starts.
      clock += wait - 1;
      await ask();
      expect(calls, `before ${wait}`).toHaveLength(i);
      clock += 1;
      await ask();
      expect(calls, `after ${wait}`).toHaveLength(i + 1);
      calls[i]!.fail("The gateway did not answer");
      await portraitsIdle();
    }
    expect(logs.filter((l) => l.level === "warn").map((l) => l.obj.retryInSeconds)).toEqual([60, 120, 240, 480]);
    // A success clears the record.
    clock += 480_000;
    await ask();
    calls[4]!.release();
    await portraitsIdle();
    expect(await ensurePortraits(deps, [key])).toEqual({ ready: [key], pending: [], failed: [] });
    expect(calls).toHaveLength(5);
  });

  it("shares the backoff through Redis, so another replica waits out the same window", async () => {
    const { redis, store, setDown } = fakeRedis();
    const one = controlledGateway();
    const key = KEYS[11]!;
    await ensurePortraits(depsWith(one.gateway, undefined, redis), [key]);
    await tick();
    one.calls[0]!.fail("The gateway did not answer");
    await portraitsIdle();
    expect(JSON.parse(store.get(PORTRAIT_BACKOFF_REDIS_PREFIX + portraitId("humans", key))!.value)).toEqual({ attempts: 1, nextTryAt: clock + 60_000 });

    // Another replica: its own process state is empty, Redis still says wait.
    resetPortraitState();
    const two = controlledGateway();
    expect(await ensurePortraits(depsWith(two.gateway, undefined, redis), [key])).toEqual({ ready: [], pending: [key], failed: [] });
    await tick();
    expect(two.calls).toHaveLength(0);

    // After the window it tries; a second failure doubles the shared window.
    clock += 60_000;
    await ensurePortraits(depsWith(two.gateway, undefined, redis), [key]);
    await tick();
    two.calls[0]!.fail("The gateway did not answer");
    await portraitsIdle();
    expect(JSON.parse(store.get(PORTRAIT_BACKOFF_REDIS_PREFIX + portraitId("humans", key))!.value)).toEqual({ attempts: 2, nextTryAt: clock + 120_000 });

    // A Redis that does not answer falls back to this process's record: still no retry storm.
    setDown(true);
    await ensurePortraits(depsWith(two.gateway, undefined, redis), [key]);
    await tick();
    expect(two.calls).toHaveLength(1);
    setDown(false);

    // A success clears the shared record.
    clock += 120_000;
    await ensurePortraits(depsWith(two.gateway, undefined, redis), [key]);
    await tick();
    two.calls[1]!.release();
    await portraitsIdle();
    expect(store.has(PORTRAIT_BACKOFF_REDIS_PREFIX + portraitId("humans", key))).toBe(false);
  });

  it("a refusal for good (a non-429 4xx from the gateway) is reported in failed and never tried again", async () => {
    const { gateway, calls } = controlledGateway();
    const deps = depsWith(gateway);
    const [refused, unknown, ok] = [KEYS[12]!, KEYS[13]!, KEYS[14]!];
    expect(await ensurePortraits(deps, [refused, unknown, ok])).toEqual({ ready: [], pending: [refused, unknown, ok], failed: [] });
    await tick();
    calls[0]!.fail(new AppError("portrait_refused", "The image service refused to make this portrait.", 422));
    calls[1]!.fail(new AppError("unknown_persona", "That is not a persona in the catalog", 400));
    calls[2]!.release();
    await portraitsIdle();
    const errors = logs.filter((l) => l.level === "error").map((l) => l.obj);
    expect(errors).toEqual([expect.objectContaining({ personaKey: refused, code: "portrait_refused", status: 422 }), expect.objectContaining({ personaKey: unknown, code: "unknown_persona", status: 400 })]);

    // Whenever asked, even a day later: failed, not pending, and nothing starts.
    clock += PORTRAIT_BACKOFF_MAX_MS * 2;
    expect(await ensurePortraits(deps, [refused, unknown, ok])).toEqual({ ready: [ok], pending: [], failed: [refused, unknown] });
    await tick();
    expect(calls).toHaveLength(3);
  });

  it("only a 4xx about the key itself is permanent: tokens, timeouts, setup and rate limits are retried", () => {
    for (const status of [400, 404, 413, 422]) expect(isPermanentPortraitFailure(new AppError("x", "x", status)), String(status)).toBe(true);
    for (const status of [401, 403, 408, 409, 412, 425, 429, 500, 502, 503]) expect(isPermanentPortraitFailure(new AppError("x", "x", status)), String(status)).toBe(false);
    expect(isPermanentPortraitFailure(new Error("The gateway did not answer"))).toBe(false);
  });

  it("live, a stored mock placeholder counts as missing and is replaced by the real face", async () => {
    const { gateway, calls } = controlledGateway();
    const key = KEYS[15]!;
    await repos.personaPortraits.put(hz.db, { key, mime: "image/png", content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), model: "mock-portrait" });
    // Mock mode keeps it as it is.
    const mock = depsWith(gateway, { INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "" });
    expect(await ensurePortraits(mock, [key])).toEqual({ ready: [key], pending: [], failed: [] });
    // Live mode makes the real one and replaces the row (put is an upsert).
    const live = depsWith(gateway);
    expect(await ensurePortraits(live, [key])).toEqual({ ready: [], pending: [key], failed: [] });
    await tick();
    expect(calls.map((c) => c.key)).toEqual([key]);
    calls[0]!.release();
    await portraitsIdle();
    expect(await repos.personaPortraits.get(hz.db, key)).toMatchObject({ mime: "image/webp", model: "test-image-model" });
    expect(await ensurePortraits(live, [key])).toEqual({ ready: [key], pending: [], failed: [] });
  });

  it("waits for the gateway longer than the connector waits for OpenAI", () => {
    expect(OPENAI_IMAGES_GENERATION_TIMEOUT_MS).toBe(120_000);
    expect(PORTRAIT_TIMEOUT_MS).toBe(150_000);
    expect(PORTRAIT_TIMEOUT_MS).toBeGreaterThan(OPENAI_IMAGES_GENERATION_TIMEOUT_MS);
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
    expect(calls[0]).toMatchObject({ key: KEYS[50], businessId: hz.A.businessId, style: "humans" });
    expect(Object.keys(calls[0]!).sort()).toEqual(["businessId", "fail", "key", "release", "style"]);
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
    expect(await ensurePortraits(deps, [KEYS[60]!, KEYS[61]!])).toEqual({ ready: [KEYS[60], KEYS[61]], pending: [], failed: [] });
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

describe("character styles (0069): one key, one portrait per style", () => {
  it("ensure answers per style: a face stored as a human is not ready as a fantasy character, and each style is made once", async () => {
    const { gateway, calls } = controlledGateway();
    const deps = depsWith(gateway);
    const key = KEYS[70]!;
    await repos.personaPortraits.put(hz.db, { key, mime: "image/webp", content: WEBP_BYTES, model: "x" });
    expect(await ensurePortraits(deps, [key])).toEqual({ ready: [key], pending: [], failed: [] });
    expect(await ensurePortraits(deps, [key], { style: "humans" })).toEqual({ ready: [key], pending: [], failed: [] });
    expect(await ensurePortraits(deps, [key], { style: "fantasy" })).toEqual({ ready: [], pending: [key], failed: [] });
    expect(await ensurePortraits(deps, [key], { style: "cartoon_2d" })).toEqual({ ready: [], pending: [key], failed: [] });
    // Asked again before they finish: the same character is not started twice, but the two styles are two jobs.
    expect(await ensurePortraits(deps, [key], { style: "fantasy" })).toEqual({ ready: [], pending: [key], failed: [] });
    await tick();
    expect(calls.map((c) => [c.key, c.style])).toEqual([
      [key, "fantasy"],
      [key, "cartoon_2d"],
    ]);
    calls.forEach((c) => c.release());
    await portraitsIdle();
    expect(await repos.personaPortraits.get(hz.db, key, "fantasy")).toMatchObject({ style: "fantasy", model: "test-image-model" });
    expect(await repos.personaPortraits.get(hz.db, key, "cartoon_2d")).toMatchObject({ style: "cartoon_2d" });
    expect(await repos.personaPortraits.get(hz.db, key, "cartoon_3d")).toBeNull();
    expect(await ensurePortraits(deps, [key], { style: "fantasy" })).toEqual({ ready: [key], pending: [], failed: [] });
    expect(await ensurePortraits(deps, [key], { style: "cartoon_3d" })).toEqual({ ready: [], pending: [key], failed: [] });
    await tick();
    calls[2]!.release();
    await portraitsIdle();
    expect(logs.filter((l) => l.level === "info").map((l) => l.obj.style)).toEqual(["fantasy", "cartoon_2d", "cartoon_3d"]);
  });

  it("a failure, a backoff and a permanent refusal are the character's, not the key's", async () => {
    const { redis, store } = fakeRedis();
    const { gateway, calls } = controlledGateway();
    const deps = depsWith(gateway, undefined, redis);
    const key = KEYS[71]!;
    await ensurePortraits(deps, [key], { style: "fantasy" });
    await ensurePortraits(deps, [key], { style: "cartoon_2d" });
    await ensurePortraits(deps, [key]);
    await tick();
    expect(calls.map((c) => c.style)).toEqual(["fantasy", "cartoon_2d", "humans"]);
    calls[0]!.fail("The gateway did not answer");
    calls[1]!.fail(new AppError("portrait_refused", "The image service refused to make this portrait.", 422));
    calls[2]!.release();
    await portraitsIdle();
    expect(store.has(PORTRAIT_BACKOFF_REDIS_PREFIX + portraitId("fantasy", key))).toBe(true);
    expect(store.has(PORTRAIT_BACKOFF_REDIS_PREFIX + portraitId("humans", key))).toBe(false);
    expect(store.has(PORTRAIT_BACKOFF_REDIS_PREFIX + portraitId("cartoon_2d", key))).toBe(false);
    expect(logs.find((l) => l.level === "warn")?.obj).toMatchObject({ personaKey: key, style: "fantasy", attempts: 1 });
    expect(logs.find((l) => l.level === "error")?.obj).toMatchObject({ personaKey: key, style: "cartoon_2d", code: "portrait_refused" });
    // Humans is ready; fantasy waits out its window; 2D is failed for good; 3D was never asked and starts at once.
    expect(await ensurePortraits(deps, [key])).toEqual({ ready: [key], pending: [], failed: [] });
    expect(await ensurePortraits(deps, [key], { style: "fantasy" })).toEqual({ ready: [], pending: [key], failed: [] });
    expect(await ensurePortraits(deps, [key], { style: "cartoon_2d" })).toEqual({ ready: [], pending: [], failed: [key] });
    expect(await ensurePortraits(deps, [key], { style: "cartoon_3d" })).toEqual({ ready: [], pending: [key], failed: [] });
    await tick();
    expect(calls).toHaveLength(4);
    expect(calls[3]!.style).toBe("cartoon_3d");
    calls[3]!.release();
    await portraitsIdle();
    clock += PORTRAIT_BACKOFF_BASE_MS;
    await ensurePortraits(deps, [key], { style: "fantasy" });
    await tick();
    expect(calls).toHaveLength(5);
    expect(calls[4]!.style).toBe("fantasy");
    calls[4]!.release();
    await portraitsIdle();
  });

  it("live, a stored placeholder in one style is replaced without touching the other styles", async () => {
    const { gateway, calls } = controlledGateway();
    const key = KEYS[72]!;
    await repos.personaPortraits.put(hz.db, { key, style: "fantasy", mime: "image/png", content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), model: "mock-portrait" });
    await repos.personaPortraits.put(hz.db, { key, style: "humans", mime: "image/webp", content: WEBP_BYTES, model: "real" });
    const live = depsWith(gateway);
    expect(await ensurePortraits(live, [key])).toEqual({ ready: [key], pending: [], failed: [] });
    expect(await ensurePortraits(live, [key], { style: "fantasy" })).toEqual({ ready: [], pending: [key], failed: [] });
    await tick();
    expect(calls.map((c) => [c.key, c.style])).toEqual([[key, "fantasy"]]);
    calls[0]!.release();
    await portraitsIdle();
    expect(await repos.personaPortraits.get(hz.db, key, "fantasy")).toMatchObject({ mime: "image/webp", model: "test-image-model" });
    expect(await repos.personaPortraits.get(hz.db, key, "humans")).toMatchObject({ model: "real" });
  });

  it("mock mode draws a placeholder for every style, and the bytes differ per style because the prompt does", async () => {
    const deps = depsWith(controlledGateway().gateway, { INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "" });
    const key = KEYS[73]!;
    const faces = await Promise.all(AGENT_STYLES.map((style) => generatePortraitFor(deps, key, undefined, style)));
    for (const face of faces) {
      expect(face).toMatchObject({ mime: "image/png", model: "mock-portrait" });
      expect(Buffer.from(face.base64, "base64").subarray(1, 4).toString("ascii")).toBe("PNG");
    }
    expect(new Set(faces.map((f) => f.base64)).size).toBe(AGENT_STYLES.length);
    expect((await generatePortraitFor(deps, key)).base64).toBe(faces[0]!.base64);
    // Through ensure: one row per style, all placeholders, no gateway.
    for (const style of AGENT_STYLES) expect((await ensurePortraits(deps, [key], { style })).pending).toEqual([key]);
    await portraitsIdle();
    for (const style of AGENT_STYLES) expect(await ensurePortraits(deps, [key], { style })).toEqual({ ready: [key], pending: [], failed: [] });
  });

  it("the serving cache is per character: the human face never answers for the fantasy one", async () => {
    const key = KEYS[74]!;
    const human = new Uint8Array(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 human", "latin1"));
    const elf = new Uint8Array(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 elf", "latin1"));
    await repos.personaPortraits.put(hz.db, { key, mime: "image/webp", content: human, model: "x" });
    expect(await storedPortrait(hz.db, key, { style: "fantasy" })).toBeNull();
    expect(Buffer.from((await storedPortrait(hz.db, key))!.bytes).equals(human)).toBe(true);
    await repos.personaPortraits.put(hz.db, { key, style: "fantasy", mime: "image/webp", content: elf, model: "x" });
    const served = await storedPortrait(hz.db, key, { style: "fantasy" });
    expect(Buffer.from(served!.bytes).equals(elf)).toBe(true);
    expect(served!.etag).not.toBe((await storedPortrait(hz.db, key, { style: "humans" }))!.etag);
    expect(cachedPortraitCount()).toBe(2);
    invalidateStoredPortrait(key, "fantasy");
    expect(cachedPortraitCount()).toBe(1);
    expect(portraitId("fantasy", key)).toBe(`fantasy:${key}`);
  });
});
