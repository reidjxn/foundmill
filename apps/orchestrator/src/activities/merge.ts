/**
 * Review to merge (BUILD §9.6, §11.6): a code task that passed its acceptance tests sits in `review` until its branch
 * reaches the default branch, and every task that depends on it waits meanwhile. Until Oct 30, 2026 nothing moved it:
 * the agents were meant to open the pull request and route the review themselves, and on the Foundmill business they
 * did not (the deploy contract passed, sat on its branch, and three deploy tasks waited on it for a day).
 *
 * The platform does it now, through the gateway like any agent call, in the task's agent's name:
 * - `prepareMerge`: the pull request for the branch (an open one, else a new one on the default branch, with the task
 *   and the test counts in its body), the repository's CI started on the branch (`run_checks`, best effort), then
 *   `merge_pr`. The gateway's policy decides what a merge is in this business: it runs (Assisted and Automated modes, or
 *   a decision Team › Responsibilities delegates) or it asks (Augmented mode: an approval and one Inbox decision for the
 *   founder, with the pull request and the tests). A refusal holds the task in review with the reason.
 * - `completeMerge`: after the founder approved, the same call again, which the gateway runs under that approval.
 * - A merged pull request ends the task (`done`, phase done, `pr.merged`), so the tasks that depend on it can start.
 *
 * Never a push to the default branch, never a merge in Augmented mode without the founder, never a second Inbox item
 * for the same merge (the gateway reuses an open approval for the same call).
 */
import { APP_NAME } from "@foundmill/config";
import { isUntrusted } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { MergeInput, MergeOutcome, MergePrepared } from "./types";

/** Lifetime of the token minted for one merge step (a few GitHub calls). */
export const MERGE_TOKEN_TTL_SECONDS = 300;
/** How long one GitHub call of the merge may take. */
const MERGE_CALL_TIMEOUT_MS = 120_000;
const MERGE_TOOLS = ["github:list_pull_requests", "github:open_pr", "github:run_checks", "github:merge_pr"];
/** Audit actions of the merge step. */
export const MERGE_AUDIT = { prepared: "merge.prepared", merged: "merge.merged", notMerged: "merge.not_merged" } as const;

interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  base: { ref: string };
  head: { ref: string };
  additions: number;
  deletions: number;
  changedFiles: number;
}

type CallResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** The data of a gateway tool call, unwrapped from the quarantine envelope, or the error it answered. */
function resultOf<T>(res: { outcome: string; result?: unknown; reasons?: string[] }): CallResult<T> {
  if (res.outcome !== "allow") return { ok: false, code: res.outcome, message: res.reasons?.join("; ") || res.outcome };
  const r = res.result as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | undefined;
  if (!r?.ok || r.data === undefined) return { ok: false, code: r?.error?.code ?? "tool_failed", message: r?.error?.message ?? "GitHub gave no result" };
  return { ok: true, data: (isUntrusted(r.data) ? r.data.content : r.data) as T };
}

/** The pull request's body: the task, what the platform tested, and what merging means here. */
export function pullRequestBody(input: MergeInput, task: { id: string; title: string; goalMd: string }): string {
  const tests = input.acceptance ? `${input.acceptance.passing} of ${input.acceptance.total} acceptance tests passed in the platform's sandbox.` : "Nothing in this change had tests the sandbox could run (documentation, or suites that need the running app).";
  const goal = task.goalMd.trim().slice(0, 1500);
  return [`## Task\n${task.title}${goal ? `\n\n${goal}` : ""}`, `## Tests\n${tests}`, `## Summary\n${input.summary.trim().slice(0, 2000) || "(none)"}`, `Opened by ${APP_NAME} when task ${task.id} passed its tests. Merging follows the business mode: the founder's decision in Augmented mode, automatic when green in Assisted and Automated.`].join("\n\n");
}

/** The `merge_pr` arguments for a task's pull request: the same on every call, so an approval of the first covers the second. */
export function mergeArgs(target: { owner: string; repo: string }, prNumber: number, title: string): Record<string, unknown> {
  return { owner: target.owner, repo: target.repo, prNumber, mergeMethod: "squash", commitTitle: `${title.trim()} (#${prNumber})`.slice(0, 256) };
}

