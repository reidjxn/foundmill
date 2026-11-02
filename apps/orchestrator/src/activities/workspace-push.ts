/**
 * Saved code goes to GitHub: after a code session's workspace is saved (workspace-store.ts), the save is pushed to the
 * agent's branch (`agent/<taskId>`) of the repository the business chose (Development › Code), through the gateway's
 * GitHub connector (`commit_files`), never by calling GitHub from here.
 *
 * - Off until the founder turns pushing on for the repository: a push runs the repository's CI and preview deploys on
 *   code an agent wrote. Commits carry `[skip ci]`, files under `.github` (workflows, local actions) are never sent, and
 *   a session that was stopped, looped or failed is not pushed at all.
 * - One commit per session, within `commit_files`' limits (300 files, 10 MB). A save made on a checkout of the
 *   repository (0068) is already the diff against it: its added and changed files are written and the checkout's files
 *   the agent deleted are removed, on top of the branch (created from the checkout's commit when missing); unchanged
 *   files are never sent. A save with no checkout carries only what changed since the last save that reached the
 *   repository (its files are the diff base; the first push sends every file and deletes nothing that was already in
 *   the repository).
 * - The token is minted for this call alone (`github:commit_files`, five minutes), so the push goes through the same
 *   policy, audit, rate limits and credentials as any agent tool call.
 * - `commit_files` writes only `agent/` branches of private repositories and never force-pushes; merging stays a pull
 *   request. The message names the agent and the task id, not the task's title (the founder's words stay here).
 * - Never over a branch that moved: `commit_files` gets `expectedHeadSha`, the last commit of the branch this task saw
 *   (the checkout's commit for the first push after a checkout of the branch, else the commit the task last pushed
 *   there). When the branch head differs GitHub is not written (`branch_moved`): the reason is recorded on the save and
 *   the next session checks the branch out again.
 * - A save made on a checkout of another ref than the branch (the default branch: a task handed back to be brought up to
 *   date starts from its newest files, checkout.ts `fromDefaultBranch`) is a diff against a commit the branch does not
 *   have, so it is not added on top of the branch: the branch is rebuilt on that commit (`commit_files` `rebuild`), its
 *   earlier commits left behind, and the push expects the branch at the last head this task knew (its agent's own push
 *   this session, else the last push the task made there); when GitHub names another head, the rebuild is retried once
 *   there (the branch is the task's own and is being replaced). A branch that does not exist yet is simply created there.
 * - A save made without a checkout on a task whose saves are diffs against one (`saveHeldBack`) is the whole
 *   workspace, not a diff: it is never pushed over the repository.
 * - The result is recorded on the save (commit and link, or why not). A save that did not reach GitHub is pushed again
 *   when the next session on the task ends. A failed push never fails the session.
 */
import { isCommitPath, MAX_COMMIT_BYTES, MAX_COMMIT_FILES } from "@foundmill/connectors/connectors/github/tools";
import { repos, type Db, type WorkspaceSnapshot } from "@foundmill/db";
import type { GatewayClient } from "../gateway-client";
import type { WorkspaceOwner } from "./workspace-store";

export type PushResult =
  | { status: "pushed"; repo: string; branch: string; commitSha: string; url: string | null; filesWritten: number; filesDeleted: number; leftOut: number; rebuilt: boolean }
  | { status: "up_to_date"; repo: string; branch: string; commitSha: string }
  | { status: "skipped"; reason: string }
  | { status: "awaiting_approval"; repo: string; branch: string; approvalId: string | null }
  | { status: "moved"; repo: string; branch: string; headSha: string | null }
  | { status: "failed"; repo: string; branch: string; reason: string };

export interface PushContext extends WorkspaceOwner {
  agentName: string;
  /** Why this session's save is not pushed (stopped, looped, failed); null pushes it. Required, so a caller decides. */
  holdBack: string | null;
  /** Why the save itself must not be pushed (saveWorkspace's `pushHeldBack`); recorded on this session's own save. */
  saveHeldBack?: string | null;
  /** The checkout this session took (its commit and when): a save on that same commit expects the branch there. */
  checkout?: { commitSha: string; at: Date } | null;
  /**
   * What the agent itself pushed to its branch during this session with `commit_files` (engineers hold `pulls.create`):
   * how many pushes went through and the last branch head one answered, when the answer named it. Those commits moved
   * the branch after the checkout, and the workspace is the state the agent committed from, so the final push goes on
   * top of them: the last head is the one this push expects, and when no head is known, a `branch_moved` refusal is
   * retried once at the head it reports. Without this, an agent's own commits read as someone else's and the save is
   * never pushed (Foundmill business, Oct 25, 2026).
   */
  agentPushed?: { count: number; lastSha: string | null } | null;
}

