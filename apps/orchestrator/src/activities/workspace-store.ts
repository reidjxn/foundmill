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
 * A session that started from a checkout of the repository (./checkout, 0068) saves only what differs from it: the
 * added and changed files, the checkout's files it deleted and the base (repository, ref, commit). Restoring such a save
 * over a checkout replaces the checkout's files and removes the deleted ones again.
 *
 * Restored paths are checked again (relative, inside the workspace, never over SDK state or startup files) and written
 * with O_CREAT | O_EXCL | O_NOFOLLOW into the fresh directory (over a checkout, a regular file there is unlinked first),
 * in batches of at most 8 MB. Everything restored came
 * from an earlier session that may have read untrusted content, so the recipients found in it are returned for the
 * gateway's untrusted register (BUILD §9.8 step 4): the new session cannot contact them without the founder.
 */
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { extractCandidateRecipients } from "@foundmill/connectors";
import { isSafeWorkspacePath, repos, type Db, type WorkspaceManifestEntry, type WorkspaceSnapshot } from "@foundmill/db";
import { LONG_LIVED_VALUE_PATTERNS } from "@foundmill/sandbox";
import type { CheckoutBase } from "./checkout";
import { CHECKOUT_SYNC_LIMITS, DEFAULT_SYNC_LIMITS, isSdkHomeEntry, NEVER_SYNCED_DIRS, readWorkspace, readWorkspaceChanges, type WorkspaceSyncLimits } from "./workspace-sync";

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
  /** Files of the checkout the restored changes delete (a snapshot saved on a checkout); 0 otherwise. */
  removed: number;
  /** When the restored snapshot was saved; null when there was none. */
  savedAt: Date | null;
  recipients: RecipientSeed;
}

export type SavedWorkspace =
  | { status: "saved" | "unchanged"; files: number; bytes: number; added: number; changed: number; removed: number; leftOut: LeftOut[]; masked: string[]; snapshot: WorkspaceSnapshot | null }
  | { status: "refused"; reason: string; leftOut: LeftOut[]; masked: string[] };

export interface LeftOut {
  path: string;
  reason: "secret" | "startup" | "name";
}

