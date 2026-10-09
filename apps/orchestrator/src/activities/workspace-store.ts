/**
 * A code task's workspace outlives its session (0013 workspaces): when a code session ends, the files the agent wrote
 * are saved as a snapshot of the task (`repos.workspaces.save`, contents stored once per business); the next session
 * on the same task starts from the latest snapshot. Development › Code shows them.
 *
 * What is saved is what `readWorkspace` reads for the acceptance run (single-link regular files, no SDK HOME state,
 * no node_modules or .git, the same caps), minus what must not outlive a session:
 * - files named like secrets (`.env`, keys, package-manager and git credentials) are left out;
 * - credential-shaped values (`LONG_LIVED_VALUE_PATTERNS`) and the session's own model key and gateway token are masked
 *   in the files that are kept;
 * - the workspace is also the SDK's HOME and project root, so top-level files that configure the CLI, git, package
 *   managers or shells (`STARTUP_FILES`) are neither saved nor restored: nothing an agent wrote runs before the next
 *   session's CLI starts;
 * - names the store refuses (control or bidi characters, backslashes, over 500 characters) are left out and reported,
 *   rather than failing the whole save.
 *
 * Restored paths are checked again (relative, inside the workspace, never over SDK state or startup files) and written
 * with O_CREAT | O_EXCL | O_NOFOLLOW into the fresh directory, in batches of at most 8 MB. Everything restored came
 * from an earlier session that may have read untrusted content, so the recipients found in it are returned for the
 * gateway's untrusted register (BUILD §9.8 step 4): the new session cannot contact them without the founder.
 */