/** The branch head a successful `commit_files` answer names (`data.sha`), or null when the text holds none. */
export function commitShaOf(resultText: string | null | undefined): string | null {
  const m = /"sha"\s*:\s*"([0-9a-f]{40})"/i.exec(resultText ?? "");
  return m ? m[1]!.toLowerCase() : null;
}

/** Lifetime of the token minted for one push. */
export const PUSH_TOKEN_TTL_SECONDS = 300;
/** How long one push may take end to end (up to 300 files through the gateway to GitHub). */
export const PUSH_TIMEOUT_MS = 120_000;

export function pushMessage(ctx: PushContext, snapshot: Pick<WorkspaceSnapshot, "added" | "changed" | "removed" | "baseRef" | "baseCommitSha">, rebuild = false): string {
  const counts = [`${snapshot.added} added`, `${snapshot.changed} changed`, `${snapshot.removed} removed`].join(", ");
  const rebuilt = rebuild && snapshot.baseCommitSha ? ` Based on ${snapshot.baseRef ?? "the default branch"} at ${snapshot.baseCommitSha.slice(0, 7)}.` : "";
  return `Code saved by ${ctx.agentName.slice(0, 80)} at the end of a session (${counts})\n\nFoundmill task ${ctx.taskId}, session ${ctx.sessionId}.${rebuilt}\n\n[skip ci]`;
}

/**
 * A save made on a checkout of another ref than the task's branch (the default branch, after a hand-back) is a diff
 * against a commit the branch does not have: it rebuilds the branch on that commit instead of going on top.
 */
export function rebuildsBranch(snapshot: Pick<WorkspaceSnapshot, "baseRef" | "baseCommitSha" | "baseRepo">, branch: string): boolean {
  return snapshot.baseCommitSha !== null && snapshot.baseRepo !== null && snapshot.baseRef !== null && snapshot.baseRef !== branch;
}

interface CommitFilesData {
  committed: boolean;
  rebuilt?: boolean;
  sha: string;
  url: string | null;
  filesWritten: number;
  filesDeleted: number;
}

/** The branch head a `branch_moved` refusal reports (the connector's `currentHeadSha` detail), or null when it names none. */
export function movedHeadSha(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  for (const key of ["currentHeadSha", "headSha", "currentSha"]) {
    const v = d[key];
    if (typeof v === "string" && /^[0-9a-f]{7,64}$/i.test(v)) return v;
  }
  return null;
}

/**
 * The branch head this push expects: the last commit of the branch the task saw. For a save on a checkout that is the
 * checkout's commit, unless a push from this task moved the branch after the checkout was taken (then that push's
 * commit). For a save without a checkout it is the commit the task last pushed there.
 */
async function expectedHead(db: Db, ctx: PushContext, snapshot: WorkspaceSnapshot, repo: string, branch: string): Promise<string | null> {
  // The agent's own pushes this session are the newest commits this task saw: the branch is expected at the last one.
  if (ctx.agentPushed?.lastSha) return ctx.agentPushed.lastSha;
  const last = await repos.workspaces.lastPushed(db, ctx.businessId, ctx.taskId, repo);
  const lastSha = last && last.id !== snapshot.id && last.pushedBranch === branch && last.pushedCommitSha ? last.pushedCommitSha : null;
  // The save's base is not on the branch (a rebuild): the branch is expected where this task last left it, if anywhere.
  if (snapshot.baseCommitSha === null || rebuildsBranch(snapshot, branch)) return lastSha;
  if (!lastSha || lastSha === snapshot.baseCommitSha || !last?.pushedAt) return snapshot.baseCommitSha;
  // When the base was seen: this session's checkout when the save is on its commit, else when the save was made.
  const seenAt = ctx.checkout && ctx.checkout.commitSha === snapshot.baseCommitSha ? ctx.checkout.at : snapshot.createdAt;
  return last.pushedAt.getTime() > seenAt.getTime() ? lastSha : snapshot.baseCommitSha;
}

