/**
 * Review to merge (activities/merge.ts): a code task that passed its tests gets its pull request opened and the
 * repository's tests started; GitHub's merge state is read before anyone is asked (a conflicting branch goes back to its
 * agent); the merge is asked for through the gateway, waits for the checks once approved, runs under the approval and
 * ends the task; every outcome after the founder's answer is on record against the approval.
 */
import { createGithubMock } from "@foundmill/connectors/connectors/github/mock";
import { makeToolContext } from "@foundmill/connectors/testing/contract-suite";
import { isUntrusted } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMergeActivities, handBackDetail, MERGE_AUDIT, mergeableOf, mergeArgs, pullRequestBody } from "../activities/merge";
import type { MergeInput } from "../activities/types";
import { createOfflineGatewayClient, type GatewayCallResponse, type GatewayClient } from "../gateway-client";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "merge" });
});
afterAll(async () => {
  await t?.close();
});
afterEach(async () => {
  const row = await repos.integrations.getByKey(t.deps.db, t.businessId, "github");
  if (row && !row.archivedAt) await repos.integrations.disconnect(t.deps.db, t.businessId, row.id);
});

const APPROVAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPO = { owner: "acme", repo: "shop" };

/** A gateway whose GitHub calls land on one mock; `call` forces an answer for a tool (policy outcomes, refusals). */
function githubGateway(github = createGithubMock(), force: (req: { tool: string; args: Record<string, unknown> }) => GatewayCallResponse | null = () => null) {
  const offline = createOfflineGatewayClient();
  const ctx = makeToolContext(github);
  const gateway: GatewayClient = {
    ...offline,
    async call(_token, req) {
      offline.calls.push(req);
      return force(req) ?? { outcome: "allow", result: await github.callTool(req.tool, req.args, ctx), costMinor: 0 };
    },
  };
  return { github, gateway, offline, ctx, acts: createMergeActivities({ ...t.deps, gateway }) };
}

/** The gateway's answer when its policy makes the merge the founder's decision (every mode, decision 2026-11-01). */
const asksForMerge = (req: { tool: string }): GatewayCallResponse | null => (req.tool === "merge_pr" ? { outcome: "ask", approvalId: APPROVAL, reasons: ["You chose to be asked before anything goes live"] } : null);

const unwrap = <T>(r: { data?: unknown }): T => (isUntrusted(r.data) ? r.data.content : r.data) as T;

async function reviewTask(title = "Deploy contract"): Promise<{ task: { id: string; title: string; goalMd: string }; input: MergeInput }> {
  const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title, goalMd: "Ship the deploy contract so the deploy tasks can start.", assigneeAgentId: t.workerId, status: "ready" });
  await repos.tasks.setStatus(t.db, t.businessId, task.id, "review", { force: true });
  const sessionId = await openSessionRow(t, t.workerId, task.id);
  return { task, input: { businessId: t.businessId, taskId: task.id, agentId: t.workerId, sessionId, branch: `agent/${task.id}`, acceptance: { passing: 145, total: 145 }, summary: "Added the deploy contract and its tests." } };
}

const connectRepo = () => repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });
const commitOn = (github: ReturnType<typeof createGithubMock>, ctx: ReturnType<typeof makeToolContext>, branch: string, path = "DEPLOY.md") => github.callTool("commit_files", { ...REPO, branch, message: "work", files: [{ path, content: `${path}\n` }] }, ctx);
const auditOf = async (action: string | string[]) => (await repos.audit.list(t.db, t.businessId, { action, limit: 20 })).items;

