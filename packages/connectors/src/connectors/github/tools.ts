/**
 * GitHub App connector: repositories the installation can reach, tree/file reads (quarantined — repo
 * content is third-party text), branches, commits to working branches, pull requests. Merging is
 * `irreversible` (never spends money); deleting a repository or force-pushing over history would be permanent
 * deletion and is not offered. `commit_files` only fast-forwards an `agent/` branch of a private repository and never
 * writes `.git` or `.github` (so it cannot add or edit workflow files), a commit can always be reverted, and the
 * default branch changes only through `merge_pr`. Code it writes can still run in CI that the repository's own
 * workflows start (scripts, local actions elsewhere, `on: create`): pushing is the founder's opt-in for that reason.
 *
 * `run_checks` starts the repository's own `.github/workflows/ci.yml` on an agent's branch (the file must already be on
 * the branch and listen for `workflow_dispatch`; agents cannot write it) and `get_checks` reads the check runs of the
 * branch head back. Like `commit_files`, `run_checks` only touches `agent/` branches of private repositories, and only
 * when the branch's `.github` tree is identical to the default branch's (GitHub runs the workflow file of the ref it is
 * dispatched on, with the repository's secrets). It spends the repository owner's CI minutes, so it is a write even
 * though it changes no repository content. `get_checks` is pending until the CI workflow has run on the head.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { defineTool } from "../../define";

export const GITHUB_KEY = "github";
export const GITHUB_API_URL = "https://api.github.com";
// actions:write starts a workflow run (run_checks); checks:read lists check runs (get_checks).
export const GITHUB_APP_SCOPES = ["contents:write", "pull_requests:write", "metadata:read", "members:read", "actions:write", "checks:read"];

const Owner = z.string().min(1).max(100).regex(/^[A-Za-z0-9-]+$/, "GitHub owner");
const RepoName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/, "GitHub repository name")
  .refine((n) => n !== "." && n !== "..", "GitHub repository name");
const Ref = z.string().min(1).max(250);
const BranchName = z.string().min(1).max(250).regex(/^(?!\/)(?!.*\.\.)(?!.*\/\/)[^\s~^:?*[\\]+(?<!\/)(?<!\.lock)$/, "git branch name");
const Path = z.string().max(1000).regex(/^(?!\/)(?!.*\.\.(\/|$))/, "relative path");

export const Repository = z.object({
  id: z.number().int(),
  fullName: z.string(),
  owner: z.string(),
  name: z.string(),
  private: z.boolean(),
  defaultBranch: z.string(),
  description: z.string().nullable(),
  url: z.url(),
  pushedAt: z.string().nullable(),
  language: z.string().nullable(),
});
export type RepositoryT = z.infer<typeof Repository>;

export const TreeEntry = z.object({ path: z.string(), type: z.enum(["blob", "tree", "commit"]), sha: z.string(), size: z.number().int().nullable() });

export const PullRequest = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean(),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
  head: z.object({ ref: z.string(), sha: z.string() }),
  base: z.object({ ref: z.string(), sha: z.string() }),
  url: z.url(),
  author: z.string().nullable(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  createdAt: z.string(),
  mergedAt: z.string().nullable(),
  mergeCommitSha: z.string().nullable(),
});
export type PullRequestT = z.infer<typeof PullRequest>;

const RepoRef = z.object({ owner: Owner, repo: RepoName });

/**
 * Files and bytes one `commit_files` call may carry: enough for a session's source changes, small enough that the
 * gateway holds a few at once and GitHub's limits on creating content are not reached.
 */
export const MAX_COMMIT_FILES = 300;
export const MAX_COMMIT_BYTES = 10 * 1024 * 1024;
export const MAX_COMMIT_FILE_BYTES = 5 * 1024 * 1024;

/** The only branches `commit_files` writes: an agent's working branch (`agent/<task id>`), never a deploy branch. */
export const AGENT_BRANCH = /^agent\/(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?<!\.lock)(?<!\.)$/;

/**
 * A path `commit_files` writes or deletes: relative, no empty, "." or ".." segment, nothing inside `.git`, and nothing
 * under `.github` (workflows and local actions run with the repository's secrets on every push).
 */
