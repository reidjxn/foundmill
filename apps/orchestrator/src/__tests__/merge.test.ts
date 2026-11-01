/**
 * Review to merge (activities/merge.ts): a code task that passed its tests gets its pull request opened, the
 * repository's CI started and the merge made through the gateway; when the gateway asks (Augmented mode) the step
 * reports the approval to wait on, and the approved merge ends the task; nothing to merge or a refusal leaves the
 * task in review with the reason on record.
 */
import { createGithubMock } from "@foundmill/connectors/connectors/github/mock";
import { makeToolContext } from "@foundmill/connectors/testing/contract-suite";
import { isUntrusted } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMergeActivities, MERGE_AUDIT, mergeArgs, pullRequestBody } from "../activities/merge";
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

const unwrap = <T>(r: { data?: unknown }): T => (isUntrusted(r.data) ? r.data.content : r.data) as T;

async function reviewTask(title = "Deploy contract"): Promise<{ task: { id: string; title: string; goalMd: string }; input: MergeInput }> {
  const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title, goalMd: "Ship the deploy contract so the deploy tasks can start.", assigneeAgentId: t.workerId, status: "ready" });
  await repos.tasks.setStatus(t.db, t.businessId, task.id, "review", { force: true });
  const sessionId = await openSessionRow(t, t.workerId, task.id);
  return { task, input: { businessId: t.businessId, taskId: task.id, agentId: t.workerId, sessionId, branch: `agent/${task.id}`, acceptance: { passing: 145, total: 145 }, summary: "Added the deploy contract and its tests." } };
}

const connectRepo = () => repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });

