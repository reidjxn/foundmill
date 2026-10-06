import { describe, expect, it } from "vitest";
import { serializeEvent, type PlatformEvent } from "../catalogue";
import { consume, decodePlatformEntry, type EntryMeta } from "../consume";
import { businessStreamKey, deadLetterKey } from "../keys";
import { createMemoryRedisWithClock, MemoryRedis } from "../testing/memory-redis";
import { FIXTURE_BUSINESS_ID, fixtureEvent, fixtureId } from "../testing/fixtures";

const STREAM = businessStreamKey(FIXTURE_BUSINESS_ID);

async function publish(redis: MemoryRedis, event: PlatformEvent, stream = STREAM): Promise<string> {
  return (await redis.xadd(
    stream,
    "*",
    "id",
    event.id,
    "type",
    event.type,
    "json",
    serializeEvent(event),
  ))!;
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("consume", () => {
  it("creates the group, delivers events in order, acks them and leaves nothing pending", async () => {
    const redis = new MemoryRedis();
    const e1 = fixtureEvent("signup.created", { id: fixtureId("e1") });
    const e2 = fixtureEvent("payment.received", { id: fixtureId("e2") });
    await publish(redis, e1);

    const seen: { event: PlatformEvent; meta: EntryMeta }[] = [];
    const consumer = consume(redis, {
      businessId: FIXTURE_BUSINESS_ID,
      group: "composer",
      consumer: "c1",
      blockMs: 20,
      handler: (event, meta) => {
        seen.push({ event, meta });
      },
    });
    await waitFor(() => seen.length === 1);
    await publish(redis, e2); // arrives while blocked
    await waitFor(() => seen.length === 2);

    expect(seen.map((s) => s.event)).toEqual([e1, e2]);
    expect(seen[0]!.meta).toMatchObject({
      stream: STREAM,
      group: "composer",
      consumer: "c1",
      deliveries: 1,
    });
    expect(seen[0]!.meta.fields.type).toBe("signup.created");
    expect(redis.pendingOf(STREAM, "composer")).toEqual([]);
    expect(consumer.streams()).toEqual([STREAM]);

    await consumer.stop();
    expect(consumer.running).toBe(false);
  });

  it("uses a dedicated blocking connection and closes it on stop", async () => {
    const redis = new MemoryRedis();
    let dup: MemoryRedis | null = null;
    const original = redis.duplicate.bind(redis);
    redis.duplicate = () => (dup = original());
    const consumer = consume(redis, {
      stream: STREAM,
      group: "g",
      consumer: "c",
      blockMs: 10,
      handler: () => {},
    });
    await consumer.runOnce();
    expect(dup).not.toBeNull();
    await consumer.stop();
    await expect(dup!.xlen(STREAM)).rejects.toThrow(/closed/);
    await expect(redis.xlen(STREAM)).resolves.toBe(0); // the shared connection stays open
  });

  it("retries a failing handler and dead-letters after maxRetries, acking the original", async () => {
    const { redis, clock } = createMemoryRedisWithClock();
    const bad = fixtureEvent("cycle.started", { id: fixtureId("bad") });
    const good = fixtureEvent("cycle.completed", { id: fixtureId("good") });
    await publish(redis, bad);
    await publish(redis, good);

    const attempts: Record<string, number[]> = {};
    const dead: { id: string; deliveries: number }[] = [];
    const consumer = consume(redis, {
      stream: STREAM,
      group: "journey",
      consumer: "j1",
      maxRetries: 3,
      retryDelayMs: 100,
      blockMs: 10,
      handler: (event, meta) => {
        (attempts[event.id] ??= []).push(meta.deliveries);
        if (event.id === bad.id) throw new Error(`boom ${meta.deliveries}`);
      },
      onError: () => {},
      onDeadLetter: (entry, _err, deliveries) => dead.push({ id: entry.fields.id!, deliveries }),
    });

    await waitFor(() => attempts[good.id]?.length === 1 && attempts[bad.id]?.length === 1);
    expect(redis.pendingOf(STREAM, "journey")).toMatchObject([{ consumer: "j1", deliveries: 1 }]);

    // Not idle long enough: no redelivery yet.
    await consumer.runOnce();
    expect(attempts[bad.id]).toEqual([1]);

    clock.advance(150);
    await waitFor(() => attempts[bad.id]!.length === 2);
    expect(dead).toHaveLength(0);

    clock.advance(150);
    await waitFor(() => attempts[bad.id]!.length === 3);
    await waitFor(() => dead.length === 1);

    expect(attempts[bad.id]).toEqual([1, 2, 3]);
    expect(dead).toEqual([{ id: bad.id, deliveries: 3 }]);
    expect(redis.pendingOf(STREAM, "journey")).toEqual([]);

    const dlq = redis.dump(deadLetterKey("journey"));
    expect(dlq).toHaveLength(1);
    expect(dlq[0]!.fields).toMatchObject({
      id: bad.id,
      type: "cycle.started",
      source_stream: STREAM,
      group: "journey",
      consumer: "j1",
      deliveries: "3",
    });
    expect(dlq[0]!.fields.error).toMatch(/boom 3/);
    expect(JSON.parse(dlq[0]!.fields.json!).id).toBe(bad.id);

    // The good event was handled exactly once throughout.
    expect(attempts[good.id]).toEqual([1]);
    await consumer.stop();
  });

  it("dead-letters an undecodable entry immediately (poison message) without calling the handler", async () => {
    const redis = new MemoryRedis();
    await redis.xadd(STREAM, "*", "id", "x", "type", "cycle.started", "json", "{not json");
    await redis.xadd(
      STREAM,
      "*",
      "id",
      "y",
      "type",
      "nope",
      "json",
      JSON.stringify({ hello: "world" }),
    );
    await publish(redis, fixtureEvent("cycle.started"));
    let handled = 0;
    const consumer = consume(redis, {
      stream: STREAM,
      group: "metrics",
      consumer: "m",
      blockMs: 10,
      handler: () => void handled++,
      onError: () => {},
    });
    await waitFor(() => redis.dump(deadLetterKey("metrics")).length === 2 && handled === 1);
    const [a, b] = redis.dump(deadLetterKey("metrics"));
    expect(a!.fields.error).toMatch(/invalid JSON/);
    expect(b!.fields.error).toMatch(/envelope/);
    expect(redis.pendingOf(STREAM, "metrics")).toEqual([]);
    await consumer.stop();
  });

  it("claims entries left pending by a crashed consumer on restart (pending-claim)", async () => {
    const { redis, clock } = createMemoryRedisWithClock();
    const e1 = fixtureEvent("signup.created", { id: fixtureId("e1") });
    const e2 = fixtureEvent("payment.received", { id: fixtureId("e2") });
    await publish(redis, e1);
    await publish(redis, e2);

    // First consumer reads both and "crashes" before acking (never resolves).
    const crashed = consume(redis, {
      stream: STREAM,
      group: "health",
      consumer: "node-a",
      blockMs: 10,
      handler: () => new Promise<void>(() => {}),
    });
    await waitFor(() => redis.pendingOf(STREAM, "health").length >= 1);
    // The hung handler blocks the loop; drop the consumer without awaiting stop().
    void crashed.stop();

    const seen: string[] = [];
    const deliveries: number[] = [];
    const replacement = consume(redis, {
      stream: STREAM,
      group: "health",
      consumer: "node-b",
      blockMs: 10,
      claimIdleMs: 1000,
      retryDelayMs: 0,
      handler: (event, meta) => {
        seen.push(event.id);
        deliveries.push(meta.deliveries);
      },
    });

    // node-a's entries are not idle enough: node-b only reads what node-a never saw (e2 may or may not have been read by node-a).
    await replacement.runOnce();
    const before = seen.length;

    clock.advance(1500);
    await waitFor(() => seen.length === 2);
    expect(seen.length).toBeGreaterThanOrEqual(before);
    expect(new Set(seen)).toEqual(new Set([e1.id, e2.id]));
    expect(deliveries.some((d) => d >= 2)).toBe(true); // at least one was a reclaimed redelivery
    expect(redis.pendingOf(STREAM, "health")).toEqual([]);
    await replacement.stop();
  });

  it("dead-letters a reclaimed entry that already exceeded maxRetries without running the handler again", async () => {
    const { redis, clock } = createMemoryRedisWithClock();
    const e = fixtureEvent("cycle.started");
    const id = await publish(redis, e);
    await redis.xgroup("CREATE", STREAM, "pb", "0", "MKSTREAM");
    // Pretend a previous consumer delivered it 5 times and died each time.
    await redis.xreadgroup("GROUP", "pb", "dead-node", "COUNT", 1, "STREAMS", STREAM, ">");
    await redis.xclaim(STREAM, "pb", "dead-node", 0, id, "RETRYCOUNT", 5);
    clock.advance(60_000);

    let calls = 0;
    const consumer = consume(redis, {
      stream: STREAM,
      group: "pb",
      consumer: "new-node",
      blockMs: 10,
      maxRetries: 5,
      claimIdleMs: 1000,
      handler: () => void calls++,
    });
    await waitFor(() => redis.dump(deadLetterKey("pb")).length === 1);
    expect(calls).toBe(0);
    expect(redis.dump(deadLetterKey("pb"))[0]!.fields.deliveries).toBe("6");
    expect(redis.dump(deadLetterKey("pb"))[0]!.fields.error).toMatch(/exceeded 5 deliveries/);
    await consumer.stop();
  });

  it("discovers streams by pattern, including ones created after start", async () => {
    const redis = new MemoryRedis();
    const b2 = fixtureId("business-2");
    const e1 = fixtureEvent("cycle.started", { id: fixtureId("e1") });
    const e2 = fixtureEvent("cycle.started", { id: fixtureId("e2"), businessId: b2 });
    await publish(redis, e1);
    await redis.xadd("as:not-a-business", "*", "kind", "note", "json", "{}"); // must be ignored

    const seen: string[] = [];
    const consumer = consume(redis, {
      businessId: "*",
      group: "metrics",
      consumer: "m1",
      blockMs: 10,
      discoverIntervalMs: 5,
      handler: (event) => void seen.push(`${event.businessId}:${event.id}`),
    });
    await waitFor(() => seen.length === 1);
    expect(consumer.streams()).toEqual([businessStreamKey(FIXTURE_BUSINESS_ID)]);

    await publish(redis, e2, businessStreamKey(b2));
    await waitFor(() => seen.length === 2);
    expect(consumer.streams().sort()).toEqual(
      [businessStreamKey(FIXTURE_BUSINESS_ID), businessStreamKey(b2)].sort(),
    );
    expect(seen).toEqual([`${FIXTURE_BUSINESS_ID}:${e1.id}`, `${b2}:${e2.id}`]);
    await consumer.stop();
  });

  it('startFrom "$" skips entries that existed before the group was created', async () => {
    const redis = new MemoryRedis();
    await publish(redis, fixtureEvent("cycle.started", { id: fixtureId("old") }));
    const seen: string[] = [];
    const consumer = consume(redis, {
      stream: STREAM,
      group: "late",
      consumer: "l",
      startFrom: "$",
      blockMs: 10,
      handler: (e) => void seen.push(e.id),
    });
    await consumer.runOnce();
    await publish(redis, fixtureEvent("cycle.started", { id: fixtureId("new") }));
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([fixtureId("new")]);
    await consumer.stop();
  });

  it("supports a custom decoder for non-platform streams", async () => {
    const redis = new MemoryRedis();
    await redis.xadd("custom:1", "*", "n", "1");
    await redis.xadd("custom:1", "*", "n", "2");
    const nums: number[] = [];
    const consumer = consume<number>(redis, {
      stream: "custom:1",
      group: "g",
      consumer: "c",
      blockMs: 10,
      decode: (entry) => Number(entry.fields.n),
      handler: (n) => void nums.push(n),
    });
    await waitFor(() => nums.length === 2);
    expect(nums).toEqual([1, 2]);
    await consumer.stop();
  });

  it("validates options", () => {
    const redis = new MemoryRedis();
    expect(() => consume(redis, { group: "g", consumer: "c", handler: () => {} })).toThrow(
      /one of stream, pattern or businessId/,
    );
    expect(() =>
      consume(redis, { stream: "a", pattern: "b", group: "g", consumer: "c", handler: () => {} }),
    ).toThrow(/either stream or pattern/);
    expect(() =>
      consume(redis, { stream: "a", group: "", consumer: "c", handler: () => {} }),
    ).toThrow(/group and consumer/);
  });

  it("decodePlatformEntry explains what is wrong", () => {
    expect(() => decodePlatformEntry({ stream: "s", id: "1-0", fields: {} })).toThrow(
      /no "json" field/,
    );
    expect(() => decodePlatformEntry({ stream: "s", id: "1-0", fields: { json: "{" } })).toThrow(
      /invalid JSON/,
    );
    expect(
      decodePlatformEntry({
        stream: "s",
        id: "1-0",
        fields: { json: serializeEvent(fixtureEvent("cycle.started")) },
      }),
    ).toEqual(fixtureEvent("cycle.started"));
  });
});