export const isCommitPath = (path: string): boolean => {
  if (path.length === 0 || path.length > 1000 || path.startsWith("/") || path.includes("\0")) return false;
  const segments = path.split("/");
  return segments[0]!.toLowerCase() !== ".github" && segments.every((seg) => seg.length > 0 && seg !== "." && seg !== ".." && seg.toLowerCase() !== ".git");
};
const CommitPath = z.string().refine(isCommitPath, "relative path outside .git and .github");
/** Well-formed base64 in linear time (a grouped pattern backtracks past V8's stack on multi-megabyte files). */
const isBase64 = (s: string): boolean => s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);
export const FileWrite = z
  .object({ path: CommitPath, content: z.string().max(Math.ceil((MAX_COMMIT_FILE_BYTES * 4) / 3) + 4), encoding: z.enum(["utf-8", "base64"]).default("utf-8") })
  .refine((f) => f.encoding !== "base64" || isBase64(f.content), { message: "content is not base64", path: ["content"] });
export type FileWriteT = z.infer<typeof FileWrite>;

/** Decoded size of one file write, without decoding it (base64 is checked well-formed above). */
export const fileWriteBytes = (f: Pick<FileWriteT, "content" | "encoding">): number => (f.encoding === "base64" ? (f.content.length / 4) * 3 - (f.content.endsWith("==") ? 2 : f.content.endsWith("=") ? 1 : 0) : Buffer.byteLength(f.content, "utf8"));
export const fileWriteBuffer = (f: Pick<FileWriteT, "content" | "encoding">): Buffer => (f.encoding === "base64" ? Buffer.from(f.content, "base64") : Buffer.from(f.content, "utf8"));

/** The sha git gives a blob (`git hash-object`), so unchanged files are never uploaded again. */
export const gitBlobSha = (content: Uint8Array): string => createHash("sha1").update(`blob ${content.byteLength}\0`).update(content).digest("hex");

export const CommitFilesInput = RepoRef.extend({
  branch: z.string().regex(AGENT_BRANCH, "an agent/ working branch"),
  /** Where a missing branch starts (default: the default branch). Ignored when the branch exists. */
  fromRef: Ref.optional(),
  message: z.string().min(1).max(5_000),
  files: z.array(FileWrite).max(MAX_COMMIT_FILES).default([]),
  deletions: z.array(CommitPath).max(MAX_COMMIT_FILES).default([]),
  /**
   * The branch head the caller's changes are based on. When the branch exists and its head is any other commit, the call
   * writes nothing and fails with `branch_moved` (details: `BranchMovedDetails`, with the current head). Ignored when the
   * branch does not exist yet.
   */
  expectedHeadSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, "a full commit sha").optional(),
}).superRefine((input, ctx) => {
  const seen = new Set<string>();
  let total = 0;
  for (const f of input.files) {
    if (seen.has(f.path)) ctx.addIssue({ code: "custom", path: ["files"], message: `${f.path} is listed twice` });
    seen.add(f.path);
    const bytes = fileWriteBytes(f);
    if (bytes > MAX_COMMIT_FILE_BYTES) ctx.addIssue({ code: "custom", path: ["files"], message: `${f.path} is larger than 5 MB` });
    total += bytes;
  }
  if (total > MAX_COMMIT_BYTES) ctx.addIssue({ code: "custom", path: ["files"], message: "the commit is larger than 10 MB" });
  for (const d of input.deletions) if (seen.has(d)) ctx.addIssue({ code: "custom", path: ["deletions"], message: `${d} is both written and deleted` });
});

export const CommitFilesOutput = z.object({
  branch: z.string(),
  /** The branch did not exist and was created from `fromRef`. */
  created: z.boolean(),
  /** False when every file already matched the branch and nothing was deleted (no empty commits). */
  committed: z.boolean(),
  /** The branch head after the call. */
  sha: z.string(),
  parentSha: z.string(),
  filesWritten: z.number().int().nonnegative(),
  filesDeleted: z.number().int().nonnegative(),
  url: z.url().nullable(),
});
export type CommitFilesOutputT = z.infer<typeof CommitFilesOutput>;

/** The only workflow `run_checks` dispatches: the repository's own CI, which agents cannot edit (nothing under .github). */
export const CI_WORKFLOW = "ci.yml";
const AgentBranch = z.string().regex(AGENT_BRANCH, "an agent/ working branch");

