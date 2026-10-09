/**
 * A code task's workspace outlives its session (0013 workspaces): when a code session ends, the files the agent wrote
 * are saved as a snapshot of the task (`repos.workspaces.save`, contents stored once per business); the next session
 * on the same task starts from the latest snapshot. Development › Code shows them.
 *
 * What is saved is what `readWorkspace` reads for the acceptance run (single-link regular files, no SDK HOME state,
 * no node_modules or .git, the same caps). Restored paths are checked again: relative, inside the workspace, never
 * over the SDK's own state, written with O_CREAT | O_EXCL | O_NOFOLLOW into the fresh directory.
 */
import { constants } from "node:fs";
import { mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { isSafeWorkspacePath, repos, type Db } from "@foundmill/db";
import { DEFAULT_SYNC_LIMITS, isSdkHomeEntry, NEVER_SYNCED_DIRS, readWorkspace, type WorkspaceSyncLimits } from "./workspace-sync";

export interface WorkspaceOwner {
  businessId: string;
  taskId: string;
  sessionId: string;
  agentId: string;
  branch: string;
}

export interface RestoredWorkspace {
  files: number;
  bytes: number;
  /** When the restored snapshot was saved; null when there was none. */
  savedAt: Date | null;
}

export type SavedWorkspace =
  | { status: "saved" | "unchanged"; files: number; bytes: number; added: number; changed: number; removed: number }
  | { status: "refused"; reason: string };

/** Whether a stored path may be written into a session workspace. */
export function restorablePath(rel: string): boolean {
  if (!isSafeWorkspacePath(rel)) return false;
  const segments = rel.split("/");
  if (isSdkHomeEntry(segments[0]!)) return false;
  return !segments.some((s) => NEVER_SYNCED_DIRS.includes(s));
}

/** Write the task's latest saved files into a fresh session workspace. */
export async function restoreWorkspace(db: Db, businessId: string, taskId: string, cwd: string): Promise<RestoredWorkspace> {
  const snapshot = await repos.workspaces.latest(db, businessId, taskId);
  if (!snapshot || snapshot.files.length === 0) return { files: 0, bytes: 0, savedAt: null };
  const files = await repos.workspaces.readFiles(db, businessId, snapshot);
  const root = await realpath(cwd);
  let written = 0;
  let bytes = 0;
  for (const file of files) {
    if (!restorablePath(file.path)) continue;
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
  }
  return { files: written, bytes, savedAt: snapshot.createdAt };
}

/** Save what the agent left in the workspace as the task's latest snapshot (nothing is written when nothing changed). */
export async function saveWorkspace(db: Db, owner: WorkspaceOwner, cwd: string, limits: WorkspaceSyncLimits = DEFAULT_SYNC_LIMITS): Promise<SavedWorkspace> {
  const read = await readWorkspace(cwd, limits);
  if (read.refused) return { status: "refused", reason: read.refused };
  const result = await repos.workspaces.save(db, owner.businessId, {
    taskId: owner.taskId,
    sessionId: owner.sessionId,
    agentId: owner.agentId,
    branch: owner.branch,
    files: read.files.map((f) => ({ path: f.rel, content: f.content })),
  });
  const bytes = read.files.reduce((s, f) => s + f.content.byteLength, 0);
  return { status: result.saved ? "saved" : "unchanged", files: read.files.length, bytes, added: result.added, changed: result.changed, removed: result.removed };
}