export function createMergeActivities(deps: OrchestratorDeps) {
  const { db } = deps;
  const token = (input: MergeInput) => deps.gateway.mintSessionToken({ businessId: input.businessId, agentId: input.agentId, sessionId: input.sessionId, allowedTools: MERGE_TOOLS, ttlSeconds: MERGE_TOKEN_TTL_SECONDS });
  const call = async <T>(tok: string, tool: string, args: Record<string, unknown>) => {
    const res = await deps.gateway.call(tok, { connector: "github", tool, args }, { timeoutMs: MERGE_CALL_TIMEOUT_MS });
    return { res, result: resultOf<T>(res) };
  };

  /** The task is done: status, progress and the `pr.merged` event the journey and the composer read. */
  async function finishMerged(input: MergeInput, target: { fullName: string }, pr: PullRequestSummary, sha: string, mergedBy: { kind: "agent" | "user" | "system"; id: string }): Promise<void> {
    const task = await repos.tasks.get(db, input.businessId, input.taskId);
    if (task.status !== "done") await repos.tasks.setStatus(db, input.businessId, input.taskId, "done", { force: true });
    await repos.tasks.setProgress(db, input.businessId, input.taskId, { progress: 1, phase: "done" });
    await emitEvent(db, {
      businessId: input.businessId,
      type: "pr.merged",
      actor: mergedBy,
      payload: { taskId: input.taskId, repo: target.fullName, prNumber: pr.number, title: pr.title.slice(0, 300), branch: input.branch, baseBranch: pr.base.ref, mergeCommitSha: sha, mergedBy, additions: pr.additions, deletions: pr.deletions, filesChanged: pr.changedFiles, url: pr.url },
    }, { idempotencyKey: `pr.merged:${target.fullName}#${pr.number}:${sha}` });
    await repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: input.agentId, action: MERGE_AUDIT.merged, target: { kind: "task", id: input.taskId }, details: { sessionId: input.sessionId, prNumber: pr.number, mergeCommitSha: sha, branch: input.branch } });
  }

  return {
    /**
     * The pull request for the task's branch and the merge, or the approval that decides it. Skips when there is nothing
     * to merge (not a code task in review, no repository, pushing off); holds the task in review when GitHub or the
     * gateway refuses, with the reason.
     */
    async prepareMerge(input: MergeInput): Promise<MergePrepared> {
      const task = await repos.tasks.get(db, input.businessId, input.taskId);
      if (task.kind !== "code") return { status: "skipped", reason: `${task.kind} tasks have no branch to merge` };
      if (task.status !== "review") return { status: "skipped", reason: `the task is ${task.status}, not in review` };
      const target = await repos.integrations.codeRepository(db, input.businessId);
      if (!target) return { status: "skipped", reason: "no repository is chosen on the Code tab" };
      if (!target.writeEnabled) return { status: "skipped", reason: `pushing to ${target.fullName} is turned off (the Code tab)` };
      const tok = (await token(input)).token;
      const repo = { owner: target.owner, repo: target.repo };

      // The branch's pull request: the open one when the agent (or an earlier session) opened it, else a new one.
      const listed = await call<{ items: PullRequestSummary[] }>(tok, "list_pull_requests", { ...repo, state: "open", perPage: 100 });
      let pr: PullRequestSummary | null = listed.result.ok ? (listed.result.data.items.find((p) => p.head.ref === input.branch) ?? null) : null;
      if (!pr) {
        const opened = await call<PullRequestSummary>(tok, "open_pr", { ...repo, title: task.title.trim().slice(0, 256), body: pullRequestBody(input, task), head: input.branch, base: "HEAD", draft: false });
        if (!opened.result.ok) {
          await repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: input.agentId, action: MERGE_AUDIT.notMerged, target: { kind: "task", id: input.taskId }, details: { sessionId: input.sessionId, step: "open_pr", reason: opened.result.message } });
          return { status: "held", reason: `the pull request could not be opened: ${opened.result.message}`.slice(0, 500), prNumber: null, prUrl: null };
        }
        pr = opened.result.data;
      }
      // The repository's own CI on the branch, so the founder (or the merge queue) sees the full suite's verdict next to
      // the sandbox's. Best effort: a repository without the workflow, or a branch whose .github differs, is noted.
      const checks = await call<{ dispatched: true }>(tok, "run_checks", { ...repo, branch: input.branch });
      await repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: input.agentId, action: MERGE_AUDIT.prepared, target: { kind: "task", id: input.taskId }, details: { sessionId: input.sessionId, prNumber: pr.number, prUrl: pr.url, ci: checks.result.ok ? "started" : checks.result.message.slice(0, 300), acceptance: input.acceptance } });

      // The merge itself: the gateway's policy makes it the founder's decision (Augmented) or runs it (Assisted, Automated).
      const merged = await call<{ merged: true; sha: string }>(tok, "merge_pr", mergeArgs(repo, pr.number, task.title));
      if (merged.res.outcome === "ask" && merged.res.approvalId) return { status: "awaiting_approval", approvalId: merged.res.approvalId, prNumber: pr.number, prUrl: pr.url };
      if (merged.result.ok) {
        await finishMerged(input, target, pr, merged.result.data.sha, { kind: "agent", id: input.agentId });
        return { status: "merged", prNumber: pr.number, prUrl: pr.url, mergeCommitSha: merged.result.data.sha };
      }
      await repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: input.agentId, action: MERGE_AUDIT.notMerged, target: { kind: "task", id: input.taskId }, details: { sessionId: input.sessionId, step: "merge_pr", prNumber: pr.number, reason: merged.result.message } });
      return { status: "held", reason: `the merge was refused: ${merged.result.message}`.slice(0, 500), prNumber: pr.number, prUrl: pr.url };
    },

    /** After the founder approved: the same merge call, which the gateway runs under that approval, and the task is done. */
    async completeMerge(input: MergeInput & { prNumber: number; approvalId: string; decidedBy: string | null }): Promise<MergeOutcome> {
      const task = await repos.tasks.get(db, input.businessId, input.taskId);
      const target = await repos.integrations.codeRepository(db, input.businessId);
      if (!target) return { status: "skipped", reason: "no repository is chosen on the Code tab" };
      const tok = (await token(input)).token;
      const repo = { owner: target.owner, repo: target.repo };
      const current = await call<PullRequestSummary>(tok, "list_pull_requests", { ...repo, state: "all", perPage: 100 }).then((r) => (r.result.ok ? ((r.result.data as unknown as { items: PullRequestSummary[] }).items.find((p) => p.number === input.prNumber) ?? null) : null));
      const merged = await call<{ merged: true; sha: string }>(tok, "merge_pr", mergeArgs(repo, input.prNumber, task.title));
      if (merged.result.ok) {
        const pr: PullRequestSummary = current ?? { number: input.prNumber, title: task.title, url: `https://github.com/${target.fullName}/pull/${input.prNumber}`, base: { ref: "main" }, head: { ref: input.branch }, additions: 0, deletions: 0, changedFiles: 0 };
        await finishMerged(input, target, pr, merged.result.data.sha, input.decidedBy ? { kind: "user", id: input.decidedBy } : systemActor);
        return { status: "merged", prNumber: input.prNumber, prUrl: pr.url, mergeCommitSha: merged.result.data.sha };
      }
      const reason = merged.res.outcome === "ask" ? "the merge asked for approval again instead of running under the one given" : merged.result.ok ? "unknown" : merged.result.message;
      await repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: input.agentId, action: MERGE_AUDIT.notMerged, target: { kind: "task", id: input.taskId }, details: { sessionId: input.sessionId, step: "merge_pr_approved", prNumber: input.prNumber, approvalId: input.approvalId, reason } });
      return { status: "held", reason: `the approved merge did not run: ${reason}`.slice(0, 500), prNumber: input.prNumber, prUrl: current?.url ?? null };
    },

    /** The founder rejected the merge, or the approval expired or was withdrawn: the task stays in review, on record. */
    async recordMergeDecision(input: MergeInput & { prNumber: number; prUrl: string | null; approvalId: string; outcome: "rejected" | "expired" | "withdrawn" }): Promise<MergeOutcome> {
      await repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: input.agentId, action: MERGE_AUDIT.notMerged, target: { kind: "task", id: input.taskId }, details: { sessionId: input.sessionId, step: "decision", prNumber: input.prNumber, approvalId: input.approvalId, outcome: input.outcome } });
      const reason = input.outcome === "rejected" ? "the founder did not approve the merge" : input.outcome === "expired" ? "the approval expired" : "the wait for the approval was withdrawn";
      return { status: "not_merged", prNumber: input.prNumber, prUrl: input.prUrl, reason };
    },
  };
}

export type MergeActivities = ReturnType<typeof createMergeActivities>;