import { constants } from "node:fs";
import { mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { extractCandidateRecipients } from "@foundmill/connectors";
import { isSafeWorkspacePath, repos, type Db, type WorkspaceManifestEntry } from "@foundmill/db";
import { redactCredentialValues } from "@foundmill/sandbox";
import { DEFAULT_SYNC_LIMITS, isSdkHomeEntry, NEVER_SYNCED_DIRS, readWorkspace, type WorkspaceSyncLimits } from "./workspace-sync";

export interface WorkspaceOwner {
  businessId: string;
  taskId: string;
  sessionId: string;
  agentId: string;
  branch: string;
}

/** Recipients found in restored files, for the gateway's untrusted register; `all` when there are too many to list. */
export interface RecipientSeed {
  emails: string[];
  urls: string[];
  phones: string[];
  all: boolean;
}

export interface RestoredWorkspace {
  files: number;
  bytes: number;
  /** When the restored snapshot was saved; null when there was none. */
  savedAt: Date | null;
  recipients: RecipientSeed;
}

export type SavedWorkspace =
  | { status: "saved" | "unchanged"; files: number; bytes: number; added: number; changed: number; removed: number; leftOut: LeftOut[]; masked: string[] }
  | { status: "refused"; reason: string; leftOut: LeftOut[]; masked: string[] };

export interface LeftOut {
  path: string;
  reason: "secret" | "startup" | "name";
}

export interface SaveWorkspaceOptions {
  limits?: WorkspaceSyncLimits;
  /** Values that must never be stored (the session's model key and gateway token); masked wherever they appear. */
  secrets?: readonly string[];
  /** The session started without the saved files (its restore failed): keep the ones it did not write. */
  carryOver?: boolean;
}

/**
 * Top-level names the CLI, git, package managers or shells read from HOME or the project root at start-up (the
 * workspace is both). Compared case-insensitively.
 */
export const STARTUP_FILES: readonly string[] = [
  ".mcp.json",
  "claude.md",
  "claude.local.md",
  ".gitconfig",
  ".git-credentials",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  ".netrc",
  ".pypirc",
  ".ssh",
  ".gnupg",
  ".aws",
  ".docker",
  ".kube",
  ".bashrc",
  ".bash_profile",
  ".bash_login",
  ".bash_logout",
  ".profile",
  ".zshrc",
  ".zshenv",
  ".zprofile",
  ".zlogin",
  ".inputrc",
  ".ripgreprc",
];

/** File names that hold credentials wherever they are; `.env.example` and friends are templates and are kept. */
const SECRET_FILE = /^(\.env(\..+)?|.+\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|credentials)$/i;
const SECRET_TEMPLATE = /^\.env\.(example|sample|template|dist|defaults)$/i;
/** Restore reads and writes at most this many bytes of contents at a time. */
export const RESTORE_BATCH_BYTES = 8 * 1024 * 1024;
/** Matches the gateway's MAX_SEEDED_RECIPIENTS: past it the seed is `all`. */
export const MAX_SEEDED_RECIPIENTS = 5_000;
const SEED_VALUE_LIMITS = { emails: 320, urls: 2048, phones: 40 } as const;

export function isSecretFileName(rel: string): boolean {
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  return SECRET_FILE.test(name) && !SECRET_TEMPLATE.test(name);
}

const isStartupFile = (rel: string) => STARTUP_FILES.includes(rel.split("/")[0]!.toLowerCase());

/** Whether a stored path may be written into a session workspace. */
export function restorablePath(rel: string): boolean {
  if (!isSafeWorkspacePath(rel)) return false;
  const segments = rel.split("/");
  if (isSdkHomeEntry(segments[0]!) || isStartupFile(rel)) return false;
  return !segments.some((s) => NEVER_SYNCED_DIRS.includes(s));
}

/** Text files only: a NUL byte near the start means binary. */
function asText(content: Uint8Array): string | null {
  const head = content.subarray(0, 8192);
  if (head.includes(0)) return null;
  return new TextDecoder("utf-8").decode(content);
}

/** Group manifest entries into batches of at most `maxBytes` (a larger file is a batch of its own). */
function byteBatches(entries: readonly WorkspaceManifestEntry[], maxBytes: number): WorkspaceManifestEntry[][] {
  const batches: WorkspaceManifestEntry[][] = [];
  let current: WorkspaceManifestEntry[] = [];
  let bytes = 0;
  for (const e of entries) {
    if (current.length > 0 && bytes + e.size > maxBytes) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(e);
    bytes += e.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Write the task's latest saved files into a fresh session workspace and collect the recipients they mention. */
export async function restoreWorkspace(db: Db, businessId: string, taskId: string, cwd: string, limits: WorkspaceSyncLimits = DEFAULT_SYNC_LIMITS, batchBytes = RESTORE_BATCH_BYTES): Promise<RestoredWorkspace> {
  const found = { emails: new Set<string>(), urls: new Set<string>(), phones: new Set<string>() };
  const snapshot = await repos.workspaces.latest(db, businessId, taskId);
  if (!snapshot || snapshot.files.length === 0) return { files: 0, bytes: 0, savedAt: null, recipients: toSeed(found) };
  if (snapshot.fileCount > limits.maxFiles || snapshot.totalBytes > limits.maxTotalBytes) throw new Error(`the saved code (${snapshot.fileCount} files, ${snapshot.totalBytes} bytes) is over the workspace limits`);
  const entries = snapshot.files.filter((e) => restorablePath(e.path) && e.size <= limits.maxFileBytes);
  const root = await realpath(cwd);
  let written = 0;
  let bytes = 0;
  for (const batch of byteBatches(entries, batchBytes)) {
    const files = await repos.workspaces.readFiles(db, businessId, snapshot, batch.map((e) => e.path));
    for (const file of files) {
      const abs = path.join(root, ...file.path.split("/"));
      if (!abs.startsWith(root + path.sep)) continue;
      await mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
      const handle = await open(abs, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(file.content);
      } finally {
        await handle.close();
      }
      written++;
      bytes += file.content.byteLength;
      const text = asText(file.content);
      if (text) {
        const c = extractCandidateRecipients(text);
        for (const v of c.emails) found.emails.add(v);
        for (const v of c.urls) found.urls.add(v);
        for (const v of c.phones) found.phones.add(v);
      }
    }
  }
  return { files: written, bytes, savedAt: snapshot.createdAt, recipients: toSeed(found) };
}

/** The mint request's seed: every value, or `all` when there are too many or one is too long to send. */
function toSeed(found: { emails: Set<string>; urls: Set<string>; phones: Set<string> }): RecipientSeed {
  const kinds = ["emails", "urls", "phones"] as const;
  const tooMany = kinds.some((k) => found[k].size > MAX_SEEDED_RECIPIENTS || [...found[k]].some((v) => v.length > SEED_VALUE_LIMITS[k]));
  if (tooMany) return { emails: [], urls: [], phones: [], all: true };
  return { emails: [...found.emails], urls: [...found.urls], phones: [...found.phones], all: false };
}

/** Mask credential-shaped values and the session's own secrets in a text file; null when there is nothing to mask. */
function maskSecrets(text: string, secrets: readonly string[]): string | null {
  let out = redactCredentialValues(text);
  for (const secret of secrets) if (secret.length >= 16) out = out.split(secret).join("[redacted:session-secret]");
  return out === text ? null : out;
}

/** Save what the agent left in the workspace as the task's latest snapshot (nothing is written when nothing changed). */
export async function saveWorkspace(db: Db, owner: WorkspaceOwner, cwd: string, options: SaveWorkspaceOptions = {}): Promise<SavedWorkspace> {
  const read = await readWorkspace(cwd, options.limits ?? DEFAULT_SYNC_LIMITS);
  const leftOut: LeftOut[] = [];
  const masked: string[] = [];
  if (read.refused) return { status: "refused", reason: read.refused, leftOut, masked };
  const files: { path: string; content: Uint8Array }[] = [];
  for (const f of read.files) {
    if (!isSafeWorkspacePath(f.rel)) leftOut.push({ path: f.rel, reason: "name" });
    else if (isStartupFile(f.rel)) leftOut.push({ path: f.rel, reason: "startup" });
    else if (isSecretFileName(f.rel)) leftOut.push({ path: f.rel, reason: "secret" });
    else {
      const text = asText(f.content);
      const clean = text === null ? null : maskSecrets(text, options.secrets ?? []);
      if (clean !== null) masked.push(f.rel);
      files.push({ path: f.rel, content: clean === null ? f.content : new TextEncoder().encode(clean) });
    }
  }
  const result = await repos.workspaces.save(db, owner.businessId, { taskId: owner.taskId, sessionId: owner.sessionId, agentId: owner.agentId, branch: owner.branch, files, carryOver: options.carryOver });
  if (result.refused) return { status: "refused", reason: result.refused, leftOut, masked };
  const bytes = files.reduce((s, f) => s + f.content.byteLength, 0);
  return { status: result.saved ? "saved" : "unchanged", files: files.length, bytes, added: result.added, changed: result.changed, removed: result.removed, leftOut, masked };
}
