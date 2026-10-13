/** Nonce stores (memory TTL/eviction, Redis SET NX PX with memory fallback) and delivery identification per vendor. */
import { describe, expect, it } from "vitest";
import type { Env } from "@foundmill/shared";
import { createNonceStore } from "../index";
import { MemoryNonceStore, nonceKey, RedisNonceStore, type RedisNonceClient } from "../nonce-store";
import type { IngestLogger } from "../types";
import { identifyDelivery, splitConnectorSegment, stripeSignatureTimestamp, withinReplayWindow } from "../replay";

describe("MemoryNonceStore", () => {
  it("claims once, probes without recording, expires after the TTL and releases on demand", async () => {
    let now = 1_000;
    const store = new MemoryNonceStore({ now: () => now });
    expect(await store.has("a")).toBe(false);
    expect(store.size).toBe(0);
    expect(await store.claim("a", 500)).toBe(true);
    expect(await store.claim("a", 500)).toBe(false);
    expect(await store.has("a")).toBe(true);
    now += 499;
    expect(await store.has("a")).toBe(true);
    now += 2;
    expect(await store.has("a")).toBe(false);
    expect(await store.claim("a", 500)).toBe(true);
    await store.release("a");
    expect(await store.has("a")).toBe(false);
  });

  it("evicts the oldest entries past its bound", async () => {
    const store = new MemoryNonceStore({ max: 3, now: () => 0 });
    for (const k of ["1", "2", "3", "4"]) await store.claim(k, 10_000);
    expect(store.size).toBe(3);
    expect(await store.has("1")).toBe(false);
    expect(await store.has("4")).toBe(true);
  });
});

class FakeRedis implements RedisNonceClient {
  readonly keys = new Map<string, number>();
  failing = false;
  constructor(private readonly now: () => number) {}
  private check() {
    if (this.failing) throw new Error("ECONNREFUSED");
  }
  async set(key: string, _value: string, _px: "PX", ms: number, _nx: "NX"): Promise<"OK" | null> {
    this.check();
    const exp = this.keys.get(key);
    if (exp !== undefined && exp > this.now()) return null;
    this.keys.set(key, this.now() + ms);
    return "OK";
  }
  async exists(...keys: string[]): Promise<number> {
    this.check();
    return keys.filter((k) => (this.keys.get(k) ?? 0) > this.now()).length;
  }
  async del(...keys: string[]): Promise<number> {
    this.check();
    let n = 0;
    for (const k of keys) if (this.keys.delete(k)) n++;
    return n;
  }
}

describe("RedisNonceStore", () => {
  it("uses SET NX PX under a prefix and answers probes from Redis", async () => {
    let now = 0;
    const redis = new FakeRedis(() => now);
    const store = new RedisNonceStore(redis, { prefix: "t:" });
    expect(await store.claim("stripe:evt_1", 1000)).toBe(true);
    expect(redis.keys.has("t:stripe:evt_1")).toBe(true);
    expect(await store.claim("stripe:evt_1", 1000)).toBe(false);
    expect(await store.has("stripe:evt_1")).toBe(true);
    now = 1001;
    expect(await store.has("stripe:evt_1")).toBe(false);
    expect(await store.claim("stripe:evt_1", 1000)).toBe(true);
    await store.release("stripe:evt_1");
    expect(await store.has("stripe:evt_1")).toBe(false);
    expect(store.isDegraded).toBe(false);
  });

  it("falls back to memory on the first Redis error and says so once", async () => {
    const redis = new FakeRedis(() => 0);
    const fallbacks: unknown[] = [];
    const store = new RedisNonceStore(redis, { onFallback: (e) => fallbacks.push(e) });
    redis.failing = true;
    expect(await store.claim("k", 1000)).toBe(true);
    expect(store.isDegraded).toBe(true);
    expect(await store.claim("k", 1000)).toBe(false);
    expect(await store.has("k")).toBe(true);
    await store.release("k");
    expect(await store.has("k")).toBe(false);
    expect(fallbacks).toHaveLength(1);
    expect(store.kind).toBe("redis");
  });

  it("goes back to Redis after the cooldown (the first delivery after boot used to latch memory for good)", async () => {
    let now = 0;
    const redis = new FakeRedis(() => now);
    const recovered: number[] = [];
    const store = new RedisNonceStore(redis, { now: () => now, retryAfterMs: 30_000, onRecover: () => recovered.push(now) });
    redis.failing = true;
    expect(await store.has("github:d1")).toBe(false);
    expect(store.inUse).toBe("memory");
    redis.failing = false;
    // Within the cooldown Redis is not asked: a claim lands in memory and is still honoured afterwards.
    now = 10_000;
    expect(await store.claim("github:d1", 300_000)).toBe(true);
    expect(redis.keys.size).toBe(0);
    now = 31_000;
    expect(await store.has("github:d1")).toBe(true);
    expect(store.inUse).toBe("redis");
    expect(recovered).toEqual([31_000]);
    expect(await store.claim("github:d2", 300_000)).toBe(true);
    expect(redis.keys.has("ingest:nonce:github:d2")).toBe(true);
  });
});

