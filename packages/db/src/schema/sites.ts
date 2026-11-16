/**
 * 0117 — Foundmill sites (WP-07 T2): a project's static site and its releases. Members read; the services write, but
 * for an owner's or an admin's publish (`sites_publish` on status, live_release_id and slug; `site_releases_publish`
 * on published_by and published_at). Each release's files are a `WorkspaceManifestEntry[]` whose bytes are the
 * business's `workspace_blobs`. apps/sites reads through `site_resolve` and `site_file` as `sites_reader`.
 */
import { sql } from "drizzle-orm";
import { bigint, char, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { tasks } from "./agents";
import type { WorkspaceManifestEntry } from "./workspaces";

export const SITE_STATUSES = ["draft", "live", "taken_down"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];
export const SITE_RELEASE_STATES = ["preview", "held"] as const;
export type SiteReleaseState = (typeof SITE_RELEASE_STATES)[number];

/** What screening found in a release (T5 fills the rules). */
export interface SiteScreening {
  flags: unknown[];
  [key: string]: unknown;
}

export const sites = pgTable(
  "sites",
  {
    id: id(),
    businessId: businessId().unique(),
    slug: text("slug").notNull().unique(),
    status: text("status").$type<SiteStatus>().notNull().default("draft"),
    liveReleaseId: uuid("live_release_id").references((): AnyPgColumn => siteReleases.id, { onDelete: "set null" }),
    starterKey: text("starter_key").notNull().default("static-site"),
    takenDownReason: text("taken_down_reason"),
    ...timestamps(),
  },
  (t) => [index("sites_live_release_id_idx").on(t.liveReleaseId)],
);
export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;

export const siteReleases = pgTable(
  "site_releases",
  {
    id: id(),
    businessId: businessId(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    parentReleaseId: uuid("parent_release_id"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    sessionId: uuid("session_id"),
    agentId: uuid("agent_id"),
    files: jsonb("files").$type<WorkspaceManifestEntry[]>().notNull(),
    fileCount: integer("file_count").notNull().default(0),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
    contentHash: char("content_hash", { length: 64 }).notNull(),
    state: text("state").$type<SiteReleaseState>().notNull(),
    screening: jsonb("screening").$type<SiteScreening>().notNull().default(sql`'{"flags":[]}'::jsonb`),
    previewToken: text("preview_token").notNull().unique(),
    publishedBy: uuid("published_by"),
    publishedAt: tstz("published_at"),
    ...timestamps(),
  },
  (t) => [
    unique("site_releases_number_unique").on(t.siteId, t.number),
    index("site_releases_business_idx").on(t.businessId, t.createdAt.desc()),
    index("site_releases_task_id_idx").on(t.taskId),
    uniqueIndex("site_releases_session_idx")
      .on(t.sessionId)
      .where(sql`session_id is not null`),
  ],
);
export type SiteRelease = typeof siteReleases.$inferSelect;
export type NewSiteRelease = typeof siteReleases.$inferInsert;
