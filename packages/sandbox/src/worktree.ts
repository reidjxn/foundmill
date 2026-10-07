/**
 * Git helpers that run *inside* a sandbox through `Sandbox.exec` (BUILD §9.3, §11.6: "agent works in sandbox +
 * worktree `agent/<taskId>`"). Nothing here touches the host's git; every command is composed with the shell
 * quoting helpers and executed by the runner, so the same code serves E2B, Docker and the mock.
 *
 * Credentials: a clone or push authenticates with a **short-lived** token (GitHub App installation token,
 * one hour) passed through `GIT_CONFIG_*` environment variables, never on the command line and never in the
 * remote URL (which would persist it in `.git/config`). `gitAuthEnv` output still goes through
 * `assertNoLongLivedCredentials` on the way into the sandbox (AC-11.6.6).
 */
import { ValidationError } from "@foundmill/shared";
import { SandboxError } from "./errors";
import { shellJoin, shellQuote } from "./shell";
import type { ExecOptions, ExecResult, Sandbox, SandboxRepo } from "./types";

export const AGENT_BRANCH_PREFIX = "agent/";

/**
 * Task ids become the branch suffix, so they must be valid git ref components (`git check-ref-format`):
 * no spaces, control characters, `..`, `@{`, leading `.` or `-`, trailing `.lock`, and none of `~^:?*[\`.
 */
export function isValidBranchComponent(component: string): boolean {
  if (component.length === 0 || component.length > 120) return false;
  if (!/^[A-Za-z0-9._-]+$/.test(component)) return false;
  if (component.startsWith(".") || component.startsWith("-")) return false;
  if (component.endsWith(".lock") || component.endsWith(".")) return false;
  if (component.includes("..")) return false;
  return true;
}

/** `agent/<taskId>`; throws when the task id cannot be a branch name. */
export function agentBranch(taskId: string): string {
  if (!isValidBranchComponent(taskId)) {
    throw new ValidationError(`Task id ${JSON.stringify(taskId)} cannot be used as a git branch component`);
  }
  return `${AGENT_BRANCH_PREFIX}${taskId}`;
}

/** The task id behind an `agent/<taskId>` branch, or null for any other branch. */
export function taskIdFromBranch(branch: string): string | null {
  if (!branch.startsWith(AGENT_BRANCH_PREFIX)) return null;
  const id = branch.slice(AGENT_BRANCH_PREFIX.length);
  return isValidBranchComponent(id) ? id : null;
}

export interface GitAuthOptions {
  /** Short-lived token (GitHub App installation token `ghs_…`, or a gateway-minted scoped token). */
  token: string;
  /** Username paired with the token; GitHub App tokens use `x-access-token`. */
  username?: string;
  /** Limit the header to one origin (`https://github.com/`). Default: every https remote. */
  origin?: string;
}

/**
 * Environment that makes git authenticate with a token through `http.extraheader` (git ≥ 2.31
 * `GIT_CONFIG_COUNT`), so the token never appears in argv, in `.git/config` or in the remote URL.
 * `GIT_TERMINAL_PROMPT=0` makes a missing credential fail fast instead of hanging the session.
 */
export function gitAuthEnv(opts: GitAuthOptions): Record<string, string> {
  if (!opts.token) throw new ValidationError("gitAuthEnv: token is required");
  const basic = Buffer.from(`${opts.username ?? "x-access-token"}:${opts.token}`, "utf8").toString("base64");
  const key = opts.origin ? `http.${opts.origin.replace(/\/+$/, "")}/.extraheader` : "http.extraheader";
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: key,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export interface GitIdentity {
  name: string;
  email: string;
}

/** Commits inside a sandbox are authored by the agent, never by the founder (BUILD §2.2 "founder's identity"). */
export function gitIdentityEnv(identity: GitIdentity): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}