export const RunChecksInput = RepoRef.extend({ branch: AgentBranch });
export const RunChecksOutput = z.object({ dispatched: z.literal(true), branch: z.string(), workflow: z.literal(CI_WORKFLOW) });

/** One check run as GitHub reports it (`status`: queued, in_progress, completed...; `conclusion`: null until completed). */
export const CheckRun = z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable(), url: z.string().nullable() });
export type CheckRunT = z.infer<typeof CheckRun>;
export const ChecksState = z.enum(["pending", "success", "failure"]);
export type ChecksStateT = z.infer<typeof ChecksState>;

export const GetChecksInput = RepoRef.extend({ branch: AgentBranch });
export const GetChecksOutput = z.object({ headSha: z.string(), state: ChecksState, checks: z.array(CheckRun) });

const PASSED_CONCLUSIONS: ReadonlySet<string> = new Set(["success", "neutral", "skipped"]);

/**
 * One verdict for a branch head's check runs. Pending while anything has not completed (queued, in_progress, waiting...)
 * and when there are no check runs yet; failure when a completed run concluded failure, timed_out, cancelled or
 * action_required (or with a conclusion this code does not know, such as "stale": never read as a pass); success only when
 * every run concluded success, neutral or skipped. `complete` is false when the list was cut short, which can never be
 * success.
 */
export const checksState = (checks: readonly Pick<CheckRunT, "status" | "conclusion">[], complete = true): ChecksStateT => {
  if (checks.length === 0 || checks.some((c) => c.status !== "completed")) return "pending";
  if (checks.some((c) => c.conclusion === null || !PASSED_CONCLUSIONS.has(c.conclusion))) return "failure";
  return complete ? "success" : "pending";
};

/** A workflow run (`GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs`): `conclusion` is null until it completes. */
export interface GhWorkflowRun { status?: string | null; conclusion?: string | null }

/**
 * The verdict for a branch head once the CI workflow's own run is taken into account. Check runs alone can look green
 * before CI has run on the head (other workflows or apps report checks too), so: no run yet or one that has not
 * completed is pending; a completed run whose conclusion is not "success" is a failure; only a successful run defers to
 * the check runs (`checksState`).
 */
export const ciState = (run: GhWorkflowRun | null | undefined, checks: readonly Pick<CheckRunT, "status" | "conclusion">[], complete = true): ChecksStateT => {
  if (!run || run.status !== "completed") return "pending";
  if (run.conclusion !== "success") return "failure";
  return checksState(checks, complete);
};

/**
 * `download_archive`: a repository at one ref as GitHub's gzip-compressed tarball, for the platform's own checkout (a
 * code session starts from it). At most 60 MB compressed; private repositories only, like every write.
 */
export const DOWNLOAD_ARCHIVE_TOOL = "download_archive";
export const MAX_ARCHIVE_BYTES = 60 * 1024 * 1024;
export const DownloadArchiveInput = RepoRef.extend({ ref: Ref.default("HEAD") });
export const DownloadArchiveOutput = z.object({
  /** The ref the archive is of: the branch, tag or commit asked for (the default branch's name for HEAD). */
  ref: z.string(),
  /** The commit the ref resolved to; the archive is of exactly this commit. */
  sha: z.string().min(7).max(64),
  bytes: z.number().int().nonnegative().max(MAX_ARCHIVE_BYTES),
  /**
   * The gzip-compressed tarball's bytes, as they came from GitHub: never base64 inside the gateway (60 MB would be 80 MB of
   * text, then that again as JSON). The gateway's archive route sends them as the response body; `/v1/call` encodes them
   * as base64 for the few service callers that use it.
   */
  archive: z.instanceof(Uint8Array),
  /**
   * Deprecated: the same bytes as base64, set by the mock only (its archives are a few hundred bytes) until every reader
   * takes `archive`. The live connector never sets it.
   */
  base64: z.string().optional(),
});
export type DownloadArchiveOutputT = z.infer<typeof DownloadArchiveOutput>;
export const archiveTooLargeMessage = (fullName: string) => `${fullName} is larger than ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MB compressed; it cannot be checked out`;

/**
 * `get_repository`: one repository's identity as the installation sees it (its numeric id, whether it is private, its
 * default branch). The gateway reads it to pin and check the Code-tab repository (first-party reads, choosing the
 * repository on Development › Code); it is never in an agent's tools.
 */
export const GET_REPOSITORY_TOOL = "get_repository";

