/** 0004 — agents, versions, skills, training, departments, screens, dashboards, tasks, playbooks, holidays. */
import {
  AGENT_LAYERS, AGENT_PAUSE_REASONS, AGENT_STATUSES, AGENT_VERSION_STATES, DEPT_COLOUR_TOKENS, MODEL_KEYS, SKILL_GROUPS, TASK_KINDS, TASK_PHASES, TASK_STATUSES,
} from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { businessCurrency, emptyArray, emptyList, emptyObject, id, minor, timestamps, timestampsWithArchive, tstz, usdCurrency } from "./_common";
import { businessId, businessIdNullable } from "./_refs";
import { inboxItems, planActions } from "./inbox";
import { roadmapItems } from "./product";

export const CREATED_BY_KINDS = ["user", "agent", "system"] as const;
export const MEMBER_KINDS = ["agent", "human"] as const;
export const TRAINING_STATUSES = ["queued", "running", "grading", "awaiting_decision", "done", "failed", "cancelled"] as const;
export const TRAINING_DECISIONS = ["promoted", "discarded"] as const;

export const agents = pgTable(
  "agents",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    role: text("role").notNull().default(""),
    agentType: text("agent_type").notNull(),
    layer: text("layer", { enum: AGENT_LAYERS }).notNull().default("worker"),
    descriptionMd: text("description_md").notNull().default(""),
    departmentIds: uuid("department_ids").array().notNull().default(emptyArray),
    lineManagerId: uuid("line_manager_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    modelKey: text("model_key", { enum: MODEL_KEYS }).notNull().default("sonnet"),
    status: text("status", { enum: AGENT_STATUSES }).notNull().default("idle"),
    /** 0023 — why a paused agent is paused (null: by hand or before 0023); a trigger drops it when the agent leaves `paused`. */
    pausedReason: text("paused_reason", { enum: AGENT_PAUSE_REASONS }),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => agentVersions.id, { onDelete: "set null" }),
    autonomy: jsonb("autonomy").$type<Record<string, unknown>>().notNull().default(emptyObject),
    negotiation: jsonb("negotiation").$type<Record<string, unknown>>().notNull().default(emptyObject),
    schedule: jsonb("schedule").$type<Record<string, unknown>>().notNull().default(emptyObject),
    wageCapMinor: minor("wage_cap_minor"),
    /** The wage cap caps metered model cost: US dollars (0024, 0025), never the business's currency. */
    currency: usdCurrency(),
    avatarSeed: text("avatar_seed").notNull().default(""),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("agents_business_id_idx").on(t.businessId),
    index("agents_status_idx").on(t.businessId, t.status),
    index("agents_line_manager_id_idx").on(t.lineManagerId),
    index("agents_current_version_id_idx").on(t.currentVersionId),
  ],
);
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: id(),
    businessId: businessId(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    instructions: jsonb("instructions").$type<Record<string, unknown>>().notNull().default(emptyObject),
    tools: jsonb("tools").$type<unknown[]>().notNull().default(emptyList),
    modelKey: text("model_key", { enum: MODEL_KEYS }).notNull().default("sonnet"),
    state: text("state", { enum: AGENT_VERSION_STATES }).notNull().default("draft"),
    createdByKind: text("created_by_kind", { enum: CREATED_BY_KINDS }).notNull().default("user"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("agent_versions_agent_id_version_key").on(t.agentId, t.version),
    index("agent_versions_business_id_idx").on(t.businessId),
    index("agent_versions_agent_id_idx").on(t.agentId, t.state),
  ],
);
export type AgentVersion = typeof agentVersions.$inferSelect;
export type NewAgentVersion = typeof agentVersions.$inferInsert;

export const departments = pgTable(
  "departments",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    icon: text("icon").notNull().default("folder"),
    colourToken: text("colour_token", { enum: DEPT_COLOUR_TOKENS }).notNull().default("dept-1"),
    position: integer("position").notNull().default(0),
    leadAgentId: uuid("lead_agent_id").references(() => agents.id, { onDelete: "set null" }),
    moduleKeys: text("module_keys").array().notNull().default(emptyArray),
    budgetMinor: minor("budget_minor"),
    currency: businessCurrency(),
    approvers: jsonb("approvers").$type<unknown[]>().notNull().default(emptyList),
    hidden: boolean("hidden").notNull().default(false),
    ...timestampsWithArchive(),
  },
  (t) => [
    uniqueIndex("departments_business_id_slug_key").on(t.businessId, t.slug),
    index("departments_business_id_idx").on(t.businessId, t.position),
    index("departments_lead_agent_id_idx").on(t.leadAgentId),
  ],
);
export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;