/** `git clone --branch <branch> --single-branch <url> <dir>` (shallow by default: agents rarely need history). */
export function cloneCommand(repo: SandboxRepo, dir: string, opts: { depth?: number | null } = {}): string {
  const depth = opts.depth === undefined ? 50 : opts.depth;
  const parts = ["git", "clone", "--branch", repo.branch, "--single-branch"];
  if (depth !== null) parts.push("--depth", String(depth));
  parts.push(repo.url, dir);
  return shellJoin(parts);
}

export interface CloneOptions extends Pick<ExecOptions, "onStdout" | "onStderr" | "timeoutMs" | "signal"> {
  /** Extra environment (typically `gitAuthEnv(...)`). */
  env?: Record<string, string>;
  depth?: number | null;
}

/** Clone `repo` into `dir` inside the sandbox. Throws `SandboxError` when git exits non-zero. */
export async function cloneRepo(sandbox: Sandbox, repo: SandboxRepo, dir: string, opts: CloneOptions = {}): Promise<ExecResult> {
  const { env, depth, ...exec } = opts;
  const result = await sandbox.exec(cloneCommand(repo, dir, { depth }), { ...exec, ...(env ? { env } : {}), cwd: "/" });
  if (result.code !== 0) {
    throw new SandboxError(`git clone of ${repo.url}#${repo.branch} failed with exit code ${result.code}`, {
      code: result.code,
      stderr: redactTokens(result.stderr).slice(-2000),
      timedOut: result.timedOut,
    });
  }
  return result;
}

export interface CreateWorktreeOptions {
  taskId: string;
  /** Path of the main checkout inside the sandbox. */
  repoDir: string;
  /** Where the worktree goes. Default `<repoDir>-agent-<taskId>` next to the checkout. */
  path?: string;
  /** Commit-ish the branch starts from. Default `HEAD`. */
  baseRef?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface WorktreeInfo {
  branch: string;
  path: string;
  headSha: string;
}

/**
 * `git worktree add -B agent/<taskId> <path> <baseRef>`: creates (or resets) the agent branch and checks it
 * out in its own directory so several tasks can work the same clone concurrently (AC-11.6.2 scheduling
 * keeps overlapping file scopes apart; the worktrees keep their checkouts apart).
 */
export async function createAgentWorktree(sandbox: Sandbox, opts: CreateWorktreeOptions): Promise<WorktreeInfo> {
  const branch = agentBranch(opts.taskId);
  const path = opts.path ?? `${opts.repoDir.replace(/\/+$/, "")}-agent-${opts.taskId}`;
  const baseRef = opts.baseRef ?? "HEAD";
  const exec: ExecOptions = { cwd: opts.repoDir, ...(opts.env ? { env: opts.env } : {}), ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) };
  const add = await sandbox.exec(shellJoin(["git", "worktree", "add", "-B", branch, path, baseRef]), exec);
  if (add.code !== 0) {
    throw new SandboxError(`git worktree add for ${branch} failed with exit code ${add.code}`, { code: add.code, stderr: redactTokens(add.stderr).slice(-2000) });
  }
  const head = await sandbox.exec(shellJoin(["git", "rev-parse", "HEAD"]), { ...exec, cwd: path });
  if (head.code !== 0) {
    throw new SandboxError(`git rev-parse in the new worktree failed with exit code ${head.code}`, { code: head.code, stderr: redactTokens(head.stderr).slice(-2000) });
  }
  return { branch, path, headSha: head.stdout.trim() };
}

export interface RemoveWorktreeOptions {
  repoDir: string;
  path: string;
  /** Also delete the `agent/<taskId>` branch (the "Stop and discard" control). */
  deleteBranch?: string;
  force?: boolean;
  timeoutMs?: number;
}

export async function removeAgentWorktree(sandbox: Sandbox, opts: RemoveWorktreeOptions): Promise<void> {
  const exec: ExecOptions = { cwd: opts.repoDir, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) };
  const parts = ["git", "worktree", "remove"];
  if (opts.force) parts.push("--force");
  parts.push(opts.path);
  const removed = await sandbox.exec(shellJoin(parts), exec);
  if (removed.code !== 0) {
    throw new SandboxError(`git worktree remove failed with exit code ${removed.code}`, { code: removed.code, stderr: redactTokens(removed.stderr).slice(-2000) });
  }
  if (opts.deleteBranch) {
    const branch = opts.deleteBranch.startsWith(AGENT_BRANCH_PREFIX) ? opts.deleteBranch : agentBranch(opts.deleteBranch);
    await sandbox.exec(shellJoin(["git", "branch", "-D", branch]), exec);
  }
}

