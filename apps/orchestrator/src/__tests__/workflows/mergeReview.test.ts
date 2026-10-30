/**
 * mergeReview workflow: the merge step's answer decides the rest. A merge the gateway ran ends the workflow at once;
 * one the gateway asked for waits on the founder's approval (the same `approval:<id>` wait the Inbox signals) and
 * merges under it when approved, or records the refusal; a session that finished with a merge to make starts the
 * review as its own child, once per task, and does not wait for it.
 */
import type { Client } from "@temporalio/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, MergeInput, SessionLaunch, SessionResult } from "../../activities";
import { agentSession, decisionSignal, mergeReview } from "../../workflows";
import { createTemporalRig, wfId, type TemporalRig } from "./temporal";

let rig: TemporalRig;
beforeAll(async () => {
  rig = await createTemporalRig();
}, 180_000);
afterAll(async () => {
  await rig?.teardown();
});

const BUSINESS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const APPROVAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REJECTED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const input: MergeInput = { businessId: BUSINESS, taskId: TASK, agentId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222", branch: `agent/${TASK}`, acceptance: { passing: 12, total: 12 }, summary: "done" };

/** The approval's own wait, once the review started it (the Inbox signals that workflow, as it does for a plan action). */
async function approvalWaitOf(client: Client, approvalId: string) {
  const handle = client.workflow.getHandle(`approval:${approvalId}`);
  for (let i = 0; i < 400; i++) {
    try {
      if ((await handle.describe()).status.name === "RUNNING") return handle;
    } catch {
      // not started yet
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`the wait for approval ${approvalId} did not start`);
}

function mockActivities(prepared: Awaited<ReturnType<Activities["prepareMerge"]>>, approvalId = APPROVAL) {
  const calls: string[] = [];
  const acts: Partial<Activities> = {
    async prepareMerge() {
      calls.push("prepareMerge");
      return prepared;
    },
    async loadApproval() {
      calls.push("loadApproval");
      return { approvalId, outcome: null, agentId: null, planActionId: null, createdAt: "2026-10-30T08:00:00.000Z" };
    },
    async resolveApproval({ decision }) {
      calls.push(`resolveApproval:${decision.outcome}`);
      return { outcome: decision.outcome, alreadyResolved: false, eventId: null };
    },
    async completeMerge(given) {
      calls.push(`completeMerge:${given.prNumber}:${given.approvalId}:${given.decidedBy}`);
      return { status: "merged", prNumber: given.prNumber, prUrl: "https://github.com/acme/shop/pull/7", mergeCommitSha: "f".repeat(40) };
    },
    async recordMergeDecision(given) {
      calls.push(`recordMergeDecision:${given.outcome}`);
      return { status: "not_merged", prNumber: given.prNumber, prUrl: given.prUrl, reason: given.outcome };
    },
  };
  return { acts, calls };
}

describe("mergeReview workflow", () => {
  it("ends at once when the gateway ran the merge, and when there was nothing to merge", async () => {
    const merged = mockActivities({ status: "merged", prNumber: 7, prUrl: null, mergeCommitSha: "a".repeat(40) });
    expect(await rig.run(merged.acts, (client, taskQueue) => client.workflow.execute(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] }))).toMatchObject({ status: "merged", prNumber: 7 });
    expect(merged.calls).toEqual(["prepareMerge"]);
    const skipped = mockActivities({ status: "skipped", reason: "no repository is chosen on the Code tab" });
    expect(await rig.run(skipped.acts, (client, taskQueue) => client.workflow.execute(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] }))).toEqual({ status: "skipped", reason: "no repository is chosen on the Code tab" });
  });

  it("waits on the founder's approval and merges under it when approved", async () => {
    const m = mockActivities({ status: "awaiting_approval", approvalId: APPROVAL, prNumber: 7, prUrl: "https://github.com/acme/shop/pull/7" });
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] });
      // The Inbox signals the approval's own wait, as it does for a plan action.
      const wait = await approvalWaitOf(client, APPROVAL);
      await wait.signal(decisionSignal, { approvalId: APPROVAL, outcome: "approved", by: "founder-1" });
      return handle.result();
    });
    expect(result).toMatchObject({ status: "merged", prNumber: 7 });
    expect(m.calls).toEqual(["prepareMerge", "loadApproval", "resolveApproval:approved", `completeMerge:7:${APPROVAL}:founder-1`]);
  });

  it("records the founder's refusal and leaves the task in review", async () => {
    const m = mockActivities({ status: "awaiting_approval", approvalId: REJECTED, prNumber: 7, prUrl: null }, REJECTED);
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] });
      const wait = await approvalWaitOf(client, REJECTED);
      await wait.signal(decisionSignal, { approvalId: REJECTED, outcome: "rejected", by: "founder-1" });
      return handle.result();
    });
    expect(result).toEqual({ status: "not_merged", prNumber: 7, prUrl: null, reason: "rejected" });
    expect(m.calls).toEqual(["prepareMerge", "loadApproval", "resolveApproval:rejected", "recordMergeDecision:rejected"]);
  });

  it("a session that finished with a merge to make starts the review once, as a child it does not wait for", async () => {
    const launch: SessionLaunch = { sandboxMode: "mock", fellBackFrom: null, modelKey: "sonnet", modelId: "claude-sonnet-5-5", recordingKey: "stub", allowedTools: [], mcpConnectors: [], envNames: [], modelBilling: "credits", branch: `agent/${TASK}`, maxTurns: 1, planSteps: 2, acceptanceTests: 1 };
    const result: SessionResult = { outcome: "done", reason: null, blockedReason: null, approvalId: null, progress: { planStepsDone: 2, planSteps: 2, acceptanceTestsPassing: 1, acceptanceTests: 1, reviewPassed: false, merged: false, phase: "review", progress: 0.9, etaAt: null, at: null }, eventsEmitted: 4, toolCalls: 2, toolFailures: 0, tokensIn: 2, tokensOut: 1, costMinor: 1, durationMs: 60_000, prNumber: null, summary: "done", providerSessionId: null };
    const prepared: MergeInput[] = [];
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const acts: Partial<Activities> = {
      async prepareSession() {
        return launch;
      },
      async runAgentSession() {
        return result;
      },
      async postSessionCommand() {},
      async finishSession() {
        return { taskStatus: "review", eventIds: [], healthChanged: false, merge: input };
      },
      async prepareMerge(given) {
        prepared.push(given);
        await released;
        return { status: "skipped", reason: "test" };
      },
    };
    const outcome = await rig.run(acts, async (client, taskQueue) => {
      const sessionId = crypto.randomUUID();
      // Two sessions on the same task (a retry) start one review between them.
      const first = await client.workflow.execute(agentSession, { workflowId: `session:${sessionId}`, taskQueue, args: [{ businessId: BUSINESS, agentId: input.agentId, taskId: TASK, sessionId }] });
      const second = await client.workflow.execute(agentSession, { workflowId: `session:${crypto.randomUUID()}`, taskQueue, args: [{ businessId: BUSINESS, agentId: input.agentId, taskId: TASK, sessionId: crypto.randomUUID() }] });
      const review = client.workflow.getHandle(`merge:${TASK}`);
      const running = (await review.describe()).status.name;
      release();
      return { first, second, running, review: await review.result() };
    });
    // The session ended while the review was still running: it is a child the session does not wait for.
    expect(outcome.first.finish?.taskStatus).toBe("review");
    expect(outcome.second.finish?.taskStatus).toBe("review");
    expect(outcome.running).toBe("RUNNING");
    expect(outcome.review).toEqual({ status: "skipped", reason: "test" });
    expect(prepared).toEqual([input]);
  });
});
