/**
 * The guided layer's product signals (docs/UX_AUDIT_AND_PLAN.md §11): a guidance.* event written through the outbox
 * reaches a metrics consumer group as the same typed event, and a malformed one is refused at write time.
 */
import { describe, expect, it } from "vitest";
import { GUIDANCE_EVENT_TYPES, ValidationError } from "@foundmill/shared";
import type { PlatformEvent } from "../catalogue";
import { consume } from "../consume";
import { runOutboxRelay } from "../outbox/relay";
import { writeEvent } from "../outbox/writer";
import { FakeDb } from "../testing/fake-db";
import { MemoryRedis } from "../testing/memory-redis";
import { EVENT_FIXTURES, FIXTURE_BUSINESS_ID, fixtureId } from "../testing/fixtures";

const FOUNDER = { kind: "user", id: fixtureId("founder") } as const;

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("guidance.* through the outbox", () => {
  it("delivers every guidance signal to the metrics group as a typed event", async () => {
    const db = new FakeDb();
    const redis = new MemoryRedis();
    const received: PlatformEvent[] = [];
    const consumer = consume(redis, { businessId: FIXTURE_BUSINESS_ID, group: "metrics", consumer: "metrics-1", blockMs: 10, handler: (e) => void received.push(e) });
    const relay = runOutboxRelay(db, redis, { intervalMs: 5 });

    // The relay publishes in (occurred_at, event id) order, so two signals stamped in the same millisecond have no
    // defined order (CI run 169 on main saw explainer_dismissed after term_opened). Each signal gets its own millisecond,
    // which is what the order assertion below is really about.
    const base = Date.now();
    for (const [i, type] of GUIDANCE_EVENT_TYPES.entries()) {
      await db.transaction((tx) => writeEvent(tx, { businessId: FIXTURE_BUSINESS_ID, type, actor: FOUNDER, payload: EVENT_FIXTURES[type], occurredAt: new Date(base + i) }));
    }
    await waitFor(() => received.length === GUIDANCE_EVENT_TYPES.length);
    expect(received.map((e) => e.type)).toEqual([...GUIDANCE_EVENT_TYPES]);
    const skipped = received.find((e) => e.type === "guidance.tour_skipped");
    if (skipped?.type === "guidance.tour_skipped") expect(skipped.payload).toEqual({ tourId: "inbox", atStep: 2, steps: 4 });
    const term = received.find((e) => e.type === "guidance.term_opened");
    if (term?.type === "guidance.term_opened") expect(term.payload.termId).toBe("runway");
    expect(received.every((e) => e.actor.kind === "user" && e.actor.id === FOUNDER.id)).toBe(true);

    await relay.stop();
    await consumer.stop();
  });

  it("refuses a malformed signal at write time and writes nothing", async () => {
    const db = new FakeDb();
    await expect(
      db.transaction((tx) => writeEvent(tx, { businessId: FIXTURE_BUSINESS_ID, type: "guidance.term_opened", actor: FOUNDER, payload: { termId: "Runway" } as never })),
    ).rejects.toThrow(ValidationError);
    expect(db.unpublished()).toHaveLength(0);
  });
});
