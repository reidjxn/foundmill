/** 0012 — LIVE social: public profiles view, connections, messages, communities, leaderboards, negotiations. */
import { ARCHETYPES, DATA_REGIONS, VISIBILITY } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, pgView, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { emptyArray, emptyObject, id, timestamps, timestampsWithArchive, tstz } from "./_common";
import { businesses } from "./accounts";
import { businessIdNullable } from "./_refs";
import { agents } from "./agents";

export const CONNECTION_STATUSES = ["requested", "accepted", "blocked"] as const;
export const COMMUNITY_ROLES = ["owner", "moderator", "member"] as const;
export const COMMUNITY_MEMBER_STATUSES = ["active", "muted", "banned", "left"] as const;
export const POST_STATUSES = ["visible", "hidden", "removed", "pending_review"] as const;
export const NEGOTIATION_STATUSES = ["open", "agreed", "declined", "expired", "stopped"] as const;
export const PUBLIC_PROFILE_KINDS = ["business", "founder"] as const;

export const publicProfiles = pgView("public_profiles", {
  businessId: uuid("business_id").notNull(),
  kind: text("kind", { enum: PUBLIC_PROFILE_KINDS }).notNull(),
  displayName: text("display_name").notNull(),
  slug: text("slug"),
  crestUrl: text("crest_url"),
  archetype: text("archetype", { enum: ARCHETYPES }),
  kitPrimary: text("kit_primary"),
  kitSecondary: text("kit_secondary"),
  region: text("region", { enum: DATA_REGIONS }),
  committedAt: tstz("committed_at"),
  userId: uuid("user_id"),
}).existing();
export type PublicProfile = typeof publicProfiles.$inferSelect;

