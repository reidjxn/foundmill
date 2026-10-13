/** 0002 — founder profiles, businesses, ideas (+ the businessId() helper every business-scoped table uses); 0022 — account preferences. */
import { AGENT_STOP_REASONS, ARCHETYPES, AUTOPILOT_CADENCES, AUTOPILOT_PAUSE_REASONS, BUSINESS_MODES, DATA_REGIONS, DATE_FORMAT_PREFERENCES, GAME_MODES, MODEL_BILLING, PLAN_TIERS, TIME_FORMAT_PREFERENCES, VISIBILITY } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { archivedAt, currency, emptyArray, emptyObject, id, minor, timestamps, timestampsWithArchive, tstz } from "./_common";

export const founderProfiles = pgTable(
  "founder_profiles",
  {
    id: id(),
    userId: uuid("user_id").notNull().unique().references(() => authUsers.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    experience: text("experience"),
    skills: jsonb("skills").$type<Record<string, number>>().notNull().default(emptyObject),
    timeCommitment: text("time_commitment"),
    budgetMinor: minor("budget_minor"),
    currency: currency(),
    citizenship: text("citizenship"),
    residence: text("residence"),
    targetMarkets: text("target_markets").array().notNull().default(emptyArray),
    constraints: text("constraints").array().notNull().default(emptyArray),
    riskAppetite: text("risk_appetite"),
    visibility: text("visibility", { enum: VISIBILITY }).notNull().default("private"),
    ...timestampsWithArchive(),
  },
);
export type FounderProfile = typeof founderProfiles.$inferSelect;
export type NewFounderProfile = typeof founderProfiles.$inferInsert;

/**
 * 0022 — one row per signed-in account: how that person reads dates and times, in every business. Beside
 * founder_profiles (not on it) so a preference never creates a profile (the onboarding gate); no row reads the defaults.
 */
export const accountPreferences = pgTable("account_preferences", {
  id: id(),
  userId: uuid("user_id").notNull().unique().references(() => authUsers.id, { onDelete: "cascade" }),
  dateFormat: text("date_format", { enum: DATE_FORMAT_PREFERENCES }).notNull().default("us"),
  timeFormat: text("time_format", { enum: TIME_FORMAT_PREFERENCES }).notNull().default("12h"),
  ...timestamps(),
});
export type AccountPreferences = typeof accountPreferences.$inferSelect;
export type NewAccountPreferences = typeof accountPreferences.$inferInsert;

export const businesses = pgTable(
  "businesses",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    gameMode: text("game_mode", { enum: GAME_MODES }).notNull().default("personal"),
    businessMode: text("business_mode", { enum: BUSINESS_MODES }).notNull().default("assisted"),
    archetype: text("archetype", { enum: ARCHETYPES }),
    kitPrimary: text("kit_primary").notNull().default("#1b4fd8"),
    kitSecondary: text("kit_secondary").notNull().default("#f5c400"),
    /** Retired (0017): always null (a check holds it empty); the logo lives in business_logos. */
    crestUrl: text("crest_url"),
    region: text("region", { enum: DATA_REGIONS }).notNull().default("eu"),
    committedAt: tstz("committed_at"),
    planTier: text("plan_tier", { enum: PLAN_TIERS }).notNull().default("free"),
    modelBilling: text("model_billing", { enum: MODEL_BILLING }).notNull().default("credits"),
    /**
     * The founder's "Spend cap per action" (Commit, Settings › Mode; 0024), in minor units of the business currency.
     * Above it every spend asks first, whatever the mode: the gateway lowers each agent's approval threshold to it.
     * Null: no business cap (each agent's own threshold applies).
     */
    spendCapMinor: minor("spend_cap_minor"),
    glossary: jsonb("glossary").$type<Record<string, string>>().notNull().default(emptyObject),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    /**
     * 0023 — the team-wide stop (Stop all agents, a revoked key, used-up credits): set with its reason, cleared only by
     * `resumeBusinessAgents`. Every path that starts work refuses while it is set.
     */
    agentsStoppedAt: tstz("agents_stopped_at"),
    agentsStoppedReason: text("agents_stopped_reason", { enum: AGENT_STOP_REASONS }),
    /**
     * 0041 — Autopilot: the business starts its own cycles (`autopilot` workflow, id `autopilot:<businessId>`). Off by
     * default. `autopilotPausedReason` is set when a guard rail paused it (stop, credits, idle cycles) and cleared only
     * when an owner or admin turns it on again; `autopilotChangedAt` is when it was last turned on (the idle streak
     * counts from there); `autopilotNextAt` is the next planned cycle (an Estimate, written by the workflow).
     */
    autopilotEnabled: boolean("autopilot_enabled").notNull().default(false),
    autopilotCadence: text("autopilot_cadence", { enum: AUTOPILOT_CADENCES }).notNull().default("every_4h"),
    autopilotDailyHour: integer("autopilot_daily_hour").notNull().default(9),
    autopilotMaxCyclesPerDay: integer("autopilot_max_cycles_per_day").notNull().default(6),
    /** USD cents of model spend per UTC day; null: the credits left. */
    autopilotSpendCeilingMinor: minor("autopilot_spend_ceiling_minor"),
    autopilotMaxIdleCycles: integer("autopilot_max_idle_cycles").notNull().default(3),
    autopilotPausedReason: text("autopilot_paused_reason", { enum: AUTOPILOT_PAUSE_REASONS }),
    autopilotChangedAt: tstz("autopilot_changed_at"),
    autopilotNextAt: tstz("autopilot_next_at"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("businesses_game_mode_idx").on(t.gameMode).where(sql`${t.archivedAt} is null`),
    index("businesses_created_by_idx").on(t.createdBy),
  ],
);
export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;

// Local (not ./_refs) to avoid an import cycle with this file; ideas carry a nullable business_id until commit.
const businessIdNullable = () => uuid("business_id").references(() => businesses.id, { onDelete: "cascade" });

export const ideas = pgTable(
  "ideas",
  {
    id: id(),
    businessId: businessIdNullable(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    pitch: text("pitch").notNull().default(""),
    archetype: text("archetype", { enum: ARCHETYPES }),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => ideaVersions.id, { onDelete: "set null" }),
    committedAt: tstz("committed_at"),
    ...timestampsWithArchive(),
  },
  (t) => [index("ideas_owner_user_id_idx").on(t.ownerUserId), index("ideas_business_id_idx").on(t.businessId), index("ideas_current_version_id_idx").on(t.currentVersionId)],
);
export type Idea = typeof ideas.$inferSelect;
export type NewIdea = typeof ideas.$inferInsert;

export const IDEA_ACTIONS = ["generated", "merged", "forked", "edited"] as const;

export const ideaVersions = pgTable(
  "idea_versions",
  {
    id: id(),
    ideaId: uuid("idea_id").notNull().references(() => ideas.id, { onDelete: "cascade" }),
    businessId: businessIdNullable(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    pitch: text("pitch").notNull().default(""),
    attributes: jsonb("attributes").$type<Record<string, { value: number; evidence?: string }>>().notNull().default(emptyObject),
    starsCurrent: numeric("stars_current", { precision: 3, scale: 1 }).notNull().default("0"),
    starsPotential: numeric("stars_potential", { precision: 3, scale: 1 }).notNull().default("0"),
    research: jsonb("research").$type<{ citations: unknown[] }>().notNull().default(sql`'{"citations":[]}'::jsonb`),
    parentVersionId: uuid("parent_version_id").references((): AnyPgColumn => ideaVersions.id, { onDelete: "set null" }),
    action: text("action", { enum: IDEA_ACTIONS }).notNull().default("generated"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idea_versions_idea_id_version_key").on(t.ideaId, t.version),
    index("idea_versions_idea_id_idx").on(t.ideaId),
    index("idea_versions_owner_user_id_idx").on(t.ownerUserId),
    index("idea_versions_business_id_idx").on(t.businessId),
    index("idea_versions_parent_version_id_idx").on(t.parentVersionId),
  ],
);
export type IdeaVersion = typeof ideaVersions.$inferSelect;
export type NewIdeaVersion = typeof ideaVersions.$inferInsert;

export const ideaComparisons = pgTable(
  "idea_comparisons",
  {
    id: id(),
    businessId: businessIdNullable(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    ideaVersionIds: uuid("idea_version_ids").array().notNull().default(emptyArray),
    verdictMd: text("verdict_md").notNull().default(""),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (t) => [index("idea_comparisons_owner_user_id_idx").on(t.ownerUserId), index("idea_comparisons_business_id_idx").on(t.businessId)],
);
export type IdeaComparison = typeof ideaComparisons.$inferSelect;
export type NewIdeaComparison = typeof ideaComparisons.$inferInsert;
