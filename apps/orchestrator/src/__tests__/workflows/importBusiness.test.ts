/**
 * importBusiness with mocked activities (BUILD §9.4, Door B): every source is read a few at a time and the finish
 * activity gets one outcome per source. A stop (the kill switch) leaves no source waiting for a read that will not
 * come: the ones not started yet finish as not read, so Product › Sources never shows them "Not read yet" forever.
 * A source whose activity fails for good is written to its row as failed (so the import job can finish) and the other
 * sources still run (audit ARB-06, api-services-08).
 */
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, ImportSourceResult } from "../../activities";
import { importBusiness, stopSignal } from "../../workflows";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
afterAll(async () => {
  await rig?.teardown();
});

const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sourceIds = [1, 2, 3, 4, 5].map(id);

describe("importBusiness workflow", () => {
  it("reads every source and hands each outcome to finishImport", async () => {
    const finished: ImportSourceResult[][] = [];
    const acts: Partial<Activities> = {
      async importSource({ sourceId }) {
        return { sourceId, ok: sourceId !== id(2), summary: sourceId === id(2) ? "Linear import: not read, the import has no reader for this source yet" : `${sourceId}: read` };
      },
      async finishImport({ results }) {
        finished.push(results);
        return { inboxItemId: id(9) };
      },
    };
    const result = await rig.run(acts, (client, taskQueue) => client.workflow.execute(importBusiness, { workflowId: wfId("import"), taskQueue, args: [{ businessId: B, sourceIds }] }));
    expect(result.inboxItemId).toBe(id(9));
    expect(finished).toHaveLength(1);
    expect(finished[0]!.map((r) => r.sourceId).sort()).toEqual(sourceIds);
    expect(finished[0]!.filter((r) => !r.ok).map((r) => r.sourceId)).toEqual([id(2)]);
  });

  it("a stop finishes the sources it had not started as not read instead of leaving them waiting", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let threeStarted!: () => void;
    const started = new Promise<void>((resolve) => (threeStarted = resolve));
    const read: string[] = [];
    const finished: ImportSourceResult[][] = [];
    const acts: Partial<Activities> = {
      async importSource({ sourceId }) {
        read.push(sourceId);
        if (read.length === 3) threeStarted();
        await gate;
        return { sourceId, ok: true, summary: `${sourceId}: read` };
      },
      async finishImport({ results }) {
        finished.push(results);
        return { inboxItemId: null };
      },
    };
    await rig.run(acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(importBusiness, { workflowId: wfId("import"), taskQueue, args: [{ businessId: B, sourceIds }] });
      await started;
      // The stop is in the history before any of the three reads completes, so no worker starts another read.
      await handle.signal(stopSignal, { reason: "kill_switch", by: "founder" });
      release();
      return handle.result();
    });
    expect(read.sort()).toEqual(sourceIds.slice(0, 3));
    const results = finished[0]!;
    expect(results).toHaveLength(5);
    expect(results.filter((r) => r.ok).map((r) => r.sourceId).sort()).toEqual(sourceIds.slice(0, 3));
    expect(results.filter((r) => !r.ok)).toEqual([
      { sourceId: id(4), ok: false, summary: "failed: the import was stopped before this source was read" },
      { sourceId: id(5), ok: false, summary: "failed: the import was stopped before this source was read" },
    ]);
  });
});

function mockActivities(failing: Set<string>) {
  const marked: { sourceId: string; reason: string }[] = [];
  let finished: ImportSourceResult[] = [];
  const acts: Partial<Activities> = {
    async importSource(input) {
      if (failing.has(input.sourceId)) throw ApplicationFailure.create({ message: "database is down", type: "ImportError", nonRetryable: true });
      return { sourceId: input.sourceId, ok: true, summary: "imported through github.read_tree" };
    },
    async failImportSource(input) {
      marked.push({ sourceId: input.sourceId, reason: input.reason });
    },
    async finishImport(input) {
      finished = input.results;
      return { inboxItemId: null };
    },
  };
  return { acts, marked, finished: () => finished };
}

describe("importBusiness failures are written to the rows", () => {
  it("writes a source that failed for good to its row and still reads the others", async () => {
    const m = mockActivities(new Set([id(2)]));
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(importBusiness, { workflowId: wfId("import"), taskQueue, args: [{ businessId: id(100), sourceIds: [id(1), id(2), id(3)] }] }));
    expect(m.marked).toHaveLength(1);
    expect(m.marked[0]).toMatchObject({ sourceId: id(2) });
    expect(m.marked[0]!.reason).toMatch(/^failed: /);
    expect(result.results.map((r) => [r.sourceId, r.ok]).sort()).toEqual([[id(1), true], [id(2), false], [id(3), true]]);
    expect(m.finished()).toHaveLength(3);
  });

  it("a run stopped before it started reports every source as not read, on its row", async () => {
    const m = mockActivities(new Set());
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(importBusiness, { workflowId: wfId("import-stop"), taskQueue, args: [{ businessId: id(100), sourceIds: [id(1), id(2)] }] });
      await handle.signal(stopSignal, { by: "test", reason: "stop" });
      return handle.result();
    });
    // Whatever the race between the signal and the first activity, no source is left without an outcome.
    expect(result.results.map((r) => r.sourceId).sort()).toEqual([id(1), id(2)]);
    for (const r of result.results.filter((r) => !r.ok)) {
      expect(m.marked.map((x) => x.sourceId)).toContain(r.sourceId);
      expect(r.summary).toMatch(/stopped before this source was read/);
    }
  });
});
