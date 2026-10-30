/**
 * Agent workspaces (0013): the code an agent wrote on a code task, kept after the session's workspace is deleted.
 * File contents live in `workspace_blobs`, once per business, addressed by sha256; each saved session adds a
 * `workspace_snapshots` manifest. Written by the orchestrator (service role), read by members (Development › Code).
 *
 * Bounded: a business stores at most `quotaBytes` of contents (saves past it are refused), a task keeps its newest
 * `keepSnapshots` saves, and contents no snapshot references any more are swept. Owners and admins may forget a
 * task's saved code (`forgetTask`); that is a founder action, never an agent's.
 */
import { createHash } from "node:crypto";
import { ValidationError } from "@foundmill/shared";
import { and, asc, count, desc, eq, inArray, isNotNull, ne, notExists, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { agentSessions, tasks, workspaceBlobs, workspaceSnapshots, type WorkspaceManifestEntry, type WorkspaceSnapshot } from "../schema";
import { Id, parseInput, type Executor } from "./_shared";

/** Control characters and the bidirectional marks and overrides that make a file name read differently from what it is. */
function isSpoofingChar(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x61c || code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

function hasSpoofingChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (isSpoofingChar(text.charCodeAt(i))) return true;
  return false;
}

/** A relative path with forward slashes: no leading slash, no empty, "." or ".." segment, no backslash, control or bidi character. */
export function isSafeWorkspacePath(path: string): boolean {
  if (path.length === 0 || path.length > 500 || hasSpoofingChar(path) || path.includes("\\") || path.startsWith("/")) return false;
  return path.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== "..");
}

