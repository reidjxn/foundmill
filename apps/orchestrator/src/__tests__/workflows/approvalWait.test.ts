/**
 * approvalWait: waits for the `decision` signal (no timeout by default), resolves the approval, expires on timeout. An
 * answer the Inbox stored without its signal reaching the wait is found by the hourly re-read and by the timeout (O-02).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, ApprovalDecision } from "../../activities";
import { approvalWait, decisionSignal } from "../../workflows";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
});
afterAll(async () => {
  await rig?.teardown();
});

const APPROVAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUSINESS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * `outcome` is what the row holds when the wait starts; `storedLater` is what the Inbox stores afterwards without the
 * signal reaching the wait (seen from the second read on).
 */
function mockActivities(outcome: string | null = null, storedLater: "approved" | "rejected" | null = null) {
  const resolved: ApprovalDecision[] = [];
  let expired = 0;
  let loads = 0;
  const acts: Partial<Activities> = {
    async loadApproval() {
      loads += 1;
      return { approvalId: APPROVAL, outcome: loads > 1 && storedLater ? storedLater : outcome, agentId: null, planActionId: null, createdAt: "2026-10-05T08:00:00.000Z" };
    },
    async resolveApproval({ decision }) {
      resolved.push(decision);
      return { outcome: decision.outcome, alreadyResolved: false, eventId: null };
    },
    async expireApproval() {
      if (storedLater) return { expired: false, outcome: storedLater };
      expired += 1;
      return { expired: true, outcome: "expired" };
    },
  };
  return { acts, resolved, expired: () => expired, loads: () => loads };
}

describe("approvalWait workflow", () => {
  it("resolves on the decision signal and ignores decisions for other approvals", async () => {
    const m = mockActivities();
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(approvalWait, { workflowId: wfId("approval"), taskQueue, args: [{ businessId: BUSINESS, approvalId: APPROVAL }] });
      await handle.signal(decisionSignal, { approvalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", outcome: "rejected", by: "someone" });
      await handle.signal(decisionSignal, { approvalId: APPROVAL, outcome: "approved", by: "founder-1" });
      return handle.result();
    });
    expect(result).toEqual({ approvalId: APPROVAL, outcome: "approved", decidedBy: "founder-1", alreadyResolved: false });
    expect(m.resolved).toEqual([{ approvalId: APPROVAL, outcome: "approved", by: "founder-1" }]);
    expect(m.expired()).toBe(0);
  });

  it("expires when a timeout is given and nobody decides (time skipped)", async () => {
    const m = mockActivities();
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(approvalWait, { workflowId: wfId("approval"), taskQueue, args: [{ businessId: BUSINESS, approvalId: APPROVAL, timeoutMs: 3 * 24 * 60 * 60 * 1000 }] }));
    expect(result.outcome).toBe("expired");
    expect(m.expired()).toBe(1);
    expect(m.resolved).toEqual([]);
  });

  it("a wait with no timeout picks up an answer stored without its signal at the next hourly read", async () => {
    const m = mockActivities(null, "approved");
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(approvalWait, { workflowId: wfId("approval"), taskQueue, args: [{ businessId: BUSINESS, approvalId: APPROVAL }] }));
    expect(result).toEqual({ approvalId: APPROVAL, outcome: "approved", decidedBy: null, alreadyResolved: true });
    expect(m.loads()).toBe(2);
    expect(m.resolved).toEqual([]);
  });

  it("a timeout never expires an approval the founder answered: the stored answer comes back (channel engines)", async () => {
    const m = mockActivities(null, "rejected");
    // Shorter than one re-read, so only the timeout can find the answer.
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(approvalWait, { workflowId: wfId("approval"), taskQueue, args: [{ businessId: BUSINESS, approvalId: APPROVAL, timeoutMs: 10 * 60 * 1000 }] }));
    expect(result).toEqual({ approvalId: APPROVAL, outcome: "rejected", decidedBy: null, alreadyResolved: true });
    expect(m.expired()).toBe(0);
  });

  it("returns immediately for an approval that is already resolved", async () => {
    const m = mockActivities("rejected");
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(approvalWait, { workflowId: wfId("approval"), taskQueue, args: [{ businessId: BUSINESS, approvalId: APPROVAL }] }));
    expect(result).toMatchObject({ outcome: "rejected", alreadyResolved: true });
  });
});