describe("prepareMerge", () => {
  it("opens the pull request on the default branch and starts the repository's tests, on separate read and write tokens", async () => {
    await connectRepo();
    const { github, offline, ctx, acts } = githubGateway();
    const { task, input } = await reviewTask();
    await commitOn(github, ctx, input.branch);

    const prepared = await acts.prepareMerge(input);
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") return;
    expect(prepared).toMatchObject({ checksStarted: true, checksNote: null, prUrl: `https://github.com/acme/shop/pull/${prepared.prNumber}` });
    expect(offline.calls.map((c) => c.tool)).toEqual(["list_pull_requests", "compare_refs", "open_pr", "run_checks"]);
    expect(offline.calls[2]!.args).toMatchObject({ head: input.branch, base: "HEAD", draft: false, title: "Deploy contract" });
    // Reads and writes on separate tokens: the reads' token can do nothing else, so the gateway answers them as data.
    expect(offline.minted.slice(-2)).toEqual([expect.objectContaining({ agentId: t.workerId, sessionId: input.sessionId, allowedTools: ["github:compare_refs", "github:list_pull_requests", "github:get_pull_request", "github:get_checks"] }), expect.objectContaining({ allowedTools: ["github:open_pr", "github:run_checks", "github:merge_pr"] })]);

    // The pull request's body says what was tested and that the founder decides; the task waits in review.
    const pr = unwrap<{ body: string; base: { ref: string }; merged: boolean }>(await github.callTool("get_pull_request", { ...REPO, prNumber: prepared.prNumber }, ctx));
    expect(pr.base.ref).toBe("main");
    expect(pr.merged).toBe(false);
    expect(pr.body).toContain("145 of 145 acceptance tests passed");
    expect(pr.body).toContain("Nothing goes live until the founder says so");
    expect(pr.body).toBe(pullRequestBody(input, task));
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("review");
    expect((await auditOf(MERGE_AUDIT.prepared))[0]).toMatchObject({ details: { prNumber: prepared.prNumber, ci: "started" } });

    // A second look finds the open pull request and starts nothing new.
    offline.calls.length = 0;
    const again = await acts.prepareMerge(input);
    expect(again).toMatchObject({ status: "ready", prNumber: prepared.prNumber });
    expect(offline.calls.map((c) => c.tool)).toEqual(["list_pull_requests", "compare_refs", "run_checks"]);
  });

  it("notes a repository whose tests cannot be started instead of failing the review", async () => {
    await connectRepo();
    const { github, ctx, acts } = githubGateway(undefined, (req) => (req.tool === "run_checks" ? { outcome: "allow", costMinor: 0, result: { ok: false, error: { code: "vendor_error", message: "Workflow does not have 'workflow_dispatch' trigger" } } } : null));
    const { input } = await reviewTask("No CI");
    await commitOn(github, ctx, input.branch);
    const prepared = await acts.prepareMerge(input);
    expect(prepared).toMatchObject({ status: "ready", checksStarted: false, checksNote: "Workflow does not have 'workflow_dispatch' trigger" });
    expect((await auditOf(MERGE_AUDIT.prepared))[0]).toMatchObject({ details: { ci: "Workflow does not have 'workflow_dispatch' trigger" } });
  });

  it("a task marked done with its work only on its branch goes back to review and gets its pull request; one with nothing to merge stays done", async () => {
    await connectRepo();
    const { github, ctx, acts } = githubGateway();
    const { task, input } = await reviewTask("Done on its branch");
    await repos.tasks.setStatus(t.db, t.businessId, task.id, "done", { force: true });
    await commitOn(github, ctx, input.branch, "contract.ts");
    const prepared = await acts.prepareMerge(input);
    expect(prepared.status).toBe("ready");
    expect((await auditOf(MERGE_AUDIT.reopened))[0]).toMatchObject({ target: { kind: "task", id: task.id } });
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("review");

    // A done task whose branch holds nothing new (created, never committed to) is left done, and on record.
    const empty = await reviewTask("Nothing new");
    await repos.tasks.setStatus(t.db, t.businessId, empty.task.id, "done", { force: true });
    await github.callTool("create_branch", { ...REPO, branch: empty.input.branch }, ctx);
    expect(await acts.prepareMerge(empty.input)).toEqual({ status: "skipped", reason: `${empty.input.branch} has nothing the default branch lacks` });
    expect((await repos.tasks.get(t.db, t.businessId, empty.task.id)).status).toBe("done");
    expect((await auditOf(MERGE_AUDIT.notMerged))[0]).toMatchObject({ target: { id: empty.task.id }, details: { step: "nothing_to_merge" } });
  });

  it("skips when there is nothing to merge: no repository, pushing off, not a code task, not in review", async () => {
    const { acts } = githubGateway();
    const { task, input } = await reviewTask("No repo");
    expect(await acts.prepareMerge(input)).toEqual({ status: "skipped", reason: "no repository is chosen on the Code tab" });
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: false } });
    expect(await acts.prepareMerge(input)).toEqual({ status: "skipped", reason: "pushing to acme/shop is turned off (the Code tab)" });
    await repos.tasks.setStatus(t.db, t.businessId, task.id, "ready", { force: true });
    expect(await acts.prepareMerge(input)).toEqual({ status: "skipped", reason: "the task is ready, not in review" });
    const research = await repos.tasks.create(t.db, t.businessId, { kind: "research", title: "Read", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    expect(await acts.prepareMerge({ ...input, taskId: research.id })).toEqual({ status: "skipped", reason: "research tasks have no branch to merge" });
  });
});

