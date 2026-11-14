/**
 * 0103 — showcase videos of real projects (docs/THESIS_REVIEW.md §13 item 15). The SQL is the source of truth and holds
 * the rules (migrations/0103_showcase_videos.sql); these mirror it.
 *
 *   - `showcaseRequests`: business-scoped to the house (`HOUSE_BUSINESS_ID`): one ask about one project, its overall
 *     state only. House members read it; only the api writes it, on the service connection.
 *   - `showcaseConsents`: business-scoped to the project: one row per founder asked. A founder reads their own row only,
 *     while they hold an owner's standing; only the api writes it.
 */
import { SHOWCASE_ANSWERS, SHOWCASE_REQUEST_STATES, SHOWCASE_WITHDRAW_REASONS, type ShowcasePreview } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { emptyObject, id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { businesses } from "./accounts";
import { assets } from "./distribution";

/** The house's own record of the video's generation, through the gateway (never a key, never a vendor's words). */
export interface ShowcaseMedia {
  /** One entry per shot, by its milestone. */
  clips?: {
    milestoneId: string;
    /** The approval the gateway opened in the house's Needs you before spending, while it waits. */
    approvalId?: string | null;
    /**
     * When the start call was made (written BEFORE the call, under the request's claim): a clip with a start and no task
     * is never started again, because the vendor may have taken the first call (no double spend).
     */
    startedAt?: string | null;
    /** When the start call was made again under the house's approval (written before it, for the same reason). */
    approvedCallAt?: string | null;
    taskId?: string | null;
    status?: string | null;
    url?: string | null;
    urlsExpireAt?: string | null;
    /** A mock connector's result: it can never be sent for a yes. */
    simulated?: boolean;
    failed?: boolean;
  }[];
  /** Why the media is not moving: Runway is not connected on the house business, or the result was simulated. */
  waiting?: "not_connected" | "simulated" | "failed" | null;
  /** When the clips were deleted (a withdrawal deletes the unposted media). */
  deletedAt?: string | null;
  /** The sweep that is making the clips now holds the request until then (`showcaseRepo.claimMedia`). */
  claimedUntil?: string | null;
}

export const showcaseRequests = pgTable(
  "showcase_requests",
  {
    id: id(),
    businessId: businessId(),
    subjectBusinessId: uuid("subject_business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    preview: jsonb("preview").$type<ShowcasePreview>().notNull(),
    previewHash: text("preview_hash").notNull(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    state: text("state", { enum: SHOWCASE_REQUEST_STATES }).notNull().default("asking"),
    withdrawReason: text("withdraw_reason", { enum: SHOWCASE_WITHDRAW_REASONS }),
    media: jsonb("media").$type<ShowcaseMedia>().notNull().default(emptyObject),
    requestedByUserId: uuid("requested_by_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    askedAt: tstz("asked_at"),
    expiresAt: tstz("expires_at"),
    approvedUntil: tstz("approved_until"),
    settledAt: tstz("settled_at"),
    ...timestamps(),
  },
  (t) => [
    index("showcase_requests_business_id_idx").on(t.businessId, t.createdAt.desc()),
    index("showcase_requests_subject_idx").on(t.subjectBusinessId, t.createdAt.desc()),
    uniqueIndex("showcase_requests_one_open_idx").on(t.subjectBusinessId).where(sql`${t.state} in ('asking', 'approved')`),
    index("showcase_requests_asset_id_idx").on(t.assetId),
    index("showcase_requests_requested_by_user_id_idx").on(t.requestedByUserId),
  ],
);
export type ShowcaseRequest = typeof showcaseRequests.$inferSelect;
export type NewShowcaseRequest = typeof showcaseRequests.$inferInsert;

export const showcaseConsents = pgTable(
  "showcase_consents",
  {
    id: id(),
    businessId: businessId(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => showcaseRequests.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** The founder's own note in the project's Needs you. (SQL: a composite foreign key to inbox_items, set null on delete.) */
    inboxItemId: uuid("inbox_item_id"),
    preview: jsonb("preview").$type<ShowcasePreview>().notNull(),
    previewHash: text("preview_hash").notNull(),
    answer: text("answer", { enum: SHOWCASE_ANSWERS }),
    answeredAt: tstz("answered_at"),
    withdrawnAt: tstz("withdrawn_at"),
    expiresAt: tstz("expires_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("showcase_consents_request_user_key").on(t.requestId, t.userId),
    index("showcase_consents_business_id_idx").on(t.businessId, t.createdAt.desc()),
    index("showcase_consents_user_id_idx").on(t.userId, t.businessId),
    index("showcase_consents_inbox_item_id_idx").on(t.inboxItemId),
  ],
);
export type ShowcaseConsent = typeof showcaseConsents.$inferSelect;
export type NewShowcaseConsent = typeof showcaseConsents.$inferInsert;