/**
 * GitHub tools only the platform calls, from the gateway's own routes or its own checks: never granted to an agent
 * session, never listed or callable through `/mcp/github`, and refused on `/v1/call` for an agent session.
 */
export const GITHUB_ROUTE_ONLY_TOOLS: readonly string[] = [DOWNLOAD_ARCHIVE_TOOL, GET_REPOSITORY_TOOL];

/** The error code `commit_files` answers when the branch head is not the `expectedHeadSha` it was given. */
export const BRANCH_MOVED = "branch_moved";
/** What `commit_files` refuses with when the branch moved since the caller read it (`details` of the tool error). */
export interface BranchMovedDetails {
  branch: string;
  expectedHeadSha: string;
  currentHeadSha: string;
}
export const branchMovedMessage = (branch: string, expected: string, current: string) => `${branch} moved: its head is ${current.slice(0, 12)}, not ${expected.slice(0, 12)} as expected; nothing was written`;

/** Why `run_checks` refuses a branch whose `.github` tree is not the default branch's. */
export const githubChangedMessage = (branch: string): string => `run_checks refuses to run a workflow that differs from the default branch (.github changed on ${branch}); rebase the branch onto the default branch`;

/**
 * `compare_refs`: what `head` changed since it left `base` (GitHub's three-dot compare, `GET /repos/{o}/{r}/compare/
 * {base}...{head}`): the merge base, the counts, and the changed files. GitHub lists at most 300 files per page; the
 * tool reads up to COMPARE_FILE_PAGES pages and says `truncated` past that. The platform's checkout uses it to scope
 * a task branch's acceptance tests to the branch's own changes (never to what the default branch did since).
 */
export const COMPARE_REFS_TOOL = "compare_refs";
export const COMPARE_FILES_PER_PAGE = 300;
export const COMPARE_FILE_PAGES = 4;
export const CompareFileStatus = z.enum(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]);
export const CompareFile = z.object({ path: z.string(), status: CompareFileStatus, previousPath: z.string().nullable() });
export const CompareRefsInput = RepoRef.extend({ base: Ref.default("HEAD"), head: Ref });
export const CompareRefsOutput = z.object({
  /** The commit `head` and `base` last shared: the branch's own changes are what differs from it. */
  mergeBaseSha: z.string(),
  baseSha: z.string(),
  headSha: z.string(),
  aheadBy: z.number().int().nonnegative(),
  behindBy: z.number().int().nonnegative(),
  files: z.array(CompareFile),
  /** More files changed than the pages read list. */
  truncated: z.boolean(),
});
export type CompareRefsOutputT = z.infer<typeof CompareRefsOutput>;

/** A file of GitHub's compare answer (`files[]`). */
export interface GhCompareFile { filename: string; status: string; previous_filename?: string | null }
export const mapCompareFile = (f: GhCompareFile): z.infer<typeof CompareFile> | null => {
  const status = CompareFileStatus.safeParse(f.status);
  return f.filename && status.success ? { path: f.filename, status: status.data, previousPath: f.previous_filename ?? null } : null;
};