export interface SaveWorkspaceOptions {
  limits?: WorkspaceSyncLimits;
  /**
   * The checkout the session started from (./checkout): only what differs from it is saved, with the files it deleted
   * and the base it is a diff against. Credential-shaped values the checkout already held are kept as they are.
   */
  base?: CheckoutBase | null;
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
const SECRET_FILE = /^(\.env(\..+)?|\.envrc|\.dev\.vars|.+\.(pem|key|p12|pfx|jks|keystore|tfvars|tfstate|tfstate\.backup)|id_(rsa|dsa|ecdsa|ed25519)|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|credentials)$/i;
/**
 * Credentials founders paste into code tasks that `LONG_LIVED_VALUE_PATTERNS` leaves alone (it also vets sandbox
 * environments, where a short-lived JWT is expected): any JWT, Supabase secret keys.
 */
const WORKSPACE_SECRET_VALUES: readonly { id: string; value: RegExp }[] = [
  { id: "value.jwt", value: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { id: "value.supabase_secret", value: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
];
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
function isText(content: Uint8Array): boolean {
  return !content.subarray(0, 8192).includes(0);
}

/**
 * Everything readable in a file, for scanning (never for storing): UTF-16 when it starts with a byte-order mark, else
 * lenient UTF-8. NULs are read twice, as separators (so binary bytes never glue onto an address) and removed (so NULs
 * interleaved in an address cannot hide it).
 */
export function scanText(content: Uint8Array): string {
  const bom = content.length >= 2 && ((content[0] === 0xff && content[1] === 0xfe) || (content[0] === 0xfe && content[1] === 0xff));
  const text = new TextDecoder(bom ? (content[0] === 0xff ? "utf-16le" : "utf-16be") : "utf-8").decode(content);
  return text.includes("\u0000") ? `${text.replaceAll("\u0000", " ")}\n${text.replaceAll("\u0000", "")}` : text;
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

export interface RestoreOptions {
  /**
   * The workspace already holds a checkout of the repository: the saved files are written over its files, and the
   * files a snapshot saved on a checkout deleted are removed again. Without it the workspace is empty and only the saved
   * files are written (a snapshot's deletions then have nothing to apply to).
   */
  checkout?: boolean;
}

/** Write a file, replacing a regular file already there only when `replace` is set; links are never followed. */
async function writeRestored(abs: string, content: Uint8Array, replace: boolean): Promise<void> {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  let handle;
  try {
    handle = await open(abs, flags, 0o600);
  } catch (err) {
    if (!replace || (err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    if (!(await lstat(abs)).isFile()) throw new Error("a saved file's path is not a file in the checkout", { cause: err });
    await unlink(abs);
    handle = await open(abs, flags, 0o600);
  }
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

/**
 * Write the task's latest saved files into a fresh session workspace (over the checkout, when it holds one) and collect
 * the recipients they mention. `files` and `savedAt` describe the task's own saved changes only, never the checkout.
 */
export async function restoreWorkspace(db: Db, businessId: string, taskId: string, cwd: string, limits: WorkspaceSyncLimits = DEFAULT_SYNC_LIMITS, batchBytes = RESTORE_BATCH_BYTES, options: RestoreOptions = {}): Promise<RestoredWorkspace> {
  const found: FoundRecipients = { emails: new Set<string>(), urls: new Set<string>(), phones: new Set<string>() };
  const snapshot = await repos.workspaces.latest(db, businessId, taskId);
  const removals = options.checkout ? (snapshot?.removedPaths ?? []).filter(restorablePath) : [];
  if (!snapshot || (snapshot.files.length === 0 && removals.length === 0)) return { files: 0, bytes: 0, removed: 0, savedAt: null, recipients: toSeed(found) };
  if (snapshot.fileCount > limits.maxFiles || snapshot.totalBytes > limits.maxTotalBytes) throw new Error(`the saved code (${snapshot.fileCount} files, ${snapshot.totalBytes} bytes) is over the workspace limits`);
  const entries = snapshot.files.filter((e) => restorablePath(e.path) && e.size <= limits.maxFileBytes);
  const root = await realpath(cwd);
  const inside = (rel: string) => {
    const abs = path.join(root, ...rel.split("/"));
    return abs.startsWith(root + path.sep) ? abs : null;
  };
  let written = 0;
  let bytes = 0;
  for (const batch of byteBatches(entries, batchBytes)) {
    const files = await repos.workspaces.readFiles(db, businessId, snapshot, batch.map((e) => e.path));
    for (const file of files) {
      const abs = inside(file.path);
      if (!abs) continue;
      await mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
      await writeRestored(abs, file.content, options.checkout === true);
      written++;
      bytes += file.content.byteLength;
      collectRecipients(found, scanText(file.content));
    }
  }
  let removed = 0;
  for (const rel of removals) {
    const abs = inside(rel);
    if (!abs) continue;
    const st = await lstat(abs).catch(() => null);
    if (!st?.isFile()) continue;
    await unlink(abs);
    removed++;
  }
  // File names are visible to the agent too (Glob, Read errors): `notes/ops@evil.example.md` counts, with and without
  // its extension.
  collectRecipients(found, entries.flatMap((e) => [e.path, e.path.replace(/\.[^./]*$/, "")]).join("\n"));
  return { files: written, bytes, removed, savedAt: snapshot.createdAt, recipients: toSeed(found) };
}

export interface FoundRecipients {
  emails: Set<string>;
  urls: Set<string>;
  phones: Set<string>;
}

export function collectRecipients(found: FoundRecipients, text: string): void {
  const c = extractCandidateRecipients(text);
  for (const v of c.emails) found.emails.add(v);
  for (const v of c.urls) found.urls.add(v);
  for (const v of c.phones) found.phones.add(v);
}

/** Found recipients and seeds together (a checkout's and a restore's), for one seed; null when one of them is `all`. */
export function mergeRecipients(...all: (FoundRecipients | RecipientSeed | null | undefined)[]): FoundRecipients | null {
  const out: FoundRecipients = { emails: new Set(), urls: new Set(), phones: new Set() };
  for (const r of all) {
    if (!r) continue;
    if ("all" in r && r.all) return null;
    for (const v of r.emails) out.emails.add(v);
    for (const v of r.urls) out.urls.add(v);
    for (const v of r.phones) out.phones.add(v);
  }
  return out;
}

/**
 * Largest seed sent with the mint request: the gateway takes at most 1 MB on /v1/session-tokens, and the rest of the
 * request is small.
 */
export const MAX_SEED_BYTES = 512 * 1024;

/**
 * The mint request's seed: every value, or `all` when there are too many, one is too long, or together they are too
 * large to send (a seed the gateway refused would stop every later session on the task from starting).
 */
export function toSeed(found: FoundRecipients): RecipientSeed {
  const kinds = ["emails", "urls", "phones"] as const;
  const tooMany = kinds.some((k) => found[k].size > MAX_SEEDED_RECIPIENTS || [...found[k]].some((v) => v.length > SEED_VALUE_LIMITS[k]));
  const all: RecipientSeed = { emails: [], urls: [], phones: [], all: true };
  if (tooMany) return all;
  const seed: RecipientSeed = { emails: [...found.emails], urls: [...found.urls], phones: [...found.phones], all: false };
  return Buffer.byteLength(JSON.stringify(seed), "utf8") > MAX_SEED_BYTES ? all : seed;
}

/** Every credential-shaped value pattern a save masks, global. */
const MASKED_VALUES: readonly { id: string; value: RegExp }[] = [
  ...LONG_LIVED_VALUE_PATTERNS.flatMap((p) => (p.value ? [{ id: p.id, value: new RegExp(p.value.source, p.value.flags.includes("g") ? p.value.flags : `${p.value.flags}g`) }] : [])),
  ...WORKSPACE_SECRET_VALUES,
];

/** The credential-shaped values in a text (a checkout's, so a save leaves the repository's own as they are). */
export function credentialMatches(text: string): string[] {
  return MASKED_VALUES.flatMap((p) => text.match(p.value) ?? []);
}

/**
 * Mask credential-shaped values and the session's own secrets in text; null when there is nothing to mask. Values in
 * `keep` (already in the checked-out repository) are left as they are; the session's own secrets never are.
 */
function maskSecrets(text: string, secrets: readonly string[], keep?: ReadonlySet<string>): string | null {
  let out = text;
  for (const p of MASKED_VALUES) out = out.replace(p.value, (m) => (keep?.has(m) ? m : `[redacted:${p.id}]`));
  for (const secret of secrets) if (secret.length >= 16) out = out.split(secret).join("[redacted:session-secret]");
  return out === text ? null : out;
}

/**
 * Save what the agent left in the workspace as the task's latest snapshot (nothing is written when nothing changed).
 * On a checkout (`options.base`) only what differs from it is saved: the added and changed files, the checkout's files
 * that are gone, and the base itself.
 */
export async function saveWorkspace(db: Db, owner: WorkspaceOwner, cwd: string, options: SaveWorkspaceOptions = {}): Promise<SavedWorkspace> {
  const base = options.base ?? null;
  const leftOut: LeftOut[] = [];
  const masked: string[] = [];
  const read: { files: { rel: string; content: Uint8Array; inBase?: boolean }[]; refused: string | null; removed?: string[] } = base ? await readWorkspaceChanges(cwd, base.files, options.limits ?? CHECKOUT_SYNC_LIMITS) : await readWorkspace(cwd, options.limits ?? DEFAULT_SYNC_LIMITS);
  if (read.refused) return { status: "refused", reason: read.refused, leftOut, masked };
  const files: { path: string; content: Uint8Array; inBase?: boolean }[] = [];
  const keep = base?.knownSecrets;
  for (const f of read.files) {
    const inBase = base ? { inBase: f.inBase === true } : {};
    if (!isSafeWorkspacePath(f.rel)) leftOut.push({ path: f.rel, reason: "name" });
    else if (isStartupFile(f.rel)) leftOut.push({ path: f.rel, reason: "startup" });
    else if (isSecretFileName(f.rel)) leftOut.push({ path: f.rel, reason: "secret" });
    else if (!isText(f.content)) {
      // A binary file cannot be masked without breaking it: one that holds a credential is left out instead.
      if (maskSecrets(scanText(f.content), options.secrets ?? [], keep) !== null) leftOut.push({ path: f.rel, reason: "secret" });
      else files.push({ path: f.rel, content: f.content, ...inBase });
    } else {
      const clean = maskSecrets(new TextDecoder("utf-8").decode(f.content), options.secrets ?? [], keep);
      if (clean !== null) masked.push(f.rel);
      files.push({ path: f.rel, content: clean === null ? f.content : new TextEncoder().encode(clean), ...inBase });
    }
  }
  // One transaction: the repo serialises the business's saves, forgets and sweeps with a transaction-scoped lock.
  const result = await db.transaction((tx) =>
    repos.workspaces.save(tx, owner.businessId, {
      taskId: owner.taskId,
      sessionId: owner.sessionId,
      agentId: owner.agentId,
      branch: owner.branch,
      files,
      carryOver: options.carryOver,
      ...(base ? { base: { repo: base.repo, ref: base.ref, commitSha: base.commitSha }, removedPaths: (read.removed ?? []).filter((p) => isSafeWorkspacePath(p)) } : {}),
    }),
  );
  if (result.refused) return { status: "refused", reason: result.refused, leftOut, masked };
  const bytes = files.reduce((s, f) => s + f.content.byteLength, 0);
  return { status: result.saved ? "saved" : "unchanged", files: files.length, bytes, added: result.added, changed: result.changed, removed: result.removed, leftOut, masked, snapshot: result.snapshot };
}
