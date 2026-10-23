/**
 * Code tasks write their files in the host workspace the Agent SDK runs in (./sdk-isolation), while acceptance tests run
 * inside the sandbox, never on the host (BUILD §9.3). `syncWorkspaceToSandbox` copies the agent's files into the
 * sandbox's workdir right before the acceptance run.
 *
 * - Only regular files with a single link are copied. Each is opened once (O_NOFOLLOW | O_NONBLOCK), checked on that
 *   descriptor (type, link count and, on Linux, that `/proc/self/fd` resolves inside the workspace) and read from it,
 *   no further than the size that was checked. Symlinks, hard links, FIFOs, sockets and devices are skipped, so nothing
 *   outside the workspace is ever read even if a path changed between listing and reading.
 * - The SDK's own state under HOME (anything named `.claude*`, `.tmp`, caches) is not the agent's work and is never
 *   copied; neither are `node_modules` and `.git` at any depth (dependencies are installed inside the sandbox).
 * - Caps (files, bytes per file, bytes in total) are checked while reading, before anything is written; over a cap the
 *   sync refuses with the reason, and the caller records the acceptance run as failed instead of testing a partial copy.
 */
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { shellJoin, type Sandbox } from "@foundmill/sandbox";

/** Top-level entries the SDK process creates under its HOME (the workspace); never part of the agent's work. */
export const SDK_HOME_ARTIFACTS: readonly string[] = [".tmp", ".cache", ".config", ".npm", ".local", ".pnpm-store"];
/** Top-level names starting with this belong to the SDK (`.claude/`, `.claude.json`, its backups). */
export const SDK_HOME_PREFIX = ".claude";
/** Directory names skipped at any depth. */
export const NEVER_SYNCED_DIRS: readonly string[] = ["node_modules", ".git"];

export interface WorkspaceSyncLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  /** Files written to the sandbox in parallel. */
  concurrency: number;
}

export const DEFAULT_SYNC_LIMITS: WorkspaceSyncLimits = { maxFiles: 2_000, maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024, concurrency: 8 };

export interface WorkspaceFile {
  /** Path relative to the workspace, with forward slashes. */
  rel: string;
  content: Uint8Array;
}

export interface WorkspaceSnapshot {
  files: WorkspaceFile[];
  /** Entries left out because they are not single-link regular files inside the workspace. */
  skipped: number;
  /** Why the workspace cannot be synced, when a cap is exceeded; `files` is then incomplete. */
  refused: string | null;
}

export interface WorkspaceSyncResult {
  files: number;
  bytes: number;
  skipped: number;
  refused: string | null;
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
/** Whether a top-level workspace entry belongs to the SDK process rather than to the agent's work. */
export const isSdkHomeEntry = (name: string) => name.startsWith(SDK_HOME_PREFIX) || SDK_HOME_ARTIFACTS.includes(name);
const PROC_FD = existsSync("/proc/self/fd");

/** Relative paths of every candidate file, sorted. Dirent types use lstat semantics: a symlink is never a file or a directory here. */
async function candidates(cwd: string): Promise<{ rels: string[]; skipped: number }> {
  const rels: string[] = [];
  let skipped = 0;
  const walk = async (dir: string, relDir: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (relDir === "" && isSdkHomeEntry(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!NEVER_SYNCED_DIRS.includes(entry.name)) await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        rels.push(rel);
      } else {
        skipped++;
      }
    }
  };
  await walk(cwd, "");
  return { rels, skipped };
}

/**
 * Read every file the agent wrote, with the caps applied, through one descriptor per file. Writes nothing anywhere.
 * Exported for tests.
 */
