/** 0007 — customer journey: visitors, touches, conversions, journeys, journey_daily, milestones. */
import { CHANNEL_KEYS, CONVERSION_KINDS, MATCHDAY_LEVELS, MILESTONE_KINDS, VISIBILITY } from "@founder-manager/shared";
import { bigint, date, index, integer, jsonb, numeric, pgMaterializedView, pgTable, pgView, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { currency, emptyArray, emptyList, emptyObject, id, minor, timestamps, timestampsWithArchive, tstz } from "./_common";
import { businessId } from "./_refs";
import { entities } from "./crm";
import { campaigns } from "./distribution";
import { events } from "./governance";

export const CONSENT_STATES = ["unknown", "granted", "denied", "withdrawn"] as const;

export const visitors = pgTable(
  "visitors",
  {
    id: id(),
    businessId: businessId(),
    anonId: text("anon_id").notNull(),
    entityId: uuid("entity_id").references((): AnyPgColumn => entities.id, { onDelete: "set null" }),
    firstSeen: tstz("first_seen").notNull().defaultNow(),
    lastSeen: tstz("last_seen").notNull().defaultNow(),
    consentState: text("consent_state", { enum: CONSENT_STATES }).notNull().default("unknown"),
    ...timestamps(),
  },
  (t) => [index("visitors_business_id_idx").on(t.businessId), index("visitors_entity_id_idx").on(t.entityId)],
);
export type Visitor = typeof visitors.$inferSelect;
export type NewVisitor = typeof visitors.$inferInsert;

export const touches = pgTable(
  "touches",
  {
    id: id(),
    businessId: businessId(),
    visitorId: uuid("visitor_id").references(() => visitors.id, { onDelete: "set null" }),
    entityId: uuid("entity_id").references((): AnyPgColumn => entities.id, { onDelete: "set null" }),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    channelKey: text("channel_key", { enum: CHANNEL_KEYS }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default(emptyObject),
    kind: text("kind").notNull().default("visit"),
    ...timestamps(),
  },
  (t) => [
    index("touches_business_id_idx").on(t.businessId, t.occurredAt),
    index("touches_visitor_id_idx").on(t.visitorId, t.occurredAt),
    index("touches_entity_id_idx").on(t.entityId, t.occurredAt),
    index("touches_campaign_id_idx").on(t.campaignId),
    index("touches_channel_key_idx").on(t.businessId, t.channelKey),
  ],
);
export type Touch = typeof touches.$inferSelect;
export type NewTouch = typeof touches.$inferInsert;

export const conversions = pgTable(
  "conversions",
  {
    id: id(),
    businessId: businessId(),
    entityId: uuid("entity_id").references((): AnyPgColumn => entities.id, { onDelete: "set null" }),
    kind: text("kind", { enum: CONVERSION_KINDS }).notNull(),
    amountMinor: minor("amount_minor").notNull().default(0),
    currency: currency(),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    sourceEventId: uuid("source_event_id").references((): AnyPgColumn => events.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("conversions_business_id_idx").on(t.businessId, t.occurredAt),
    index("conversions_entity_id_idx").on(t.entityId),
    index("conversions_kind_idx").on(t.businessId, t.kind, t.occurredAt),
    index("conversions_source_event_id_idx").on(t.sourceEventId),
  ],
);
export type Conversion = typeof conversions.$inferSelect;
export type NewConversion = typeof conversions.$inferInsert;

export const journeys = pgTable(
  "journeys",
  {
    id: id(),
    businessId: businessId(),
    conversionId: uuid("conversion_id").notNull().unique().references(() => conversions.id, { onDelete: "cascade" }),
    touchIds: uuid("touch_ids").array().notNull().default(emptyArray),
    weights: jsonb("weights").$type<Record<string, number>>().notNull().default(emptyObject),
    xcSeries: jsonb("xc_series").$type<unknown[]>().notNull().default(emptyList),
    commentary: jsonb("commentary").$type<unknown[]>().notNull().default(emptyList),
    agents: jsonb("agents").$type<unknown[]>().notNull().default(emptyList),
    matchdayLevel: text("matchday_level", { enum: MATCHDAY_LEVELS }).notNull(),
    viewedAt: tstz("viewed_at"),
    ...timestamps(),
  },
  (t) => [index("journeys_business_id_idx").on(t.businessId, t.createdAt), index("journeys_matchday_level_idx").on(t.businessId, t.matchdayLevel)],
);
export type Journey = typeof journeys.$inferSelect;
export type NewJourney = typeof journeys.$inferInsert;

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    businessId: businessId(),
    kind: text("kind", { enum: MILESTONE_KINDS }).notNull(),
    label: text("label").notNull(),
    achievedAt: tstz("achieved_at").notNull().defaultNow(),
    ref: jsonb("ref").$type<Record<string, unknown>>(),
    visibility: text("visibility", { enum: VISIBILITY }).notNull().default("private"),
    ...timestampsWithArchive(),
  },
  (t) => [index("milestones_business_id_idx").on(t.businessId, t.achievedAt)],
);
export type Milestone = typeof milestones.$inferSelect;
export type NewMilestone = typeof milestones.$inferInsert;

const journeyDailyColumns = {
  businessId: uuid("business_id").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  /** Nil uuid (00000000-…) means "no department". */
  departmentId: uuid("department_id").notNull(),
  agentHours: numeric("agent_hours", { precision: 12, scale: 3 }).notNull(),
  tasksDone: integer("tasks_done").notNull(),
  spendMinor: bigint("spend_minor", { mode: "number" }).notNull(),
  revenueMinor: bigint("revenue_minor", { mode: "number" }).notNull(),
  signups: integer("signups").notNull(),
  activations: integer("activations").notNull(),
  payments: integer("payments").notNull(),
  decisions: integer("decisions").notNull(),
};

/** The materialised aggregate (service_role only; refreshed by refresh_journey_daily()). */
export const journeyDailyMv = pgMaterializedView("journey_daily_mv", journeyDailyColumns).existing();
/** The RLS-filtered view app roles read (security_barrier over the matview). */
export const journeyDaily = pgView("journey_daily", journeyDailyColumns).existing();
export type JourneyDailyRow = typeof journeyDaily.$inferSelect;
