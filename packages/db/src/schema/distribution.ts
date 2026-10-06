/** 0006 — distribution: channels, campaigns, assets, channel metrics, suppression list. */
import { APPROVAL_STATES, ASSET_KINDS, CAMPAIGN_STATUSES, CHANNEL_KEYS, CHANNEL_LINES } from "@founder-manager/shared";
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currency, emptyObject, id, minor, timestamps, timestampsWithArchive, tstz } from "./_common";
import { businessId, businessIdNullable } from "./_refs";
import { agents } from "./agents";

export const SUPPRESSION_SCOPES = ["business", "platform"] as const;

export const channels = pgTable(
  "channels",
  {
    id: id(),
    businessId: businessId(),
    channelKey: text("channel_key", { enum: CHANNEL_KEYS }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    line: text("line", { enum: CHANNEL_LINES }).notNull(),
    fit: integer("fit").notNull().default(1),
    potential: numeric("potential", { precision: 5, scale: 2 }).notNull().default("0"),
    recommended: boolean("recommended").notNull().default(false),
    whyMd: text("why_md").notNull().default(""),
    budgetMinor: minor("budget_minor").notNull().default(0),
    currency: currency(),
    kitMode: boolean("kit_mode").notNull().default(false),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    engineWorkflowId: text("engine_workflow_id"),
    ...timestampsWithArchive(),
  },
  (t) => [
    uniqueIndex("channels_business_id_channel_key_key").on(t.businessId, t.channelKey),
    index("channels_business_id_idx").on(t.businessId),
    index("channels_enabled_idx").on(t.businessId, t.enabled),
    index("channels_owner_agent_id_idx").on(t.ownerAgentId),
  ],
);
export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    businessId: businessId(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal").notNull().default(""),
    status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("draft"),
    budgetMinor: minor("budget_minor").notNull().default(0),
    currency: currency(),
    startsAt: tstz("starts_at"),
    endsAt: tstz("ends_at"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default(emptyObject),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("campaigns_business_id_idx").on(t.businessId),
    index("campaigns_channel_id_idx").on(t.channelId, t.status),
    index("campaigns_status_idx").on(t.businessId, t.status),
  ],
);
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

export const assets = pgTable(
  "assets",
  {
    id: id(),
    businessId: businessId(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ASSET_KINDS }).notNull(),
    title: text("title").notNull().default(""),
    contentRef: text("content_ref"),
    approvalState: text("approval_state", { enum: APPROVAL_STATES }).notNull().default("draft"),
    authoredByAgentId: uuid("authored_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("assets_business_id_idx").on(t.businessId),
    index("assets_campaign_id_idx").on(t.campaignId),
    index("assets_approval_state_idx").on(t.businessId, t.approvalState),
    index("assets_authored_by_agent_id_idx").on(t.authoredByAgentId),
  ],
);
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export const channelMetrics = pgTable(
  "channel_metrics",
  {
    id: id(),
    businessId: businessId(),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    day: date("day", { mode: "string" }).notNull(),
    spendMinor: minor("spend_minor").notNull().default(0),
    currency: currency(),
    impressions: minor("impressions").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    signups: integer("signups").notNull().default(0),
    activations: integer("activations").notNull().default(0),
    customers: integer("customers").notNull().default(0),
    cpaMinor: minor("cpa_minor"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("channel_metrics_channel_id_campaign_id_day_key").on(t.channelId, t.campaignId, t.day),
    index("channel_metrics_business_id_idx").on(t.businessId, t.day),
    index("channel_metrics_campaign_id_idx").on(t.campaignId, t.day),
  ],
);
export type ChannelMetric = typeof channelMetrics.$inferSelect;
export type NewChannelMetric = typeof channelMetrics.$inferInsert;

export const suppressionList = pgTable(
  "suppression_list",
  {
    id: id(),
    businessId: businessIdNullable(),
    emailHash: text("email_hash"),
    addressHash: text("address_hash"),
    phoneHash: text("phone_hash"),
    reason: text("reason").notNull(),
    scope: text("scope", { enum: SUPPRESSION_SCOPES }).notNull().default("business"),
    source: text("source"),
    ...timestamps(),
  },
  (t) => [
    index("suppression_list_business_id_idx").on(t.businessId),
    index("suppression_list_email_hash_idx").on(t.emailHash),
    index("suppression_list_address_hash_idx").on(t.addressHash),
    index("suppression_list_phone_hash_idx").on(t.phoneHash),
  ],
);
export type SuppressionEntry = typeof suppressionList.$inferSelect;
export type NewSuppressionEntry = typeof suppressionList.$inferInsert;
