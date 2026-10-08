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
import { constants, existsSync } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { Sandbox } from "@foundmill/sandbox";

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
const isSdkHomeEntry = (name: string) => name.startsWith(SDK_HOME_PREFIX) || SDK_HOME_ARTIFACTS.includes(name);
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
