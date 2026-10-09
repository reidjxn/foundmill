/**
 * Saved code goes to GitHub: after a code session's workspace is saved (workspace-store.ts), the save is pushed to the
 * agent's branch (`agent/<taskId>`) of the repository the business chose (Development › Code), through the gateway's
 * GitHub connector (`commit_files`), never by calling GitHub from here.
 *
 * - One commit per session, carrying only what changed since the last save that reached the repository (its files are
 *   the diff base; the first push sends every file and deletes nothing that was already in the repository).
 * - The token is minted for this call alone (`github:commit_files`, five minutes), so the push goes through the same
 *   policy, audit, rate limits and credentials as any agent tool call.
 * - `commit_files` never writes the default branch and never force-pushes; merging stays a pull request.
 * - The result is recorded on the save (commit and link, or why not). A save that did not reach GitHub is pushed again
 *   when the next session on the task ends. A failed push never fails the session.
 */
import { repos, type Db, type WorkspaceSnapshot } from "@foundmill/db";
import type { GatewayClient } from "../gateway-client";
import type { WorkspaceOwner } from "./workspace-store";

export type PushResult =
  | { status: "pushed"; repo: string; branch: string; commitSha: string; url: string | null; filesWritten: number; filesDeleted: number }
  | { status: "up_to_date"; repo: string; branch: string; commitSha: string }
  | { status: "skipped"; reason: string }
  | { status: "awaiting_approval"; repo: string; branch: string; approvalId: string | null }
  | { status: "failed"; repo: string; branch: string; reason: string };

export interface PushContext extends WorkspaceOwner {
  taskTitle: string;
  agentName: string;
}

/** Lifetime of the token minted for one push. */
export const PUSH_TOKEN_TTL_SECONDS = 300;

export function pushMessage(ctx: PushContext, snapshot: Pick<WorkspaceSnapshot, "added" | "changed" | "removed">): string {
  const counts = [`${snapshot.added} added`, `${snapshot.changed} changed`, `${snapshot.removed} removed`].join(", ");
  return `${ctx.taskTitle.slice(0, 120)}\n\nSaved by ${ctx.agentName} at the end of a session (${counts}).\n\nFoundmill task ${ctx.taskId}, session ${ctx.sessionId}.`;
}

interface CommitFilesData {
  committed: boolean;
  sha: string;
  url: string | null;
  filesWritten: number;
  filesDeleted: number;
}

/** Push one save to the agent's branch. Records the outcome on the save; never throws. */
export async function pushWorkspace(db: Db, gateway: GatewayClient, ctx: PushContext, snapshot: WorkspaceSnapshot): Promise<PushResult> {
  const target = await repos.integrations.codeRepository(db, ctx.businessId);
  if (!target) return { status: "skipped", reason: "connect GitHub and choose a repository on Development › Code" };
  if (!target.writeEnabled) return { status: "skipped", reason: `pushing to ${target.fullName} is turned off` };
  const repo = target.fullName;
  const branch = ctx.branch;
  if (snapshot.pushedRepo === repo && snapshot.pushedCommitSha) return { status: "up_to_date", repo, branch, commitSha: snapshot.pushedCommitSha };

  const record = async (push: { commitSha: string; url: string | null } | { error: string }) => {
    try {
      await repos.workspaces.recordPush(db, ctx.businessId, snapshot.id, { repo, branch, ...push });
    } catch {
      // The push itself happened (or not) either way; a lost record only means the next session pushes again.
    }
  };

  try {
    const base = await repos.workspaces.lastPushed(db, ctx.businessId, ctx.taskId, repo);
    const before = new Map((base?.files ?? []).map((f) => [f.path, f.sha256] as const));
    const now = new Set(snapshot.files.map((f) => f.path));
    const writes = snapshot.files.filter((f) => before.get(f.path) !== f.sha256);
    const deletions = [...before.keys()].filter((p) => !now.has(p));
    if (base?.pushedCommitSha && writes.length === 0 && deletions.length === 0) {
      await record({ commitSha: base.pushedCommitSha, url: base.pushedUrl });
      return { status: "up_to_date", repo, branch, commitSha: base.pushedCommitSha };
    }
    const contents = writes.length > 0 ? await repos.workspaces.readFiles(db, ctx.businessId, snapshot, writes.map((f) => f.path)) : [];
    if (contents.length !== writes.length) throw new Error("some saved files could not be read back");

    const token = await gateway.mintSessionToken({ businessId: ctx.businessId, agentId: ctx.agentId, sessionId: ctx.sessionId, allowedTools: ["github:commit_files"], ttlSeconds: PUSH_TOKEN_TTL_SECONDS });
    const res = await gateway.call(token.token, {
      connector: "github",
      tool: "commit_files",
      args: { owner: target.owner, repo: target.repo, branch, message: pushMessage(ctx, snapshot), files: contents.map((f) => ({ path: f.path, content: Buffer.from(f.content).toString("base64"), encoding: "base64" })), deletions },
    });
    if (res.outcome === "ask") {
      await record({ error: "waiting for the founder's approval" });
      return { status: "awaiting_approval", repo, branch, approvalId: res.approvalId ?? null };
    }
    if (res.outcome !== "allow") {
      const reason = res.outcome === "rate_limited" ? "GitHub's rate limit was reached" : `refused by policy${res.reasons?.length ? ` (${res.reasons.join("; ")})` : ""}`;
      await record({ error: reason });
      return { status: "failed", repo, branch, reason };
    }
    const result = res.result as { ok?: boolean; data?: CommitFilesData; error?: { message?: string } } | undefined;
    if (!result?.ok || !result.data) {
      const reason = result?.error?.message ?? "GitHub gave no result";
      await record({ error: reason });
      return { status: "failed", repo, branch, reason };
    }
    await record({ commitSha: result.data.sha, url: result.data.url });
    if (!result.data.committed) return { status: "up_to_date", repo, branch, commitSha: result.data.sha };
    return { status: "pushed", repo, branch, commitSha: result.data.sha, url: result.data.url, filesWritten: result.data.filesWritten, filesDeleted: result.data.filesDeleted };
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
      return { level: "info", text: `Pushed to ${push.branch} on ${push.repo}: ${push.filesWritten} file${push.filesWritten === 1 ? "" : "s"} written, ${push.filesDeleted} removed (commit ${push.commitSha.slice(0, 7)}).` };
    case "up_to_date":
      return null;
    case "skipped":
      return { level: "info", text: `Not pushed to GitHub: ${push.reason}. The code is saved on Development › Code.` };
    case "awaiting_approval":
      return { level: "info", text: `Pushing to ${push.branch} on ${push.repo} is waiting for your approval.` };
    case "failed":
      return { level: "warn", text: `Not pushed to ${push.branch} on ${push.repo}: ${push.reason}. The code is saved here, and the next session on the task pushes it again.` };
  }
}
