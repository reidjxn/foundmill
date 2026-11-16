/**
 * businessCycle versioning (WP-05 T15). A capped cycle now runs only as many sessions at a time as its cap pays for at
 * `MIN_SESSION_CAP_MINOR`, behind `patched(CYCLE_CAP_FLOOR_PATCH)`. A capped cycle recorded before that deploy split
 * its cap across every free slot; it must replay on the new code down the same path, not fail its workflow task with a
 * non-determinism error.
 *
 * Fixture (`fixtures/legacy-cycle-capped.json`): a history of the workflow as it was at 48d649fa, recorded on the
 * time-skipping test server with stub activities: an overnight round with a 15-cent cap and four free slots, which
 * started four sessions with 3, 4, 4 and 4 cents. Delete it once no cycle started on the old code can still be running.
 */
import { readFileSync } from "node:fs";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { WORKFLOWS_PATH } from "../../index";
import { CYCLE_CAP_FLOOR_PATCH } from "../../workflows/businessCycle";

const LEGACY = "legacy-cycle-capped";
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
type HistoryLike = { events: { startChildWorkflowExecutionInitiatedEventAttributes?: { input?: { payloads?: { data?: string }[] } }; markerRecordedEventAttributes?: { details?: Record<string, { payloads?: { data?: string }[] }> } }[] };
/** The cap each child session was started with, in order. */
const childCaps = (history: unknown): (number | undefined)[] =>
  (history as HistoryLike).events.flatMap((e) => {
    const data = e.startChildWorkflowExecutionInitiatedEventAttributes?.input?.payloads?.[0]?.data;
    return data ? [(JSON.parse(Buffer.from(data, "base64").toString("utf8")) as { spendCapMinor?: number }).spendCapMinor] : [];
  });
/** The patch ids the history recorded. */
const patches = (history: unknown): string[] =>
  (history as HistoryLike).events.flatMap((e) => {
    const data = e.markerRecordedEventAttributes?.details?.["patch-data"]?.payloads?.[0]?.data;
    return data ? [(JSON.parse(Buffer.from(data, "base64").toString("utf8")) as { id: string }).id] : [];
  });

describe("businessCycle: histories from before the floor for a capped cycle", () => {
  it("the fixture split 15 cents into four sessions and has no floor marker", () => {
    expect(childCaps(fixture(LEGACY))).toEqual([3, 4, 4, 4]);
    expect(patches(fixture(LEGACY))).toEqual(["merge-sweep", "cycle-budget-reconcile", "cycle-follow-ups"]);
    expect(patches(fixture(LEGACY))).not.toContain(CYCLE_CAP_FLOOR_PATCH);
  });

  it(`${LEGACY} replays on the current code without a non-determinism error`, async () => {
    await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: LEGACY }, fixture(LEGACY))).resolves.toBeUndefined();
  }, 120_000);
});