/** Contents one business may keep (deduplicated), and saves kept per task. */
export const WORKSPACE_QUOTA_BYTES = 500 * 1024 * 1024;
export const WORKSPACE_KEEP_SNAPSHOTS = 20;
export const WORKSPACE_KEEP_YOUNGER_THAN_MS = 24 * 60 * 60 * 1000;
const CHECKOUT_REPO = /^[A-Za-z0-9-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const CHECKOUT_SHA = /^[0-9a-f]{7,64}$/;

export const SaveWorkspaceInput = z.object({
  taskId: Id,
  sessionId: Id.nullable().optional(),
  agentId: Id.nullable().optional(),
  branch: z.string().max(250).nullable().optional(),
  files: z
    .array(
      z.object({
        path: z.string().refine(isSafeWorkspacePath, "workspace path must be relative and stay inside the workspace"),
        content: z.custom<Uint8Array>((v) => v instanceof Uint8Array, "file content must be bytes"),
        /** With a `base`: whether the checkout had this path (changed) or not (added). Counted, not stored. */
        inBase: z.boolean().optional(),
      }),
    )
    .max(5_000),
  /**
   * Keep the previous snapshot's files that are missing here instead of counting them as removed: the session did not
   * start from them (its restore failed), so their absence says nothing.
   */
  carryOver: z.boolean().optional(),
  /**
   * 0068: the checkout the session started from. With it `files` are only what changed against the checkout and
   * `removedPaths` the checkout's files the session deleted. Omitted, a task whose latest save has a base keeps that
   * base (the session could not check out, so it worked on the saved changes alone); null saves a whole workspace.
   */
  base: z
    .object({ repo: z.string().regex(CHECKOUT_REPO, "owner/name"), ref: z.string().min(1).max(250), commitSha: z.string().regex(CHECKOUT_SHA, "a commit sha") })
    .nullable()
    .optional(),
  removedPaths: z.array(z.string().refine(isSafeWorkspacePath, "workspace path must be relative and stay inside the workspace")).max(10_000).optional(),
});
export type SaveWorkspaceInput = z.input<typeof SaveWorkspaceInput>;

export interface SaveWorkspaceResult {
  /** The latest snapshot after the call: the new one, or the previous one when nothing changed or the save was refused. */
  snapshot: WorkspaceSnapshot | null;
  /** Whether a new snapshot was written. */
  saved: boolean;
  added: number;
  changed: number;
  removed: number;
  /** Why nothing was written although something changed (the business's quota), else null. */
  refused: string | null;
  /** Older snapshots of the task removed by retention. */
  pruned: number;
}

export interface SaveWorkspaceOptions {
  quotaBytes?: number;
  keepSnapshots?: number;
  /** Snapshots younger than this are never pruned (a looping agent cannot push the history out in minutes). */
  keepYoungerThanMs?: number;
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
  pushedRepo: workspaceSnapshots.pushedRepo,
  pushedBranch: workspaceSnapshots.pushedBranch,
  pushedCommitSha: workspaceSnapshots.pushedCommitSha,
  pushedUrl: workspaceSnapshots.pushedUrl,
  pushedAt: workspaceSnapshots.pushedAt,
  pushError: workspaceSnapshots.pushError,
  baseRepo: workspaceSnapshots.baseRepo,
  baseRef: workspaceSnapshots.baseRef,
  baseCommitSha: workspaceSnapshots.baseCommitSha,
  removedPaths: workspaceSnapshots.removedPaths,
  createdAt: workspaceSnapshots.createdAt,
  updatedAt: workspaceSnapshots.updatedAt,
};

/**
 * Saves, forgets and sweeps of one business run one at a time, so a sweep never deletes contents a concurrent save
 * found already stored. Transaction-scoped: callers pass a transaction (the orchestrator, `withRls`).
 */
async function lockBusiness(db: Executor, businessId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`workspaces:${businessId}`}))`);
}

async function storedBytes(db: Executor, businessId: string): Promise<number> {
  const [row] = await db.select({ n: sum(workspaceBlobs.sizeBytes) }).from(workspaceBlobs).where(eq(workspaceBlobs.businessId, businessId));
  return Number(row?.n ?? 0);
}

/** Delete the business's contents that no snapshot references (only among `shas` when given); returns how many. */
async function sweepBlobs(db: Executor, businessId: string, shas?: readonly string[]): Promise<number> {
  const referenced = notExists(
    db
      .select({ one: sql`1` })
      .from(workspaceSnapshots)
      .where(and(eq(workspaceSnapshots.businessId, businessId), sql`${workspaceSnapshots.files} @> jsonb_build_array(jsonb_build_object('sha256', ${workspaceBlobs.sha256}::text))`)),
  );
  if (shas && shas.length === 0) return 0;
  let deleted = 0;
  for (const part of shas ? chunk(shas, 500) : [null]) {
    const rows = await db
      .delete(workspaceBlobs)
      .where(and(eq(workspaceBlobs.businessId, businessId), part ? inArray(workspaceBlobs.sha256, part) : undefined, referenced))
      .returning({ id: workspaceBlobs.id });
    deleted += rows.length;
  }
  return deleted;
}

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
  async save(db: Executor, businessId: string, input: SaveWorkspaceInput, options: SaveWorkspaceOptions = {}): Promise<SaveWorkspaceResult> {
    const f = parseInput(SaveWorkspaceInput, input, "workspace");
    const quotaBytes = options.quotaBytes ?? WORKSPACE_QUOTA_BYTES;
    const keep = Math.max(1, options.keepSnapshots ?? WORKSPACE_KEEP_SNAPSHOTS);
    const seen = new Set<string>();
    for (const file of f.files) {
      if (seen.has(file.path)) throw new ValidationError(`workspace path listed twice: ${file.path}`);
      seen.add(file.path);
    }
    await lockBusiness(db, businessId);
    // A session that started before the task's code was forgotten may hold the forgotten files (both times are the
    // database's own clock).
    if (f.sessionId) {
      const [row] = await db
        .select({ forgottenAt: tasks.codeForgottenAt, startedAt: agentSessions.startedAt })
        .from(tasks)
        .innerJoin(agentSessions, and(eq(agentSessions.businessId, tasks.businessId), eq(agentSessions.id, f.sessionId)))
        .where(and(eq(tasks.businessId, businessId), eq(tasks.id, f.taskId)))
        .limit(1);
      if (row?.forgottenAt && row.startedAt < row.forgottenAt) {
        return { snapshot: await workspacesRepo.latest(db, businessId, f.taskId), saved: false, added: 0, changed: 0, removed: 0, refused: "this task's saved code was forgotten after the session started", pruned: 0 };
      }
    }
    const previous = await workspacesRepo.latest(db, businessId, f.taskId);
    // The checkout this save is a diff against: the session's own, or (when it could not check out) the latest save's.
    const inherited = f.base === undefined && previous?.baseCommitSha && previous.baseRepo && previous.baseRef ? { repo: previous.baseRepo, ref: previous.baseRef, commitSha: previous.baseCommitSha } : null;
    const base = f.base ?? inherited;
    const removedSet = new Set(base ? (f.removedPaths ?? []) : []);
    for (const p of removedSet) if (seen.has(p)) throw new ValidationError(`workspace path both saved and removed: ${p}`);
    // A session on an inherited base never had the checkout: what an earlier save removed stays removed unless it is back.
    if (inherited || (base && f.carryOver)) for (const p of previous?.removedPaths ?? []) if (!seen.has(p)) removedSet.add(p);
    const inBase = new Map(f.files.map((file) => [file.path, file.inBase] as const));
    const entries: Array<WorkspaceManifestEntry & { content?: Uint8Array }> = f.files.map((file) => ({ path: file.path, sha256: sha256(file.content), size: file.content.byteLength, content: file.content }));
    if (f.carryOver) for (const e of previous?.files ?? []) if (!seen.has(e.path) && !removedSet.has(e.path)) entries.push({ ...e });
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const removedPaths = [...removedSet].sort();
    const now = new Set(entries.map((e) => e.path));
    const before = new Map((previous?.files ?? []).map((e) => [e.path, e.sha256] as const));
    let added = 0;
    let changed = 0;
    let removed: number;
    const unchanged = { snapshot: previous, saved: false, added: 0, changed: 0, removed: 0, refused: null, pruned: 0 };
    if (base) {
      // Counted against the checkout: what the commit onto the branch adds, changes and deletes.
      for (const e of entries) {
        const known = inBase.get(e.path);
        if (known === false || (known === undefined && !before.has(e.path))) added++;
        else if (known === true || before.get(e.path) !== e.sha256) changed++;
      }
      removed = removedPaths.length;
      const sameBase = previous?.baseCommitSha === base.commitSha && previous.baseRepo === base.repo;
      const sameFiles = previous !== null && previous.files.length === entries.length && entries.every((e) => before.get(e.path) === e.sha256);
      const sameRemoved = previous !== null && previous.removedPaths.length === removedPaths.length && removedPaths.every((p, i) => previous.removedPaths[i] === p);
      if ((sameBase && sameFiles && sameRemoved) || (!previous && entries.length === 0 && removedPaths.length === 0)) return unchanged;
    } else {
      for (const e of entries) {
        const prev = before.get(e.path);
        if (prev === undefined) added++;
        else if (prev !== e.sha256) changed++;
      }
      removed = [...before.keys()].filter((p) => !now.has(p)).length;
      if (added + changed + removed === 0 && (previous || entries.length === 0)) return unchanged;
    }

    const unique = new Map<string, WorkspaceManifestEntry & { content: Uint8Array }>();
    for (const e of entries) if (e.content && !unique.has(e.sha256)) unique.set(e.sha256, e as WorkspaceManifestEntry & { content: Uint8Array });
    const stored = new Set<string>();
    for (const shas of chunk([...unique.keys()], 500)) {
      const rows = await db.select({ sha256: workspaceBlobs.sha256 }).from(workspaceBlobs).where(and(eq(workspaceBlobs.businessId, businessId), inArray(workspaceBlobs.sha256, shas)));
      for (const r of rows) stored.add(r.sha256);
    }
    const missing = [...unique.values()].filter((e) => !stored.has(e.sha256));
    const newBytes = missing.reduce((s, e) => s + e.size, 0);
    if (newBytes > 0) {
      let used = await storedBytes(db, businessId);
      // Contents left behind by deleted tasks count until swept; sweep them before refusing.
      if (used + newBytes > quotaBytes) {
        await sweepBlobs(db, businessId);
        used = await storedBytes(db, businessId);
      }
      if (used + newBytes > quotaBytes) return { ...unchanged, refused: `the business's saved code would pass its ${Math.round(quotaBytes / (1024 * 1024))} MB limit` };
    }
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
      .values({
        businessId,
        taskId: f.taskId,
        sessionId: f.sessionId ?? null,
        agentId: f.agentId ?? null,
        branch: f.branch ?? null,
        files,
        fileCount: files.length,
        totalBytes: files.reduce((s, e) => s + e.size, 0),
        added,
        changed,
        removed,
        baseRepo: base?.repo ?? null,
        baseRef: base?.ref ?? null,
        baseCommitSha: base?.commitSha ?? null,
        removedPaths,
      })
      .returning();

    // Retention: the task keeps its newest snapshots and everything from the last day (the quota still bounds both);
    // contents only the pruned ones used are swept.
    const youngest = Date.now() - (options.keepYoungerThanMs ?? WORKSPACE_KEEP_YOUNGER_THAN_MS);
    const old = (
      await db
        .select({ id: workspaceSnapshots.id, files: workspaceSnapshots.files, createdAt: workspaceSnapshots.createdAt })
        .from(workspaceSnapshots)
        .where(and(eq(workspaceSnapshots.businessId, businessId), eq(workspaceSnapshots.taskId, f.taskId)))
        .orderBy(desc(workspaceSnapshots.createdAt), desc(workspaceSnapshots.id))
        .offset(keep)
    ).filter((o) => o.createdAt.getTime() < youngest);
    if (old.length > 0) {
      await db.delete(workspaceSnapshots).where(and(eq(workspaceSnapshots.businessId, businessId), inArray(workspaceSnapshots.id, old.map((o) => o.id))));
      await sweepBlobs(db, businessId, [...new Set(old.flatMap((o) => o.files.map((e) => e.sha256)))]);
    }
    return { snapshot: snapshot ?? null, saved: true, added, changed, removed, refused: null, pruned: old.length };
  },

  /** The newest save of a task that reached `repo` (`owner/name`): what the next push is diffed against. */
  async lastPushed(db: Executor, businessId: string, taskId: string, repo: string): Promise<WorkspaceSnapshot | null> {
    const rows = await db
      .select()
      .from(workspaceSnapshots)
      .where(and(eq(workspaceSnapshots.businessId, businessId), eq(workspaceSnapshots.taskId, taskId), eq(workspaceSnapshots.pushedRepo, repo), isNotNull(workspaceSnapshots.pushedCommitSha)))
      .orderBy(desc(workspaceSnapshots.createdAt), desc(workspaceSnapshots.id))
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Where the task's branch started: the checkout its first save on a *different* ref of `repo` (the default branch) was
   * made on. The branch `agent/<taskId>` is created from that commit when the save is pushed (workspace-push), so a
   * comparison of the branch with this commit is the branch's own changes, whatever the default branch did since. Null
   * when no save of the task was made on a checkout of another ref (the branch came from the agent's own commits).
   */
  async forkPoint(db: Executor, businessId: string, taskId: string, repo: string, branch: string): Promise<{ ref: string; commitSha: string; at: Date } | null> {
    const rows = await db
      .select({ ref: workspaceSnapshots.baseRef, commitSha: workspaceSnapshots.baseCommitSha, at: workspaceSnapshots.createdAt })
      .from(workspaceSnapshots)
      .where(and(eq(workspaceSnapshots.businessId, businessId), eq(workspaceSnapshots.taskId, taskId), eq(workspaceSnapshots.baseRepo, repo), isNotNull(workspaceSnapshots.baseCommitSha), isNotNull(workspaceSnapshots.baseRef), ne(workspaceSnapshots.baseRef, branch)))
      .orderBy(asc(workspaceSnapshots.createdAt), asc(workspaceSnapshots.id))
      .limit(1);
    const row = rows[0];
    return row?.ref && row.commitSha ? { ref: row.ref, commitSha: row.commitSha, at: row.at } : null;
  },

  /** Record where a save was pushed (its branch head after the push) or why it was not. Service role only. */
  async recordPush(db: Executor, businessId: string, snapshotId: string, push: { repo: string; branch: string } & ({ commitSha: string; url: string | null } | { error: string })): Promise<void> {
    const ok = "commitSha" in push;
    await db
      .update(workspaceSnapshots)
      .set({ pushedRepo: push.repo, pushedBranch: push.branch, pushedCommitSha: ok ? push.commitSha : null, pushedUrl: ok ? push.url : null, pushedAt: ok ? new Date() : null, pushError: ok ? null : push.error.slice(0, 500) })
      .where(and(eq(workspaceSnapshots.businessId, businessId), eq(workspaceSnapshots.id, snapshotId)));
  },

  /**
   * Forget a task's saved code: its snapshots and every content no other snapshot uses. A founder action (owners and
   * admins; RLS refuses anyone else), never an agent's. Returns how many snapshots and contents were deleted.
   */
  async forgetTask(db: Executor, businessId: string, taskId: string): Promise<{ snapshots: number; blobs: number }> {
    await lockBusiness(db, businessId);
    const gone = await db
      .delete(workspaceSnapshots)
      .where(and(eq(workspaceSnapshots.businessId, businessId), eq(workspaceSnapshots.taskId, taskId)))
      .returning({ id: workspaceSnapshots.id, files: workspaceSnapshots.files });
    if (gone.length === 0) return { snapshots: 0, blobs: 0 };
    // Sessions already running on the task may hold the forgotten files: they cannot save them back.
    await db.update(tasks).set({ codeForgottenAt: sql`now()` }).where(and(eq(tasks.businessId, businessId), eq(tasks.id, taskId)));
    const blobs = await sweepBlobs(db, businessId, [...new Set(gone.flatMap((g) => g.files.map((e) => e.sha256)))]);
    return { snapshots: gone.length, blobs };
  },

  /** The contents of a snapshot's files (every file, or only `paths`), in manifest order. */
  async readFiles(db: Executor, businessId: string, snapshot: Pick<WorkspaceSnapshot, "files">, paths?: readonly string[]): Promise<Array<WorkspaceManifestEntry & { content: Uint8Array }>> {
    const wanted = paths ? new Set(paths) : null;
    const entries = snapshot.files.filter((e) => !wanted || wanted.has(e.path));
    const bySha = new Map<string, Uint8Array>();
    for (const shas of chunk([...new Set(entries.map((e) => e.sha256))], 200)) {
      const rows = await db.select({ sha256: workspaceBlobs.sha256, content: workspaceBlobs.content }).from(workspaceBlobs).where(and(eq(workspaceBlobs.businessId, businessId), inArray(workspaceBlobs.sha256, shas)));
      for (const r of rows) bySha.set(r.sha256, r.content instanceof Uint8Array ? r.content : new Uint8Array(r.content));
    }
    return entries.flatMap((e) => {
      const content = bySha.get(e.sha256);
      return content ? [{ ...e, content }] : [];
    });
  },
};
