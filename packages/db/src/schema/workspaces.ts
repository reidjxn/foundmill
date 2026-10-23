/** 0013 — agent workspaces: the code an agent wrote on a code task, kept after its session ends. */
import { sql } from "drizzle-orm";
import { bigint, char, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea, emptyList, id, timestamps } from "./_common";
import { businessId } from "./_refs";
import { agentSessions, agents, tasks } from "./agents";

/** One file's content, stored once per business and addressed by its sha256 (hex). */
export const workspaceBlobs = pgTable(
  "workspace_blobs",
  {
    id: id(),
    businessId: businessId(),
    sha256: char("sha256", { length: 64 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: bytea("content").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("workspace_blobs_business_sha_idx").on(t.businessId, t.sha256)],
);
export type WorkspaceBlob = typeof workspaceBlobs.$inferSelect;
export type NewWorkspaceBlob = typeof workspaceBlobs.$inferInsert;

/** A file in a snapshot's manifest. */
export interface WorkspaceManifestEntry {
  /** Relative path with forward slashes. */
  path: string;
  sha256: string;
  size: number;
}

/** The workspace of a code task as one session left it. */
export const workspaceSnapshots = pgTable(
  "workspace_snapshots",
  {
    id: id(),
    businessId: businessId(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    branch: text("branch"),
    files: jsonb("files").$type<WorkspaceManifestEntry[]>().notNull().default(emptyList),
    fileCount: integer("file_count").notNull().default(0),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
    added: integer("added").notNull().default(0),
    changed: integer("changed").notNull().default(0),
    removed: integer("removed").notNull().default(0),
    /** 0014: where this save was pushed (`owner/name`, the agent's branch) and the commit, or why it was not. */
    pushedRepo: text("pushed_repo"),
    pushedBranch: text("pushed_branch"),
    pushedCommitSha: text("pushed_commit_sha"),
    pushedUrl: text("pushed_url"),
    pushedAt: timestamp("pushed_at", { withTimezone: true, mode: "date" }),
    pushError: text("push_error"),
    /**
     * 0068: the checkout the session started from (the Code-tab repository at a ref and commit). With a base, `files` are
     * only what the agent added or changed against it and `removedPaths` the checkout's files it deleted; without one,
     * `files` are the whole workspace.
     */
    baseRepo: text("base_repo"),
    baseRef: text("base_ref"),
    baseCommitSha: text("base_commit_sha"),
    removedPaths: jsonb("removed_paths").$type<string[]>().notNull().default(emptyList),
    ...timestamps(),
  },
  (t) => [
    index("workspace_snapshots_business_id_idx").on(t.businessId, t.createdAt),
    index("workspace_snapshots_task_id_idx").on(t.taskId, t.createdAt),
    index("workspace_snapshots_session_id_idx").on(t.sessionId),
    index("workspace_snapshots_agent_id_idx").on(t.agentId),
    index("workspace_snapshots_files_idx").using("gin", t.files.op("jsonb_path_ops")),
    index("workspace_snapshots_pushed_idx").on(t.taskId, t.pushedRepo, t.createdAt).where(sql`pushed_commit_sha is not null`),
  ],
);
export type WorkspaceSnapshot = typeof workspaceSnapshots.$inferSelect;
export type NewWorkspaceSnapshot = typeof workspaceSnapshots.$inferInsert;
