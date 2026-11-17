/**
 * businessFoundations versioning (review item 6). The staged drafting replaced the single `draftFoundations` call; a
 * workflow started before that deploy must replay on the new code and finish on its old path, not fail its workflow
 * task with a non-determinism error forever. The staged path sits behind `patched("foundations-staged")`.
 *
 * Fixtures (`fixtures/legacy-*.json`): histories of the workflow as it was at 23545f4 (draftFoundations → applyFoundations
 * or failFoundations), recorded on the time-skipping test server with stub activities: one that finished ready, one that
 * failed on the draft, and one in flight with `draftFoundations` scheduled (the state a deploy finds it in). Delete them
 * with the legacy path (see `businessFoundations`).
 */
import { readFileSync } from "node:fs";
import { ApplicationFailure } from "@temporalio/common";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities } from "../../activities";
import { WORKFLOWS_PATH } from "../../index";
import { businessFoundations, FOUNDATIONS_PAGE_PATCH, FOUNDATIONS_POSITIONING_PATCH, FOUNDATIONS_SECOND_READ_PATCH, FOUNDATIONS_STAGED_PATCH } from "../../workflows";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

const LEGACY = ["legacy-drafting", "legacy-ready", "legacy-draft-failed"] as const;
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
/** The activities a history schedules, in order. */
const scheduled = (history: unknown): string[] =>
  ((history as { events: { activityTaskScheduledEventAttributes?: { activityType?: { name?: string } } }[] }).events ?? []).flatMap((e) => (e.activityTaskScheduledEventAttributes?.activityType?.name ? [e.activityTaskScheduledEventAttributes.activityType.name] : []));

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
}, 120_000);
afterAll(async () => {
  await rig?.teardown();
});

describe("businessFoundations: histories from before the staged drafting", () => {
  it("the fixtures are the single-call workflow", () => {
    expect(scheduled(fixture("legacy-drafting"))).toEqual(["draftFoundations"]);
    expect(scheduled(fixture("legacy-ready"))).toEqual(["draftFoundations", "applyFoundations"]);
    expect(scheduled(fixture("legacy-draft-failed"))).toEqual(["draftFoundations", "failFoundations"]);
  });

  for (const name of LEGACY) {
    it(`${name} replays on the current code without a non-determinism error`, async () => {
      await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: name }, fixture(name))).resolves.toBeUndefined();
    }, 120_000);
  }
});

describe("businessFoundations: new workflows", () => {
  it("take the staged path behind the foundations-staged patch marker, and their histories replay", async () => {
    const usage = { calls: 1, inputTokens: 10, outputTokens: 20, costMinor: 1, model: "claude-opus-5-5", mode: "mock" as const, repaired: false };
    let legacyCalls = 0;
    const acts: Partial<Activities> = {
      async draftFoundations() {
        legacyCalls++;
        throw ApplicationFailure.create({ message: "a new workflow never takes the single-call path", nonRetryable: true });
      },
      draftProjectPage: async () => ({ current: true, written: true, source: "model" as const, inboxItemId: null, usage }),
      draftPositioning: async () => ({ written: true, source: "model" as const }),
      draftFoundationsPlan: async () => ({ current: true, door: "ideation" as const, chunks: [["Problem"]], usage }),
      draftFoundationsSections: async () => ({ current: true, usage }),
      draftFoundationsRoadmap: async () => ({ current: true, usage }),
      applyFoundations: async () => ({ applied: true, inboxItemId: null }),
      failFoundations: async () => ({ failed: true }),
      secondReadDocument: async () => ({ status: "skipped" as const, reason: "it is too short to need a second read" }),
    };
    const workflowId = wfId("foundations");
    const result = await rig.run(acts, (client, taskQueue) => client.workflow.execute(businessFoundations, { workflowId, taskQueue, args: [{ businessId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", attempt: 1 }] }));
    expect(result).toEqual({ status: "ready", inboxItemId: null, error: null });
    expect(legacyCalls).toBe(0);

    const history = await rig.client.workflow.getHandle(workflowId).fetchHistory();
    const markers = (history.events ?? []).flatMap((e) => (e.markerRecordedEventAttributes ? [e.markerRecordedEventAttributes] : []));
    const patches = markers.filter((m) => m.markerName === "core_patch").map((m) => JSON.parse(Buffer.from(m.details?.["patch-data"]?.payloads?.[0]?.data ?? new Uint8Array()).toString("utf8") || "null") as { id: string; deprecated: boolean } | null);
    expect(patches).toEqual([
      { id: FOUNDATIONS_STAGED_PATCH, deprecated: false },
      { id: FOUNDATIONS_PAGE_PATCH, deprecated: false },
      { id: FOUNDATIONS_POSITIONING_PATCH, deprecated: false },
      { id: FOUNDATIONS_SECOND_READ_PATCH, deprecated: false },
    ]);
    expect(scheduled({ events: history.events ?? [] })).toEqual(["draftProjectPage", "draftPositioning", "draftFoundationsPlan", "draftFoundationsSections", "draftFoundationsRoadmap", "applyFoundations", "secondReadDocument"]);
    await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: "staged" }, history)).resolves.toBeUndefined();
  }, 120_000);
});
