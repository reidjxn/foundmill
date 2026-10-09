/**
 * Agent workspaces (0013): the code an agent wrote on a code task, kept after the session's workspace is deleted.
 * File contents live in `workspace_blobs`, once per business, addressed by sha256; each saved session adds a
 * `workspace_snapshots` manifest. Written by the orchestrator (service role), read by members (Development › Code).
 */
import { createHash } from "node:crypto";
import { ValidationError } from "@foundmill/shared";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tasks, workspaceBlobs, workspaceSnapshots, type WorkspaceManifestEntry, type WorkspaceSnapshot } from "../schema";
import { Id, parseInput, type Executor } from "./_shared";

/** A relative path with forward slashes: no leading slash, no empty, "." or ".." segment, no backslash or NUL. */
export function isSafeWorkspacePath(path: string): boolean {
  if (path.length === 0 || path.length > 500 || path.includes("\0") || path.includes("\\") || path.startsWith("/")) return false;
  return path.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== "..");
}

export const SaveWorkspaceInput = z.object({
  taskId: Id,
  sessionId: Id.nullable().optional(),
  agentId: Id.nullable().optional(),
  branch: z.string().max(250).nullable().optional(),
  files: z.array(z.object({ path: z.string().refine(isSafeWorkspacePath, "workspace path must be relative and stay inside the workspace"), content: z.custom<Uint8Array>((v) => v instanceof Uint8Array, "file content must be bytes") })).max(5_000),
});
export type SaveWorkspaceInput = z.input<typeof SaveWorkspaceInput>;

export interface SaveWorkspaceResult {
  /** The latest snapshot after the call: the new one, or the previous one when nothing changed. */
  snapshot: WorkspaceSnapshot | null;
  /** Whether a new snapshot was written. */
  saved: boolean;
  added: number;
  changed: number;
  removed: number;
}

export type WorkspaceSnapshotSummary = Omit<WorkspaceSnapshot, "files">;

export interface TaskWithCode {
  taskId: string;
  title: string;
  status: string;
  assigneeAgentId: string | null;
  latest: WorkspaceSnapshotSummary;
  snapshots: number;
}

