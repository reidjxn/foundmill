/**
 * GitHub App connector: repositories the installation can reach, tree/file reads (quarantined — repo
 * content is third-party text), branches, commits to working branches, pull requests. Merging is
 * `irreversible` (never spends money); deleting a repository or force-pushing over history would be permanent
 * deletion and is not offered. `commit_files` only fast-forwards a working branch and never writes the default
 * branch, so a commit can always be reverted and the default branch changes only through `merge_pr`.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { defineTool } from "../../define";

export const GITHUB_KEY = "github";
export const GITHUB_API_URL = "https://api.github.com";
export const GITHUB_APP_SCOPES = ["contents:write", "pull_requests:write", "metadata:read"];

const Owner = z.string().min(1).max(100).regex(/^[A-Za-z0-9-]+$/, "GitHub owner");
const RepoName = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/, "GitHub repository name");
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

/** Files and bytes one `commit_files` call may carry (the session workspace caps). */
export const MAX_COMMIT_FILES = 2_000;
export const MAX_COMMIT_BYTES = 50 * 1024 * 1024;
export const MAX_COMMIT_FILE_BYTES = 5 * 1024 * 1024;

/** A path git and GitHub accept: relative, no empty, "." or ".." segment, nothing inside `.git`. */
export const isCommitPath = (path: string): boolean => path.length > 0 && path.length <= 1000 && !path.startsWith("/") && !path.includes("\0") && path.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== ".." && seg.toLowerCase() !== ".git");
const CommitPath = z.string().refine(isCommitPath, "relative path outside .git");
export const FileWrite = z.object({ path: CommitPath, content: z.string().max(Math.ceil((MAX_COMMIT_FILE_BYTES * 4) / 3) + 4), encoding: z.enum(["utf-8", "base64"]).default("utf-8") });
export type FileWriteT = z.infer<typeof FileWrite>;

/** Decoded size of one file write. */
export const fileWriteBytes = (f: Pick<FileWriteT, "content" | "encoding">): number => (f.encoding === "base64" ? Buffer.from(f.content, "base64").byteLength : Buffer.byteLength(f.content, "utf8"));
export const fileWriteBuffer = (f: Pick<FileWriteT, "content" | "encoding">): Buffer => (f.encoding === "base64" ? Buffer.from(f.content, "base64") : Buffer.from(f.content, "utf8"));

/** The sha git gives a blob (`git hash-object`), so unchanged files are never uploaded again. */
export const gitBlobSha = (content: Uint8Array): string => createHash("sha1").update(`blob ${content.byteLength}\0`).update(content).digest("hex");

export const CommitFilesInput = RepoRef.extend({
  branch: BranchName,
  /** Where a missing branch starts (default: the default branch). Ignored when the branch exists. */
  fromRef: Ref.optional(),
  message: z.string().min(1).max(5_000),
  files: z.array(FileWrite).max(MAX_COMMIT_FILES).default([]),
  deletions: z.array(CommitPath).max(MAX_COMMIT_FILES).default([]),
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
  if (total > MAX_COMMIT_BYTES) ctx.addIssue({ code: "custom", path: ["files"], message: "the commit is larger than 50 MB" });
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
    name: "create_branch",
    description: "Create a branch from a ref (default: the default branch). Idempotent: an existing branch with the same name is returned.",
    input: RepoRef.extend({ branch: BranchName, fromRef: Ref.optional() }),
    output: z.object({ branch: z.string(), sha: z.string(), created: z.boolean() }),
    hints: {},
    annotations: { idempotentHint: true },
  }),
  defineTool({
    name: "commit_files",
    description: "Write files to a working branch as one commit: the branch is created from fromRef (default: the default branch) when missing, the files are added or replaced on top of it and the deletions removed. Only changed files are uploaded; nothing changed means no commit. Never writes the default branch (merge a pull request with merge_pr) and never force-pushes.",
    input: CommitFilesInput,
    output: CommitFilesOutput,
    hints: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }),
  defineTool({
    name: "open_pr",
    description: "Open a pull request from head to base. Draft by default so humans see it before review requests go out.",
    input: RepoRef.extend({ title: z.string().min(1).max(256), body: z.string().max(60_000).default(""), head: BranchName, base: BranchName, draft: z.boolean().default(true) }),
    output: PullRequest,
    hints: {},
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
    description: "Merge a pull request into its base branch. Irreversible (history on the base branch changes); merges to the default branch are a decision in Augmented mode (BUILD §9.6). Spends no money.",
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

export const mapRepository = (r: GhRepository): RepositoryT => ({ id: r.id, fullName: r.full_name, owner: r.owner.login, name: r.name, private: r.private, defaultBranch: r.default_branch, description: r.description ?? null, url: r.html_url, pushedAt: r.pushed_at ?? null, language: r.language ?? null });

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
