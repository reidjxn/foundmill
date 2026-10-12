/**
 * sourceWatch / sourceWatchSweep with mocked activities: every source gets its own read, a read whose retries run out
 * is recorded as failed without stopping the others, and the sweep reads each business's stale sources.
 */
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, SourceWatchInput } from "../../activities";
import { SOURCE_WATCH_FAILED_REASON, sourceWatch, sourceWatchSweep } from "../../workflows";
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
  const watched: SourceWatchInput[] = [];
  const failed: { sourceId: string; error: string }[] = [];
  const acts: Partial<Activities> = {
    async watchSource(input) {
      watched.push(input);
      if (failing.has(input.sourceId)) throw ApplicationFailure.create({ message: "boom", type: "SourceWatchError", nonRetryable: true });
      return { sourceId: input.sourceId, status: "scored", reason: null, relevantBlockIds: [id(50)], proposalId: input.sourceId === id(1) ? id(90) : null, costMinor: 3 };
    },
    async failSourceWatch(input) {
      failed.push({ sourceId: input.sourceId, error: input.error });
    },
    async listSourcesToWatch(input) {
      return { sourceIds: input.businessId === id(100) ? [id(1), id(2)] : [] };
    },
  };
  return { acts, watched, failed };
}

describe("sourceWatch", () => {
  it("reads every source; a failed read is recorded with the founder-readable reason and the rest still run", async () => {
    const m = mockActivities(new Set([id(2)]));
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(sourceWatch, { workflowId: wfId("source-watch"), taskQueue, args: [{ businessId: id(100), sourceIds: [id(1), id(2), id(3)], reason: "added" }] }));
    expect(m.watched.map((w) => [w.sourceId, w.reason])).toEqual([
      [id(1), "added"],
      [id(2), "added"],
      [id(3), "added"],
    ]);
    expect(m.failed).toEqual([{ sourceId: id(2), error: SOURCE_WATCH_FAILED_REASON }]);
    expect(result.results.map((r) => r.status)).toEqual(["scored", "skipped", "scored"]);
    expect(result.results[0]!.proposalId).toBe(id(90));
  });
});

describe("sourceWatchSweep", () => {
  it("reads the stale sources of each business and reports what it did", async () => {
    const m = mockActivities(new Set());
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(sourceWatchSweep, { workflowId: wfId("source-watch-sweep"), taskQueue, args: [{ businessIds: [id(100), id(101)], staleAfterHours: 12 }] }));
    expect(m.watched.map((w) => [w.businessId, w.sourceId, w.reason])).toEqual([
      [id(100), id(1), "schedule"],
      [id(100), id(2), "schedule"],
    ]);
    expect(result).toMatchObject({ businesses: 2, touched: 1, eventIds: [] });
    expect(result.notes).toEqual([`${id(100)}: 2 source(s) read, 1 proposal(s), 0 failed`]);
  });
});
