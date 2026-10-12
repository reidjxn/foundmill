/**
 * incorporation with mocked activities: the founder's hard gate only opens for an owner or admin of the business
 * (audit ARB-01). A `founderSubmit` from anyone else, sent before or after the review, is ignored and the pack keeps
 * waiting; the real founder's submit, sent behind it, still goes through.
 *
 * Versioning: the checked gate sits behind `patched(INCORPORATION_SUBMITTER_PATCH)`. Fixtures
 * (`fixtures/legacy-incorporation-*.json`) are histories of the workflow as it was at 76a112c (the unchecked wait),
 * recorded on the time-skipping test server with stub activities: one in flight at the founder's gate (the state a
 * deploy finds it in) and one the founder submitted through the old API payload (`{ by, at }`, no `kind`) and filed.
 * Delete them with the legacy path (see `incorporation`).
 */
import { readFileSync } from "node:fs";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities } from "../../activities";
import { WORKFLOWS_PATH } from "../../index";
import { founderSubmitSignal, incorporation, INCORPORATION_SUBMITTER_PATCH, stopSignal } from "../../workflows";
import { createTemporalRig, type TemporalRig } from "./temporal";

const LEGACY = ["legacy-incorporation-awaiting", "legacy-incorporation-submitted"] as const;
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
}, 120_000);
afterAll(async () => {
  await rig?.teardown();
});

const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER = "0f0a0d00-0000-4000-8000-0000000000f1";
const INTRUDER = "5a1e0000-0000-4000-8000-00000000bad1";

function mockActivities() {
  const calls = { steps: [] as string[], verified: [] as (string | null)[], abandoned: null as string | null };
  const acts: Partial<Activities> = {
    async incorporationStep(input) {
      calls.steps.push(input.step);
      return { status: input.step === "complete" ? "complete" : input.step === "founder_review" ? "awaiting_founder" : "in_progress", note: input.step };
    },
    async verifyIncorporationSubmitter(input) {
      calls.verified.push(input.userId);
      return input.userId === OWNER ? { ok: true, reason: null } : { ok: false, reason: "the sender is not an owner or admin of this business" };
    },
    async abandonIncorporation(input) {
      calls.abandoned = input.reason;
    },
  };
  return { acts, calls };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
};

describe("incorporation workflow", () => {
  it("ignores a submit from someone who is not an owner or admin, then files on the founder's own submit", async () => {
    const m = mockActivities();
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(incorporation, { workflowId: `incorporation:${INC}`, taskQueue, args: [{ businessId: B, incorporationId: INC }] });
      await handle.signal(founderSubmitSignal, { kind: "submitted", by: INTRUDER });
      await until(() => m.calls.verified.length >= 1);
      // Refused: nothing filed, the pack still waits for the founder.
      expect(m.calls.steps).toEqual(["prepare_documents", "founder_review"]);
      await handle.signal(founderSubmitSignal, { kind: "submitted", by: OWNER, payload: { reference: "SC123" } });
      return handle.result();
    });
    expect(result).toEqual({ incorporationId: INC, status: "complete", submittedBy: OWNER });
    expect(m.calls.verified).toEqual([INTRUDER, OWNER]);
    expect(m.calls.steps).toEqual(["prepare_documents", "founder_review", "founder_submits", "record_filing", "complete"]);
  });

  it("a cancel from an outsider abandons nothing; stop still ends the wait", async () => {
    const m = mockActivities();
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(incorporation, { workflowId: `incorporation:${INC}-cancel`, taskQueue, args: [{ businessId: B, incorporationId: INC }] });
      await handle.signal(founderSubmitSignal, { kind: "cancel" });
      await until(() => m.calls.verified.length >= 1);
      expect(m.calls.abandoned).toBeNull();
      await handle.signal(stopSignal, { reason: "kill_switch", by: OWNER });
      return handle.result();
    });
    expect(result.status).toBe("abandoned");
    expect(m.calls.verified).toEqual([null]);
    expect(m.calls.abandoned).toBe("kill_switch");
    expect(m.calls.steps).toEqual(["prepare_documents", "founder_review"]);
  });
});

describe("incorporation: histories from before the checked gate", () => {
  for (const name of LEGACY) {
    it(`${name} replays on the current code without a non-determinism error`, async () => {
      await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: name }, fixture(name))).resolves.toBeUndefined();
    }, 120_000);
  }

  it("a new workflow records the incorporation-submitter-checked marker, and its history replays", async () => {
    const m = mockActivities();
    const workflowId = `incorporation:${INC}-marker`;
    await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(incorporation, { workflowId, taskQueue, args: [{ businessId: B, incorporationId: INC }] });
      await handle.signal(founderSubmitSignal, { kind: "submitted", by: OWNER });
      return handle.result();
    });
    const history = await rig.client.workflow.getHandle(workflowId).fetchHistory();
    const markers = (history.events ?? []).flatMap((e) => (e.markerRecordedEventAttributes ? [e.markerRecordedEventAttributes] : []));
    const patches = markers.filter((mk) => mk.markerName === "core_patch").map((mk) => JSON.parse(Buffer.from(mk.details?.["patch-data"]?.payloads?.[0]?.data ?? new Uint8Array()).toString("utf8") || "null") as { id: string; deprecated: boolean } | null);
    expect(patches).toEqual([{ id: INCORPORATION_SUBMITTER_PATCH, deprecated: false }]);
    await expect(Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH, replayName: "checked" }, history)).resolves.toBeUndefined();
  }, 120_000);
});
