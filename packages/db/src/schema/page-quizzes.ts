/** 0105 — the optional "which one is for you" quiz on a project's public page, and its anonymous counts per result. */
import type { PageQuizDefinition, PageQuizEvidence, PageQuizStatus } from "@foundmill/shared";
import { bigint, boolean, index, integer, jsonb, pgTable, pgView, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { agents } from "./agents";

/**
 * One row per business. `definition` is everything a visitor would read; `evidence` is what the team's draft rested
 * on (real counts, the founder's alone). Members read; owner, admin and member edit a draft; only an owner or an admin
 * approves, turns it on or off, or edits an approved one (trigger `fm_page_quizzes_guard`). Clients never insert: the
 * row is the team's draft, written on the service connection. A changed definition is a new `version`, back to draft.
 */
export const pageQuizzes = pgTable(
  "page_quizzes",
  {
    id: id(),
    businessId: businessId(),
    definition: jsonb("definition").$type<PageQuizDefinition>().notNull(),
    status: text("status").$type<PageQuizStatus>().notNull().default("draft"),
    version: integer("version").notNull().default(1),
    evidence: jsonb("evidence").$type<Partial<PageQuizEvidence>>().notNull().default({}),
    draftedAt: tstz("drafted_at").notNull().defaultNow(),
    draftedByAgentId: uuid("drafted_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    /** Recorded by the database for a client role: its clock and the caller. */
    approvedAt: tstz("approved_at"),
    approvedBy: uuid("approved_by").references(() => authUsers.id, { onDelete: "set null" }),
    /** When it was last turned on (kept after it is turned off). */
    liveAt: tstz("live_at"),
    ...timestamps(),
    updatedBy: uuid("updated_by").references(() => authUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("page_quizzes_business_id_key").on(t.businessId),
    index("page_quizzes_drafted_by_agent_id_idx").on(t.draftedByAgentId),
    index("page_quizzes_approved_by_idx").on(t.approvedBy),
    index("page_quizzes_updated_by_idx").on(t.updatedBy),
  ],
);
export type PageQuiz = typeof pageQuizzes.$inferSelect;
export type NewPageQuiz = typeof pageQuizzes.$inferInsert;

/** How many visitors finished each version of the quiz with each result: a number per type, nothing about who. Services write. */
export const pageQuizCounts = pgTable(
  "page_quiz_counts",
  {
    id: id(),
    businessId: businessId(),
    quizId: uuid("quiz_id").notNull().references(() => pageQuizzes.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    typeKey: text("type_key").notNull(),
    finished: bigint("finished", { mode: "number" }).notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex("page_quiz_counts_once_key").on(t.quizId, t.version, t.typeKey), index("page_quiz_counts_business_id_idx").on(t.businessId)],
);
export type PageQuizCount = typeof pageQuizCounts.$inferSelect;

/**
 * What a visitor reads of a live quiz (0105): the page's address, the version, the definition and whether the page has
 * its Follow form. The service connection's only. Rows exist only while the quiz is live and its page is public.
 */
export const publicPageQuizzes = pgView("public_page_quizzes", {
  slug: text("slug").notNull(),
  version: integer("version").notNull(),
  definition: jsonb("definition").$type<PageQuizDefinition>().notNull(),
  followForm: boolean("follow_form").notNull(),
}).existing();
export type PublicPageQuizRow = typeof publicPageQuizzes.$inferSelect;

/** The columns `public_page_quizzes` exposes, in order (the view's test compares the catalog with this list). */
export const PUBLIC_PAGE_QUIZ_COLUMNS = ["slug", "version", "definition", "follow_form"] as const;
