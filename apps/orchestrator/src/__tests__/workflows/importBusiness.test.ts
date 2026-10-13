/**
 * importBusiness with mocked activities (audit ARB-06, api-services-08): a source whose activity fails for good is
 * written to its row as failed (so the import job can finish), the other sources still run, and a stopped run
 * reports the sources it never read.
 */
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, ImportSourceResult } from "../../activities";
import { importBusiness } from "../../workflows";
import { stopSignal } from "../../workflows/signals";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
afterAll(async () => {
  await rig?.teardown();
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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

describe("importBusiness", () => {
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
