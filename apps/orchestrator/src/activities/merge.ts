/**
 * Review to merge (BUILD §9.6, §11.6): a code task that passed its acceptance tests sits in `review` until its branch
 * reaches the default branch, and every task that depends on it waits meanwhile. The platform carries it there, through
 * the gateway like any agent call, in the task's agent's name, and going live is the founder's one tap in every business
 * mode (decision 2026-11-01):
 *
 * - `prepareMerge`: the pull request for the branch (an open one, else a new one on the default branch, with the task and
 *   the test counts in its body) and the repository's own tests on the branch (`run_checks`, best effort).
 * - `assessMerge`: what GitHub says before anyone is asked: a branch that conflicts with the default branch or has fallen
 *   behind it, or whose checks already failed, never reaches the founder; it goes back to its agent (`handBack`).
 * - `askMerge`: `merge_pr` through the gateway, whose policy makes it the founder's decision (an approval and one Inbox
 *   item) or runs it when Team › Responsibilities delegated the decision.
 * - After the founder approved: `awaitChecks` until the repository's tests conclude (the workflow polls), then
 *   `completeMerge`, the same call again, which the gateway runs under that approval. Tests that fail hand the branch back;
 *   tests that never conclude hold the merge for the next cycle.
 * - Every outcome after the founder's answer is on record against the approval (`merge.*` audit rows with `approvalId`),
 *   which is what the Inbox's Decided panel shows: went live, waiting for the tests, or did not go through and why.
 *
 * Never a push to the default branch, never a merge the founder did not approve (or delegate), never a second Inbox item
 * for the same merge (the gateway reuses an open approval for the same call, and an approved one covers the retry).
 */
import { codeReviewHandBack } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { isUntrusted } from "@foundmill/connectors";
import { previewProvider } from "@foundmill/connectors/connectors/github/tools";
import { founderReworkDetail, repos } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { postNote } from "./dispatch";
import type { MergeAsked, MergeAssessment, MergeBranchUpdated, MergeHoldReason, MergeInput, MergeOutcome, MergePrepared, MergePullRequest } from "./types";

/** Lifetime of the token minted for one merge step (a few GitHub calls). */
export const MERGE_TOKEN_TTL_SECONDS = 300;
/** How long one GitHub call of the merge may take. */
const MERGE_CALL_TIMEOUT_MS = 120_000;
/**
 * Two tokens, never one: the reads (pull requests, checks, the compare) on a token that can only read, so the gateway
 * returns GitHub's answer as data; a token that can also open and merge would have the pull request list read by the
 * quarantined reader and handed back as a summary (BUILD §9.8), which the merge cannot parse (Nov 1, 2026: every merge
 * failed there).
 */
const MERGE_READ_TOOLS = ["github:compare_refs", "github:list_pull_requests", "github:get_pull_request", "github:get_checks", "github:list_deployments"];
const MERGE_WRITE_TOOLS = ["github:open_pr", "github:run_checks", "github:update_branch", "github:merge_pr"];
/** Audit actions of the merge step; `approvalId` in their details ties them to the founder's decision. */
export const MERGE_AUDIT = { prepared: "merge.prepared", updated: "merge.updated", asked: "merge.asked", waiting: "merge.waiting", merged: "merge.merged", notMerged: "merge.not_merged", reopened: "merge.reopened", handedBack: "merge.handed_back" } as const;
/** How many review tasks, and how much of their history, one sweep reads. */
const SWEEP_TASKS = 100;
const SWEEP_HISTORY = 500;
/** The audit step of a merge with nothing to do: the work is already on the default branch. */
const NOTHING_TO_MERGE = "nothing_to_merge";
/** The reason a session gives when it changed how the tests run: the founder looks at it first (session.ts). */
const TEST_SETUP_REVIEW = "needs review:";

interface CompletedPayload {
  taskId: string;
  assigneeAgentId: string;
  sessionId: string;
  acceptanceTestsPassing: number;
  acceptanceTests: number;
  branch?: string | null;
  summary?: string;
  /** `saved_only`: the session had no repository to push to (WP-05 T8), so its branch never reached GitHub. */
  landed?: "saved_only" | "site" | null;
}

interface PullRequestSummary {
  number: number;
  merged?: boolean;
  state?: string;
  draft?: boolean;
  mergeableState?: string | null;
  /** The squash or merge commit on the base branch once merged; null before. */
  mergeCommitSha?: string | null;
  title: string;
  url: string;
  base: { ref: string };
  head: { ref: string };
  additions: number;
  deletions: number;
  changedFiles: number;
}

