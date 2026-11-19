/**
 * 0083 — the return loop (retention plan, founder 2026-11-11): when each founder was last in each business, the days
 * they came, and the founder emails the platform sent them. All three are one person's rows in one business: the person
 * reads only their own, and only while they belong to the business (`user_id = auth.uid() and is_member(business_id)`).
 * Presence and visit days are written by the api as that person (the presence ping); notifications are written by the
 * orchestrator's notifier with the service role, and a person can only read theirs.
 */
import { FOUNDER_NOTIFICATION_CHANNELS, FOUNDER_NOTIFICATION_KINDS, FOUNDER_NOTIFICATION_STATUSES, FOUNDER_RETURN_VIA } from "@foundmill/shared";
import { date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { emptyArray, id, timestamps, tstz } from "./_common";
import { businessId, businessIdNullable } from "./_refs";

/** One row per person per business: the last ping, the session it belongs to and the end of the session before it. */
export const founderPresence = pgTable(
  "founder_presence",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    businessId: businessId(),
    lastSeenAt: tstz("last_seen_at").notNull(),
    sessionStartedAt: tstz("session_started_at").notNull(),
    /** The last ping of the session before this one: what "Since you were last here" counts from. Null on the first session. */
    previousSeenAt: tstz("previous_seen_at"),
    sessions: integer("sessions").notNull().default(1),
    /** How the current session started. */
    lastVia: text("last_via", { enum: FOUNDER_RETURN_VIA }).notNull().default("direct"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("founder_presence_user_business_key").on(t.userId, t.businessId), index("founder_presence_business_idx").on(t.businessId)],
);
export type FounderPresence = typeof founderPresence.$inferSelect;

/** One row per person per business per day they were there (the business's own calendar day). */
export const founderVisitDays = pgTable(
  "founder_visit_days",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    businessId: businessId(),
    day: date("day", { mode: "string" }).notNull(),
    firstAt: tstz("first_at").notNull(),
    lastAt: tstz("last_at").notNull(),
    pings: integer("pings").notNull().default(1),
    ...timestamps(),
  },
  (t) => [uniqueIndex("founder_visit_days_user_business_day_key").on(t.userId, t.businessId, t.day), index("founder_visit_days_business_day_idx").on(t.businessId, t.day)],
);
export type FounderVisitDay = typeof founderVisitDays.$inferSelect;

/**
 * Every founder notification the notifier decided on: sent, skipped (with why) or failed. `dedupeKey` makes a sweep
 * that runs twice send once. An email that offers a one-click answer carries the option and the hash of its token
 * (never the token); `actionUsedAt` makes it single-use. `businessId` is null only for the email about a kept card to a
 * person with no project yet (0132, kind `getting_started`).
 */
export const founderNotifications = pgTable(
  "founder_notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    businessId: businessIdNullable(),
    kind: text("kind", { enum: FOUNDER_NOTIFICATION_KINDS }).notNull(),
    channel: text("channel", { enum: FOUNDER_NOTIFICATION_CHANNELS }).notNull().default("email"),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status", { enum: FOUNDER_NOTIFICATION_STATUSES }).notNull().default("queued"),
    skipReason: text("skip_reason"),
    mode: text("mode", { enum: ["mock", "live"] }),
    subject: text("subject").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    bodyHtml: text("body_html").notNull().default(""),
    inboxItemIds: uuid("inbox_item_ids").array().notNull().default(emptyArray),
    providerMessageId: text("provider_message_id"),
    actionItemId: uuid("action_item_id"),
    actionOptionId: text("action_option_id"),
    actionTokenHash: text("action_token_hash"),
    actionExpiresAt: tstz("action_expires_at"),
    actionUsedAt: tstz("action_used_at"),
    sentAt: tstz("sent_at"),
    /** When the founder came back through one of its links. */
    openedAt: tstz("opened_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("founder_notifications_dedupe_key").on(t.userId, t.dedupeKey),
    uniqueIndex("founder_notifications_action_token_key").on(t.actionTokenHash),
    index("founder_notifications_user_created_idx").on(t.userId, t.createdAt),
    index("founder_notifications_business_idx").on(t.businessId, t.createdAt),
    index("founder_notifications_user_kind_idx").on(t.userId, t.kind, t.createdAt),
  ],
);
export type FounderNotification = typeof founderNotifications.$inferSelect;
export type NewFounderNotification = typeof founderNotifications.$inferInsert;
