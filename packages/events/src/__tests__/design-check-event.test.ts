/**
 * `task.design_checked` (item 13): a design check written through the outbox reaches the stream group as the same typed
 * event, and a record that claims screenshots it does not have the shape of (or an unknown status) is refused at write.
 */
import { describe, expect, it } from "vitest";
import type { PlatformEvent } from "../catalogue";
import { consume } from "../consume";
import { runOutboxRelay } from "../outbox/relay";
import { buildEvent, writeEvent } from "../outbox/writer";
import { FakeDb } from "../testing/fake-db";
import { MemoryRedis } from "../testing/memory-redis";
import { EVENT_FIXTURES, FIXTURE_BUSINESS_ID, fixtureId } from "../testing/fixtures";

const SYSTEM = { kind: "system", id: "orchestrator" } as const;

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("task.design_checked", () => {
  it("reaches the stream consumer as a typed event", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    const received: PlatformEvent[] = [];
    const consumer = consume(redis, { businessId: FIXTURE_BUSINESS_ID, group: "stream", consumer: "stream-1", blockMs: 10, handler: (e) => void received.push(e) });
    const relay = runOutboxRelay(db, redis, { intervalMs: 5 });
    await db.transaction((tx) => writeEvent(tx, { businessId: FIXTURE_BUSINESS_ID, type: "task.design_checked", actor: SYSTEM, payload: EVENT_FIXTURES["task.design_checked"], entityIds: [fixtureId("task")] }));
    await waitFor(() => received.length === 1);
    await relay.stop();
    await consumer.stop();
    const event = received[0]!;
    expect(event.type).toBe("task.design_checked");
    if (event.type !== "task.design_checked") return;
    expect(event.payload.result.status).toBe("reviewed");
    expect(event.payload.result.fixes[0]!.principle).toBe("responsive");
  });

  it("refuses a malformed record at write time", () => {
    const good = EVENT_FIXTURES["task.design_checked"];
    const build = (result: unknown) => buildEvent({ businessId: FIXTURE_BUSINESS_ID, type: "task.design_checked", actor: SYSTEM, payload: { ...good, result } as never });
    expect(() => build({ ...good.result, status: "looks_great" })).toThrow();
    expect(() => build({ ...good.result, before: [{ ...good.result.before![0]!, sha256: "not-a-hash" }] })).toThrow();
    expect(() => build({ ...good.result, fixes: Array.from({ length: 6 }, (_, i) => ({ ...good.result.fixes![0]!, rank: i + 1 })) })).toThrow();
    expect(() => build({ ...good.result, status: "not_seen", reason: "the sandbox has no browser", fixes: [], before: [], after: [], fixesAsked: false })).not.toThrow();
  });
});