describe("assessMerge and handBack", () => {
  it("reads GitHub's merge state and the checks; a conflicting branch goes back to its agent as a blocked task with the instruction", async () => {
    await connectRepo();
    const { task: ok, input: okInput } = await reviewTask("Clean");
    const { task: dirty, input: dirtyInput } = await reviewTask("Conflicting");
    const { github, ctx, acts } = githubGateway(createGithubMock({ conflictingBranches: [dirtyInput.branch] }));
    await commitOn(github, ctx, okInput.branch);
    await commitOn(github, ctx, dirtyInput.branch);
    const prepared = [await acts.prepareMerge(okInput), await acts.prepareMerge(dirtyInput)];
    if (prepared[0]!.status !== "ready" || prepared[1]!.status !== "ready") throw new Error("not ready");

    // The mock's CI concludes the moment it is dispatched: a clean branch with green checks is ready to ask about.
    expect(await acts.assessMerge({ ...okInput, prNumber: prepared[0]!.prNumber, prUrl: prepared[0]!.prUrl })).toEqual({ mergeable: "ready", checks: "success", detail: "GitHub reports the pull request as clean" });
    expect(await acts.assessMerge({ ...dirtyInput, prNumber: prepared[1]!.prNumber, prUrl: prepared[1]!.prUrl })).toMatchObject({ mergeable: "conflicts", detail: "GitHub reports the pull request as dirty" });
    expect(mergeableOf("blocked", false)).toBe("ready");
    expect(mergeableOf("behind", false)).toBe("behind");
    expect(mergeableOf("unknown", false)).toBe("unknown");
    expect(mergeableOf(null, false)).toBe("unknown");

    const back = await acts.handBack({ ...dirtyInput, prNumber: prepared[1]!.prNumber, prUrl: prepared[1]!.prUrl, approvalId: null, why: "conflicts", detail: "GitHub reports the pull request as dirty" });
    expect(back).toMatchObject({ status: "handed_back", why: "conflicts", prNumber: prepared[1]!.prNumber });
    expect((await repos.tasks.get(t.db, t.businessId, dirty.id)).status).toBe("blocked");
    expect((await repos.tasks.get(t.db, t.businessId, ok.id)).status).toBe("review");
    const blocked = (await repos.events.list(t.db, t.businessId, { type: "task.blocked", limit: 10 })).items.find((e) => (e.payload as { taskId: string }).taskId === dirty.id);
    expect(blocked).toMatchObject({ payload: { reason: "needs_update", assigneeAgentId: t.workerId, detail: handBackDetail("conflicts", dirtyInput.branch, "GitHub reports the pull request as dirty") } });
    expect((blocked!.payload as { detail: string }).detail).toMatch(/^This change clashes with newer work on the live product/);
    expect((await auditOf(MERGE_AUDIT.handedBack))[0]).toMatchObject({ target: { id: dirty.id }, details: { why: "conflicts", approvalId: null } });
    // The sweep leaves a handed-back task alone: it is blocked, not in review.
    expect((await acts.pendingMerges({ businessId: t.businessId })).map((m) => m.taskId)).not.toContain(dirty.id);
  });

  it("words every hand-back for the founder first and the agent second", () => {
    for (const why of ["conflicts", "behind", "checks_failed", "checks_timeout", "refused"] as const) {
      const text = handBackDetail(why, "agent/x", null);
      expect(text).not.toMatch(/\bmerge\b|\brebase\b|\bPR\b|mergeable/i);
      expect(text).toContain("Bring your working copy (agent/x) up to date");
    }
    expect(handBackDetail("checks_failed", "agent/x", null)).toContain("fix what the repository's tests found");
  });
});

