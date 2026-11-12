/** 0002 — founder profiles, businesses, ideas (+ the businessId() helper every business-scoped table uses); 0022 — account preferences; 0025 — the business currency. */
import { AGENT_STOP_REASONS, AGENT_STYLES, ARCHETYPES, AUTOPILOT_CADENCES, AUTOPILOT_PAUSE_REASONS, BUSINESS_MODES, DATA_REGIONS, DATE_FORMAT_PREFERENCES, DEVICE_PLATFORMS, GAME_MODES, GUIDANCE_MODES, MODEL_BILLING, PERSON_LOOKING_FOR, PLAN_TIERS, PUSH_PROVIDERS, TEXT_SIZES, TIME_FORMAT_PREFERENCES, VISIBILITY, type EmailNotificationPrefs, type NotificationPrefs } from "@foundmill/shared";
import { VIA_KINDS } from "@foundmill/shared/via";
import { sql } from "drizzle-orm";
import { boolean, char, index, integer, jsonb, numeric, pgTable, pgView, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
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
    /**
     * 0080 — the person's own public profile at /u/<handle> (docs/THESIS_REVIEW.md package 2.3): the address, what the
     * person writes for it, "What are you here for?" (`on_my_own` by default, a complete answer) and the switch. Public
     * only while `public` is true; only the api (service role) makes it public or changes a public one (trigger
     * `fm_founder_profiles_public_guard`). Anyone reads it through `public_person_profiles` and nothing else.
     */
    handle: text("handle"),
    headline: text("headline").notNull().default(""),
    about: text("about").notNull().default(""),
    strengths: text("strengths").array().notNull().default(emptyArray),
    wantsToLearn: text("wants_to_learn").array().notNull().default(emptyArray),
    lookingFor: text("looking_for", { enum: PERSON_LOOKING_FOR }).notNull().default("on_my_own"),
    place: text("place").notNull().default(""),
    public: boolean("public").notNull().default(false),
    /** When the profile last went public (kept after it is taken down). */
    publishedAt: tstz("published_at"),
    ...timestampsWithArchive(),
  },
  (t) => [uniqueIndex("founder_profiles_handle_key").on(t.handle)],
);
export type FounderProfile = typeof founderProfiles.$inferSelect;
export type NewFounderProfile = typeof founderProfiles.$inferInsert;

/**
 * 0080 — a handle a person left (renamed or cleared), kept for them for 90 days (`PERSON_HANDLE_HOLD_DAYS`): another
 * account cannot take it in that time (trigger `fm_founder_profiles_handle_hold`, and `repos.personProfiles.handleTaken`).
 * Written by the database's triggers on `founder_profiles`; service role only, no client role reads or writes it.
 */
