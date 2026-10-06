import { describe, expect, it } from "vitest";
import { compareStreamIds, parsePendingReply, parseReadReply } from "../redis";
import { createMemoryRedisWithClock, MemoryRedis } from "../testing/memory-redis";

describe("MemoryRedis", () => {
  it("generates monotonic ids, honours explicit ids and MAXLEN, and NOMKSTREAM", async () => {
    const { redis, clock } = createMemoryRedisWithClock(1000);
    const a = await redis.xadd("s", "*", "k", "v");
    const b = await redis.xadd("s", "*", "k", "v");
    expect(a).toBe("1000-0");
    expect(b).toBe("1000-1");
    clock.advance(5);
    expect(await redis.xadd("s", "*", "k", "v")).toBe("1005-0");
    expect(await redis.xadd("s", "2000-7", "k", "v")).toBe("2000-7");
    await expect(redis.xadd("s", "1999-0", "k", "v")).rejects.toThrow(/equal or smaller/);
    expect(await redis.xadd("s", "2000-*", "k", "v")).toBe("2000-8");
    expect(await redis.xadd("s", "MAXLEN", "~", 3, "*", "k", "v")).toBe("2000-9");
    expect(await redis.xlen("s")).toBe(3);
    expect((await redis.xrange("s", "-", "+")).map(([id]) => id)).toEqual([
      "2000-7",
      "2000-8",
      "2000-9",
    ]);
    expect(await redis.xadd("missing", "NOMKSTREAM", "*", "k", "v")).toBeNull();
    await expect(redis.xadd("s", "*")).rejects.toThrow(/wrong number of arguments/);
    expect(compareStreamIds("1000-1", "1000-0")).toBeGreaterThan(0);
    expect(compareStreamIds("999-9", "1000-0")).toBeLessThan(0);
  });

  it("xrange supports exclusive bounds, COUNT and xrevrange", async () => {
    const redis = new MemoryRedis();
    for (let i = 1; i <= 5; i++) await redis.xadd("s", `${i}-0`, "n", String(i));
    expect((await redis.xrange("s", "(2-0", "4-0")).map(([id]) => id)).toEqual(["3-0", "4-0"]);
    expect((await redis.xrange("s", "-", "+", "COUNT", 2)).map(([id]) => id)).toEqual([
      "1-0",
      "2-0",
    ]);
    expect((await redis.xrange("s", "2", "3")).map(([id]) => id)).toEqual(["2-0", "3-0"]);
    expect((await redis.xrevrange("s", "+", "-", "COUNT", 2)).map(([id]) => id)).toEqual([
      "5-0",
      "4-0",
    ]);
    expect(await redis.xrange("nope", "-", "+")).toEqual([]);
  });

  it("consumer groups: CREATE/BUSYGROUP/MKSTREAM, > vs 0 reads, pending and ack", async () => {
    const redis = new MemoryRedis();
    await expect(redis.xgroup("CREATE", "s", "g", "0")).rejects.toThrow(
      /requires the key to exist/,
    );
    await redis.xgroup("CREATE", "s", "g", "0", "MKSTREAM");
    await expect(redis.xgroup("CREATE", "s", "g", "0", "MKSTREAM")).rejects.toThrow(/BUSYGROUP/);
    await expect(redis.xreadgroup("GROUP", "nope", "c", "STREAMS", "s", ">")).rejects.toThrow(
      /NOGROUP/,
    );

    await redis.xadd("s", "1-0", "n", "1");
    await redis.xadd("s", "2-0", "n", "2");
    await redis.xadd("s", "3-0", "n", "3");

    const first = parseReadReply(
      await redis.xreadgroup("GROUP", "g", "c1", "COUNT", 2, "STREAMS", "s", ">"),
    );
    expect(first.map((e) => e.id)).toEqual(["1-0", "2-0"]);
    expect(first[0]!.fields).toEqual({ n: "1" });
    const second = parseReadReply(await redis.xreadgroup("GROUP", "g", "c2", "STREAMS", "s", ">"));
    expect(second.map((e) => e.id)).toEqual(["3-0"]);
    expect(await redis.xreadgroup("GROUP", "g", "c2", "STREAMS", "s", ">")).toBeNull();

    // id "0" re-reads this consumer's own pending entries and bumps the delivery counter.
    const again = parseReadReply(await redis.xreadgroup("GROUP", "g", "c1", "STREAMS", "s", "0"));
    expect(again.map((e) => e.id)).toEqual(["1-0", "2-0"]);
    expect(redis.pendingOf("s", "g")).toEqual([
      { id: "1-0", consumer: "c1", deliveries: 2 },
      { id: "2-0", consumer: "c1", deliveries: 2 },
      { id: "3-0", consumer: "c2", deliveries: 1 },
    ]);

    const summary = await redis.xpending("s", "g");
    expect(summary).toEqual([
      3,
      "1-0",
      "3-0",
      [
        ["c1", "2"],
        ["c2", "1"],
      ],
    ]);

    expect(await redis.xack("s", "g", "1-0", "9-9")).toBe(1);
    expect(
      parsePendingReply(await redis.xpending("s", "g", "-", "+", 10)).map((p) => p.id),
    ).toEqual(["2-0", "3-0"]);
    expect(
      parsePendingReply(await redis.xpending("s", "g", "-", "+", 10, "c2")).map((p) => p.id),
    ).toEqual(["3-0"]);
    expect(await redis.xgroup("DESTROY", "s", "g")).toBe(1);
    await expect(redis.xpending("s", "g")).rejects.toThrow(/NOGROUP/);
  });

  it("xpending IDLE and xclaim respect idle time, bump deliveries, and honour JUSTID/RETRYCOUNT/FORCE", async () => {
    const { redis, clock } = createMemoryRedisWithClock(1000);
    await redis.xgroup("CREATE", "s", "g", "0", "MKSTREAM");
    await redis.xadd("s", "1-0", "n", "1");
    await redis.xadd("s", "2-0", "n", "2");
    await redis.xreadgroup("GROUP", "g", "c1", "STREAMS", "s", ">");

    expect(await redis.xpending("s", "g", "IDLE", 500, "-", "+", 10)).toEqual([]);
    clock.advance(600);
    const pending = parsePendingReply(await redis.xpending("s", "g", "IDLE", 500, "-", "+", 10));
    expect(pending).toEqual([
      { id: "1-0", consumer: "c1", idleMs: 600, deliveries: 1 },
      { id: "2-0", consumer: "c1", idleMs: 600, deliveries: 1 },
    ]);

    // Too fresh for a 1000 ms minimum idle: nothing claimed.
    expect(await redis.xclaim("s", "g", "c2", 1000, "1-0", "2-0")).toEqual([]);
    const claimed = await redis.xclaim("s", "g", "c2", 500, "1-0", "missing-9");
    expect(claimed).toEqual([["1-0", ["n", "1"]]]);
    expect(redis.pendingOf("s", "g")).toEqual([
      { id: "1-0", consumer: "c2", deliveries: 2 },
      { id: "2-0", consumer: "c1", deliveries: 1 },
    ]);
    expect(await redis.xclaim("s", "g", "c3", 0, "2-0", "JUSTID")).toEqual(["2-0"]);
    expect(redis.pendingOf("s", "g")[1]).toEqual({ id: "2-0", consumer: "c3", deliveries: 1 }); // JUSTID: no increment
    await redis.xclaim("s", "g", "c3", 0, "2-0", "RETRYCOUNT", 7);
    expect(redis.pendingOf("s", "g")[1]!.deliveries).toBe(7);

    // FORCE adds an entry that is not pending; a deleted entry is dropped from the PEL.
    await redis.xack("s", "g", "1-0");
    expect(await redis.xclaim("s", "g", "c4", 0, "1-0")).toEqual([]);
    expect(await redis.xclaim("s", "g", "c4", 0, "1-0", "FORCE")).toEqual([["1-0", ["n", "1"]]]);
    await redis.xdel("s", "1-0");
    expect(await redis.xclaim("s", "g", "c5", 0, "1-0")).toEqual([]);
    expect(redis.pendingOf("s", "g").map((p) => p.id)).toEqual(["2-0"]);
  });

  it("blocking XREADGROUP wakes on XADD from another connection and times out otherwise", async () => {
    const redis = new MemoryRedis();
    const blocking = redis.duplicate();
    await redis.xgroup("CREATE", "s", "g", "$", "MKSTREAM");

    const t0 = Date.now();
    expect(
      await blocking.xreadgroup("GROUP", "g", "c", "BLOCK", 30, "STREAMS", "s", ">"),
    ).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);

    const pending = blocking.xreadgroup("GROUP", "g", "c", "BLOCK", 5000, "STREAMS", "s", ">");
    await new Promise((r) => setTimeout(r, 5));
    await redis.xadd("s", "*", "n", "1");
    const reply = parseReadReply(await pending);
    expect(reply).toHaveLength(1);
    expect(reply[0]!.fields).toEqual({ n: "1" });

    // Blocking across several streams; only the one with data is returned.
    await redis.xgroup("CREATE", "t", "g", "$", "MKSTREAM");
    const multi = blocking.xreadgroup(
      "GROUP",
      "g",
      "c",
      "BLOCK",
      5000,
      "STREAMS",
      "s",
      "t",
      ">",
      ">",
    );
    await redis.xadd("t", "*", "n", "2");
    expect(parseReadReply(await multi).map((e) => e.stream)).toEqual(["t"]);
  });

  it("xread with $ and BLOCK, scan with MATCH/TYPE, keys/del/exists, and closed connections", async () => {
    const redis = new MemoryRedis();
    await redis.xadd("ev:a", "1-0", "n", "1");
    await redis.xadd("ev:b", "1-0", "n", "1");
    await redis.xadd("as:x", "1-0", "n", "1");
    expect(parseReadReply(await redis.xread("STREAMS", "ev:a", "0")).map((e) => e.id)).toEqual([
      "1-0",
    ]);
    const tail = redis.xread("BLOCK", 5000, "STREAMS", "ev:a", "$");
    await redis.xadd("ev:a", "2-0", "n", "2");
    expect(parseReadReply(await tail).map((e) => e.id)).toEqual(["2-0"]);

    expect(await redis.scan("0", "MATCH", "ev:*", "COUNT", 10, "TYPE", "stream")).toEqual([
      "0",
      ["ev:a", "ev:b"],
    ]);
    expect(await redis.scan("0", "MATCH", "ev:*", "COUNT", 10, "TYPE", "hash")).toEqual(["0", []]);
    expect(await redis.keys("*:?")).toEqual(["as:x", "ev:a", "ev:b"]);
    expect(await redis.exists("ev:a", "nope")).toBe(1);
    expect(await redis.del("ev:a", "nope")).toBe(1);
    expect(await redis.exists("ev:a")).toBe(0);

    const dup = redis.duplicate();
    expect(await dup.quit()).toBe("OK");
    await expect(dup.xlen("ev:b")).rejects.toThrow(/closed/);
    expect(await redis.xlen("ev:b")).toBe(1);
  });
});