export type CallResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** The data of a gateway tool call, unwrapped from the quarantine envelope, or the error it answered. */
export function resultOf<T>(res: { outcome: string; result?: unknown; reasons?: string[] }): CallResult<T> {
  if (res.outcome !== "allow") return { ok: false, code: res.outcome, message: res.reasons?.join("; ") || res.outcome };
  const r = res.result as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | undefined;
  if (!r?.ok || r.data === undefined) return { ok: false, code: r?.error?.code ?? "tool_failed", message: r?.error?.message ?? "GitHub gave no result" };
  return { ok: true, data: (isUntrusted(r.data) ? r.data.content : r.data) as T };
}

/** The pull request's body: the task, what the platform tested, and what merging means here. */
export function pullRequestBody(input: MergeInput, task: { id: string; title: string; goalMd: string }): string {
  const tests = input.acceptance ? `${input.acceptance.passing} of ${input.acceptance.total} acceptance tests passed in the platform's sandbox.` : "Nothing in this change had tests the sandbox could run (documentation, or suites that need the running app).";
  const goal = task.goalMd.trim().slice(0, 1500);
  return [`## Task\n${task.title}${goal ? `\n\n${goal}` : ""}`, `## Tests\n${tests}`, `## Summary\n${input.summary.trim().slice(0, 2000) || "(none)"}`, `Opened by ${APP_NAME} when task ${task.id} passed its tests. Nothing goes live until the founder says so: once the repository's checks pass, the founder's one tap in the Inbox merges it.`].join("\n\n");
}

/**
 * A merge refusal GitHub takes back a moment later: "not mergeable" (405) right after the last check passes, "Repository
 * rule violations found … N of N required status checks are expected" while its rules catch up with checks that already
 * concluded, "Base branch was modified" (409) when the default branch moved under the merge. Anything else (a conflict,
 * a closed pull request, a rule a retry cannot satisfy) is not.
 */
export function mergeRefusalIsMomentary(message: string): boolean {
  return /not mergeable|\b405\b|\b409\b|status checks? (are|is) (expected|pending)|base branch was modified/i.test(message);
}

/**
 * The `merge_pr` arguments for a task's pull request: the same on every call, so an approval of the first covers the
 * second. `reviewedSha`, when the second read ran, is the commit it read: it is on the approval (the Inbox matches the
 * review to it and says when the branch changed since), and a later run on a branch that moved asks again rather than
 * reusing the approval. GitHub's merge is not pinned to it: the connector's `merge_pr` takes no `sha` (its contract is
 * unchanged here), so the connector drops the field.
 */
export function mergeArgs(target: { owner: string; repo: string }, prNumber: number, title: string, reviewedSha?: string | null): Record<string, unknown> {
  return { owner: target.owner, repo: target.repo, prNumber, mergeMethod: "squash", commitTitle: `${title.trim()} (#${prNumber})`.slice(0, 256), ...(reviewedSha ? { headSha: reviewedSha } : {}) };
}

/** What GitHub's merge state means for the review. */
export function mergeableOf(state: string | null | undefined, draft: boolean | undefined): MergeAssessment["mergeable"] {
  switch (state) {
    case "dirty":
      return "conflicts";
    case "behind":
      return "behind";
    case "clean":
    case "blocked":
    case "unstable":
    case "has_hooks":
      return "ready";
    case "draft":
      return draft === false ? "unknown" : "ready"; // the merge marks a draft ready first
    default:
      return "unknown";
  }
}

/**
 * The instruction a handed-back task carries to its agent and the founder: what happened, in both their words, and what
 * the next session must do. The founder reads the first sentence in the Chief of Staff's note; the agent reads all of it.
 */
export function handBackDetail(why: MergeHoldReason, branch: string, detail: string | null): string {
  // The founder's words are the instruction, first (WP-05 T16); the api writes the same text when the founder answers.
  if (why === "founder" && detail?.trim()) return founderReworkDetail(detail, branch);
  // The second read asked for changes (WP-05 T17): `secondReadMerge` wrote the whole instruction, findings as data.
  // Never cut: a slice could drop `</untrusted_content>` and leave what follows it inside an open block, so a detail that
  // is too long or does not end closed falls back to the instruction without the findings.
  if (why === "review") return detail && detail.length <= 2000 && detail.trimEnd().endsWith("</untrusted_content>") ? detail : codeReviewHandBack(null, branch);
  const what =
    why === "conflicts"
      ? "This change clashes with newer work on the live product, so it could not go live as it is."
      : why === "behind"
        ? "The live product moved on since this change was made, so the change has to be brought up to date before it goes live."
        : why === "checks_failed"
          ? "A final quality check failed on this change, so it could not go live."
          : why === "checks_timeout"
            ? "The final quality checks did not finish in time, so this change did not go live yet."
            : "The change could not be put live this time.";
  const todo =
    why === "checks_failed"
      ? `Bring your working copy (${branch}) up to date with the newest version of the product, fix what the quality checks found, keep every check passing, and finish; it is offered to go live again when the checks pass.`
      : `Bring your working copy (${branch}) up to date with the newest version of the product: your session starts from the live product's newest files with your earlier change applied on top. Reconcile the files the product changed since, keep every check passing, and finish; it is offered to go live again when the checks pass.`;
  return [what, detail ? `Details: ${detail}` : "", todo].filter(Boolean).join(" ").slice(0, 2000);
}

