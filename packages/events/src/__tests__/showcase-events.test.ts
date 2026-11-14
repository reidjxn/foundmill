/**
 * Showcase videos (0105): the house's `showcase.requested`, `showcase.approved`, `showcase.withdrawn` and the project's
 * `showcase.asked`, `showcase.settled` reach a metrics consumer through the outbox as typed events; a malformed one,
 * and one that tries to carry a founder's own answer, are refused at write time. None is narrated.
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "@foundmill/shared";
import { EVENTS, type PlatformEvent } from "../catalogue";
import { consume } from "../consume";
import { runOutboxRelay } from "../outbox/relay";
import { writeEvent } from "../outbox/writer";
import { FakeDb } from "../testing/fake-db";
import { MemoryRedis } from "../testing/memory-redis";
import { EVENT_FIXTURES, FIXTURE_BUSINESS_ID, fixtureId } from "../testing/fixtures";

const SYSTEM = { kind: "system", id: "api" } as const;
const TYPES = ["showcase.requested", "showcase.approved", "showcase.withdrawn", "showcase.asked", "showcase.settled"] as const;

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("showcase.* through the outbox", () => {
  it("delivers each to the metrics group as a typed event, ids only", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    const received: PlatformEvent[] = [];
    const consumer = consume(redis, { businessId: FIXTURE_BUSINESS_ID, group: "metrics", consumer: "metrics-1", blockMs: 10, handler: (e) => void received.push(e) });
    const relay = runOutboxRelay(db, redis, { intervalMs: 5 });
    const base = Date.now();
    for (const [i, type] of TYPES.entries()) await db.transaction((tx) => writeEvent(tx, { businessId: FIXTURE_BUSINESS_ID, type, actor: SYSTEM, payload: EVENT_FIXTURES[type], occurredAt: new Date(base + i) }));
    await waitFor(() => received.length === TYPES.length);
    expect(received.map((e) => e.type)).toEqual([...TYPES]);
    const withdrawn = received.find((e) => e.type === "showcase.withdrawn");
    if (withdrawn?.type === "showcase.withdrawn") expect(withdrawn.payload).toEqual({ requestId: fixtureId("showcase-request"), subjectBusinessId: fixtureId("business"), reason: "founder_withdrew" });
    await relay.stop();
    await consumer.stop();
  });

  it("is never narrated", () => {
    for (const type of TYPES) expect(EVENTS[type].narratable).toBe(false);
  });

  it("refuses a malformed payload and a settled state of asking", async () => {
    const db = new FakeDb();
    await expect(db.transaction((tx) => writeEvent(tx, { businessId: FIXTURE_BUSINESS_ID, type: "showcase.withdrawn", actor: SYSTEM, payload: { requestId: fixtureId("r"), subjectBusinessId: fixtureId("b"), reason: "bored" } as never }))).rejects.toThrow(ValidationError);
    await expect(db.transaction((tx) => writeEvent(tx, { businessId: FIXTURE_BUSINESS_ID, type: "showcase.settled", actor: SYSTEM, payload: { requestId: fixtureId("r"), state: "asking" } as never }))).rejects.toThrow(ValidationError);
    expect(db.unpublished()).toHaveLength(0);
  });

  it("carries no founder's answer: an extra field does not reach the payload", () => {
    const parsed = EVENTS["showcase.settled"].schema.parse({ requestId: fixtureId("r"), state: "declined", userId: fixtureId("u"), answer: "no" });
    expect(parsed).toEqual({ requestId: fixtureId("r"), state: "declined" });
  });
});