export const personHandleReleases = pgTable(
  "person_handle_releases",
  {
    id: id(),
    handle: text("handle").notNull().unique(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    releasedAt: tstz("released_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index("person_handle_releases_user_id_idx").on(t.userId)],
);
export type PersonHandleRelease = typeof personHandleReleases.$inferSelect;

/** One project page a public person profile lists (`public_person_profiles.projects`). */
export interface PublicPersonProject {
  slug: string;
  name: string;
  pitch: string;
}

/**
 * 0080 — what anyone may read of a person's public profile, signed in or not, through the api (granted to service_role
 * only: the api serves it one handle at a time, rate-limited). Exactly these columns: nothing else of the account leaves
 * through it. Rows only while the profile is public and not archived. `projects`
 * lists the person's published project pages, only where they are an owner and the page names its founders.
 */
export const publicPersonProfiles = pgView("public_person_profiles", {
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  headline: text("headline").notNull(),
  about: text("about").notNull(),
  strengths: text("strengths").array().notNull(),
  wantsToLearn: text("wants_to_learn").array().notNull(),
  lookingFor: text("looking_for", { enum: PERSON_LOOKING_FOR }).notNull(),
  place: text("place").notNull(),
  publishedAt: tstz("published_at").notNull(),
  projects: jsonb("projects").$type<PublicPersonProject[]>().notNull(),
}).existing();
export type PublicPersonProfile = typeof publicPersonProfiles.$inferSelect;

/** The columns `public_person_profiles` exposes, in order (the view's test compares the catalog with this list). */
export const PUBLIC_PERSON_PROFILE_COLUMNS = ["handle", "display_name", "headline", "about", "strengths", "wants_to_learn", "looking_for", "place", "published_at", "projects"] as const;

/**
 * 0064 — the guided layer's one switch and the account's type size (docs/UX_AUDIT_AND_PLAN.md §6.3). The tuples live
 * beside DATE_FORMAT_PREFERENCES in @foundmill/shared (constants.ts) so the API's input schema, the design system and
 * this column cannot drift; they are re-exported here for the repos and the migrations that read the schema.
 */
export { GUIDANCE_MODES, TEXT_SIZES } from "@foundmill/shared";
export type { GuidanceMode, TextSize } from "@foundmill/shared";
/** Screen or tour ids remembered as done (`{ "home": true }`); the value is always true, a key is removed by a reset. */
export type SeenMap = Record<string, true>;

/**
 * 0022 — one row per signed-in account: how that person reads dates and times, in every business. Beside
 * founder_profiles (not on it) so a preference never creates a profile (the onboarding gate); no row reads the defaults.
 * 0064 adds the guided layer's preferences: the guidance switch, the text size, the explainers seen, the tours done
 * and when the first-week checklist was dismissed (null: showing). 0067 adds `anthropomorphic_agents`: agents show a
 * persona's first name and AI-generated face (off: exactly as before). 0069 adds `agent_style`: which character style
 * the faces and names are drawn in when the switch is on (humans by default; off ignores it). 0073 adds `builder_view`:
 * show how the platform runs the team (cycle numbers, tokens, technical tabs and columns); off by default.
 */
export const accountPreferences = pgTable("account_preferences", {
  id: id(),
  userId: uuid("user_id").notNull().unique().references(() => authUsers.id, { onDelete: "cascade" }),
  dateFormat: text("date_format", { enum: DATE_FORMAT_PREFERENCES }).notNull().default("us"),
  timeFormat: text("time_format", { enum: TIME_FORMAT_PREFERENCES }).notNull().default("12h"),
  guidance: text("guidance", { enum: GUIDANCE_MODES }).notNull().default("on"),
  textSize: text("text_size", { enum: TEXT_SIZES }).notNull().default("standard"),
  explainersSeen: jsonb("explainers_seen").$type<SeenMap>().notNull().default(emptyObject),
  toursDone: jsonb("tours_done").$type<SeenMap>().notNull().default(emptyObject),
  checklistDismissedAt: tstz("checklist_dismissed_at"),
  anthropomorphicAgents: boolean("anthropomorphic_agents").notNull().default(false),
  agentStyle: text("agent_style", { enum: AGENT_STYLES }).notNull().default("humans"),
  /**
   * 0075 — which kinds of push the person's phones get (`{ customer: false }`; an absent kind is on); and, under `email`,
   * which kinds of email Foundmill sends them (`{ email: { decision_waiting: false } }`; an absent kind is on).
   */
  notifications: jsonb("notifications").$type<Partial<NotificationPrefs> & { email?: Partial<EmailNotificationPrefs> }>().notNull().default(emptyObject),
  /** 0075 — keep money amounts out of lock-screen notifications. */
  hideAmountsOnLockScreen: boolean("hide_amounts_on_lock_screen").notNull().default(false),
  builderView: boolean("builder_view").notNull().default(false),
  ...timestamps(),
});
export type AccountPreferences = typeof accountPreferences.$inferSelect;
export type NewAccountPreferences = typeof accountPreferences.$inferInsert;

/**
 * 0073 — the phones a signed-in person registered for push from the mobile companion app (docs/mobile): one row per
 * provider subscription id, owned by the account that signed in on that phone last. Account-scoped like
 * account_preferences; each person reads, writes and deletes only their own rows, the service role reads them all to
 * send.
 */
export const founderDevices = pgTable(
  "founder_devices",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: DEVICE_PLATFORMS }).notNull(),
    provider: text("provider", { enum: PUSH_PROVIDERS }).notNull().default("onesignal"),
    token: text("token").notNull().unique(),
    appVersion: text("app_version").notNull().default(""),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index("founder_devices_user_id_idx").on(t.userId, t.lastSeenAt)],
);
export type FounderDevice = typeof founderDevices.$inferSelect;
export type NewFounderDevice = typeof founderDevices.$inferInsert;

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
     * The founder's "Spend cap per action" (Commit, Settings › What the team can do; 0024), in minor units of the business currency.
     * Above it every spend asks first, whatever the mode: the gateway lowers each agent's approval threshold to it.
     * Null: no business cap (each agent's own threshold applies).
     */
    spendCapMinor: minor("spend_cap_minor"),
    /**
     * 0059 — the monthly model budget (BUILD §10.4), in US cents like wages and credits: what the team's metered work may
     * cost in a calendar month whoever pays the model (credits or the business's own key). Dispatch refuses new sessions
     * once the month's cost reaches it and a running session is handed only what is left. Null: no budget.
     */
    modelBudgetMinor: minor("model_budget_minor"),
    glossary: jsonb("glossary").$type<Record<string, string>>().notNull().default(emptyObject),
    /**
     * 0025 — the currency of the business's money (ISO 4217): set at commit from the founder's choice, changed in
     * Settings › Business. Business amounts written without a currency take it; model and credit costs stay in USD.
     */
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    /**
     * 0023 — the team-wide stop (Stop all agents, a revoked key, used-up credits): set with its reason, cleared only by
     * `resumeBusinessAgents`. Every path that starts work refuses while it is set.
     */
    agentsStoppedAt: tstz("agents_stopped_at"),
    agentsStoppedReason: text("agents_stopped_reason", { enum: AGENT_STOP_REASONS }),
    /**
     * 0041 — the business's IANA time zone: Home's "today", week and month, the Journey's days and the top bar's date
     * follow it. Null until an owner or admin first opens the business (set from their browser) or picks one; null reads
     * as UTC.
     */
    timeZone: text("time_zone"),
    /**
     * 0044 — a seeded demo business (Northwind, Ledgerly): its numbers are synthetic, so it is never listed on the
     * network (public views, community owners) for anyone outside it. Set by the seed only.
     */
    isDemo: boolean("is_demo").notNull().default(false),
    /**
     * 0055 — Autopilot: the business starts its own cycles (`autopilot` workflow, id `autopilot:<businessId>`). Off by
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
    /**
     * 0062 — when the founder started distribution (Distribution › Board › Start distribution, or the "Ready to start
     * selling?" note). Null until then: no channel engine starts, the cycle planner defers channel tasks and the Board
     * reads "Waiting for the product". Businesses committed before sign-offs existed carry their commit time.
     */
    distributionStartedAt: tstz("distribution_started_at"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("businesses_game_mode_idx").on(t.gameMode).where(sql`${t.archivedAt} is null`),
    index("businesses_created_by_idx").on(t.createdBy),
  ],
);
export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;

/**
 * 0086 — who or what brought a new person (docs/NETWORK.md §5, §11): the first `?via=` reference a visitor arrived
 * with, recorded once when their founder profile is first created (apps/api services/attribution.ts). One row per
 * account, ever. Account-scoped, no `business_id`: `sourceBusinessId` is the project whose page brought them (null for a
 * person's profile) and `referrerUserId` the person credited. Service role only: no client role reads or writes it,
 * not even the person's own row.
 */
export const attributions = pgTable(
  "attributions",
  {
    id: id(),
    userId: uuid("user_id").notNull().unique("attributions_user_id_key").references(() => authUsers.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind", { enum: VIA_KINDS }).notNull(),
    /** The slug or handle as it arrived. */
    sourceRef: text("source_ref").notNull(),
    sourceBusinessId: uuid("source_business_id").references(() => businesses.id, { onDelete: "set null" }),
    referrerUserId: uuid("referrer_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("attributions_source_business_id_idx").on(t.sourceBusinessId), index("attributions_referrer_user_id_idx").on(t.referrerUserId)],
);
export type Attribution = typeof attributions.$inferSelect;
export type NewAttribution = typeof attributions.$inferInsert;

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
