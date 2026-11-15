/**
 * mergeReview versioning (WP-05 T17). A fresh second read that asks for changes now sends the change back to its author
 * once before the founder is asked, behind `patched(MERGE_REVIEW_HAND_BACK_PATCH)`. A review recorded before that deploy
 * went on to ask the founder; it must replay on the new code down the same path, not fail its workflow task with a
 * non-determinism error.
 *
 * Fixture (`fixtures/legacy-merge-review-changes.json`): a history of the workflow as it was at bbb15784, recorded on the
 * time-skipping test server with stub activities: the second read answered `request_changes` (fresh, two findings), the
 * merge was asked for, the founder approved and it merged. Delete it once no review started on the old code can still be
 * running.
 */
import { readFileSync } from "node:fs";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, MergeInput } from "../../activities";
import { WORKFLOWS_PATH } from "../../index";
import { mergeReview } from "../../workflows";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

const LEGACY = "legacy-merge-review-changes";
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

describe("mergeReview: histories from before a review could send work back", () => {
  it("the fixture asked the founder after a review that asked for changes", () => {
    expect(scheduled(fixture(LEGACY))).toEqual(["prepareMerge", "assessMerge", "secondReadMerge", "askMerge", "completeMerge"]);
  });

  it(`${LEGACY} replays on the current code without a non-determinism error`, async () => {
    await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: LEGACY }, fixture(LEGACY))).resolves.toBeUndefined();
  }, 120_000);
});

describe("mergeReview: new reviews", () => {
  it("a review that sends the change back records a history that replays", async () => {
    const BUSINESS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const TASK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const input: MergeInput = { businessId: BUSINESS, taskId: TASK, agentId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222", branch: `agent/${TASK}`, acceptance: { passing: 2, total: 2 }, summary: "done" };
    const PR = { prNumber: 7, prUrl: "https://github.com/acme/shop/pull/7" };
    const acts: Partial<Activities> = {
      prepareMerge: async () => ({ status: "ready", ...PR, checksStarted: false, checksNote: null }),
      assessMerge: async () => ({ mergeable: "ready", checks: "pending", detail: null }),
      secondReadMerge: async () => ({ status: "reviewed", cached: false, verdict: "request_changes", findings: 1, reviewerAgentId: "33333333-3333-4333-8333-333333333333", headSha: "a".repeat(40), handedBackBefore: false, handBackDetail: "findings" }),
      handBack: async (g) => ({ status: "handed_back", why: g.why, reason: "back", prNumber: g.prNumber, prUrl: g.prUrl }),
    };
    const workflowId = wfId("merge");
    const result = await rig.run(acts, (client, taskQueue) => client.workflow.execute(mergeReview, { workflowId, taskQueue, args: [input] }));
    expect(result).toMatchObject({ status: "handed_back", why: "review" });
    const history = await rig.client.workflow.getHandle(workflowId).fetchHistory();
    expect(scheduled(history)).toEqual(["prepareMerge", "assessMerge", "secondReadMerge", "handBack"]);
    await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: "review-hand-back" }, history)).resolves.toBeUndefined();
  }, 120_000);
});
