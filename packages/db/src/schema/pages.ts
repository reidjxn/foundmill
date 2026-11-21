/** 0077 — a project's public page: one row per business, a draft and what is published, at its own address. */
import type { ProjectPageContent } from "@foundmill/shared";
import { boolean, index, jsonb, pgTable, pgView, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";

/**
 * `draft` is what the founder is writing; `published` is the copy the public page shows (null until published and
 * again after it is taken down). Members read; owner, admin and member write the draft; only an owner or an admin
 * changes `published`, the publish columns or a live page's slug (trigger `fm_project_pages_guard`), and only they delete.
 * `published_at` and `unpublished_at` are the database's to write for a signed-in client (0090): its clock when the page
 * goes live or is taken down, unchanged otherwise, whatever the client sent.
 */
export const projectPages = pgTable(
  "project_pages",
  {
    id: id(),
    businessId: businessId(),
    /** The address under /p/: 3 to 40 lowercase letters, digits and hyphens, unique across every project. */
    slug: text("slug").notNull(),
    draft: jsonb("draft").$type<ProjectPageContent>().notNull(),
    published: jsonb("published").$type<ProjectPageContent>(),
    /** When the page last went live (kept after it is taken down). Recorded by the database for a client role (0090). */
    publishedAt: tstz("published_at"),
    publishedBy: uuid("published_by").references(() => authUsers.id, { onDelete: "set null" }),
    /** When it was taken down; null while it is live or was never published. */
    unpublishedAt: tstz("unpublished_at"),
    /** 0119: when the published copy last changed (the page's dateModified and sitemap lastmod); the database's for a client role. */
    contentPublishedAt: tstz("content_published_at"),
    /** 0149: the owner's opt-in to the public gallery (`/explore`). Counts only while the page is published; an owner's or an admin's to switch (its own guard). */
    exploreListed: boolean("explore_listed").notNull().default(false),
    ...timestamps(),
    updatedBy: uuid("updated_by").references(() => authUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("project_pages_business_id_key").on(t.businessId),
    uniqueIndex("project_pages_slug_key").on(t.slug),
    index("project_pages_published_by_idx").on(t.publishedBy),
    index("project_pages_updated_by_idx").on(t.updatedBy),
  ],
);
export type ProjectPage = typeof projectPages.$inferSelect;
export type NewProjectPage = typeof projectPages.$inferInsert;

/**
 * What anyone may read of a published page, signed in or not (granted to anon). Exactly these columns: nothing else of
 * the page, the business or its people leaves through it. Rows exist only while a page is published and its business
 * is committed, not archived and not a sample business. `founderNames` is empty unless the page says to show them.
 */
export const publicProjectPages = pgView("public_project_pages", {
  slug: text("slug").notNull(),
  published: jsonb("published").$type<ProjectPageContent>().notNull(),
  publishedAt: tstz("published_at").notNull(),
  name: text("name").notNull(),
  /** The sha256 of the business's logo (its version), or null when it has none. */
  logoVersion: text("logo_version"),
  kitPrimary: text("kit_primary").notNull(),
  kitSecondary: text("kit_secondary").notNull(),
  founderNames: text("founder_names").array().notNull(),
  /** 0119: when the published copy last changed. */
  contentPublishedAt: tstz("content_published_at"),
}).existing();
export type PublicProjectPage = typeof publicProjectPages.$inferSelect;

/**
 * The milestones a project's founders chose to show (0089): the rows of its story (`/p/<slug>/story`) and its cards
 * (`/m/<id>`). The service connection's only, like the page view. Exactly these columns: the milestone's id, the page's
 * address, the key, the public words (built from the key, so nothing of a customer travels) and the date. Rows exist
 * only for a milestone that is shown and not archived, while its business has a row in `public_project_pages`.
 */
export const publicProjectMilestones = pgView("public_project_milestones", {
  id: uuid("id").notNull(),
  slug: text("slug").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  achievedAt: tstz("achieved_at").notNull(),
}).existing();
export type PublicProjectMilestone = typeof publicProjectMilestones.$inferSelect;

/** The columns `public_project_milestones` exposes, in order (the view's test compares the catalog with this list). */
export const PUBLIC_PROJECT_MILESTONE_COLUMNS = ["id", "slug", "key", "label", "achieved_at"] as const;

/** The columns `public_project_pages` exposes, in order (the view's test compares the catalog with this list). */
export const PUBLIC_PROJECT_PAGE_COLUMNS = ["slug", "published", "published_at", "name", "logo_version", "kit_primary", "kit_secondary", "founder_names", "content_published_at"] as const;

/**
 * The gallery's read (0143): the pages whose owners opted in, while they are public. A card's columns and nothing else,
 * the service connection's only, built on `public_project_pages` so what is public is decided in one place.
 */
export const publicExploreProjects = pgView("public_explore_projects", {
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  pitch: text("pitch").notNull(),
  stage: text("stage").notNull(),
  kitPrimary: text("kit_primary").notNull(),
  kitSecondary: text("kit_secondary").notNull(),
  publishedAt: tstz("published_at").notNull(),
}).existing();

/** The columns `public_explore_projects` exposes, in order (the view's test compares the catalog with this list). */
export const PUBLIC_EXPLORE_PROJECT_COLUMNS = ["slug", "name", "pitch", "stage", "kit_primary", "kit_secondary", "published_at"] as const;