export const departmentMembers = pgTable(
  "department_members",
  {
    id: id(),
    businessId: businessId(),
    departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
    memberKind: text("member_kind", { enum: MEMBER_KINDS }).notNull(),
    memberId: uuid("member_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("department_members_department_id_member_kind_member_id_key").on(t.departmentId, t.memberKind, t.memberId),
    index("department_members_business_id_idx").on(t.businessId),
    index("department_members_department_id_idx").on(t.departmentId),
    index("department_members_member_id_idx").on(t.memberId),
  ],
);
export type DepartmentMember = typeof departmentMembers.$inferSelect;
export type NewDepartmentMember = typeof departmentMembers.$inferInsert;

export const screenDefinitions = pgTable(
  "screen_definitions",
  {
    id: id(),
    businessId: businessId(),
    departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
    tabSlug: text("tab_slug").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    layout: jsonb("layout").$type<{ widgets: unknown[] }>().notNull().default(sql`'{"widgets":[]}'::jsonb`),
    version: integer("version").notNull().default(1),
    ...timestampsWithArchive(),
  },
  (t) => [
    uniqueIndex("screen_definitions_department_id_tab_slug_key").on(t.departmentId, t.tabSlug),
    index("screen_definitions_business_id_idx").on(t.businessId),
    index("screen_definitions_department_id_idx").on(t.departmentId, t.position),
  ],
);
export type ScreenDefinition = typeof screenDefinitions.$inferSelect;
export type NewScreenDefinition = typeof screenDefinitions.$inferInsert;

export const dashboardLayouts = pgTable(
  "dashboard_layouts",
  {
    id: id(),
    businessId: businessId(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Home"),
    preset: text("preset"),
    layout: jsonb("layout").$type<{ widgets: unknown[] }>().notNull().default(sql`'{"widgets":[]}'::jsonb`),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    ...timestampsWithArchive(),
  },
  (t) => [index("dashboard_layouts_business_id_idx").on(t.businessId), index("dashboard_layouts_user_id_idx").on(t.userId, t.businessId)],
);
export type DashboardLayout = typeof dashboardLayouts.$inferSelect;
export type NewDashboardLayout = typeof dashboardLayouts.$inferInsert;

export const skillDefinitions = pgTable(
  "skill_definitions",
  {
    id: id(),
    businessId: businessIdNullable(),
    agentType: text("agent_type").notNull(),
    skillKey: text("skill_key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    group: text("group", { enum: SKILL_GROUPS }).notNull(),
    custom: boolean("custom").notNull().default(false),
    ...timestampsWithArchive(),
  },
  (t) => [
    uniqueIndex("skill_definitions_platform_key_idx").on(t.agentType, t.skillKey).where(sql`${t.businessId} is null`),
    uniqueIndex("skill_definitions_business_key_idx").on(t.businessId, t.agentType, t.skillKey).where(sql`${t.businessId} is not null`),
    index("skill_definitions_business_id_idx").on(t.businessId),
  ],
);
export type SkillDefinition = typeof skillDefinitions.$inferSelect;
export type NewSkillDefinition = typeof skillDefinitions.$inferInsert;

export const skillTests = pgTable(
  "skill_tests",
  {
    id: id(),
    businessId: businessIdNullable(),
    skillDefinitionId: uuid("skill_definition_id").notNull().references(() => skillDefinitions.id, { onDelete: "cascade" }),
    task: jsonb("task").$type<Record<string, unknown>>().notNull().default(emptyObject),
    rubric: jsonb("rubric").$type<Record<string, unknown>>().notNull().default(emptyObject),
    heldOut: boolean("held_out").notNull().default(false),
    fixturesRef: text("fixtures_ref"),
    ...timestampsWithArchive(),
  },
  (t) => [index("skill_tests_skill_definition_id_idx").on(t.skillDefinitionId), index("skill_tests_business_id_idx").on(t.businessId)],
);
export type SkillTest = typeof skillTests.$inferSelect;
export type NewSkillTest = typeof skillTests.$inferInsert;

export const agentSkills = pgTable(
  "agent_skills",
  {
    id: id(),
    businessId: businessId(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    skillKey: text("skill_key").notNull(),
    group: text("group", { enum: SKILL_GROUPS }).notNull(),
    tested: numeric("tested", { precision: 6, scale: 3 }),
    proven: numeric("proven", { precision: 6, scale: 3 }),
    nLive: integer("n_live").notNull().default(0),
    displayed: integer("displayed").notNull().default(1),
    potential: integer("potential").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("agent_skills_agent_id_skill_key_key").on(t.agentId, t.skillKey),
    index("agent_skills_business_id_idx").on(t.businessId),
    index("agent_skills_agent_id_idx").on(t.agentId),
  ],
);
export type AgentSkill = typeof agentSkills.$inferSelect;
export type NewAgentSkill = typeof agentSkills.$inferInsert;

export const trainingRuns = pgTable(
  "training_runs",
  {
    id: id(),
    businessId: businessId(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    fromVersionId: uuid("from_version_id").references(() => agentVersions.id, { onDelete: "set null" }),
    toVersionId: uuid("to_version_id").references(() => agentVersions.id, { onDelete: "set null" }),
    status: text("status", { enum: TRAINING_STATUSES }).notNull().default("queued"),
    costMinor: minor("cost_minor").notNull().default(0),
    /** A training run's model cost: US cents (0024), the model price list's currency. */
    currency: usdCurrency(),
    results: jsonb("results").$type<Record<string, { old: number; new: number }>>().notNull().default(emptyObject),
    coachSummaryMd: text("coach_summary_md").notNull().default(""),
    decision: text("decision", { enum: TRAINING_DECISIONS }),
    watchUntil: tstz("watch_until"),
    requestedBy: uuid("requested_by"),
    startedAt: tstz("started_at"),
    endedAt: tstz("ended_at"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("training_runs_business_id_idx").on(t.businessId),
    index("training_runs_agent_id_idx").on(t.agentId, t.status),
    index("training_runs_from_version_id_idx").on(t.fromVersionId),
    index("training_runs_to_version_id_idx").on(t.toVersionId),
  ],
);
export type TrainingRun = typeof trainingRuns.$inferSelect;
export type NewTrainingRun = typeof trainingRuns.$inferInsert;

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    businessId: businessId(),
    kind: text("kind", { enum: TASK_KINDS }).notNull(),
    title: text("title").notNull(),
    goalMd: text("goal_md").notNull().default(""),
    acceptance: jsonb("acceptance").$type<unknown[]>().notNull().default(emptyList),
    fileScope: text("file_scope").array().notNull().default(emptyArray),
    roadmapItemId: uuid("roadmap_item_id").references((): AnyPgColumn => roadmapItems.id, { onDelete: "set null" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    planActionId: uuid("plan_action_id").references((): AnyPgColumn => planActions.id, { onDelete: "set null" }),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("planned"),
    progress: numeric("progress", { precision: 5, scale: 4 }).notNull().default("0"),
    phase: text("phase", { enum: TASK_PHASES }),
    eta: tstz("eta"),
    priority: integer("priority").notNull().default(0),
    budgetMinor: minor("budget_minor"),
    currency: businessCurrency(),
    startedAt: tstz("started_at"),
    endedAt: tstz("ended_at"),
    /** When an owner or admin forgot the task's saved code (0013); sessions that started earlier cannot save it again. */
    codeForgottenAt: tstz("code_forgotten_at"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("tasks_business_id_idx").on(t.businessId),
    index("tasks_status_idx").on(t.businessId, t.status),
    index("tasks_assignee_agent_id_idx").on(t.assigneeAgentId),
    index("tasks_roadmap_item_id_idx").on(t.roadmapItemId),
    index("tasks_department_id_idx").on(t.departmentId),
    index("tasks_plan_action_id_idx").on(t.planActionId),
  ],
);
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export const taskEdges = pgTable(
  "task_edges",
  {
    id: id(),
    businessId: businessId(),
    fromTask: uuid("from_task").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    toTask: uuid("to_task").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("task_edges_from_task_to_task_key").on(t.fromTask, t.toTask),
    index("task_edges_business_id_idx").on(t.businessId),
    index("task_edges_to_task_idx").on(t.toTask),
  ],
);
export type TaskEdge = typeof taskEdges.$inferSelect;
export type NewTaskEdge = typeof taskEdges.$inferInsert;

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: id(),
    businessId: businessId(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => agentVersions.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    workflowId: text("workflow_id"),
    modelKey: text("model_key", { enum: MODEL_KEYS }).notNull().default("sonnet"),
    startedAt: tstz("started_at").notNull().defaultNow(),
    endedAt: tstz("ended_at"),
    tokensIn: minor("tokens_in").notNull().default(0),
    tokensOut: minor("tokens_out").notNull().default(0),
    costMinor: minor("cost_minor").notNull().default(0),
    /** The session's model cost: US cents (0024), the model price list's currency. */
    currency: usdCurrency(),
    outcome: text("outcome"),
    recordingRef: text("recording_ref"),
    ...timestamps(),
  },
  (t) => [
    index("agent_sessions_business_id_idx").on(t.businessId, t.startedAt),
    index("agent_sessions_agent_id_idx").on(t.agentId, t.startedAt),
    index("agent_sessions_task_id_idx").on(t.taskId),
    index("agent_sessions_version_id_idx").on(t.versionId),
    index("agent_sessions_workflow_id_idx").on(t.workflowId),
  ],
);
export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;

export const agentMetrics = pgTable(
  "agent_metrics",
  {
    id: id(),
    businessId: businessId(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    tasksDone: integer("tasks_done").notNull().default(0),
    successRate: numeric("success_rate", { precision: 5, scale: 4 }),
    reviewFindings: integer("review_findings").notNull().default(0),
    approvalsRejected: integer("approvals_rejected").notNull().default(0),
    ratingAvg: numeric("rating_avg", { precision: 4, scale: 2 }),
    costMinor: minor("cost_minor").notNull().default(0),
    /** Rolled up from the day's sessions: US cents (0024). */
    currency: usdCurrency(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("agent_metrics_agent_id_day_key").on(t.agentId, t.day), index("agent_metrics_business_id_idx").on(t.businessId, t.day)],
);
export type AgentMetric = typeof agentMetrics.$inferSelect;
export type NewAgentMetric = typeof agentMetrics.$inferInsert;

export const playbooks = pgTable(
  "playbooks",
  {
    id: id(),
    businessId: businessId(),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    name: text("name").notNull().default(""),
    sourceText: text("source_text").notNull(),
    compiled: jsonb("compiled").$type<Record<string, unknown>>().notNull().default(emptyObject),
    enabled: boolean("enabled").notNull().default(false),
    lastRunAt: tstz("last_run_at"),
    createdBy: uuid("created_by"),
    ...timestampsWithArchive(),
  },
  (t) => [index("playbooks_business_id_idx").on(t.businessId), index("playbooks_department_id_idx").on(t.departmentId)],
);
export type Playbook = typeof playbooks.$inferSelect;
export type NewPlaybook = typeof playbooks.$inferInsert;

export const holidayPeriods = pgTable(
  "holiday_periods",
  {
    id: id(),
    businessId: businessId(),
    untilAt: tstz("until_at"),
    untilCondition: jsonb("until_condition").$type<Record<string, unknown>>(),
    authority: jsonb("authority").$type<Record<string, unknown>>().notNull().default(emptyObject),
    budgetCeilingMinor: minor("budget_ceiling_minor"),
    currency: businessCurrency(),
    wakeEvents: text("wake_events").array().notNull().default(emptyArray),
    startedAt: tstz("started_at"),
    endedAt: tstz("ended_at"),
    reportInboxItemId: uuid("report_inbox_item_id").references((): AnyPgColumn => inboxItems.id, { onDelete: "set null" }),
    startedBy: uuid("started_by"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("holiday_periods_business_id_idx").on(t.businessId, t.startedAt),
    index("holiday_periods_report_inbox_item_id_idx").on(t.reportInboxItemId),
    // 0036: at most one running vacation per business.
    uniqueIndex("holiday_periods_one_running_idx").on(t.businessId).where(sql`started_at is not null and ended_at is null and archived_at is null`),
  ],
);
export type HolidayPeriod = typeof holidayPeriods.$inferSelect;
export type NewHolidayPeriod = typeof holidayPeriods.$inferInsert;
