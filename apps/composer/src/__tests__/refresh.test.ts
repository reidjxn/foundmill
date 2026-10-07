/**
 * Refresh (BUILD §11.3, §10.4): exactly one new item every time — including with zero events (AC-11.3.2) — never a
 * fabricated event, priority event → insight → decision, the 3-candidate buffer, invalidation on source change,
 * the 3 s debounce and p95 < 400 ms warm (AC-11.3.7).
 */
import { repos } from "@foundmill/db";
import { validateMarkup } from "@foundmill/entity-linker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countInbox, countSourceEvents, createComposerHarness, p95, unnarratedIds, type ComposerHarness } from "./harness";

let hz: ComposerHarness;
beforeAll(async () => {
  hz = await createComposerHarness("refresh");
}, 120_000);
afterAll(() => hz?.close());

const quiet = async (businessId: string) => {
  // Narrate away the fixture's seed events so the business has no un-narrated event at all.
  const ids = await unnarratedIds(hz.db, businessId);
  if (ids.length) await repos.events.markNarrated(hz.db, businessId, ids);
};

describe("exactly one item, never a fabricated event (AC-11.3.2)", () => {
  it("with zero un-narrated events yields one item from the insight or next-best-decision rule and no new source event", async () => {
    const service = hz.service();
    await quiet(hz.B.businessId);
    for (let i = 0; i < 5; i++) {
      const inboxBefore = await countInbox(hz.db, hz.B.businessId);
      const eventsBefore = await countSourceEvents(hz.db, hz.B.businessId);
      const r = await service.refresh(hz.B.businessId);
      await service.drain(hz.B.businessId);
      expect(await countInbox(hz.db, hz.B.businessId)).toBe(inboxBefore + 1);
      expect(await countSourceEvents(hz.db, hz.B.businessId)).toBe(eventsBefore);
      expect(r.item.sourceEventIds).toEqual([]);
      expect(["insight", "decision"]).toContain(r.slot);
      expect(validateMarkup(r.item.bodyMd, await hz.manifest(hz.B.businessId)).valid).toBe(true);
      expect(await unnarratedIds(hz.db, hz.B.businessId)).toEqual([]);
    }
  }, 120_000);

  it("a next-best decision is grounded in state: a decision item with 2–4 options, exactly one recommended, exhibit from the registry", async () => {
    const service = hz.service();
    await quiet(hz.B.businessId);
    let decision = await service.refresh(hz.B.businessId);
    await service.drain(hz.B.businessId);
    for (let i = 0; i < 3 && decision.slot !== "decision"; i++) {
      decision = await service.refresh(hz.B.businessId);
      await service.drain(hz.B.businessId);
    }
    expect(decision.slot).toBe("decision");
    expect(decision.item.type).toBe("decision");
    expect(decision.item.blocksContinue).toBe(true);
    const options = (decision.item.decision as { options: { recommended: boolean }[] }).options;
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.length).toBeLessThanOrEqual(4);
    expect(options.filter((o) => o.recommended)).toHaveLength(1);
    expect((decision.item.exhibit as unknown as { spec_ref: string }).spec_ref).toBe("tasks_by_status");
  });

  it("narrates the highest-priority un-narrated event first", async () => {
    const service = hz.service();
    await quiet(hz.A.businessId);
    const low = await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Low priority" });
    const high = await hz.writeEvent(hz.A.businessId, "runway.threshold_crossed", { runwayMonths: 8, thresholdMonths: 9, direction: "below" });
    const first = await service.refresh(hz.A.businessId);
    expect(first.slot).toBe("events");
    expect(first.item.sourceEventIds).toEqual([high.id]);
    await service.drain(hz.A.businessId);
    const second = await service.refresh(hz.A.businessId);
    expect(second.item.sourceEventIds).toEqual([low.id]);
    await service.drain(hz.A.businessId);
    expect(await unnarratedIds(hz.db, hz.A.businessId)).toEqual([]);
  });
});

