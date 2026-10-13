/**
 * importBusiness with mocked activities (BUILD §9.4, Door B): every source is read a few at a time and the finish
 * activity gets one outcome per source. A stop (the kill switch) leaves no source waiting for a read that will not
 * come: the ones not started yet finish as not read, so Product › Sources never shows them "Not read yet" forever.
 */
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