describe("prepareMerge", () => {
  it("opens the pull request on the default branch, starts CI, merges when the gateway allows, and ends the task", async () => {
    await connectRepo();
    const { github, offline, ctx, acts } = githubGateway();
    const { task, input } = await reviewTask();
    await github.callTool("commit_files", { owner: "acme", repo: "shop", branch: input.branch, message: "deploy contract", files: [{ path: "DEPLOY.md", content: "contract\n" }] }, ctx);

    const prepared = await acts.prepareMerge(input);
    expect(prepared.status).toBe("merged");
    if (prepared.status !== "merged") return;
    expect(prepared.prUrl).toBe(`https://github.com/acme/shop/pull/${prepared.prNumber}`);
    expect(offline.calls.map((c) => c.tool)).toEqual(["list_pull_requests", "compare_refs", "open_pr", "run_checks", "merge_pr"]);
    expect(offline.calls[2]!.args).toMatchObject({ head: input.branch, base: "HEAD", draft: false, title: "Deploy contract" });
    expect(offline.calls[4]!.args).toEqual(mergeArgs({ owner: "acme", repo: "shop" }, prepared.prNumber, task.title));
    // Reads and writes on separate tokens: the reads' token can do nothing else, so the gateway answers them as data.
    expect(offline.minted.slice(-2)).toEqual([expect.objectContaining({ agentId: t.workerId, sessionId: input.sessionId, allowedTools: ["github:compare_refs", "github:list_pull_requests"] }), expect.objectContaining({ allowedTools: ["github:open_pr", "github:run_checks", "github:merge_pr"] })]);

    // The pull request's body says what was tested; the mock's default branch now carries the merge.
    const pr = unwrap<{ body: string; base: { ref: string }; merged: boolean }>(await github.callTool("get_pull_request", { owner: "acme", repo: "shop", prNumber: prepared.prNumber }, ctx));
    expect(pr.base.ref).toBe("main");
    expect(pr.merged).toBe(true);
    expect(pr.body).toContain("145 of 145 acceptance tests passed");
    expect(pr.body).toBe(pullRequestBody(input, task));

    expect(await repos.tasks.get(t.db, t.businessId, task.id)).toMatchObject({ status: "done", progress: "1.0000" });
    const merged = await repos.events.byIdempotencyKey(t.db, t.businessId, `pr.merged:acme/shop#${prepared.prNumber}:${prepared.mergeCommitSha}`);
    expect(merged).toMatchObject({ type: "pr.merged", payload: { taskId: task.id, repo: "acme/shop", prNumber: prepared.prNumber, branch: input.branch, baseBranch: "main", mergedBy: { kind: "agent", id: t.workerId } } });
    const audit = await repos.audit.list(t.db, t.businessId, { limit: 10 });
    expect(audit.items.map((a) => a.action)).toEqual(expect.arrayContaining([MERGE_AUDIT.prepared, MERGE_AUDIT.merged]));

    // A second run finds the merged pull request and leaves the done task alone, on record for the sweep.
    expect(await acts.prepareMerge(input)).toEqual({ status: "skipped", reason: `pull request #${prepared.prNumber} is already merged` });
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("done");
  });

  it("reuses the branch's open pull request and reports the approval when the gateway asks for the merge", async () => {
    await connectRepo();
    const { github, offline, ctx, acts } = githubGateway(undefined, (req) => (req.tool === "merge_pr" ? { outcome: "ask", approvalId: APPROVAL, reasons: ["merge_to_main needs the founder"] } : null));
    const { task, input } = await reviewTask("Hydration fix");
    await github.callTool("commit_files", { owner: "acme", repo: "shop", branch: input.branch, message: "fix", files: [{ path: "src/index.ts", content: "fixed\n" }] }, ctx);
    const existing = unwrap<{ number: number; url: string }>(await github.callTool("open_pr", { owner: "acme", repo: "shop", title: "Agent's own PR", head: input.branch, base: "main", draft: true }, ctx));

    const prepared = await acts.prepareMerge(input);
    expect(prepared).toEqual({ status: "awaiting_approval", approvalId: APPROVAL, prNumber: existing.number, prUrl: existing.url });
    expect(offline.calls.map((c) => c.tool)).toEqual(["list_pull_requests", "compare_refs", "run_checks", "merge_pr"]);
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("review");

    // The founder approved: the same call runs under the approval and the task is done in the founder's name.
    const approved = githubGateway(github);
    const done = await approved.acts.completeMerge({ ...input, prNumber: existing.number, approvalId: APPROVAL, decidedBy: t.fixture.ownerId });
    expect(done.status).toBe("merged");
    expect(approved.offline.calls.at(-1)).toMatchObject({ tool: "merge_pr", args: mergeArgs({ owner: "acme", repo: "shop" }, existing.number, task.title) });
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("done");
    expect(done.status === "merged" && (await repos.events.byIdempotencyKey(t.db, t.businessId, `pr.merged:acme/shop#${existing.number}:${done.mergeCommitSha}`))).toMatchObject({ payload: { mergedBy: { kind: "user", id: t.fixture.ownerId } } });
  });

  it("holds the task in review when the merge is refused, and records a decision against it", async () => {
    await connectRepo();
    const { github, ctx, acts } = githubGateway(undefined, (req) => (req.tool === "merge_pr" ? { outcome: "deny", reasons: ["branch protection: checks pending"] } : null));
    const { task, input } = await reviewTask("Refused");
    await github.callTool("commit_files", { owner: "acme", repo: "shop", branch: input.branch, message: "m", files: [{ path: "a.md", content: "a\n" }] }, ctx);
    const held = await acts.prepareMerge(input);
    expect(held).toMatchObject({ status: "held", reason: "the merge was refused: branch protection: checks pending" });
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("review");

    const rejected = await acts.recordMergeDecision({ ...input, prNumber: 7, prUrl: null, approvalId: APPROVAL, outcome: "rejected" });
    expect(rejected).toEqual({ status: "not_merged", prNumber: 7, prUrl: null, reason: "the founder did not approve the merge" });
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("review");
    const audit = await repos.audit.list(t.db, t.businessId, { limit: 5 });
    expect(audit.items[0]).toMatchObject({ action: MERGE_AUDIT.notMerged, details: { step: "decision", outcome: "rejected" } });
  });

  it("a task marked done with its work only on its branch goes back to review and gets its pull request; one with nothing to merge stays done", async () => {
    await connectRepo();
    const { github, ctx, acts } = githubGateway();
    const { task, input } = await reviewTask("Done on its branch");
    await repos.tasks.setStatus(t.db, t.businessId, task.id, "done", { force: true });
    await github.callTool("commit_files", { owner: "acme", repo: "shop", branch: input.branch, message: "contract", files: [{ path: "contract.ts", content: "export {};\n" }] }, ctx);
    const prepared = await acts.prepareMerge(input);
    expect(prepared.status).toBe("merged");
    const audit = await repos.audit.list(t.db, t.businessId, { action: MERGE_AUDIT.reopened, limit: 5 });
    expect(audit.items[0]).toMatchObject({ target: { kind: "task", id: task.id } });
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("done");

    // A done task whose branch holds nothing new (created, never committed to) is left done, and on record.
    const empty = await reviewTask("Nothing new");
    await repos.tasks.setStatus(t.db, t.businessId, empty.task.id, "done", { force: true });
    await github.callTool("create_branch", { owner: "acme", repo: "shop", branch: empty.input.branch }, ctx);
    expect(await acts.prepareMerge(empty.input)).toEqual({ status: "skipped", reason: `${empty.input.branch} has nothing the default branch lacks` });
    expect((await repos.tasks.get(t.db, t.businessId, empty.task.id)).status).toBe("done");
    expect((await repos.audit.list(t.db, t.businessId, { action: MERGE_AUDIT.notMerged, limit: 1 })).items[0]).toMatchObject({ target: { id: empty.task.id }, details: { step: "nothing_to_merge" } });
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
        if (canAct && req.tool === "list_pull_requests" && isUntrusted(result.data)) return { outcome: "allow", costMinor: 0, result: { ...result, data: { ...result.data, content: "Three pull requests, all open.", quarantined: true } } };
        return { outcome: "allow", result, costMinor: 0 };
      },
    };
    const acts = createMergeActivities({ ...t.deps, gateway });
    const { task, input } = await reviewTask("Quarantine-proof");
    await github.callTool("commit_files", { owner: "acme", repo: "shop", branch: input.branch, message: "m", files: [{ path: "q.md", content: "q\n" }] }, ctx);
    expect((await acts.prepareMerge(input)).status).toBe("merged");
    expect((await repos.tasks.get(t.db, t.businessId, task.id)).status).toBe("done");
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