export async function readWorkspace(cwd: string, limits: WorkspaceSyncLimits = DEFAULT_SYNC_LIMITS): Promise<WorkspaceSnapshot> {
  const cwdReal = await realpath(cwd);
  const { rels, skipped: notFiles } = await candidates(cwd);
  const files: WorkspaceFile[] = [];
  let skipped = notFiles;
  let total = 0;
  for (const rel of rels) {
    let handle;
    try {
      handle = await open(path.join(cwd, ...rel.split("/")), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      skipped++; // became a symlink (ELOOP) or vanished since the listing
      continue;
    }
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.nlink !== 1) {
        skipped++;
        continue;
      }
      if (PROC_FD) {
        const where = await realpath(`/proc/self/fd/${handle.fd}`);
        if (!where.startsWith(cwdReal + path.sep)) {
          skipped++; // a parent directory was swapped for a link out of the workspace
          continue;
        }
      }
      if (st.size > limits.maxFileBytes) return { files, skipped, refused: `${rel} is larger than ${mb(limits.maxFileBytes)}` };
      if (files.length + 1 > limits.maxFiles) return { files, skipped, refused: `the workspace has more than ${limits.maxFiles} files` };
      if (total + st.size > limits.maxTotalBytes) return { files, skipped, refused: `the workspace is larger than ${mb(limits.maxTotalBytes)}` };
      const content = new Uint8Array(st.size);
      let read = 0;
      while (read < st.size) {
        const { bytesRead } = await handle.read(content, read, st.size - read, read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      files.push({ rel, content: read === st.size ? content : content.subarray(0, read) });
      total += read;
    } finally {
      await handle.close();
    }
  }
  return { files, skipped, refused: null };
}

/**
 * A workspace that holds a checkout of the repository (./checkout): the whole tree is read (up to 10,000 files and
 * 350 MB, at most 5 MB each), but only what differs from the checkout is kept, within the usual limits on what one
 * session may change (DEFAULT_SYNC_LIMITS).
 */
export const CHECKOUT_SYNC_LIMITS: WorkspaceSyncLimits = { maxFiles: 10_000, maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 350 * 1024 * 1024, concurrency: 8 };

export interface WorkspaceChange extends WorkspaceFile {
  /** The checkout had this path (the file changed) or not (it was added). */
  inBase: boolean;
}

export interface WorkspaceChanges {
  /** Files added or changed against the checkout. */
  files: WorkspaceChange[];
  /** Files of the checkout that are no longer in the workspace (as regular files), sorted. */
  removed: string[];
  /** Files the same as in the checkout. */
  unchanged: number;
  skipped: number;
  refused: string | null;
}

const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

/**
 * What the agent changed against the checkout: every candidate file is opened and checked exactly as `readWorkspace`
 * does and hashed; its content is kept only when it differs from `base` (path → sha256). Writes nothing anywhere.
 */
export async function readWorkspaceChanges(cwd: string, base: ReadonlyMap<string, string>, limits: WorkspaceSyncLimits = CHECKOUT_SYNC_LIMITS, changeLimits: WorkspaceSyncLimits = DEFAULT_SYNC_LIMITS): Promise<WorkspaceChanges> {
  const cwdReal = await realpath(cwd);
  const { rels, skipped: notFiles } = await candidates(cwd);
  const files: WorkspaceChange[] = [];
  const present = new Set<string>();
  let skipped = notFiles;
  let total = 0;
  let changedBytes = 0;
  let unchanged = 0;
  const done = (refused: string | null): WorkspaceChanges => ({ files, removed: refused ? [] : [...base.keys()].filter((p) => !present.has(p)).sort(), unchanged, skipped, refused });
  for (const rel of rels) {
    let handle;
    try {
      handle = await open(path.join(cwd, ...rel.split("/")), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      skipped++;
      continue;
    }
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.nlink !== 1) {
        skipped++;
        continue;
      }
      if (PROC_FD) {
        const where = await realpath(`/proc/self/fd/${handle.fd}`);
        if (!where.startsWith(cwdReal + path.sep)) {
          skipped++;
          continue;
        }
      }
      if (st.size > limits.maxFileBytes) return done(`${rel} is larger than ${mb(limits.maxFileBytes)}`);
      if (present.size + 1 > limits.maxFiles) return done(`the workspace has more than ${limits.maxFiles} files`);
      if (total + st.size > limits.maxTotalBytes) return done(`the workspace is larger than ${mb(limits.maxTotalBytes)}`);
      const content = new Uint8Array(st.size);
      let read = 0;
      while (read < st.size) {
        const { bytesRead } = await handle.read(content, read, st.size - read, read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      const bytes = read === st.size ? content : content.subarray(0, read);
      total += read;
      present.add(rel);
      const known = base.get(rel);
      if (known !== undefined && known === sha256(bytes)) {
        unchanged++;
        continue;
      }
      if (files.length + 1 > changeLimits.maxFiles) return done(`the session changed more than ${changeLimits.maxFiles} files`);
      if (changedBytes + read > changeLimits.maxTotalBytes) return done(`the session's changes are larger than ${mb(changeLimits.maxTotalBytes)}`);
      changedBytes += read;
      files.push({ rel, content: bytes, inBase: known !== undefined });
    } finally {
      await handle.close();
    }
  }
  return done(null);
}

/** Where the checkout's archive is put inside the sandbox before it is unpacked into the workdir. */
export const SANDBOX_ARCHIVE_PATH = "/tmp/fm-checkout.tgz";
/** How long unpacking the checkout inside the sandbox may take. */
export const SANDBOX_UNPACK_TIMEOUT_MS = 5 * 60_000;
/** The archive goes to the sandbox from its temp file in parts of at most this size (never whole in memory). */
export const SANDBOX_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Upload the archive file to `SANDBOX_ARCHIVE_PATH`, reading it in parts: one write when it fits in a part, else one
 * file per part joined inside the sandbox (the parts are removed). Returns the bytes sent.
 */
async function uploadArchive(sandbox: Pick<Sandbox, "writeFile" | "exec">, archive: Uint8Array | string, chunkBytes: number): Promise<number> {
  if (typeof archive !== "string") {
    await sandbox.writeFile(SANDBOX_ARCHIVE_PATH, archive);
    return archive.byteLength;
  }
  const handle = await open(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw new Error("the checkout's archive is not a file");
    const parts: string[] = [];
    let offset = 0;
    do {
      const size = Math.min(chunkBytes, st.size - offset);
      const buf = new Uint8Array(size);
      let read = 0;
      while (read < size) {
        const { bytesRead } = await handle.read(buf, read, size - read, offset + read);
        if (bytesRead === 0) throw new Error("the checkout's archive changed while it was uploaded");
        read += bytesRead;
      }
      const target = st.size <= chunkBytes ? SANDBOX_ARCHIVE_PATH : `${SANDBOX_ARCHIVE_PATH}.part-${String(parts.length).padStart(4, "0")}`;
      await sandbox.writeFile(target, buf);
      if (target !== SANDBOX_ARCHIVE_PATH) parts.push(target);
      offset += size;
    } while (offset < st.size);
    if (parts.length > 0) {
      const joined = await sandbox.exec(`cat ${shellJoin(parts)} > ${SANDBOX_ARCHIVE_PATH} && rm -f -- ${shellJoin(parts)}`, { cwd: "/", timeoutMs: SANDBOX_UNPACK_TIMEOUT_MS });
      if (joined.code !== 0) throw new Error(`the checkout's archive could not be joined in the sandbox (exit ${joined.code})`);
    }
    return st.size;
  } finally {
    await handle.close();
  }
}

/**
 * Remove every symbolic link under the sandbox's workdir (an archive may carry them; the host workspace has none), so
 * no later write or removal there goes through one; refuses when one is left.
 */
export function removeSandboxLinksCommand(workdir: string): string {
  const dir = shellJoin([workdir]);
  return `if [ -d ${dir} ]; then find ${dir} -type l -delete && test -z "$(find ${dir} -type l -print -quit)"; fi`;
}

export interface CheckoutSyncResult extends WorkspaceSyncResult {
  /** The checkout was unpacked inside the sandbox from its archive (only the changes were copied); false when the whole workspace was copied instead. */
  unpacked: boolean;
  changed: number;
  removed: number;
}

/**
 * The acceptance copy of a workspace that holds a checkout: the checkout's archive (bytes, or the path of its temp file,
 * read in parts) is uploaded once and unpacked in the sandbox's workdir (without node_modules or .git), every symbolic
 * link the archive carried is removed, then the agent's changes are written over it and the files it deleted are
 * removed. When the sandbox cannot unpack it, the whole workspace is copied file by file instead (with the checkout's
 * limits), also with no link left in the workdir. Writes nothing when refused.
 */
export async function syncCheckoutToSandbox(cwd: string, sandbox: Pick<Sandbox, "writeFile" | "exec" | "workdir">, checkout: { archive: Uint8Array | string; files: ReadonlyMap<string, string> }, limits: WorkspaceSyncLimits = CHECKOUT_SYNC_LIMITS, chunkBytes = SANDBOX_UPLOAD_CHUNK_BYTES): Promise<CheckoutSyncResult> {
  const changes = await readWorkspaceChanges(cwd, checkout.files, limits);
  if (changes.refused) return { files: 0, bytes: 0, skipped: changes.skipped, refused: changes.refused, unpacked: false, changed: 0, removed: 0 };
  const archiveBytes = await uploadArchive(sandbox, checkout.archive, chunkBytes);
  const unpack = await sandbox.exec(
    [`mkdir -p ${shellJoin([sandbox.workdir])}`, `tar -xzf ${SANDBOX_ARCHIVE_PATH} -C ${shellJoin([sandbox.workdir])} --strip-components=1 --no-same-owner --exclude=node_modules --exclude=.git`, `rm -f ${SANDBOX_ARCHIVE_PATH}`].join(" && "),
    { cwd: "/", timeoutMs: SANDBOX_UNPACK_TIMEOUT_MS },
  );
  // Whether it unpacked or stopped part-way, nothing is written or removed through a link the archive made.
  const unlinked = await sandbox.exec(removeSandboxLinksCommand(sandbox.workdir), { cwd: "/", timeoutMs: SANDBOX_UNPACK_TIMEOUT_MS });
  if (unlinked.code !== 0) throw new Error(`the symbolic links in the sandbox's checkout could not be removed (exit ${unlinked.code})`);
  if (unpack.code !== 0) {
    const whole = await syncWorkspaceToSandbox(cwd, sandbox, limits);
    return { ...whole, unpacked: false, changed: changes.files.length, removed: changes.removed.length };
  }
  // Paths come from the workspace walk and the checkout (both checked as relative paths); quoted one by one.
  for (let i = 0; i < changes.removed.length; i += 200) {
    const rm = await sandbox.exec(`rm -f -- ${shellJoin(changes.removed.slice(i, i + 200))}`, { timeoutMs: 60_000 });
    if (rm.code !== 0) throw new Error(`the files the agent deleted could not be removed in the sandbox (exit ${rm.code})`);
  }
  let next = 0;
  let bytes = 0;
  const worker = async () => {
    while (next < changes.files.length) {
      const file = changes.files[next++]!;
      await sandbox.writeFile(file.rel, file.content);
      bytes += file.content.byteLength;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limits.concurrency, changes.files.length)) }, worker));
  return { files: changes.unchanged + changes.files.length, bytes: archiveBytes + bytes, skipped: changes.skipped, refused: null, unpacked: true, changed: changes.files.length, removed: changes.removed.length };
}

/** Copy the agent's files from the host workspace into `sandbox.workdir`, keeping relative paths. Writes nothing when refused. */
export async function syncWorkspaceToSandbox(cwd: string, sandbox: Pick<Sandbox, "writeFile">, limits: WorkspaceSyncLimits = DEFAULT_SYNC_LIMITS): Promise<WorkspaceSyncResult> {
  const snapshot = await readWorkspace(cwd, limits);
  if (snapshot.refused) return { files: 0, bytes: 0, skipped: snapshot.skipped, refused: snapshot.refused };
  let next = 0;
  let bytes = 0;
  const worker = async () => {
    while (next < snapshot.files.length) {
      const file = snapshot.files[next++]!;
      await sandbox.writeFile(file.rel, file.content);
      bytes += file.content.byteLength;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limits.concurrency, snapshot.files.length)) }, worker));
  return { files: snapshot.files.length, bytes, skipped: snapshot.skipped, refused: null };
}