describe("askMerge, awaitChecks and completeMerge", () => {
  it("asks the founder, records the wait for the checks, and merges under the approval in the founder's name", async () => {
    await connectRepo();
    const { github, offline, ctx, acts } = githubGateway(undefined, asksForMerge);
    const { task, input } = await reviewTask("Hydration fix");
    await commitOn(github, ctx, input.branch, "src/index.ts");
    const existing = unwrap<{ number: number; url: string }>(await github.callTool("open_pr", { ...REPO, title: "Agent's own PR", head: input.branch, base: "main", draft: true }, ctx));
    const prepared = await acts.prepareMerge(input);
    expect(prepared).toMatchObject({ status: "ready", prNumber: existing.number, prUrl: existing.url });
    const pr = { prNumber: existing.number, prUrl: existing.url };

    const asked = await acts.askMerge({ ...input, ...pr });
    expect(asked).toEqual({ status: "awaiting_approval", approvalId: APPROVAL, ...pr });
    expect(offline.calls.at(-1)).toMatchObject({ tool: "merge_pr", args: mergeArgs(REPO, existing.number, task.title) });
    expect((await auditOf(MERGE_AUDIT.asked))[0]).toMatchObject({ details: { approvalId: APPROVAL, prNumber: existing.number } });
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("review");

    // Approved: the first look at the checks is on record against the approval (the Inbox's "waiting for the tests").
    expect(await acts.awaitChecks({ ...input, ...pr, approvalId: APPROVAL, first: true })).toEqual({ state: "success" });
    expect((await auditOf(MERGE_AUDIT.waiting))[0]).toMatchObject({ details: { step: "checks", approvalId: APPROVAL, checks: "success" } });

    // The same call runs under the approval and the task is done in the founder's name.
    const approved = githubGateway(github);
    const done = await approved.acts.completeMerge({ ...input, ...pr, approvalId: APPROVAL, decidedBy: t.fixture.ownerId });
    expect(done).toMatchObject({ status: "merged", prNumber: existing.number });
    expect(approved.offline.calls.at(-1)).toMatchObject({ tool: "merge_pr", args: mergeArgs(REPO, existing.number, task.title) });
    expect(await repos.tasks.get(t.db, t.businessId, task.id)).toMatchObject({ status: "done", progress: "1.0000" });
    const merged = done.status === "merged" ? await repos.events.byIdempotencyKey(t.db, t.businessId, `pr.merged:acme/shop#${existing.number}:${done.mergeCommitSha}`) : null;
    expect(merged).toMatchObject({ type: "pr.merged", payload: { taskId: task.id, mergedBy: { kind: "user", id: t.fixture.ownerId } } });
    expect((await auditOf(MERGE_AUDIT.merged))[0]).toMatchObject({ details: { approvalId: APPROVAL, prNumber: existing.number } });
    // Marked ready before the merge, as GitHub needs.
    expect(unwrap<{ draft: boolean; merged: boolean }>(await github.callTool("get_pull_request", { ...REPO, prNumber: existing.number }, ctx))).toMatchObject({ draft: false, merged: true });

    // Afterwards the review finds the merged pull request and leaves the done task alone.
    expect(await acts.prepareMerge(input)).toEqual({ status: "skipped", reason: `pull request #${existing.number} is already merged` });
  });

  it("a merge the gateway runs at once (a delegated decision) ends the task in the agent's name", async () => {
    await connectRepo();
    const { github, ctx, acts } = githubGateway();
    const { task, input } = await reviewTask("Delegated");
    await commitOn(github, ctx, input.branch);
    const prepared = await acts.prepareMerge(input);
    if (prepared.status !== "ready") throw new Error("not ready");
    const asked = await acts.askMerge({ ...input, prNumber: prepared.prNumber, prUrl: prepared.prUrl });
    expect(asked.status).toBe("merged");
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("done");
    expect((await repos.events.list(t.db, t.businessId, { type: "pr.merged", limit: 5 })).items[0]).toMatchObject({ payload: { taskId: task.id, mergedBy: { kind: "agent", id: t.workerId } } });
  });

  it("a merge GitHub refuses after approval is held on record against the approval, retryable when GitHub says not mergeable", async () => {
    await connectRepo();
    const { input } = await reviewTask("Refused after approval");
    const { github, ctx, acts } = githubGateway(createGithubMock({ conflictingBranches: [input.branch] }));
    await commitOn(github, ctx, input.branch);
    const prepared = await acts.prepareMerge(input);
    if (prepared.status !== "ready") throw new Error("not ready");
    const pr = { prNumber: prepared.prNumber, prUrl: prepared.prUrl };
    const held = await acts.completeMerge({ ...input, ...pr, approvalId: APPROVAL, decidedBy: t.fixture.ownerId });
    expect(held).toMatchObject({ status: "held", retryable: true, reason: expect.stringContaining("not mergeable") });
    expect((await auditOf(MERGE_AUDIT.notMerged))[0]).toMatchObject({ details: { step: "merge_pr_approved", approvalId: APPROVAL, retryable: true } });
    expect((await repos.tasks.get(t.db, t.businessId, input.taskId)).status).toBe("review");

    const timeout = await acts.holdMerge({ ...input, ...pr, approvalId: APPROVAL, why: "checks_timeout", detail: null });
    expect(timeout).toMatchObject({ status: "held", reason: "The repository's automatic tests did not finish in time, so this change did not go live yet." });
    expect((await auditOf(MERGE_AUDIT.notMerged))[0]).toMatchObject({ details: { step: "checks_timeout", approvalId: APPROVAL } });

    const rejected = await acts.recordMergeDecision({ ...input, ...pr, approvalId: APPROVAL, outcome: "rejected" });
    expect(rejected).toEqual({ status: "not_merged", ...pr, reason: "the founder did not approve the merge" });
    expect((await auditOf(MERGE_AUDIT.notMerged))[0]).toMatchObject({ details: { step: "decision", outcome: "rejected" } });
  });

  it("works against the real gateway's quarantine: a token that can write gets the pull request list as a summary, never as data", async () => {
    await connectRepo();
    const github = createGithubMock();
    const offline = createOfflineGatewayClient();
    const ctx = makeToolContext(github);
    const tools = new Map<string, string[]>();
    // As the gateway does (BUILD §9.8): untrusted reads on a session that can also act come back as the reader's digest.
    const gateway: GatewayClient = {
      ...offline,
      async mintSessionToken(req) {
        const minted = await offline.mintSessionToken(req);
        tools.set(minted.token, req.allowedTools ?? []);
        return minted;
      },
      async call(token, req) {
        offline.calls.push(req);
        const result = await github.callTool(req.tool, req.args, ctx);
        const canAct = (tools.get(token) ?? []).some((t) => ["github:open_pr", "github:merge_pr", "github:run_checks"].includes(t));
        if (canAct && ["list_pull_requests", "get_pull_request", "get_checks"].includes(req.tool) && isUntrusted(result.data)) return { outcome: "allow", costMinor: 0, result: { ...result, data: { ...result.data, content: "Three pull requests, all open.", quarantined: true } } };
        return { outcome: "allow", result, costMinor: 0 };
      },
    };
    const acts = createMergeActivities({ ...t.deps, gateway });
    const { task, input } = await reviewTask("Quarantine-proof");
    await commitOn(github, ctx, input.branch, "q.md");
    const prepared = await acts.prepareMerge(input);
    if (prepared.status !== "ready") throw new Error("not ready");
    const pr = { prNumber: prepared.prNumber, prUrl: prepared.prUrl };
    expect(await acts.assessMerge({ ...input, ...pr })).toMatchObject({ mergeable: "ready", checks: "success" });
    expect((await acts.askMerge({ ...input, ...pr })).status).toBe("merged");
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("done");
  });
});

