/**
 * incorporation with mocked activities: the founder's hard gate only opens for an owner or admin of the business
 * (audit ARB-01). A `founderSubmit` from anyone else, sent before or after the review, is ignored and the pack keeps
 * waiting; the real founder's submit, sent behind it, still goes through.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities } from "../../activities";
import { founderSubmitSignal, incorporation, stopSignal } from "../../workflows";
import { createTemporalRig, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
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