/** Push one save to the agent's branch. Records the outcome on the save; never throws. */
export async function pushWorkspace(db: Db, gateway: GatewayClient, ctx: PushContext, snapshot: WorkspaceSnapshot): Promise<PushResult> {
  const target = await repos.integrations.codeRepository(db, ctx.businessId);
  if (!target) return { status: "skipped", reason: "connect GitHub and choose a repository on the Code tab" };
  if (!target.writeEnabled) return { status: "skipped", reason: `pushing to ${target.fullName} is turned off (the Code tab)` };
  if (ctx.holdBack) return { status: "skipped", reason: ctx.holdBack };
  const repo = target.fullName;
  const branch = ctx.branch;
  if (branch !== `agent/${ctx.taskId}`) return { status: "skipped", reason: `${branch} is not this task's branch` };
  if (snapshot.pushedRepo === repo && snapshot.pushedCommitSha) return { status: "up_to_date", repo, branch, commitSha: snapshot.pushedCommitSha };

  const record = async (push: { commitSha: string; url: string | null } | { error: string }) => {
    try {
      await repos.workspaces.recordPush(db, ctx.businessId, snapshot.id, { repo, branch, ...push });
    } catch {
      // The push itself happened (or not) either way; a lost record only means the next session pushes again.
    }
  };

  // Saved without the checkout its base names: the whole workspace, never pushed over the repository.
  if (ctx.saveHeldBack) {
    if (snapshot.sessionId === ctx.sessionId) await record({ error: ctx.saveHeldBack });
    return { status: "skipped", reason: ctx.saveHeldBack };
  }

  // A save made on a checkout is a diff against it: it goes onto the branch as it is, and only to that repository.
  const onCheckout = snapshot.baseCommitSha !== null && snapshot.baseRepo !== null;
  if (onCheckout && snapshot.baseRepo!.toLowerCase() !== repo.toLowerCase()) return { status: "skipped", reason: `this code was checked out from ${snapshot.baseRepo}, not ${repo} (the Code tab)` };
  // Checked out from another ref (the default branch, after a hand-back): the branch is rebuilt on that commit.
  const rebuild = rebuildsBranch(snapshot, branch);

  try {
    let writes: typeof snapshot.files;
    let deletions: string[];
    let leftOut: number;
    if (onCheckout) {
      // Only what the agent changed against the checkout: its added and changed files and the checkout's files it
      // deleted. Nothing under .git or .github ever leaves for the repository.
      writes = snapshot.files.filter((f) => isCommitPath(f.path));
      deletions = snapshot.removedPaths.filter((p) => isCommitPath(p));
      leftOut = snapshot.files.length - writes.length + (snapshot.removedPaths.length - deletions.length);
      if (writes.length === 0 && deletions.length === 0) return { status: "up_to_date", repo, branch, commitSha: snapshot.baseCommitSha! };
    } else {
      const base = await repos.workspaces.lastPushed(db, ctx.businessId, ctx.taskId, repo);
      // Only paths commit_files accepts: nothing under .git or .github ever leaves for the repository.
      const pushable = snapshot.files.filter((f) => isCommitPath(f.path));
      leftOut = snapshot.files.length - pushable.length;
      const before = new Map((base?.files ?? []).filter((f) => isCommitPath(f.path)).map((f) => [f.path, f.sha256] as const));
      const now = new Set(pushable.map((f) => f.path));
      writes = pushable.filter((f) => before.get(f.path) !== f.sha256);
      deletions = [...before.keys()].filter((p) => !now.has(p));
      if (base?.pushedCommitSha && writes.length === 0 && deletions.length === 0) {
        await record({ commitSha: base.pushedCommitSha, url: base.pushedUrl });
        return { status: "up_to_date", repo, branch, commitSha: base.pushedCommitSha };
      }
    }
    const bytes = writes.reduce((n, f) => n + f.size, 0);
    if (writes.length > MAX_COMMIT_FILES || deletions.length > MAX_COMMIT_FILES || bytes > MAX_COMMIT_BYTES) {
      const reason = `${writes.length} changed files (${(bytes / (1024 * 1024)).toFixed(1)} MB) are more than one push carries (${MAX_COMMIT_FILES} files, ${MAX_COMMIT_BYTES / (1024 * 1024)} MB)`;
      await record({ error: reason });
      return { status: "failed", repo, branch, reason };
    }
    const contents = writes.length > 0 ? await repos.workspaces.readFiles(db, ctx.businessId, snapshot, writes.map((f) => f.path)) : [];
    if (contents.length !== writes.length) throw new Error("some saved files could not be read back");

    // Never on top of commits this task did not see (someone else's push, a rebase): GitHub refuses with branch_moved.
    const expectedHeadSha = await expectedHead(db, ctx, snapshot, repo, branch);
    const token = await gateway.mintSessionToken({ businessId: ctx.businessId, agentId: ctx.agentId, sessionId: ctx.sessionId, allowedTools: ["github:commit_files"], ttlSeconds: PUSH_TOKEN_TTL_SECONDS });
    const commit = (expected: string | null) =>
      gateway.call(
        token.token,
        {
          connector: "github",
          tool: "commit_files",
          // A missing branch starts at the checkout's commit, so the diff applies to exactly what the agent saw; a branch
          // the checkout was not taken from is rebuilt there.
          args: { owner: target.owner, repo: target.repo, branch, ...(onCheckout ? { fromRef: snapshot.baseCommitSha } : {}), ...(rebuild ? { rebuild: true } : {}), ...(expected ? { expectedHeadSha: expected } : {}), message: pushMessage(ctx, snapshot, rebuild), files: contents.map((f) => ({ path: f.path, content: Buffer.from(f.content).toString("base64"), encoding: "base64" })), deletions },
        },
        { timeoutMs: PUSH_TIMEOUT_MS },
      );
    let res = await commit(expectedHeadSha);
    const movedTo = (r: typeof res): string | null => {
      const result = r.result as { ok?: boolean; error?: { code?: string; details?: unknown } } | undefined;
      return r.outcome === "allow" && result?.ok === false && result.error?.code === "branch_moved" ? movedHeadSha(result.error.details) : null;
    };
    // The agent pushed to its branch itself during this session and no answer named the head: the branch is at one of
    // its own commits, so the save goes on top of the head GitHub reports, once. A second refusal is someone else's push.
    // A rebuild is retried the same way: the branch is the task's own and is being replaced whatever it holds (an
    // earlier session's own commit the record never saw is the usual reason the head differs), so the one retry at the
    // head GitHub names replaces it; a second refusal is a push landing while this one ran.
    const ownHead = movedTo(res);
    if (ownHead && ((ctx.agentPushed?.count ?? 0) > 0 || rebuild) && ownHead !== expectedHeadSha) res = await commit(ownHead);
    if (res.outcome === "ask") {
      await record({ error: "waiting for the founder's approval" });
      return { status: "awaiting_approval", repo, branch, approvalId: res.approvalId ?? null };
    }
    if (res.outcome !== "allow") {
      const reason = res.outcome === "rate_limited" ? "GitHub's rate limit was reached" : `refused by policy${res.reasons?.length ? ` (${res.reasons.join("; ")})` : ""}`;
      await record({ error: reason });
      return { status: "failed", repo, branch, reason };
    }
    const result = res.result as { ok?: boolean; data?: CommitFilesData; error?: { code?: string; message?: string; details?: unknown } } | undefined;
    if (result?.ok === false && result.error?.code === "branch_moved") {
      // Nothing was written: the branch has commits this save was not made on. The next session checks it out again.
      const headSha = movedHeadSha(result.error.details);
      await record({ error: `${branch} moved since checkout${headSha ? ` (${headSha.slice(0, 7)})` : ""}; not pushed` });
      return { status: "moved", repo, branch, headSha };
    }
    if (!result?.ok || !result.data) {
      const reason = result?.error?.message ?? "GitHub gave no result";
      await record({ error: reason });
      return { status: "failed", repo, branch, reason };
    }
    await record({ commitSha: result.data.sha, url: result.data.url });
    if (!result.data.committed) return { status: "up_to_date", repo, branch, commitSha: result.data.sha };
    return { status: "pushed", repo, branch, commitSha: result.data.sha, url: result.data.url, filesWritten: result.data.filesWritten, filesDeleted: result.data.filesDeleted, leftOut, rebuilt: result.data.rebuilt === true };
  } catch (err) {
    const reason = (err as Error).message.slice(0, 300) || "the push failed";
    await record({ error: reason });
    return { status: "failed", repo, branch, reason };
  }
}