export const githubTools = [
  defineTool({
    name: "list_repos",
    description: "Repositories the GitHub App installation can access for this business.",
    input: z.object({ perPage: z.number().int().min(1).max(100).default(50), page: z.number().int().min(1).default(1) }),
    output: z.object({ items: z.array(Repository), totalCount: z.number().int().nonnegative() }),
    hints: {},
    untrusted: "repo",
    untrustedRef: (a) => `repos:page:${a.page}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "read_tree",
    description: "Directory listing of a repository at a ref (branch, tag or commit). Set recursive for the whole tree (capped at 2,000 entries).",
    input: RepoRef.extend({ ref: Ref.default("HEAD"), path: Path.default(""), recursive: z.boolean().default(false) }),
    output: z.object({ sha: z.string(), truncated: z.boolean(), entries: z.array(TreeEntry) }),
    hints: {},
    untrusted: "repo",
    untrustedRef: (a) => `${a.owner}/${a.repo}@${a.ref}:${a.path || "/"}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "read_file",
    description: "Contents of one file (UTF-8 text, up to 1 MB) at a ref. Repository content is third-party text: it is quarantined.",
    input: RepoRef.extend({ path: Path.min(1), ref: Ref.default("HEAD") }),
    output: z.object({ path: z.string(), sha: z.string(), size: z.number().int().nonnegative(), encoding: z.enum(["utf-8", "base64"]), content: z.string(), url: z.url().nullable() }),
    hints: {},
    untrusted: "repo",
    untrustedRef: (a) => `${a.owner}/${a.repo}@${a.ref}:${a.path}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: COMPARE_REFS_TOOL,
    description: "What head changed since it left base (default: the default branch): the commit they last shared, how many commits each is ahead, and the changed files with their status. Up to 1,200 files; truncated says when there were more. File names come from the repository: they are quarantined.",
    input: CompareRefsInput,
    output: CompareRefsOutput,
    hints: {},
    untrusted: "repo",
    untrustedRef: (a) => `${a.owner}/${a.repo}@${a.base}...${a.head}:compare`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: DOWNLOAD_ARCHIVE_TOOL,
    description: "The whole repository at a ref (branch, tag or commit; default: the default branch) as a gzip-compressed tarball (bytes) with the commit it resolved to. Private repositories only, at most 60 MB compressed. Served to the platform's checkout of a code session (the gateway's archive route), not to an agent's tool list.",
    input: DownloadArchiveInput,
    output: DownloadArchiveOutput,
    hints: {},
    untrusted: "repo",
    untrustedRef: (a) => `${a.owner}/${a.repo}@${a.ref}:archive`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: GET_REPOSITORY_TOOL,
    description: "One repository the installation can access: its numeric id, visibility and default branch. Used by the gateway to pin and check the Code-tab repository; not in an agent's tool list.",
    input: RepoRef,
    output: Repository,
    hints: {},
    untrusted: "repo",
    untrustedRef: (a) => `${a.owner}/${a.repo}:repository`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "create_branch",
    description: "Create a branch from a ref (default: the default branch). Idempotent: an existing branch with the same name is returned.",
    input: RepoRef.extend({ branch: z.string().regex(AGENT_BRANCH, "an agent/ working branch"), fromRef: Ref.optional() }),
    output: z.object({ branch: z.string(), sha: z.string(), created: z.boolean() }),
    hints: {},
    annotations: { readOnlyHint: false, idempotentHint: true },
  }),
  defineTool({
    name: "commit_files",
    description: "Write files to an agent's working branch (agent/<name>) of a private repository as one commit: the branch is created from fromRef (default: the default branch) when missing, the files are added or replaced on top of it and the deletions removed. At most 300 files and 10 MB; nothing under .git or .github. Only changed files are uploaded; nothing changed means no commit. With expectedHeadSha, an existing branch whose head is another commit is refused (branch_moved, with the current head) and nothing is written. Never writes the default branch (merge a pull request with merge_pr) and never force-pushes.",
    input: CommitFilesInput,
    output: CommitFilesOutput,
    hints: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }),
  defineTool({
    name: "run_checks",
    description: "Start the repository's CI (the .github/workflows/ci.yml workflow, which must listen for workflow_dispatch) on an agent's working branch (agent/<name>) of a private repository. Refused when .github on the branch differs from the default branch's. Uses the repository owner's CI minutes; each call starts a new run. Read the outcome with get_checks. Never runs the default branch.",
    input: RunChecksInput,
    output: RunChecksOutput,
    hints: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }),
  defineTool({
    name: "get_checks",
    description: "The check runs of an agent's working branch head (agent/<name>) and one verdict: pending (the CI workflow has not run on this head yet or is still running, or a check is queued or running, or none exists yet), failure (the CI workflow did not succeed, or a check failed, timed out, was canceled or needs action) or success (the CI workflow succeeded and every check succeeded, was neutral or was skipped). Check names and links come from the repository: they are quarantined.",
    input: GetChecksInput,
    output: GetChecksOutput,
    hints: {},
    untrusted: "repo",
    untrustedRef: (a) => `${a.owner}/${a.repo}@${a.branch}:checks`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "open_pr",
    description: "Open a pull request from head to base (HEAD, the default, is the repository's default branch). Draft by default so humans see it before review requests go out.",
    input: RepoRef.extend({ title: z.string().min(1).max(256), body: z.string().max(60_000).default(""), head: BranchName, base: BranchName.default("HEAD"), draft: z.boolean().default(true) }),
    output: PullRequest,
    hints: {},
    annotations: { readOnlyHint: false },
  }),
  defineTool({
    name: "get_pull_request",
    description: "One pull request with its merge state and diff stats.",
    input: RepoRef.extend({ prNumber: z.number().int().positive() }),
    output: PullRequest,
    hints: {},
    untrusted: "repo",
    untrustedRef: (a) => `${a.owner}/${a.repo}#${a.prNumber}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "list_pull_requests",
    description: "Pull requests of a repository, newest first.",
    input: RepoRef.extend({ state: z.enum(["open", "closed", "all"]).default("open"), perPage: z.number().int().min(1).max(100).default(30) }),
    output: z.object({ items: z.array(PullRequest) }),
    hints: {},
    untrusted: "repo",
    untrustedRef: (a) => `${a.owner}/${a.repo}:prs:${a.state}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "merge_pr",
    description: "Merge a pull request into its base branch. Irreversible (history on the base branch changes); merges to the default branch are a decision in Augmented mode (BUILD §9.6). A draft is marked ready for review first. Spends no money.",
    input: RepoRef.extend({ prNumber: z.number().int().positive(), mergeMethod: z.enum(["merge", "squash", "rebase"]).default("squash"), commitTitle: z.string().max(256).optional(), commitMessage: z.string().max(10_000).optional() }),
    output: z.object({ merged: z.literal(true), sha: z.string(), prNumber: z.number().int(), message: z.string() }),
    hints: { irreversible: true, spendsMoney: false },
  }),
] as const;

export const GITHUB_RATE_LIMITS = { perMinute: 80, perDay: 5_000 };

/* ---- Vendor shapes (subset of the REST API v2022-11-28) ---- */
export interface GhRepository { id: number; full_name: string; name: string; private: boolean; default_branch: string; description: string | null; html_url: string; pushed_at?: string | null; language?: string | null; owner: { login: string } }
export interface GhTreeEntry { path?: string; type?: string; sha?: string; size?: number }
export interface GhPullRequest {
  number: number; title: string; body: string | null; state: string; draft?: boolean; merged?: boolean | null; mergeable?: boolean | null; merged_at?: string | null; created_at: string; html_url: string;
  head: { ref: string; sha: string }; base: { ref: string; sha: string }; user?: { login: string } | null; additions?: number; deletions?: number; changed_files?: number; merge_commit_sha?: string | null;
}

/** A check run (`GET /repos/{owner}/{repo}/commits/{ref}/check-runs`): `html_url` and `details_url` are each null when unset. */
export interface GhCheckRun { name: string; status: string; conclusion?: string | null; html_url?: string | null; details_url?: string | null }

export const mapCheckRun = (c: GhCheckRun): CheckRunT => ({ name: c.name, status: c.status, conclusion: c.conclusion ?? null, url: c.html_url ?? c.details_url ?? null });

export const mapRepository =(r: GhRepository): RepositoryT => ({ id: r.id, fullName: r.full_name, owner: r.owner.login, name: r.name, private: r.private, defaultBranch: r.default_branch, description: r.description ?? null, url: r.html_url, pushedAt: r.pushed_at ?? null, language: r.language ?? null });

export const mapPullRequest = (p: GhPullRequest): PullRequestT => ({
  number: p.number, title: p.title, body: p.body ?? null, state: p.state === "closed" ? "closed" : "open", draft: p.draft ?? false, merged: Boolean(p.merged ?? p.merged_at), mergeable: p.mergeable ?? null,
  head: { ref: p.head.ref, sha: p.head.sha }, base: { ref: p.base.ref, sha: p.base.sha }, url: p.html_url, author: p.user?.login ?? null, additions: p.additions ?? 0, deletions: p.deletions ?? 0, changedFiles: p.changed_files ?? 0,
  createdAt: p.created_at, mergedAt: p.merged_at ?? null, mergeCommitSha: p.merge_commit_sha ?? null,
});

export const mapTreeEntry = (e: GhTreeEntry): z.infer<typeof TreeEntry> | null => {
  if (!e.path || !e.sha || (e.type !== "blob" && e.type !== "tree" && e.type !== "commit")) return null;
  return { path: e.path, type: e.type, sha: e.sha, size: typeof e.size === "number" ? e.size : null };
};

export const MAX_TREE_ENTRIES = 2_000;
export const MAX_FILE_BYTES = 1_000_000;
