import { describe, expect, it } from "vitest";
import { parseEvent } from "../catalogue";
import { BUSINESS_STREAM_RETENTION_MS, RELAY_DEAD_LETTER_KEY, businessStreamKey } from "../keys";
import { createOutboxRelay, rowToEventInput, rowsOf, runOutboxRelay } from "../outbox/relay";
import { writeEvent } from "../outbox/writer";
import { FakeDb } from "../testing/fake-db";
import { MemoryRedis } from "../testing/memory-redis";
import { FIXTURE_BUSINESS_ID, fixtureEvent, fixtureId, fixtureInput } from "../testing/fixtures";

const otherBusiness = fixtureId("business-2");

describe("outbox relay", () => {
  it("publishes unpublished rows to ev:{businessId} with id/type/json fields and marks them published", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    const a = await writeEvent(
      db,
      fixtureInput("payment.received", { occurredAt: "2026-10-05T09:00:00Z" }),
    );
    const b = await writeEvent(
      db,
      fixtureInput("signup.created", { occurredAt: "2026-10-05T09:00:01Z" }),
    );
    const c = await writeEvent(
      db,
      fixtureInput("cycle.started", {
        businessId: otherBusiness,
        occurredAt: "2026-10-05T09:00:02Z",
      }),
    );

    const relay = createOutboxRelay(db, redis, { batch: 10 });
    expect(await relay.tick()).toBe(3);

    const stream = redis.dump(businessStreamKey(FIXTURE_BUSINESS_ID));
    expect(stream.map((e) => e.fields.id)).toEqual([a, b]);
    expect(stream.map((e) => e.fields.type)).toEqual(["payment.received", "signup.created"]);
    expect(Object.keys(stream[0]!.fields).sort()).toEqual(["id", "json", "type"]);

    const published = parseEvent(JSON.parse(stream[0]!.fields.json!));
    expect(published).toEqual(
      fixtureEvent("payment.received", { occurredAt: "2026-10-05T09:00:00Z" }),
    );

    expect(redis.dump(businessStreamKey(otherBusiness)).map((e) => e.fields.id)).toEqual([c]);
    expect(db.unpublished()).toHaveLength(0);
    expect(db.outbox.every((o) => o.published_at instanceof Date)).toBe(true);

    // Nothing left: a second tick publishes nothing and adds no entries.
    expect(await relay.tick()).toBe(0);
    expect(await redis.xlen(businessStreamKey(FIXTURE_BUSINESS_ID))).toBe(2);
  });

  it("uses a transaction with row locks when the db supports it, and plain selects otherwise", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    await writeEvent(db, fixtureInput("cycle.started"));
    await createOutboxRelay(db, redis).tick();
    expect(db.transactions).toBe(1);
    expect(db.statements.find((s) => s.sql.startsWith("select"))!.sql).toContain(
      "for update of o skip locked",
    );

    const plain = new FakeDb();
    await writeEvent(plain, fixtureInput("cycle.started"));
    await createOutboxRelay({ execute: (q) => plain.execute(q) }, redis, {
      streamKey: () => "ev:plain",
    }).tick();
    expect(plain.transactions).toBe(0);
    expect(plain.statements.find((s) => s.sql.startsWith("select"))!.sql).not.toContain(
      "for update",
    );
    expect(await redis.xlen("ev:plain")).toBe(1);
  });

  it("respects the batch size and reports how many rows it handled", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    for (let i = 0; i < 5; i++)
      await writeEvent(
        db,
        fixtureInput("task.progressed", {
          id: undefined,
          occurredAt: new Date(1_700_000_000_000 + i * 1000),
        }),
      );
    const relay = createOutboxRelay(db, redis, { batch: 2 });
    expect(await relay.tick()).toBe(2);
    expect(db.unpublished()).toHaveLength(3);
    expect(await relay.tick()).toBe(2);
    expect(await relay.tick()).toBe(1);
    expect(await relay.tick()).toBe(0);
    expect(await redis.xlen(businessStreamKey(FIXTURE_BUSINESS_ID))).toBe(5);
  });

  it("passes MAXLEN ~ to XADD so streams stay bounded", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    for (let i = 0; i < 6; i++)
      await writeEvent(
        db,
        fixtureInput("task.progressed", {
          id: undefined,
          occurredAt: new Date(1_700_000_000_000 + i * 1000),
        }),
      );
    await createOutboxRelay(db, redis, { maxLen: 4 }).tick();
    expect(await redis.xlen(businessStreamKey(FIXTURE_BUSINESS_ID))).toBe(4);
  });

  it("keeps 30 days per business stream and lets an idle business's stream expire (#233)", async () => {
    let now = Date.parse("2026-10-12T09:00:00.000Z");
    const day = 86_400_000;
    const db = new FakeDb();
    const redis = new MemoryRedis({ now: () => now });
    const key = businessStreamKey(FIXTURE_BUSINESS_ID);
    // Two entries from long ago, one from last week (written before retention existed).
    await redis.xadd(key, `${now - 45 * day}-0`, "id", "old-1", "type", "x", "json", "{}");
    await redis.xadd(key, `${now - 31 * day}-0`, "id", "old-2", "type", "x", "json", "{}");
    await redis.xadd(key, `${now - 7 * day}-0`, "id", "recent", "type", "x", "json", "{}");
    await writeEvent(db, fixtureInput("cycle.started"));
    await createOutboxRelay(db, redis).tick();
    expect(redis.dump(key).map((e) => e.fields.id)).toEqual(["recent", expect.any(String)]);
    expect(await redis.ttl(key)).toBe(BUSINESS_STREAM_RETENTION_MS / 1000);
    // Archived, deleted or dormant: nothing writes to the stream any more, and it goes after the same 30 days.
    now += BUSINESS_STREAM_RETENTION_MS;
    expect(await redis.exists(key)).toBe(0);

    const off = new MemoryRedis();
    const db2 = new FakeDb();
    await writeEvent(db2, fixtureInput("cycle.started"));
    await createOutboxRelay(db2, off, { retentionMs: 0 }).tick();
    expect(await off.ttl(key)).toBe(-1);
  });

  it("a failed trim never re-publishes the batch", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    redis.xtrim = () => Promise.reject(new Error("READONLY"));
    const errors: unknown[] = [];
    await writeEvent(db, fixtureInput("cycle.started"));
    expect(await createOutboxRelay(db, redis, { onError: (e) => errors.push(e) }).tick()).toBe(1);
    expect(db.unpublished()).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("is at-least-once: a failure after XADD leaves rows unpublished and the next tick republishes them", async () => {
    let fail = true;
    const db = new FakeDb({
      failOn: (s) =>
        fail && s.sql.startsWith('update "outbox"') ? new Error("connection reset") : undefined,
    });
    const redis = new MemoryRedis();
    const errors: unknown[] = [];
    await writeEvent(db, fixtureInput("cycle.started"));
    const relay = createOutboxRelay(db, redis, { onError: (e) => errors.push(e) });

    await expect(relay.tick()).rejects.toThrow(/connection reset/);
    expect(db.unpublished()).toHaveLength(1);
    expect(await redis.xlen(businessStreamKey(FIXTURE_BUSINESS_ID))).toBe(1); // already on the stream

    fail = false;
    expect(await relay.tick()).toBe(1);
    expect(db.unpublished()).toHaveLength(0);
    expect(await redis.xlen(businessStreamKey(FIXTURE_BUSINESS_ID))).toBe(2); // duplicate, same event id → consumers de-duplicate
    const ids = redis.dump(businessStreamKey(FIXTURE_BUSINESS_ID)).map((e) => e.fields.id);
    expect(new Set(ids).size).toBe(1);
  });

  it("parks rows that no longer validate on dlq:outbox-relay instead of stalling", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    const good = await writeEvent(db, fixtureInput("cycle.started"));
    const bad = await writeEvent(
      db,
      fixtureInput("payment.received", { occurredAt: "2026-10-05T09:00:01Z" }),
    );
    // Simulate a payload that drifted (e.g. an older schema) by corrupting the stored row.
    db.events.get(bad)!.payload = { amount: "lots" };
    const errors: unknown[] = [];
    const relay = createOutboxRelay(db, redis, { onError: (e) => errors.push(e) });

    expect(await relay.tick()).toBe(2);
    expect(redis.dump(businessStreamKey(FIXTURE_BUSINESS_ID)).map((e) => e.fields.id)).toEqual([
      good,
    ]);
    const dead = redis.dump(RELAY_DEAD_LETTER_KEY);
    expect(dead).toHaveLength(1);
    expect(dead[0]!.fields.id).toBe(bad);
    expect(dead[0]!.fields.error).toMatch(/Invalid payload for payment.received/);
    expect(errors).toHaveLength(1);
    expect(db.unpublished()).toHaveLength(0);
  });

  it("runs as a loop: drains continuously, invokes onPublished, and stops gracefully", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    const published: string[] = [];
    const relay = runOutboxRelay(db, redis, {
      intervalMs: 5,
      batch: 2,
      onPublished: (evts) => published.push(...evts.map((e) => e.id)),
    });
    expect(relay.running).toBe(true);

    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(
        await writeEvent(
          db,
          fixtureInput("task.progressed", {
            id: undefined,
            occurredAt: new Date(1_700_000_000_000 + i * 1000),
          }),
        ),
      );

    await waitFor(() => db.unpublished().length === 0);
    expect(published.sort()).toEqual([...ids].sort());

    await relay.stop();
    expect(relay.running).toBe(false);
    await relay.done; // resolves once the loop exits

    // Nothing happens after stop.
    await writeEvent(db, fixtureInput("cycle.started"));
    await new Promise((r) => setTimeout(r, 30));
    expect(db.unpublished()).toHaveLength(1);
  });

  it("backs off after a failing tick and recovers", async () => {
    let failing = true;
    const db = new FakeDb({
      failOn: (s) => (failing && s.sql.startsWith("select") ? new Error("db down") : undefined),
    });
    const redis = new MemoryRedis();
    const errors: unknown[] = [];
    await writeEvent(db, fixtureInput("cycle.started"));
    failing = true;
    const relay = runOutboxRelay(db, redis, {
      intervalMs: 5,
      errorBackoffMs: 5,
      onError: (e) => errors.push(e),
    });
    await waitFor(() => errors.length >= 2);
    failing = false;
    await waitFor(() => db.unpublished().length === 0);
    await relay.stop();
  });

  it("start() is idempotent and stop() on a never-started relay resolves", async () => {
    const relay = createOutboxRelay(new FakeDb(), new MemoryRedis(), { intervalMs: 5 });
    await relay.stop();
    relay.start();
    relay.start();
    expect(relay.running).toBe(true);
    await relay.stop();
    expect(relay.running).toBe(false);
  });

  it("rowsOf / rowToEventInput normalise driver result shapes", () => {
    expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(rowsOf({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(rowsOf(undefined)).toEqual([]);
    const input = rowToEventInput({
      id: "x",
      businessId: "b",
      type: "cycle.started",
      occurredAt: "2026-10-05T09:00:00.000Z",
      actor: '{"kind":"system","id":"s"}',
      entityIds: "{a,b}",
      payload: '{"k":1}',
      narrated: 0,
    });
    expect(input).toEqual({
      id: "x",
      businessId: "b",
      type: "cycle.started",
      occurredAt: new Date("2026-10-05T09:00:00.000Z"),
      actor: { kind: "system", id: "s" },
      entityIds: ["a", "b"],
      payload: { k: 1 },
      narrated: false,
    });
    expect(rowToEventInput({ entityIds: "{}" }).entityIds).toEqual([]);
  });

  it("works when execute returns { rows } (PGlite / node-postgres shape)", async () => {
    const db = new FakeDb({ resultShape: "rows" });
    const redis = new MemoryRedis();
    await writeEvent(db, fixtureInput("cycle.started"));
    expect(await createOutboxRelay(db, redis).tick()).toBe(1);
    expect(await redis.xlen(businessStreamKey(FIXTURE_BUSINESS_ID))).toBe(1);
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
}