describe("createNonceStore", () => {
  const env = (APP_ENV: "staging" | "development") => ({ APP_ENV, REDIS_URL: "redis://redis.railway.internal:6379" }) as Env;
  const log = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as IngestLogger;

  it("connects Redis before the first delivery in staging and production", async () => {
    const connected: string[] = [];
    const store = await createNonceStore(env("staging"), log, async (url) => (connected.push(url), new FakeRedis(() => 0)));
    expect(connected).toEqual(["redis://redis.railway.internal:6379"]);
    expect(store).toMatchObject({ kind: "redis", inUse: "redis" });
    expect(await store.claim("stripe:evt_1", 1000)).toBe(true);
  });

  it("keeps memory in development", async () => {
    expect((await createNonceStore(env("development"), log, async () => new FakeRedis(() => 0))).kind).toBe("memory");
  });

  it("can load ioredis: it is a declared dependency of the app", async () => {
    const mod = await import("ioredis");
    expect(typeof mod.Redis).toBe("function");
  });
});

describe("identifyDelivery", () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it("Stripe: account + event id from the body, timestamp from the signature header", () => {
    const body = JSON.stringify({ id: "evt_1", account: "acct_9", created: 1_700_000_000, type: "invoice.paid" });
    const id = identifyDelivery("stripe", headers({ "stripe-signature": "t=1700000100,v1=abc" }), body);
    expect(id).toEqual({ deliveryId: "acct_9:evt_1", idSource: "body", timestampSeconds: 1_700_000_100 });
    const platform = identifyDelivery("stripe", headers({}), JSON.stringify({ id: "evt_2", created: 5 }));
    expect(platform).toEqual({ deliveryId: "platform:evt_2", idSource: "body", timestampSeconds: 5 });
    expect(stripeSignatureTimestamp("v1=abc")).toBeNull();
  });

  it("GitHub: X-GitHub-Delivery; Shopify: X-Shopify-Webhook-Id + triggered-at; SendGrid: the signature + timestamp", () => {
    expect(identifyDelivery("github", headers({ "x-github-delivery": "d-1" }), "{}")).toEqual({ deliveryId: "d-1", idSource: "header", timestampSeconds: null });
    expect(identifyDelivery("shopify", headers({ "x-shopify-webhook-id": "w-1", "x-shopify-triggered-at": "2026-10-05T09:00:00Z" }), "{}")).toMatchObject({ deliveryId: "w-1", idSource: "header", timestampSeconds: Math.floor(Date.parse("2026-10-05T09:00:00Z") / 1000) });
    const sg = identifyDelivery("sendgrid", headers({ "x-twilio-email-event-webhook-signature": "MEUCIQ==", "x-twilio-email-event-webhook-timestamp": "1700000000" }), "[]");
    expect(sg.idSource).toBe("signature");
    expect(sg.timestampSeconds).toBe(1_700_000_000);
  });

  it("Dropbox Sign reads event_hash/event_time from the form JSON; unknown vendors hash the body", () => {
    const body = 'json={"event":{"event_hash":"h-1","event_time":"1700000000"}}';
    expect(identifyDelivery("dropbox_sign", headers({}), body)).toEqual({ deliveryId: "h-1", idSource: "body", timestampSeconds: 1_700_000_000 });
    const a = identifyDelivery("somevendor", headers({}), "payload-a");
    const b = identifyDelivery("somevendor", headers({}), "payload-a");
    const c = identifyDelivery("somevendor", headers({}), "payload-b");
    expect(a.idSource).toBe("body-hash");
    expect(a.deliveryId).toBe(b.deliveryId);
    expect(a.deliveryId).not.toBe(c.deliveryId);
  });

  it("replay window and route segments", () => {
    const nowMs = 1_700_000_000_000;
    expect(withinReplayWindow(null, nowMs, 300)).toBe(true);
    expect(withinReplayWindow(1_700_000_000 - 300, nowMs, 300)).toBe(true);
    expect(withinReplayWindow(1_700_000_000 - 301, nowMs, 300)).toBe(false);
    expect(withinReplayWindow(1_700_000_000 + 301, nowMs, 300)).toBe(false);
    expect(withinReplayWindow(Number.NaN, nowMs, 300)).toBe(false);
    expect(splitConnectorSegment("sendgrid-inbound")).toEqual({ connector: "sendgrid", suffix: "inbound" });
    expect(splitConnectorSegment("dropbox_sign")).toEqual({ connector: "dropbox_sign", suffix: null });
    expect(nonceKey("stripe", "acct:evt")).toBe("stripe:acct:evt");
  });
});
