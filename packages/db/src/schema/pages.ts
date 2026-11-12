/** 0077 — a project's public page: one row per business, a draft and what is published, at its own address. */
import type { ProjectPageContent } from "@foundmill/shared";
import { index, jsonb, pgTable, pgView, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";

/**
 * `draft` is what the founder is writing; `published` is the copy the public page shows (null until published and
 * again after it is taken down). Members read; owner, admin and member write the draft; only an owner or an admin
 * changes `published`, the publish columns or a live page's slug (trigger `fm_project_pages_guard`), and only they delete.
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
    /** When the page last went live (kept after it is taken down). */
    publishedAt: tstz("published_at"),
    publishedBy: uuid("published_by").references(() => authUsers.id, { onDelete: "set null" }),
    /** When it was taken down; null while it is live or was never published. */
    unpublishedAt: tstz("unpublished_at"),
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
}).existing();
export type PublicProjectPage = typeof publicProjectPages.$inferSelect;

/** The columns `public_project_pages` exposes, in order (the view's test compares the catalog with this list). */
export const PUBLIC_PROJECT_PAGE_COLUMNS = ["slug", "published", "published_at", "name", "logo_version", "kit_primary", "kit_secondary", "founder_names"] as const;
