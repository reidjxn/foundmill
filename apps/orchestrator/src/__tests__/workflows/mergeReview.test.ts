/**
 * mergeReview workflow: GitHub's merge state decides whether anyone is asked (a conflicting branch goes back to its agent
 * before the founder sees it); the merge is asked for, waits on the founder's approval (the same `approval:<id>` wait the
 * Inbox signals), then on the repository's checks, and runs under the approval; checks that fail hand the branch back,
 * checks that never conclude hold the merge, a refusal is retried and then held; a session that finished with a merge to
 * make starts the review as its own child, once per task, and does not wait for it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Activities, MergeAssessment, MergeInput, MergeOutcome, SessionLaunch, SessionResult } from "../../activities";
import { agentSession, decisionSignal, mergeReview } from "../../workflows";
import { ASSESS_TRIES, MERGE_RETRIES } from "../../workflows/mergeReview";
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
const input: MergeInput = { businessId: BUSINESS, taskId: TASK, agentId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222", branch: `agent/${TASK}`, acceptance: { passing: 12, total: 12 }, summary: "done" };
const PR = { prNumber: 7, prUrl: "https://github.com/acme/shop/pull/7" };
let approvals = 0;
/** A fresh approval id per test: the approval's own wait is a workflow named after it. */
const nextApproval = () => `${APPROVAL.slice(0, -4)}${String((approvals += 1)).padStart(4, "0")}`;

interface Script {
  prepared?: Awaited<ReturnType<Activities["prepareMerge"]>>;
  /** Answers to `assessMerge`, in order; the last repeats. */
  assess?: MergeAssessment[];
  /** Answers to `awaitChecks`, in order; the last repeats. */
  checks?: MergeAssessment["checks"][];
  /** Answers to `completeMerge`, in order; the last repeats. */
  complete?: (MergeOutcome & { retryable?: boolean })[];
  /** Answers to `updateBranch`, in order; the last repeats. */
  update?: Awaited<ReturnType<Activities["updateBranch"]>>[];
  approvalId?: string;
  /** The second read of the diff fails (the merge is asked for all the same). */
  reviewFails?: boolean;
}

function mockActivities(script: Script) {
  const approvalId = script.approvalId ?? nextApproval();
  const calls: string[] = [];
  const next = <T>(list: T[] | undefined, i: number, fallback: T): T => (list && list.length ? list[Math.min(i, list.length - 1)]! : fallback);
  let assessed = 0;
  let checked = 0;
  let completed = 0;
  let updates = 0;
  /** The second reads, apart from `calls` (the merge's own steps); `askedAfter` is how many had run when the merge was asked for. */
  const reviews: number[] = [];
  let askedAfter: number | null = null;
  /** The reviewed commit each merge call named (askMerge first, then every completeMerge). */
  const shas: (string | null | undefined)[] = [];
  const acts: Partial<Activities> = {
    async secondReadMerge(given) {
      reviews.push(given.prNumber);
      if (script.reviewFails) throw new Error("the model is down");
      return { status: "reviewed", cached: false, verdict: "comment", findings: 1, reviewerAgentId: "33333333-3333-4333-8333-333333333333", headSha: "a".repeat(40) };
    },
    async updateBranch() {
      calls.push("updateBranch");
      return next(script.update, updates++, { updated: true, reason: null, checksStarted: true });
    },
    async prepareMerge() {
      calls.push("prepareMerge");
      return script.prepared ?? { status: "ready", ...PR, checksStarted: true, checksNote: null };
    },
    async assessMerge() {
      calls.push("assessMerge");
      return next(script.assess, assessed++, { mergeable: "ready", checks: "pending", detail: null });
    },
    async askMerge(given) {
      calls.push("askMerge");
      askedAfter ??= reviews.length;
      shas.push(given.reviewedSha);
      return { status: "awaiting_approval", approvalId, prNumber: given.prNumber, prUrl: given.prUrl };
    },
    async loadApproval() {
      calls.push("loadApproval");
      return { approvalId, outcome: null, agentId: null, planActionId: null, createdAt: "2026-11-01T08:00:00.000Z" };
    },
    async resolveApproval({ decision }) {
      calls.push(`resolveApproval:${decision.outcome}`);
      return { outcome: decision.outcome, alreadyResolved: false, eventId: null };
    },
    async awaitChecks(given) {
      calls.push(`awaitChecks:${given.first ? "first" : "again"}`);
      return { state: next(script.checks, checked++, "success") };
    },
    async completeMerge(given) {
      calls.push(`completeMerge:${given.prNumber}:${given.approvalId}:${given.decidedBy}`);
      shas.push(given.reviewedSha);
      return next(script.complete, completed++, { status: "merged", prNumber: given.prNumber, prUrl: given.prUrl, mergeCommitSha: "f".repeat(40) });
    },
    async handBack(given) {
      calls.push(`handBack:${given.why}:${given.approvalId}`);
      return { status: "handed_back", why: given.why, reason: given.why, prNumber: given.prNumber, prUrl: given.prUrl };
    },
    async holdMerge(given) {
      calls.push(`holdMerge:${given.why}:${given.approvalId}`);
      return { status: "held", reason: given.why, prNumber: given.prNumber, prUrl: given.prUrl };
    },
    async recordMergeDecision(given) {
      calls.push(`recordMergeDecision:${given.outcome}`);
      return { status: "not_merged", prNumber: given.prNumber, prUrl: given.prUrl, reason: given.outcome };
    },
  };
  return { acts, calls, approvalId, reviews, shas, askedAfter: () => askedAfter };
}