/** One session note for a push, or null when there is nothing worth saying. */
export function describePush(push: PushResult): { level: "info" | "warn"; text: string } | null {
  switch (push.status) {
    case "pushed":
      return { level: "info", text: `Pushed to ${push.branch} on ${push.repo}: ${push.filesWritten} file${push.filesWritten === 1 ? "" : "s"} written, ${push.filesDeleted} removed (commit ${push.commitSha.slice(0, 7)}).${push.rebuilt ? " The branch was rebuilt on the default branch's newest commit; its earlier commits are no longer its history." : ""}${push.leftOut ? ` ${push.leftOut} file${push.leftOut === 1 ? "" : "s"} under .github stayed here: agents never change a repository's workflows.` : ""}` };
    case "up_to_date":
      return null;
    case "skipped":
      return { level: "info", text: `Not pushed to GitHub: ${push.reason}. The code is saved on the Code tab.` };
    case "awaiting_approval":
      return { level: "info", text: `Pushing to ${push.branch} on ${push.repo} is waiting for your approval.` };
    case "moved":
      return { level: "warn", text: `Not pushed: ${push.branch} moved since checkout${push.headSha ? ` (${push.headSha.slice(0, 7)})` : ""}; the next session checks it out again.` };
    case "failed":
      return { level: "warn", text: `Not pushed to ${push.branch} on ${push.repo}: ${push.reason}. The code is saved here, and the next session on the task pushes it again.` };
  }
}