describe("pendingMerges", () => {
  /** A code task in review whose last session finished on its branch with these tests, as `finishSession` records it. */
  async function finishedInReview(title: string, tests: { passing: number; total: number }, options: { branch?: string; reason?: string } = {}) {
    const { task, input } = await reviewTask(title);
    await repos.events.write(t.db, t.businessId, { type: "task.completed", actor: { kind: "agent", id: t.workerId }, payload: { taskId: task.id, kind: "code", title, assigneeAgentId: t.workerId, sessionId: input.sessionId, outcome: "success", durationMs: 1000, cost: { amountMinor: 1, currency: "USD" }, acceptanceTestsPassing: tests.passing, acceptanceTests: tests.total, prNumber: null, branch: options.branch ?? input.branch, summary: `${title} done` } });
    await repos.audit.append(t.db, t.businessId, { actorKind: "agent", actorId: t.workerId, action: "session.finish", target: { kind: "session", id: input.sessionId }, details: { outcome: "done", reason: options.reason ?? null, taskStatus: "review" } });
    return { task, input };
  }

  it("finds the code tasks that passed on their own branch and wait in review, and leaves the rest", async () => {
    const { acts } = githubGateway();
    // Nothing is offered without a repository to push to.
    await finishedInReview("No repo yet", { passing: 3, total: 3 });
    expect(await acts.pendingMerges({ businessId: t.businessId })).toEqual([]);

    await connectRepo();
    const passed = await finishedInReview("Hydration fix", { passing: 145, total: 145 });
    const docs = await finishedInReview("Docs only", { passing: 0, total: 0 });
    const failing = await finishedInReview("Still failing", { passing: 140, total: 144 });
    const otherBranch = await finishedInReview("Other branch", { passing: 2, total: 2 }, { branch: "feature/x" });
    const setup = await finishedInReview("Changed the test setup", { passing: 9, total: 9 }, { reason: "needs review: package.json scripts changed" });
    const rejected = await finishedInReview("Rejected merge", { passing: 4, total: 4 });
    await repos.audit.append(t.db, t.businessId, { actorKind: "agent", actorId: t.workerId, action: MERGE_AUDIT.notMerged, target: { kind: "task", id: rejected.task.id }, details: { step: "decision", outcome: "rejected" } });
    const held = await finishedInReview("Held by GitHub", { passing: 4, total: 4 });
    await repos.audit.append(t.db, t.businessId, { actorKind: "agent", actorId: t.workerId, action: MERGE_AUDIT.notMerged, target: { kind: "task", id: held.task.id }, details: { step: "merge_pr", reason: "GitHub is down" } });
    const doneUnmerged = await finishedInReview("Done, never merged", { passing: 5, total: 5 });
    await repos.tasks.setStatus(t.db, t.businessId, doneUnmerged.task.id, "done", { force: true });
    const doneMerged = await finishedInReview("Done and merged", { passing: 5, total: 5 });
    await repos.tasks.setStatus(t.db, t.businessId, doneMerged.task.id, "done", { force: true });
    await repos.events.write(t.db, t.businessId, { type: "pr.merged", actor: { kind: "agent", id: t.workerId }, payload: { taskId: doneMerged.task.id, repo: "acme/shop", prNumber: 9, title: "Done and merged", branch: doneMerged.input.branch, baseBranch: "main", mergeCommitSha: "a".repeat(40), mergedBy: { kind: "agent", id: t.workerId }, additions: 1, deletions: 0, filesChanged: 1, url: "https://github.com/acme/shop/pull/9" } });

    const found = await acts.pendingMerges({ businessId: t.businessId });
    const ids = found.map((m) => m.taskId);
    expect(ids).toEqual(expect.arrayContaining([passed.task.id, docs.task.id, held.task.id, doneUnmerged.task.id]));
    for (const left of [failing, otherBranch, setup, rejected, doneMerged]) expect(ids).not.toContain(left.task.id);
    expect(found.find((m) => m.taskId === passed.task.id)).toEqual({ ...passed.input, acceptance: { passing: 145, total: 145 }, summary: "Hydration fix done" });
    expect(found.find((m) => m.taskId === docs.task.id)?.acceptance).toBeNull();
  });
});