const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");
const chunk = <T>(items: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const summaryColumns = {
  id: workspaceSnapshots.id,
  businessId: workspaceSnapshots.businessId,
  taskId: workspaceSnapshots.taskId,
  sessionId: workspaceSnapshots.sessionId,
  agentId: workspaceSnapshots.agentId,
  branch: workspaceSnapshots.branch,
  fileCount: workspaceSnapshots.fileCount,
  totalBytes: workspaceSnapshots.totalBytes,
  added: workspaceSnapshots.added,
  changed: workspaceSnapshots.changed,
  removed: workspaceSnapshots.removed,
  createdAt: workspaceSnapshots.createdAt,
  updatedAt: workspaceSnapshots.updatedAt,
};

export const workspacesRepo = {
  /** The task's latest saved workspace, or null when nothing was saved yet. */
  async latest(db: Executor, businessId: string, taskId: string): Promise<WorkspaceSnapshot | null> {
    const rows = await db
      .select()
      .from(workspaceSnapshots)
      .where(and(eq(workspaceSnapshots.businessId, businessId), eq(workspaceSnapshots.taskId, taskId)))
      .orderBy(desc(workspaceSnapshots.createdAt), desc(workspaceSnapshots.id))
      .limit(1);
    return rows[0] ?? null;
  },

  async getSnapshot(db: Executor, businessId: string, snapshotId: string): Promise<WorkspaceSnapshot | null> {
    const rows = await db.select().from(workspaceSnapshots).where(and(eq(workspaceSnapshots.businessId, businessId), eq(workspaceSnapshots.id, snapshotId))).limit(1);
    return rows[0] ?? null;
  },

  /** A task's saved sessions, newest first, without their manifests. */
  async listSnapshots(db: Executor, businessId: string, taskId: string, limit = 50): Promise<WorkspaceSnapshotSummary[]> {
    return db
      .select(summaryColumns)
      .from(workspaceSnapshots)
      .where(and(eq(workspaceSnapshots.businessId, businessId), eq(workspaceSnapshots.taskId, taskId)))
      .orderBy(desc(workspaceSnapshots.createdAt), desc(workspaceSnapshots.id))
      .limit(Math.min(200, Math.max(1, limit)));
  },

  /** Tasks with saved code, the most recently saved first, each with its latest snapshot and how many there are. */
  async listTasks(db: Executor, businessId: string, limit = 100): Promise<TaskWithCode[]> {
    const latest = await db
      .selectDistinctOn([workspaceSnapshots.taskId], summaryColumns)
      .from(workspaceSnapshots)
      .where(eq(workspaceSnapshots.businessId, businessId))
      .orderBy(workspaceSnapshots.taskId, desc(workspaceSnapshots.createdAt), desc(workspaceSnapshots.id));
    if (latest.length === 0) return [];
    const taskIds = latest.map((s) => s.taskId);
    const [taskRows, counts] = await Promise.all([
      db.select({ id: tasks.id, title: tasks.title, status: tasks.status, assigneeAgentId: tasks.assigneeAgentId }).from(tasks).where(and(eq(tasks.businessId, businessId), inArray(tasks.id, taskIds))),
      db.select({ taskId: workspaceSnapshots.taskId, n: count() }).from(workspaceSnapshots).where(and(eq(workspaceSnapshots.businessId, businessId), inArray(workspaceSnapshots.taskId, taskIds))).groupBy(workspaceSnapshots.taskId),
    ]);
    const taskById = new Map(taskRows.map((t) => [t.id, t] as const));
    const countByTask = new Map(counts.map((c) => [c.taskId, Number(c.n)] as const));
    return latest
      .flatMap((s) => {
        const t = taskById.get(s.taskId);
        return t ? [{ taskId: s.taskId, title: t.title, status: t.status, assigneeAgentId: t.assigneeAgentId, latest: s, snapshots: countByTask.get(s.taskId) ?? 1 }] : [];
      })
      .sort((a, b) => b.latest.createdAt.getTime() - a.latest.createdAt.getTime())
      .slice(0, limit);
  },

  /**
   * Save a task's workspace as one session left it. Contents already stored for the business are not written again;
   * when nothing differs from the previous snapshot no row is added (`saved: false`).
   */
  async save(db: Executor, businessId: string, input: SaveWorkspaceInput): Promise<SaveWorkspaceResult> {
    const f = parseInput(SaveWorkspaceInput, input, "workspace");
    const seen = new Set<string>();
    for (const file of f.files) {
      if (seen.has(file.path)) throw new ValidationError(`workspace path listed twice: ${file.path}`);
      seen.add(file.path);
    }
    const entries = f.files.map((file) => ({ path: file.path, sha256: sha256(file.content), size: file.content.byteLength, content: file.content })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const previous = await workspacesRepo.latest(db, businessId, f.taskId);
    const before = new Map((previous?.files ?? []).map((e) => [e.path, e.sha256] as const));
    let added = 0;
    let changed = 0;
    for (const e of entries) {
      const prev = before.get(e.path);
      if (prev === undefined) added++;
      else if (prev !== e.sha256) changed++;
    }
    const removed = [...before.keys()].filter((p) => !seen.has(p)).length;
    if (added + changed + removed === 0 && (previous || entries.length === 0)) return { snapshot: previous, saved: false, added: 0, changed: 0, removed: 0 };

    const unique = new Map(entries.map((e) => [e.sha256, e] as const));
    const stored = new Set<string>();
    for (const shas of chunk([...unique.keys()], 500)) {
      const rows = await db.select({ sha256: workspaceBlobs.sha256 }).from(workspaceBlobs).where(and(eq(workspaceBlobs.businessId, businessId), inArray(workspaceBlobs.sha256, shas)));
      for (const r of rows) stored.add(r.sha256);
    }
    const missing = [...unique.values()].filter((e) => !stored.has(e.sha256));
    // Batches of at most 50 files or 8 MB keep each statement small.
    let batch: typeof missing = [];
    let batchBytes = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      await db
        .insert(workspaceBlobs)
        .values(batch.map((e) => ({ businessId, sha256: e.sha256, sizeBytes: e.size, content: e.content })))
        .onConflictDoNothing({ target: [workspaceBlobs.businessId, workspaceBlobs.sha256] });
      batch = [];
      batchBytes = 0;
    };
    for (const e of missing) {
      if (batch.length >= 50 || batchBytes + e.size > 8 * 1024 * 1024) await flush();
      batch.push(e);
      batchBytes += e.size;
    }
    await flush();

    const files: WorkspaceManifestEntry[] = entries.map((e) => ({ path: e.path, sha256: e.sha256, size: e.size }));
    const [snapshot] = await db
      .insert(workspaceSnapshots)
      .values({ businessId, taskId: f.taskId, sessionId: f.sessionId ?? null, agentId: f.agentId ?? null, branch: f.branch ?? null, files, fileCount: files.length, totalBytes: files.reduce((s, e) => s + e.size, 0), added, changed, removed })
      .returning();
    return { snapshot: snapshot ?? null, saved: true, added, changed, removed };
  },

  /** The contents of a snapshot's files (every file, or only `paths`), in manifest order. */
  async readFiles(db: Executor, businessId: string, snapshot: Pick<WorkspaceSnapshot, "files">, paths?: readonly string[]): Promise<Array<WorkspaceManifestEntry & { content: Uint8Array }>> {
    const wanted = paths ? new Set(paths) : null;
    const entries = snapshot.files.filter((e) => !wanted || wanted.has(e.path));
    const bySha = new Map<string, Uint8Array>();
    for (const shas of chunk([...new Set(entries.map((e) => e.sha256))], 200)) {
      const rows = await db.select({ sha256: workspaceBlobs.sha256, content: workspaceBlobs.content }).from(workspaceBlobs).where(and(eq(workspaceBlobs.businessId, businessId), inArray(workspaceBlobs.sha256, shas)));
      for (const r of rows) bySha.set(r.sha256, new Uint8Array(r.content));
    }
    return entries.flatMap((e) => {
      const content = bySha.get(e.sha256);
      return content ? [{ ...e, content }] : [];
    });
  },
};