export interface WorktreeStatus {
  branch: string;
  /** Upstream branch when one is configured. */
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  /** Paths from `git status --porcelain` (staged or not). */
  changedFiles: string[];
}

/** Parse `git status --porcelain=v1 --branch` output. Exported for tests. */
export function parsePorcelainStatus(output: string): WorktreeStatus {
  const lines = output.split("\n").filter((l) => l.length > 0);
  const header = lines[0]?.startsWith("## ") ? lines[0].slice(3) : "";
  const files = lines.slice(header ? 1 : 0).map((l) => {
    const rest = l.slice(3);
    const arrow = rest.indexOf(" -> ");
    return arrow === -1 ? rest : rest.slice(arrow + 4);
  });
  let branch = header;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const bracket = header.indexOf(" [");
  if (bracket !== -1) {
    branch = header.slice(0, bracket);
    const info = header.slice(bracket + 2, header.lastIndexOf("]"));
    const a = /ahead (\d+)/.exec(info);
    const b = /behind (\d+)/.exec(info);
    ahead = a ? Number(a[1]) : 0;
    behind = b ? Number(b[1]) : 0;
  }
  const dots = branch.indexOf("...");
  if (dots !== -1) {
    upstream = branch.slice(dots + 3);
    branch = branch.slice(0, dots);
  }
  if (branch.startsWith("No commits yet on ")) branch = branch.slice("No commits yet on ".length);
  return { branch, upstream, ahead, behind, dirty: files.length > 0, changedFiles: files };
}

export async function worktreeStatus(sandbox: Sandbox, path: string, opts: { timeoutMs?: number } = {}): Promise<WorktreeStatus> {
  const res = await sandbox.exec("git status --porcelain=v1 --branch", { cwd: path, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
  if (res.code !== 0) {
    throw new SandboxError(`git status failed with exit code ${res.code}`, { code: res.code, stderr: redactTokens(res.stderr).slice(-2000) });
  }
  return parsePorcelainStatus(res.stdout);
}

/** The pieces the orchestrator chains for a coding session: clone, then the agent worktree. */
export interface PrepareWorkspaceOptions extends CloneOptions {
  taskId: string;
  /** Where the main checkout lives. Default `<sandbox.workdir>`. */
  repoDir?: string;
  baseRef?: string;
}

export interface PreparedWorkspace extends WorktreeInfo {
  repoDir: string;
}

export async function prepareAgentWorkspace(sandbox: Sandbox, repo: SandboxRepo, opts: PrepareWorkspaceOptions): Promise<PreparedWorkspace> {
  const repoDir = opts.repoDir ?? sandbox.workdir;
  const { taskId, baseRef, ...clone } = opts;
  await cloneRepo(sandbox, repo, repoDir, clone);
  const worktree = await createAgentWorktree(sandbox, {
    taskId,
    repoDir,
    ...(baseRef ? { baseRef } : {}),
    ...(clone.env ? { env: clone.env } : {}),
    ...(clone.timeoutMs ? { timeoutMs: clone.timeoutMs } : {}),
  });
  return { repoDir, ...worktree };
}

/** Strip anything that looks like a token or a basic-auth header from git output before it reaches logs or events. */
export function redactTokens(text: string): string {
  return text
    .replace(/Authorization: Basic [A-Za-z0-9+/=]+/g, "Authorization: Basic [redacted]")
    .replace(/\b(gh[pousr]|github_pat|glpat)[_-][A-Za-z0-9_-]{8,}/g, "[redacted-token]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s@]+@/g, "$1[redacted]@");
}

/** Exported for callers that compose their own git lines. */
export const git = { quote: shellQuote, join: shellJoin };