/**
 * The review sleeps between its looks at GitHub (15 s while the merge state is computed, a minute between checks, half a
 * minute between merge retries): the test server's clock is moved past them, five minutes at a time, until the workflow
 * ends (or the approval's wait appears), so no test waits in real time.
 */
async function skipUntil(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (await done()) return;
    await rig.env.sleep("5 minutes");
  }
  throw new Error("the review did not get there within 5 skipped hours");
}

/** Runs the review and answers its approval with `outcome` once the wait is up. */
async function reviewDecided(m: ReturnType<typeof mockActivities>, outcome: "approved" | "rejected") {
  return rig.run(m.acts, async (client, taskQueue) => {
    const handle = await client.workflow.start(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] });
    const wait = client.workflow.getHandle(`approval:${m.approvalId}`);
    await skipUntil(() => wait.describe().then((d) => d.status.name === "RUNNING").catch(() => false));
    await wait.signal(decisionSignal, { approvalId: m.approvalId, outcome, by: "founder-1" });
    await skipUntil(() => handle.describe().then((d) => d.status.name !== "RUNNING"));
    return handle.result();
  });
}

describe("mergeReview workflow", () => {
  it("ends at once when there is nothing to merge, or the pull request could not be opened", async () => {
    const skipped = mockActivities({ prepared: { status: "skipped", reason: "no repository is chosen on the Code tab" } });
    expect(await rig.run(skipped.acts, (client, taskQueue) => client.workflow.execute(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] }))).toEqual({ status: "skipped", reason: "no repository is chosen on the Code tab" });
    expect(skipped.calls).toEqual(["prepareMerge"]);
    const held = mockActivities({ prepared: { status: "held", reason: "the pull request could not be opened: no", prNumber: null, prUrl: null } });
    expect(await rig.run(held.acts, (client, taskQueue) => client.workflow.execute(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] }))).toMatchObject({ status: "held" });
  });

  it("a different agent reads the diff before the merge is asked for; a failed read never stops the founder being asked", async () => {
    const m = mockActivities({});
    expect(await reviewDecided(m, "approved")).toMatchObject({ status: "merged" });
    expect(m.reviews).toEqual([7]);
    expect(m.askedAfter()).toBe(1);
    // The commit the review read is the one the merge asks for, and the approved merge names the same one (M4).
    expect(m.shas).toEqual(["a".repeat(40), "a".repeat(40)]);
    const failing = mockActivities({ reviewFails: true });
    expect(await reviewDecided(failing, "approved")).toMatchObject({ status: "merged" });
    // Tried once (no retries), then the merge is asked for as before.
    expect(failing.reviews).toEqual([7]);
    expect(failing.calls).toContain("askMerge");
    expect(failing.shas[0]).toBeNull();
    // A branch handed back before anyone is asked gets no second read.
    const conflicts = mockActivities({ assess: [{ mergeable: "conflicts", checks: "pending", detail: null }] });
    await rig.run(conflicts.acts, (client, taskQueue) => client.workflow.execute(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] }));
    expect(conflicts.reviews).toEqual([]);
  });

  it("a conflicting branch goes back to its agent before anyone is asked; GitHub is given time to compute the state", async () => {
    const m = mockActivities({ assess: [{ mergeable: "unknown", checks: "unknown", detail: null }, { mergeable: "unknown", checks: "unknown", detail: null }, { mergeable: "conflicts", checks: "pending", detail: "GitHub reports the pull request as dirty" }] });
    const result = await rig.run(m.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] });
      await skipUntil(() => handle.describe().then((d) => d.status.name !== "RUNNING"));
      return handle.result();
    });
    expect(result).toMatchObject({ status: "handed_back", why: "conflicts", prNumber: 7 });
    expect(m.calls).toEqual(["prepareMerge", "assessMerge", "assessMerge", "assessMerge", "handBack:conflicts:null"]);
    // A state GitHub never computes is read as ready: the merge itself decides.
    const never = mockActivities({ assess: [{ mergeable: "unknown", checks: "unknown", detail: null }] });
    await reviewDecided(never, "approved");
    expect(never.calls.filter((c) => c === "assessMerge")).toHaveLength(ASSESS_TRIES);
    expect(never.calls).toContain("askMerge");
  });

  it("a branch the default branch moved past is brought up to date and re-read before anyone is asked; one GitHub cannot update goes back to its agent", async () => {
    const m = mockActivities({ assess: [{ mergeable: "ready", checks: "success", detail: null, behindBy: 3 }, { mergeable: "ready", checks: "pending", detail: null, behindBy: 0 }], checks: ["success"] });
    const result = await reviewDecided(m, "approved");
    expect(result).toMatchObject({ status: "merged", prNumber: 7 });
    // The stale head's green checks are not trusted: the new head's are waited for after the approval.
    expect(m.calls).toEqual(["prepareMerge", "assessMerge", "updateBranch", "assessMerge", "askMerge", "loadApproval", "resolveApproval:approved", "awaitChecks:first", `completeMerge:7:${m.approvalId}:founder-1`]);

    // GitHub's own word for it, with the compare silent, reads the same.
    const word = mockActivities({ assess: [{ mergeable: "behind", checks: "unknown", detail: null }, { mergeable: "ready", checks: "pending", detail: null, behindBy: 0 }] });
    await reviewDecided(word, "approved");
    expect(word.calls.slice(0, 5)).toEqual(["prepareMerge", "assessMerge", "updateBranch", "assessMerge", "askMerge"]);

    // Conflicts appeared when GitHub tried: the agent's turn, nobody asked.
    const stuck = mockActivities({ assess: [{ mergeable: "ready", checks: "pending", detail: null, behindBy: 1 }], update: [{ updated: false, reason: "Pull Request #7 conflicts with main", checksStarted: false }] });
    const handed = await rig.run(stuck.acts, async (client, taskQueue) => {
      const handle = await client.workflow.start(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] });
      await skipUntil(() => handle.describe().then((d) => d.status.name !== "RUNNING"));
      return handle.result();
    });
    expect(handed).toMatchObject({ status: "handed_back", why: "conflicts" });
    expect(stuck.calls).toEqual(["prepareMerge", "assessMerge", "updateBranch", "handBack:conflicts:null"]);

    // Nothing to update after all (GitHub says it is current): the review goes straight on.
    const current = mockActivities({ assess: [{ mergeable: "ready", checks: "pending", detail: null, behindBy: 1 }], update: [{ updated: false, reason: null, checksStarted: false }] });
    await reviewDecided(current, "approved");
    expect(current.calls.slice(0, 4)).toEqual(["prepareMerge", "assessMerge", "updateBranch", "askMerge"]);
  });

  it("a merge refused because the default branch moved after the approval brings the branch in once more and merges", async () => {
    const m = mockActivities({ complete: [{ status: "held", reason: "not mergeable", prNumber: 7, prUrl: PR.prUrl, retryable: false }, { status: "merged", prNumber: 7, prUrl: PR.prUrl, mergeCommitSha: "e".repeat(40) }], assess: [{ mergeable: "ready", checks: "pending", detail: null, behindBy: 0 }, { mergeable: "ready", checks: "pending", detail: null, behindBy: 2 }] });
    const result = await reviewDecided(m, "approved");
    expect(result).toMatchObject({ status: "merged", mergeCommitSha: "e".repeat(40) });
    expect(m.calls.filter((c) => c === "updateBranch")).toHaveLength(1);
    expect(m.calls.filter((c) => c.startsWith("completeMerge"))).toHaveLength(2);
    expect(m.calls.filter((c) => c.startsWith("awaitChecks"))).toEqual(["awaitChecks:first", "awaitChecks:again"]);
  });

  it("checks that already failed hand the branch back without asking", async () => {
    const m = mockActivities({ assess: [{ mergeable: "ready", checks: "failure", detail: null }] });
    const result = await rig.run(m.acts, (client, taskQueue) => client.workflow.execute(mergeReview, { workflowId: wfId("merge"), taskQueue, args: [input] }));
    expect(result).toMatchObject({ status: "handed_back", why: "checks_failed" });
    expect(m.calls).toEqual(["prepareMerge", "assessMerge", "handBack:checks_failed:null"]);
  });

  it("asks the founder, waits for the approval and then for the checks, and merges under the approval", async () => {
    const m = mockActivities({ assess: [{ mergeable: "ready", checks: "pending", detail: null }], checks: ["pending", "pending", "success"] });
    const result = await reviewDecided(m, "approved");
    expect(result).toMatchObject({ status: "merged", prNumber: 7 });
    expect(result).not.toHaveProperty("retryable");
    expect(m.calls).toEqual(["prepareMerge", "assessMerge", "askMerge", "loadApproval", "resolveApproval:approved", "awaitChecks:first", "awaitChecks:again", "awaitChecks:again", `completeMerge:7:${m.approvalId}:founder-1`]);
  });

  it("without a test run to wait for, the approved merge is tried at once and the repository's rules decide", async () => {
    const m = mockActivities({ prepared: { status: "ready", ...PR, checksStarted: false, checksNote: "no workflow" } });
    const result = await reviewDecided(m, "approved");
    expect(result).toMatchObject({ status: "merged" });
    expect(m.calls.filter((c) => c.startsWith("awaitChecks"))).toEqual([]);
  });

  it("checks that fail after the approval hand the branch back, on record against the approval", async () => {
    const m = mockActivities({ checks: ["pending", "failure"] });
    const result = await reviewDecided(m, "approved");
    expect(result).toMatchObject({ status: "handed_back", why: "checks_failed" });
    expect(m.calls.at(-1)).toBe(`handBack:checks_failed:${m.approvalId}`);
  });

  it("checks that never conclude hold the merge for the next cycle (time skipped to the limit)", async () => {
    const m = mockActivities({ checks: ["pending"] });
    const result = await reviewDecided(m, "approved");
    expect(result).toMatchObject({ status: "held", reason: "checks_timeout" });
    expect(m.calls.at(-1)).toBe(`holdMerge:checks_timeout:${m.approvalId}`);
    expect(m.calls.filter((c) => c.startsWith("awaitChecks")).length).toBeGreaterThan(10);
  });

  it("a merge GitHub refuses right after the checks passed is tried again, then held; conflicts found meanwhile hand the branch back", async () => {
    const refused: MergeOutcome & { retryable?: boolean } = { status: "held", reason: "the approved merge did not run: Pull Request #7 is not mergeable", ...PR, retryable: true };
    const eventually = mockActivities({ complete: [refused, refused, { status: "merged", ...PR, mergeCommitSha: "e".repeat(40) }] });
    expect(await reviewDecided(eventually, "approved")).toMatchObject({ status: "merged" });
    expect(eventually.calls.filter((c) => c.startsWith("completeMerge"))).toHaveLength(3);

    const always = mockActivities({ complete: [refused] });
    expect(await reviewDecided(always, "approved")).toMatchObject({ status: "held", reason: "refused" });
    expect(always.calls.filter((c) => c.startsWith("completeMerge"))).toHaveLength(1 + MERGE_RETRIES);
    expect(always.calls.at(-1)).toBe(`holdMerge:refused:${always.approvalId}`);

    const conflicted = mockActivities({ complete: [refused], assess: [{ mergeable: "ready", checks: "pending", detail: null }, { mergeable: "conflicts", checks: "success", detail: "dirty" }] });
    expect(await reviewDecided(conflicted, "approved")).toMatchObject({ status: "handed_back", why: "conflicts" });
    expect(conflicted.calls.at(-1)).toBe(`handBack:conflicts:${conflicted.approvalId}`);
  });

  it("records the founder's refusal and leaves the task in review", async () => {
    const m = mockActivities({});
    const result = await reviewDecided(m, "rejected");
    expect(result).toEqual({ status: "not_merged", prNumber: 7, prUrl: PR.prUrl, reason: "rejected" });
    expect(m.calls).toEqual(["prepareMerge", "assessMerge", "askMerge", "loadApproval", "resolveApproval:rejected", "recordMergeDecision:rejected"]);
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