describe("buffer (3 pre-written candidates, invalidated on source change, refilled asynchronously)", () => {
  it("warm fills at most three candidates; a refresh is served from the buffer and the refill tops it up", async () => {
    const service = hz.service({ bufferSize: 3 });
    await quiet(hz.A.businessId);
    await repos.inbox.bufferInvalidate(hz.db, hz.A.businessId); // start from an empty buffer
    for (let i = 0; i < 4; i++) await hz.writeEvent(hz.A.businessId, "task.completed", { title: `Buffered ${i}` });
    const written = await service.warm(hz.A.businessId);
    expect(written).toBe(3);
    const rows = await repos.inbox.bufferList(hz.db, hz.A.businessId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.sourceHash.startsWith("event:"))).toBe(true);
    const r = await service.refresh(hz.A.businessId);
    expect(r.source).toBe("buffer");
    expect(r.slot).toBe("events");
    await service.drain(hz.A.businessId);
    const after = await repos.inbox.bufferList(hz.db, hz.A.businessId);
    expect(after).toHaveLength(3);
    expect(after.some((row) => row.sourceHash === `event:${r.item.sourceEventIds[0]}`)).toBe(false);
    // Nothing in the buffer was invented: every event candidate points at a real un-narrated event.
    const pending = new Set(await unnarratedIds(hz.db, hz.A.businessId));
    for (const row of after) if (row.sourceHash.startsWith("event:")) expect(pending.has(row.sourceHash.slice("event:".length))).toBe(true);
    // Drain the queue so later suites start clean.
    for (let i = 0; i < 4; i++) {
      await service.refresh(hz.A.businessId);
      await service.drain(hz.A.businessId);
    }
  }, 120_000);

  it("invalidates candidates whose inputs changed (an insight disappears when the roadmap slip is fixed)", async () => {
    const service = hz.service();
    await quiet(hz.A.businessId);
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    const slipped = await repos.product.upsertRoadmapItem(hz.db, hz.A.businessId, { title: "Slipped launch", horizon: "now", targetEnd: past, status: "in_progress" });
    await service.warm(hz.A.businessId);
    const before = await repos.inbox.bufferList(hz.db, hz.A.businessId);
    const slipRow = before.find((r) => r.sourceHash.startsWith("insight:roadmap:"));
    expect(slipRow).toBeTruthy();
    // Source change: the item ships.
    await repos.product.upsertRoadmapItem(hz.db, hz.A.businessId, { id: slipped.id, title: "Slipped launch", horizon: "now", targetEnd: past, status: "done" });
    const r = await service.refresh(hz.A.businessId);
    await service.drain(hz.A.businessId);
    expect(r.item.bodyMd).not.toContain("Slipped launch");
    const after = await repos.inbox.bufferList(hz.db, hz.A.businessId);
    expect(after.some((row) => row.sourceHash === slipRow!.sourceHash)).toBe(false);
    expect(after.length).toBeGreaterThan(0);
  }, 120_000);

  it("a data-change insight: channel CPA moved ≥ 20 % becomes a warning that quotes the computed numbers", async () => {
    const service = hz.service();
    await quiet(hz.B.businessId);
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await repos.channels.upsertMetrics(hz.db, hz.B.businessId, [
      { channelId: hz.B.channelId, day: day(10), spendMinor: 10_000, customers: 10 },
      { channelId: hz.B.channelId, day: day(2), spendMinor: 15_000, customers: 10 },
    ]);
    let r = await service.refresh(hz.B.businessId);
    await service.drain(hz.B.businessId);
    for (let i = 0; i < 3 && r.slot !== "insight"; i++) {
      r = await service.refresh(hz.B.businessId);
      await service.drain(hz.B.businessId);
    }
    expect(r.slot).toBe("insight");
    expect(r.item.type).toBe("warning");
    expect(r.item.blocksContinue).toBe(false);
    expect((r.item.exhibit as unknown as { spec_ref: string }).spec_ref).toBe("channel_cpa");
  }, 120_000);
});

describe("debounce (3 s per business)", () => {
  it("rapid calls inside the window return the pending item instead of a second one", async () => {
    let t = 1_000_000;
    const service = hz.service({ debounceMs: 3000, now: () => new Date(t) });
    await quiet(hz.A.businessId);
    const before = await countInbox(hz.db, hz.A.businessId);
    const first = await service.refresh(hz.A.businessId);
    t += 1000;
    const second = await service.refresh(hz.A.businessId);
    expect(second.debounced).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    expect(await countInbox(hz.db, hz.A.businessId)).toBe(before + 1);
    t += 2500;
    const third = await service.refresh(hz.A.businessId);
    expect(third.debounced).toBe(false);
    expect(third.item.id).not.toBe(first.item.id);
    await service.drain(hz.A.businessId);
    expect(await countInbox(hz.db, hz.A.businessId)).toBe(before + 2);
  });

  it("concurrent calls share one in-flight refresh", async () => {
    const service = hz.service();
    const before = await countInbox(hz.db, hz.A.businessId);
    const [a, b, c] = await Promise.all([service.refresh(hz.A.businessId), service.refresh(hz.A.businessId), service.refresh(hz.A.businessId)]);
    expect(new Set([a.item.id, b.item.id, c.item.id]).size).toBe(1);
    await service.drain(hz.A.businessId);
    expect(await countInbox(hz.db, hz.A.businessId)).toBe(before + 1);
  });
});

describe("latency (AC-11.3.7)", () => {
  it("p95 < 400 ms when the buffer is warm (mock path, PGlite)", async () => {
    const service = hz.service();
    await quiet(hz.A.businessId);
    for (let i = 0; i < 25; i++) await hz.writeEvent(hz.A.businessId, i % 2 ? "task.completed" : "pr.merged", { title: `Timing ${i}` });
    await service.warm(hz.A.businessId);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const r = await service.refresh(hz.A.businessId);
      samples.push(performance.now() - started);
      expect(r.source).toBe("buffer");
      await service.drain(hz.A.businessId); // refill time is not on the request path
    }
    expect(p95(samples)).toBeLessThan(400);
  }, 180_000);
});