export const connections = pgTable(
  "connections",
  {
    id: id(),
    fromUser: uuid("from_user").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    toUser: uuid("to_user").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    status: text("status", { enum: CONNECTION_STATUSES }).notNull().default("requested"),
    message: text("message"),
    respondedAt: tstz("responded_at"),
    /** Who blocked (0016): set exactly when `status` is "blocked"; only they may change or delete the row. */
    blockedBy: uuid("blocked_by").references(() => authUsers.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("connections_from_user_to_user_key").on(t.fromUser, t.toUser),
    index("connections_blocked_by_idx").on(t.blockedBy),
    // One row per pair of people, whichever of them asked (0016).
    uniqueIndex("connections_pair_key").on(sql`least(${t.fromUser}, ${t.toUser})`, sql`greatest(${t.fromUser}, ${t.toUser})`),
    index("connections_to_user_idx").on(t.toUser, t.status),
    index("connections_from_user_idx").on(t.fromUser, t.status),
  ],
);
export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;

export const messageThreads = pgTable(
  "message_threads",
  {
    id: id(),
    participantIds: uuid("participant_ids").array().notNull(),
    subject: text("subject"),
    lastMessageAt: tstz("last_message_at"),
    ...timestampsWithArchive(),
  },
  (t) => [index("message_threads_participant_ids_idx").using("gin", t.participantIds)],
);
export type MessageThread = typeof messageThreads.$inferSelect;
export type NewMessageThread = typeof messageThreads.$inferInsert;

export const messages = pgTable(
  "messages",
  {
    id: id(),
    threadId: uuid("thread_id").notNull().references(() => messageThreads.id, { onDelete: "cascade" }),
    fromUser: uuid("from_user").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    readBy: uuid("read_by").array().notNull().default(emptyArray),
    ...timestamps(),
  },
  (t) => [index("messages_thread_id_idx").on(t.threadId, t.createdAt), index("messages_from_user_idx").on(t.fromUser)],
);
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export const communities = pgTable(
  "communities",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    descriptionMd: text("description_md").notNull().default(""),
    visibility: text("visibility", { enum: VISIBILITY }).notNull().default("public"),
    ownerBusinessId: uuid("owner_business_id").references(() => businesses.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    memberCount: integer("member_count").notNull().default(0),
    ...timestampsWithArchive(),
  },
  (t) => [index("communities_owner_business_id_idx").on(t.ownerBusinessId), index("communities_created_by_idx").on(t.createdBy)],
);
export type Community = typeof communities.$inferSelect;
export type NewCommunity = typeof communities.$inferInsert;

export const communityMembers = pgTable(
  "community_members",
  {
    id: id(),
    communityId: uuid("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "set null" }),
    role: text("role", { enum: COMMUNITY_ROLES }).notNull().default("member"),
    status: text("status", { enum: COMMUNITY_MEMBER_STATUSES }).notNull().default("active"),
    joinedAt: tstz("joined_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("community_members_community_id_user_id_key").on(t.communityId, t.userId),
    index("community_members_user_id_idx").on(t.userId),
    index("community_members_business_id_idx").on(t.businessId),
  ],
);
export type CommunityMember = typeof communityMembers.$inferSelect;
export type NewCommunityMember = typeof communityMembers.$inferInsert;

export const posts = pgTable(
  "posts",
  {
    id: id(),
    communityId: uuid("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    businessId: businessIdNullable(),
    parentPostId: uuid("parent_post_id").references((): AnyPgColumn => posts.id, { onDelete: "cascade" }),
    bodyMd: text("body_md").notNull(),
    entityIds: uuid("entity_ids").array().notNull().default(emptyArray),
    status: text("status", { enum: POST_STATUSES }).notNull().default("visible"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("posts_community_id_idx").on(t.communityId, t.createdAt),
    index("posts_author_user_id_idx").on(t.authorUserId),
    index("posts_business_id_idx").on(t.businessId),
    index("posts_parent_post_id_idx").on(t.parentPostId),
  ],
);
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;

export const leaderboards = pgTable(
  "leaderboards",
  {
    id: id(),
    boardKind: text("board_kind").notNull(),
    division: text("division").notNull().default("open"),
    period: text("period").notNull(),
    metric: text("metric").notNull(),
    archetype: text("archetype", { enum: ARCHETYPES }),
    region: text("region", { enum: DATA_REGIONS }),
    computedAt: tstz("computed_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("leaderboards_board_kind_division_period_archetype_region_key").on(t.boardKind, t.division, t.period, t.archetype, t.region),
    index("leaderboards_period_idx").on(t.period, t.boardKind),
  ],
);
export type Leaderboard = typeof leaderboards.$inferSelect;
export type NewLeaderboard = typeof leaderboards.$inferInsert;

export const leaderboardEntries = pgTable(
  "leaderboard_entries",
  {
    id: id(),
    leaderboardId: uuid("leaderboard_id").notNull().references(() => leaderboards.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    movement: integer("movement").notNull().default(0),
    form: text("form").notNull().default(""),
    metricValue: numeric("metric_value", { precision: 20, scale: 4 }).notNull(),
    verified: boolean("verified").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("leaderboard_entries_leaderboard_id_business_id_key").on(t.leaderboardId, t.businessId),
    index("leaderboard_entries_leaderboard_id_idx").on(t.leaderboardId, t.position),
    index("leaderboard_entries_business_id_idx").on(t.businessId),
  ],
);
export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect;
export type NewLeaderboardEntry = typeof leaderboardEntries.$inferInsert;

export const negotiationThreads = pgTable(
  "negotiation_threads",
  {
    id: id(),
    businessA: uuid("business_a").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    businessB: uuid("business_b").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    agentA: uuid("agent_a").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    agentB: uuid("agent_b").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    subject: text("subject").notNull().default(""),
    limitsSnapshot: jsonb("limits_snapshot").$type<Record<string, unknown>>().notNull().default(emptyObject),
    transcriptRef: text("transcript_ref"),
    status: text("status", { enum: NEGOTIATION_STATUSES }).notNull().default("open"),
    workflowId: text("workflow_id"),
    closedAt: tstz("closed_at"),
    ...timestamps(),
  },
  (t) => [
    index("negotiation_threads_business_a_idx").on(t.businessA, t.status),
    index("negotiation_threads_business_b_idx").on(t.businessB, t.status),
    index("negotiation_threads_agent_a_idx").on(t.agentA),
    index("negotiation_threads_agent_b_idx").on(t.agentB),
  ],
);
export type NegotiationThread = typeof negotiationThreads.$inferSelect;
export type NewNegotiationThread = typeof negotiationThreads.$inferInsert;
