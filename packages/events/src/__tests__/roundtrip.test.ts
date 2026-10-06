/**
 * Gate 0: "outbox → stream round trip". A business change writes an event through the outbox inside a
 * transaction; the relay publishes it to ev:{businessId}; a consumer group receives the same typed event.
 */
import { describe, expect, it } from "vitest";
import { consume } from "../consume";
import { businessStreamKey } from "../keys";
import { runOutboxRelay } from "../outbox/relay";
import { writeEvent } from "../outbox/writer";
import { FakeDb } from "../testing/fake-db";
import { MemoryRedis } from "../testing/memory-redis";
import {
  EVENT_FIXTURES,
  FIXTURE_BUSINESS_ID,
  FIXTURE_ENTITY_ID,
  fixtureEvent,
  fixtureId,
} from "../testing/fixtures";
import type { PlatformEvent } from "../catalogue";

describe("outbox → relay → consumer round trip", () => {
  it("delivers a committed event to a consumer group as the same typed PlatformEvent", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    const received: PlatformEvent[] = [];

    const consumer = consume(redis, {
      businessId: FIXTURE_BUSINESS_ID,
      group: "composer",
      consumer: "api-1",
      blockMs: 10,
      handler: (event) => void received.push(event),
    });
    const relay = runOutboxRelay(db, redis, { intervalMs: 5 });

    // The business change and its event commit together.
    const eventId = await db.transaction(async (tx) => {
      return writeEvent(tx, {
        businessId: FIXTURE_BUSINESS_ID,
        type: "payment.received",
        actor: { kind: "webhook", id: "stripe" },
        entityIds: [FIXTURE_ENTITY_ID],
        payload: EVENT_FIXTURES["payment.received"],
        occurredAt: "2026-10-05T09:00:00.000Z",
        id: fixtureId("roundtrip"),
      });
    });

    await waitFor(() => received.length === 1);
    const event = received[0]!;
    expect(event.id).toBe(eventId);
    expect(event.type).toBe("payment.received");
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event).toEqual(
      fixtureEvent("payment.received", {
        id: fixtureId("roundtrip"),
        actor: { kind: "webhook", id: "stripe" },
      }),
    );
    if (event.type === "payment.received")
      expect(event.payload.amount).toEqual({ amountMinor: 4900, currency: "EUR" });

    expect(db.unpublished()).toHaveLength(0);
    expect(redis.pendingOf(businessStreamKey(FIXTURE_BUSINESS_ID), "composer")).toEqual([]);

    // A rolled-back transaction publishes nothing.
    await expect(
      db.transaction(async (tx) => {
        await writeEvent(tx, {
          businessId: FIXTURE_BUSINESS_ID,
          type: "cycle.started",
          actor: { kind: "system", id: "t" },
          payload: EVENT_FIXTURES["cycle.started"],
        });
        throw new Error("business change failed");
      }),
    ).rejects.toThrow(/business change failed/);
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(1);
    expect(await redis.xlen(businessStreamKey(FIXTURE_BUSINESS_ID))).toBe(1);

    await relay.stop();
    await consumer.stop();
  });

  it("fans one event out to several consumer groups independently", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    const got: Record<string, string[]> = { composer: [], journey: [], metrics: [] };
    const consumers = Object.keys(got).map((group) =>
      consume(redis, {
        businessId: "*",
        group,
        consumer: "x",
        blockMs: 10,
        discoverIntervalMs: 5,
        handler: (e) => void got[group]!.push(e.id),
      }),
    );
    const relay = runOutboxRelay(db, redis, { intervalMs: 5 });
    const id = await writeEvent(db, {
      businessId: FIXTURE_BUSINESS_ID,
      type: "signup.created",
      actor: { kind: "webhook", id: "auth" },
      payload: EVENT_FIXTURES["signup.created"],
    });
    await waitFor(() => Object.values(got).every((ids) => ids.length === 1));
    expect(got).toEqual({ composer: [id], journey: [id], metrics: [id] });
    await relay.stop();
    await Promise.all(consumers.map((c) => c.stop()));
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
}