/** The subject of the note a held merge posts, and closes once the change is live. */
export const notLiveYetSubject = (agentName: string): string => `${agentName}'s change is not live yet`.slice(0, 80);

export function createMergeActivities(deps: OrchestratorDeps) {
  const { db } = deps;
  const mint = (input: MergeInput, allowedTools: string[]) => deps.gateway.mintSessionToken({ businessId: input.businessId, agentId: input.agentId, sessionId: input.sessionId, allowedTools, ttlSeconds: MERGE_TOKEN_TTL_SECONDS });
  const tokens = async (input: MergeInput) => ({ read: (await mint(input, MERGE_READ_TOOLS)).token, write: (await mint(input, MERGE_WRITE_TOOLS)).token });
  const call = async <T>(tok: string, tool: string, args: Record<string, unknown>) => {
    const res = await deps.gateway.call(tok, { connector: "github", tool, args }, { timeoutMs: MERGE_CALL_TIMEOUT_MS });
    return { res, result: resultOf<T>(res) };
  };
  /** The branch's pull requests (every state), or null when GitHub's answer is not the list it should be. */
  const pullRequestsOf = async (tok: string, repo: { owner: string; repo: string }, branch: string): Promise<PullRequestSummary[] | null> => {
    const listed = await call<{ items?: unknown }>(tok, "list_pull_requests", { ...repo, state: "all", perPage: 100 });
    if (!listed.result.ok || !Array.isArray(listed.result.data.items)) return null;
    return (listed.result.data.items as PullRequestSummary[]).filter((p) => p && typeof p.number === "number" && p.head?.ref === branch);
  };
  const repository = async (input: MergeInput) => {
    const target = await repos.integrations.codeRepository(db, input.businessId);
    return target ? { target, repo: { owner: target.owner, repo: target.repo } } : null;
  };
  const audit = (input: MergeInput, action: string, details: Record<string, unknown>) => repos.audit.append(db, input.businessId, { actorKind: "agent", actorId: input.agentId, action, target: { kind: "task", id: input.taskId }, details: { sessionId: input.sessionId, ...details } });

  /** The task is done: status, progress and the `pr.merged` event the journey and the composer read. */
  async function finishMerged(input: MergeInput, target: { fullName: string }, pr: PullRequestSummary, sha: string, mergedBy: { kind: "agent" | "user" | "system"; id: string }, approvalId: string | null): Promise<void> {
    const task = await repos.tasks.get(db, input.businessId, input.taskId);
    if (task.status !== "done") await repos.tasks.setStatus(db, input.businessId, input.taskId, "done", { force: true });
    await repos.tasks.setProgress(db, input.businessId, input.taskId, { progress: 1, phase: "done" });
    await emitEvent(db, {
      businessId: input.businessId,
      type: "pr.merged",
      actor: mergedBy,
      payload: { taskId: input.taskId, repo: target.fullName, prNumber: pr.number, title: pr.title.slice(0, 300), branch: input.branch, baseBranch: pr.base.ref, mergeCommitSha: sha, mergedBy, additions: pr.additions, deletions: pr.deletions, filesChanged: pr.changedFiles, url: pr.url },
    }, { idempotencyKey: `pr.merged:${target.fullName}#${pr.number}:${sha}` });
    await audit(input, MERGE_AUDIT.merged, { prNumber: pr.number, prUrl: pr.url, mergeCommitSha: sha, branch: input.branch, approvalId });
    // The change is live: an open "… is not live yet" note from this agent is no longer true (Nov 7, 2026).
    const agent = await repos.agents.get(db, input.businessId, input.agentId).catch(() => null);
    if (agent) {
      const open = await repos.inbox.list(db, input.businessId, { type: "update", state: ["unread", "read"], fromAgentId: agent.id, limit: 20 });
      for (const note of open.items.filter((n) => n.subject === notLiveYetSubject(agent.name))) await repos.inbox.archive(db, input.businessId, note.id, { force: true });
    }
  }

  /**
   * The preview a repository's own deploy left on the branch head (WP-07 T12): the first successful deployment whose
   * address is https on a known preview host becomes `deploy.succeeded` (preview), once per head commit, which the
   * Development tab's "See it" column opens. Best effort: a repository with no previews, or an App without deployments
   * access, records nothing and the merge goes on.
   */
  async function recordPreview(input: MergeInput, tok: string, repo: { owner: string; repo: string }, sha: string): Promise<void> {
    const listed = await call<{ items?: unknown }>(tok, "list_deployments", { ...repo, sha }).catch(() => null);
    if (!listed?.result.ok || !Array.isArray(listed.result.data.items)) return;
    // The deployer's answer is untrusted: only a success with an address on a preview host is kept, checked again here.
    const preview = (listed.result.data.items as { state?: unknown; url?: unknown }[]).find((d) => d?.state === "success" && typeof d.url === "string" && previewProvider(d.url));
    if (!preview) return;
    const url = preview.url as string;
    await emitEvent(db, {
      businessId: input.businessId,
      type: "deploy.succeeded",
      actor: systemActor,
      payload: { taskId: input.taskId, environment: "preview", provider: previewProvider(url)!, url, commitSha: sha, branch: input.branch, durationMs: null },
    }, { idempotencyKey: `deploy:${input.taskId}:${sha}` });
  }

  return {
    /**
     * Code tasks whose work passed its tests on the task's own branch and never reached the default branch: in review with
     * nothing moving them, or marked done (until Oct 31, 2026 a code session ended done whatever its branch held) with no
     * `pr.merged`. Skipped: a merge made, refused by the founder, found unnecessary (`nothing_to_merge`) or handed back
     * to its agent (the task is blocked, not in review), and a session held for the founder's look at a change to the
     * test setup. The cycle starts a `mergeReview` for each; a review already under way for a task is left running.
     */
    async pendingMerges(input: { businessId: string }): Promise<MergeInput[]> {
      const waiting = (await repos.tasks.list(db, input.businessId, { status: ["review", "done"], kind: "code", limit: SWEEP_TASKS })).items;
      if (waiting.length === 0) return [];
      const target = await repos.integrations.codeRepository(db, input.businessId);
      if (!target?.writeEnabled) return [];
      const [completed, merges, finishes, mergedEvents] = await Promise.all([
        repos.events.list(db, input.businessId, { type: "task.completed", limit: SWEEP_HISTORY }),
        repos.audit.list(db, input.businessId, { action: [MERGE_AUDIT.merged, MERGE_AUDIT.notMerged], limit: SWEEP_HISTORY }),
        repos.audit.list(db, input.businessId, { action: "session.finish", limit: SWEEP_HISTORY }),
        repos.events.list(db, input.businessId, { type: "pr.merged", limit: SWEEP_HISTORY }),
      ]);
      const mergedTasks = new Set(mergedEvents.items.map((e) => (e.payload as { taskId?: unknown }).taskId).filter((id): id is string => typeof id === "string"));
      // Newest first: the first completion seen for a task is its latest.
      const latest = new Map<string, CompletedPayload>();
      const completedAt = new Map<string, number>();
      for (const e of completed.items) {
        const p = e.payload as unknown as CompletedPayload;
        if (p?.taskId && !latest.has(p.taskId)) {
          latest.set(p.taskId, p);
          completedAt.set(p.taskId, new Date(e.occurredAt).getTime());
        }
      }
      // The founder's answer settles the work it was about, not the rework they asked for: a `decision` older than the
      // task's latest completion is a change sent back and finished again (WP-05 T16), offered to go live again.
      const settledRow = (a: (typeof merges.items)[number]) => {
        const step = String((a.details as { step?: unknown } | null)?.step);
        if (a.action === MERGE_AUDIT.merged || step === NOTHING_TO_MERGE) return true;
        if (step !== "decision") return false;
        const id = (a.target as { id?: unknown } | null)?.id;
        const done = typeof id === "string" ? completedAt.get(id) : undefined;
        return done === undefined || new Date(a.createdAt).getTime() >= done;
      };
      const settled = new Set(merges.items.filter(settledRow).map((a) => (a.target as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === "string"));
      const heldForSetup = new Set(finishes.items.filter((a) => String((a.details as { reason?: unknown } | null)?.reason ?? "").startsWith(TEST_SETUP_REVIEW)).map((a) => (a.target as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === "string"));
      const out: MergeInput[] = [];
      for (const task of waiting) {
        const done = latest.get(task.id);
        if (!done || settled.has(task.id) || mergedTasks.has(task.id) || heldForSetup.has(done.sessionId)) continue;
        // Saved with nowhere to push (WP-05 T8): its branch was never pushed, so a repository connected later has nothing
        // of it to merge.
        if (done.branch !== `agent/${task.id}` || done.landed === "saved_only" || done.landed === "site") continue;
        const tests = done.acceptanceTests ?? 0;
        if (tests > 0 && (done.acceptanceTestsPassing ?? 0) < tests) continue;
        if (task.assigneeAgentId && task.assigneeAgentId !== done.assigneeAgentId) continue;
        out.push({ businessId: input.businessId, taskId: task.id, agentId: done.assigneeAgentId, sessionId: done.sessionId, branch: done.branch, acceptance: tests > 0 ? { passing: done.acceptanceTestsPassing, total: tests } : null, summary: (done.summary ?? "").slice(0, 2000) });
      }
      return out;
    },

    /**
     * The pull request for the task's branch and the repository's tests on it. Skips when there is nothing to merge (not a
     * code task in review, no repository, pushing off, already merged, nothing new); holds the task in review when the
     * pull request cannot be opened, with the reason.
     */
    async prepareMerge(input: MergeInput): Promise<MergePrepared> {
      const task = await repos.tasks.get(db, input.businessId, input.taskId);
      if (task.kind !== "code") return { status: "skipped", reason: `${task.kind} tasks have no branch to merge` };
      // A task marked done before Oct 31, 2026 may have its work only on its branch (the sweep offers those): it goes back
      // to review below, once GitHub shows there is something to merge.
      if (task.status !== "review" && task.status !== "done") return { status: "skipped", reason: `the task is ${task.status}, not in review` };
      const found = await repository(input);
      if (!found) return { status: "skipped", reason: "no repository is chosen on the Code tab" };
      const { target, repo } = found;
      if (!target.writeEnabled) return { status: "skipped", reason: `pushing to ${target.fullName} is turned off (the Code tab)` };
      const { read, write } = await tokens(input);

      // Already merged (by an earlier review, or by hand on GitHub), or nothing on the branch differs: nothing to ask.
      const ofBranch = (await pullRequestsOf(read, repo, input.branch)) ?? [];
      const alreadyMerged = ofBranch.find((p) => p.merged);
      const compared = await call<{ aheadBy?: unknown; files?: unknown }>(read, "compare_refs", { ...repo, base: "HEAD", head: input.branch });
      const comparedOk = compared.result.ok && typeof compared.result.data.aheadBy === "number" && Array.isArray(compared.result.data.files);
      const nothingToMerge = alreadyMerged !== undefined || (comparedOk && compared.result.ok && (compared.result.data.aheadBy === 0 || (compared.result.data.files as unknown[]).length === 0));
      if (nothingToMerge) {
        const reason = alreadyMerged ? `pull request #${alreadyMerged.number} is already merged` : `${input.branch} has nothing the default branch lacks`;
        if (task.status === "review") await repos.tasks.setStatus(db, input.businessId, input.taskId, "done", { force: true });
        // Merged by hand on GitHub (or before the platform recorded merges): the pull request's own facts go on record, so
        // the Pull requests table shows its number, lines and commit instead of "—". History, not news: not narrated.
        if (alreadyMerged?.mergeCommitSha) {
          const key = `pr.merged:${target.fullName}#${alreadyMerged.number}:${alreadyMerged.mergeCommitSha}`;
          if (!(await repos.events.byIdempotencyKey(db, input.businessId, key))) {
            const mergedBy = { kind: "webhook", id: "github" } as const;
            const event = await emitEvent(db, {
              businessId: input.businessId,
              type: "pr.merged",
              actor: mergedBy,
              payload: { taskId: input.taskId, repo: target.fullName, prNumber: alreadyMerged.number, title: alreadyMerged.title.slice(0, 300), branch: input.branch, baseBranch: alreadyMerged.base.ref, mergeCommitSha: alreadyMerged.mergeCommitSha, mergedBy, additions: alreadyMerged.additions, deletions: alreadyMerged.deletions, filesChanged: alreadyMerged.changedFiles, url: alreadyMerged.url },
            }, { idempotencyKey: key });
            await repos.events.markNarrated(db, input.businessId, [event.id]);
          }
        }
        // On record, so the cycle's sweep does not ask GitHub about this task again.
        await audit(input, MERGE_AUDIT.notMerged, { step: NOTHING_TO_MERGE, reason });
        return { status: "skipped", reason };
      }
      if (!compared.result.ok && compared.result.code === "not_found") return { status: "skipped", reason: `${input.branch} is not in ${target.fullName}` };
      if (task.status === "done") {
        await repos.tasks.setStatus(db, input.businessId, input.taskId, "review", { force: true });
        await audit(input, MERGE_AUDIT.reopened, { branch: input.branch, reason: "marked done with its work only on its branch" });
      }

      // The branch's pull request: the open one when the agent (or an earlier session) opened it, else a new one.
      let pr: PullRequestSummary | null = ofBranch.find((p) => !p.merged && p.state !== "closed") ?? null;
      if (!pr) {
        const opened = await call<PullRequestSummary>(write, "open_pr", { ...repo, title: task.title.trim().slice(0, 256), body: pullRequestBody(input, task), head: input.branch, base: "HEAD", draft: false });
        if (!opened.result.ok) {
          await audit(input, MERGE_AUDIT.notMerged, { step: "open_pr", reason: opened.result.message });
          return { status: "held", reason: `the pull request could not be opened: ${opened.result.message}`.slice(0, 500), prNumber: null, prUrl: null };
        }
        pr = opened.result.data;
      }
      // The repository's own tests on the branch, so the founder decides with the full suite's verdict next to the
      // sandbox's, and the merge waits for them. Best effort: a repository without the workflow, or a branch whose
      // .github differs, is noted and the merge is tried once the founder approves (the repository's rules decide).
      const checks = await call<{ dispatched: true }>(write, "run_checks", { ...repo, branch: input.branch });
      const checksNote = checks.result.ok ? null : checks.result.message.slice(0, 300);
      await audit(input, MERGE_AUDIT.prepared, { prNumber: pr.number, prUrl: pr.url, ci: checksNote ?? "started", acceptance: input.acceptance });
      return { status: "ready", prNumber: pr.number, prUrl: pr.url, checksStarted: checks.result.ok, checksNote };
    },

    /** GitHub's merge state and the checks on the branch head, before anyone is asked. */
    async assessMerge(input: MergeInput & MergePullRequest): Promise<MergeAssessment> {
      const found = await repository(input);
      if (!found) return { mergeable: "unknown", checks: "unknown", detail: "no repository is chosen on the Code tab" };
      const { read } = await tokens(input);
      const [pr, checks, compared] = await Promise.all([
        call<PullRequestSummary>(read, "get_pull_request", { ...found.repo, prNumber: input.prNumber }),
        call<{ state?: unknown }>(read, "get_checks", { ...found.repo, branch: input.branch }),
        call<{ behindBy?: unknown }>(read, "compare_refs", { ...found.repo, base: "HEAD", head: input.branch }),
      ]);
      const mergeable = pr.result.ok ? mergeableOf(pr.result.data.mergeableState, pr.result.data.draft) : "unknown";
      const state = checks.result.ok && typeof checks.result.data.state === "string" ? checks.result.data.state : "unknown";
      const checksState: MergeAssessment["checks"] = state === "pending" || state === "success" || state === "failure" ? state : "unknown";
      const behindBy = compared.result.ok && typeof compared.result.data.behindBy === "number" ? compared.result.data.behindBy : null;
      const headSha = checks.result.ok ? (checks.result.data as { headSha?: unknown }).headSha : undefined;
      if (typeof headSha === "string") await recordPreview(input, read, found.repo, headSha);
      const detail = pr.result.ok ? (pr.result.data.mergeableState ? `GitHub reports the pull request as ${pr.result.data.mergeableState}${behindBy ? `, ${behindBy} commit${behindBy === 1 ? "" : "s"} behind the default branch` : ""}` : null) : pr.result.message.slice(0, 300);
      return { mergeable, checks: checksState, detail, behindBy };
    },

    /**
     * The branch brought up to date with the default branch by GitHub (one merge commit on the agent's branch, nothing
     * on the default branch), then the repository's tests started on the new head. A branch's tests mean nothing when
     * they ran against yesterday's default branch; before this, every such branch went back to its agent for a cycle.
     * Conflicts are the one case GitHub refuses, and the one case an agent is for.
     */
    async updateBranch(input: MergeInput & MergePullRequest): Promise<MergeBranchUpdated> {
      const found = await repository(input);
      if (!found) return { updated: false, reason: "no repository is chosen on the Code tab", checksStarted: false };
      const { write } = await tokens(input);
      const updated = await call<{ updated?: unknown; message?: unknown }>(write, "update_branch", { ...found.repo, prNumber: input.prNumber });
      if (!updated.result.ok) {
        await audit(input, MERGE_AUDIT.notMerged, { step: "update_branch", prNumber: input.prNumber, reason: updated.result.message });
        return { updated: false, reason: updated.result.message.slice(0, 300), checksStarted: false };
      }
      if (updated.result.data.updated !== true) return { updated: false, reason: null, checksStarted: false };
      const checks = await call<{ dispatched: true }>(write, "run_checks", { ...found.repo, branch: input.branch });
      await audit(input, MERGE_AUDIT.updated, { prNumber: input.prNumber, prUrl: input.prUrl, ci: checks.result.ok ? "started" : checks.result.message.slice(0, 300) });
      return { updated: true, reason: null, checksStarted: checks.result.ok };
    },

    /** The merge, asked for: the gateway's policy makes it the founder's decision, or runs it when the decision was delegated. */
    async askMerge(input: MergeInput & MergePullRequest & { reviewedSha?: string | null }): Promise<MergeAsked> {
      const task = await repos.tasks.get(db, input.businessId, input.taskId);
      const found = await repository(input);
      if (!found) return { status: "held", reason: "no repository is chosen on the Code tab", prNumber: input.prNumber, prUrl: input.prUrl };
      const { read, write } = await tokens(input);
      const merged = await call<{ merged: true; sha: string }>(write, "merge_pr", mergeArgs(found.repo, input.prNumber, task.title, input.reviewedSha));
      if (merged.res.outcome === "ask" && merged.res.approvalId) {
        await audit(input, MERGE_AUDIT.asked, { prNumber: input.prNumber, prUrl: input.prUrl, approvalId: merged.res.approvalId });
        return { status: "awaiting_approval", approvalId: merged.res.approvalId, prNumber: input.prNumber, prUrl: input.prUrl };
      }
      if (merged.result.ok) {
        const pr = ((await pullRequestsOf(read, found.repo, input.branch)) ?? []).find((p) => p.number === input.prNumber) ?? { number: input.prNumber, title: task.title, url: input.prUrl ?? `https://github.com/${found.target.fullName}/pull/${input.prNumber}`, base: { ref: "main" }, head: { ref: input.branch }, additions: 0, deletions: 0, changedFiles: 0 };
        await finishMerged(input, found.target, pr, merged.result.data.sha, { kind: "agent", id: input.agentId }, null);
        return { status: "merged", prNumber: input.prNumber, prUrl: pr.url, mergeCommitSha: merged.result.data.sha };
      }
      await audit(input, MERGE_AUDIT.notMerged, { step: "merge_pr", prNumber: input.prNumber, reason: merged.result.message });
      return { status: "held", reason: `the merge was refused: ${merged.result.message}`.slice(0, 500), prNumber: input.prNumber, prUrl: input.prUrl };
    },

    /**
     * The repository's checks on the branch head, after the founder approved. The first look is on record against the
     * approval (`merge.waiting`), which the Inbox shows as "Waiting for the final quality checks".
     */
    async awaitChecks(input: MergeInput & MergePullRequest & { approvalId: string; first: boolean }): Promise<{ state: MergeAssessment["checks"] }> {
      const found = await repository(input);
      if (!found) return { state: "unknown" };
      const { read } = await tokens(input);
      const checks = await call<{ state?: unknown }>(read, "get_checks", { ...found.repo, branch: input.branch });
      const state = checks.result.ok && typeof checks.result.data.state === "string" ? checks.result.data.state : "unknown";
      if (input.first) await audit(input, MERGE_AUDIT.waiting, { step: "checks", prNumber: input.prNumber, prUrl: input.prUrl, approvalId: input.approvalId, checks: state });
      return { state: state === "pending" || state === "success" || state === "failure" ? state : "unknown" };
    },

    /** After the founder approved and the checks passed: the same merge call, which the gateway runs under that approval, and the task is done. */
    async completeMerge(input: MergeInput & MergePullRequest & { approvalId: string; decidedBy: string | null; reviewedSha?: string | null }): Promise<MergeOutcome & { retryable?: boolean }> {
      const task = await repos.tasks.get(db, input.businessId, input.taskId);
      const found = await repository(input);
      if (!found) return { status: "skipped", reason: "no repository is chosen on the Code tab" };
      const { read, write } = await tokens(input);
      const current = ((await pullRequestsOf(read, found.repo, input.branch)) ?? []).find((p) => p.number === input.prNumber) ?? null;
      const merged = await call<{ merged: true; sha: string }>(write, "merge_pr", mergeArgs(found.repo, input.prNumber, task.title, input.reviewedSha));
      if (merged.result.ok) {
        const pr: PullRequestSummary = current ?? { number: input.prNumber, title: task.title, url: input.prUrl ?? `https://github.com/${found.target.fullName}/pull/${input.prNumber}`, base: { ref: "main" }, head: { ref: input.branch }, additions: 0, deletions: 0, changedFiles: 0 };
        await finishMerged(input, found.target, pr, merged.result.data.sha, input.decidedBy ? { kind: "user", id: input.decidedBy } : systemActor, input.approvalId);
        return { status: "merged", prNumber: input.prNumber, prUrl: pr.url, mergeCommitSha: merged.result.data.sha };
      }
      const reason = merged.res.outcome === "ask" ? "the merge asked for approval again instead of running under the one given" : merged.result.message;
      // GitHub answers 405 "not mergeable" for a moment after the last check passes, or "Repository rule violations
      // found … required status checks are expected" while its rules catch up with checks that already concluded
      // (17 seconds after the last one, Nov 2, 2026), or 409 "Base branch was modified"; the workflow tries again shortly.
      const retryable = merged.res.outcome === "allow" && mergeRefusalIsMomentary(reason);
      await audit(input, MERGE_AUDIT.notMerged, { step: "merge_pr_approved", prNumber: input.prNumber, prUrl: input.prUrl, approvalId: input.approvalId, reason, retryable });
      return { status: "held", reason: `the approved merge did not run: ${reason}`.slice(0, 500), prNumber: input.prNumber, prUrl: input.prUrl, retryable };
    },

    /**
     * The branch goes back to its agent: the task is blocked with the instruction (`needs_update`), which the next session
     * starts from (the default branch's newest files with the change applied on top) and the Chief of Staff tells the
     * founder about. On record against the approval when the founder had already approved.
     */
    async handBack(input: MergeInput & MergePullRequest & { approvalId: string | null; why: MergeHoldReason; detail: string | null }): Promise<MergeOutcome> {
      const task = await repos.tasks.get(db, input.businessId, input.taskId);
      const reason = handBackDetail(input.why, input.branch, input.detail);
      // One transaction, so the one-round check (`merge.handed_back`) never disagrees with the blocked task. The key is the
      // session's: a session's change goes back at most once (the task is blocked; its rework is a new session).
      await db.transaction(async (tx) => {
        if (task.status === "review" || task.status === "done") await repos.tasks.setStatus(tx, input.businessId, input.taskId, "blocked", { force: true });
        await emitEvent(tx, {
          businessId: input.businessId,
          type: "task.blocked",
          actor: { kind: "agent", id: input.agentId },
          payload: { taskId: input.taskId, kind: task.kind, title: task.title.slice(0, 200), assigneeAgentId: input.agentId, sessionId: input.sessionId, reason: "needs_update", detail: reason, approvalId: input.approvalId, occurrence: 1 },
        }, { idempotencyKey: `task.blocked:merge:${input.sessionId}:${input.prNumber}:${input.why}` });
        await repos.audit.append(tx, input.businessId, { actorKind: "agent", actorId: input.agentId, action: MERGE_AUDIT.handedBack, target: { kind: "task", id: input.taskId }, details: { sessionId: input.sessionId, prNumber: input.prNumber, prUrl: input.prUrl, approvalId: input.approvalId, why: input.why, detail: input.detail } });
      });
      return { status: "handed_back", why: input.why, reason, prNumber: input.prNumber, prUrl: input.prUrl };
    },

    /**
     * The merge is held for the next cycle (the checks never concluded, or GitHub kept refusing): on record against the
     * approval, and in the founder's Inbox. The `mergeReview` workflow is started abandoned, so nobody reads its outcome:
     * until Nov 2, 2026 a founder who had approved a merge that GitHub then refused heard nothing (the deploy contract,
     * approved 8:53 PM, refused 9:15 PM, no Inbox line). The next cycle's sweep tries the merge again.
     */
    async holdMerge(input: MergeInput & MergePullRequest & { approvalId: string | null; why: MergeHoldReason; detail: string | null }): Promise<MergeOutcome> {
      const reason = handBackDetail(input.why, input.branch, input.detail).split(" Bring your working copy")[0]!;
      await audit(input, MERGE_AUDIT.notMerged, { step: input.why, prNumber: input.prNumber, prUrl: input.prUrl, approvalId: input.approvalId, reason: input.detail ?? reason });
      try {
        const [task, agent] = await Promise.all([repos.tasks.get(db, input.businessId, input.taskId), repos.agents.get(db, input.businessId, input.agentId)]);
        const what = input.why === "refused" ? "It could not go live yet: a final check was still running when the team tried." : reason;
        // An update, not a warning (Nov 7, 2026): nothing is asked of the founder, and it closes itself once the change is live.
        await postNote(deps, input.businessId, input.agentId, {
          type: "update",
          subject: notLiveYetSubject(agent.name),
          body: `**What happened:** ${what} ${input.approvalId ? "You had already said yes to putting it live." : ""}\n\n**What happens next:** the team tries again on the next round of work; nothing is needed from you. The work (“${(task.founderTitle ?? task.title).slice(0, 120)}”) stays saved and waits.`.replace(/ {2,}/g, " "),
          blocksContinue: false,
        });
      } catch (err) {
        deps.log.warn({ businessId: input.businessId, taskId: input.taskId, err: (err as Error).message }, "merge: the held note could not be written");
      }
      return { status: "held", reason, prNumber: input.prNumber, prUrl: input.prUrl };
    },

    /** The founder rejected the merge, or the approval expired or was withdrawn: the task stays in review, on record. */
    async recordMergeDecision(input: MergeInput & MergePullRequest & { approvalId: string; outcome: "rejected" | "expired" | "withdrawn" }): Promise<MergeOutcome> {
      await audit(input, MERGE_AUDIT.notMerged, { step: "decision", prNumber: input.prNumber, prUrl: input.prUrl, approvalId: input.approvalId, outcome: input.outcome });
      const reason = input.outcome === "rejected" ? "the founder did not approve the merge" : input.outcome === "expired" ? "the approval expired" : "the wait for the approval was withdrawn";
      return { status: "not_merged", prNumber: input.prNumber, prUrl: input.prUrl, reason };
    },
  };
}

export type MergeActivities = ReturnType<typeof createMergeActivities>;
