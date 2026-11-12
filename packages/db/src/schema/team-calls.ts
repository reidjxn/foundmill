/**
 * 0084 — Team call (docs/TEAM_CALL.md §2): a spoken call between the founder and their team (or one agent), its turns
 * in speaking order and the action items filed when it ends. Members read; owners, admins and members write (the agent
 * desk's model, 0020). Turns and actions are insert-only for app roles; on a call an app role changes only its status,
 * summary, counters, `ended_at` and `updated_at` (column grants). The SQL is the source of truth for checks and RLS.
 */
import { PLAN_ACTION_TYPES, TEAM_CALL_ACTION_STATUSES, TEAM_CALL_KINDS, TEAM_CALL_SPEAKERS, TEAM_CALL_STATUSES, TEAM_CALL_TARGET_KINDS, type TeamCallAddressee } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { id, timestamps, tstz } from "./_common";
import { businessId } from "./_refs";
import { agents, departments } from "./agents";
import { planActions, plans } from "./inbox";

/** How a founder turn arrived. */
export const TEAM_CALL_TURN_VIA = ["spoken", "typed"] as const;
export type TeamCallTurnVia = (typeof TEAM_CALL_TURN_VIA)[number];

export const teamCalls = pgTable(
  "team_calls",
  {
    id: id(),
    businessId: businessId(),
    kind: text("kind", { enum: TEAM_CALL_KINDS }).notNull(),
    status: text("status", { enum: TEAM_CALL_STATUSES }).notNull().default("live"),
    /** At most 200 characters; null when the founder named none. */
    topic: text("topic"),
    /** The agents on the call, 1 to 8 (exactly 1 for `one_to_one`), in tile order. */
    agentIds: uuid("agent_ids").array().notNull(),
    /** The person who started it; null once their account is gone. */
    startedBy: uuid("started_by").references(() => authUsers.id, { onDelete: "set null" }),
    startedAt: tstz("started_at").notNull().defaultNow(),
    endedAt: tstz("ended_at"),
    /** Plain text written when the call ends (at most 4,000 characters). */
    summary: text("summary"),
    /** Agent-only rounds since the founder last spoke ("Let the team discuss" stops at the limit). */
    agentRoundsSinceFounder: integer("agent_rounds_since_founder").notNull().default(0),
    turnCount: integer("turn_count").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique("team_calls_id_business_id_key").on(t.id, t.businessId),
    index("team_calls_business_started_idx").on(t.businessId, t.startedAt.desc()),
    index("team_calls_started_by_idx").on(t.startedBy),
  ],
);
export type TeamCall = typeof teamCalls.$inferSelect;
export type NewTeamCall = typeof teamCalls.$inferInsert;

export const teamCallTurns = pgTable(
  "team_call_turns",
  {
    id: id(),
    businessId: businessId(),
    callId: uuid("call_id").notNull(),
    /** 1, 2, 3… per call, assigned under the call's row lock (`repos.teamCalls.appendTurns`). */
    seq: integer("seq").notNull(),
    speaker: text("speaker", { enum: TEAM_CALL_SPEAKERS }).notNull(),
    /** The agent who spoke (agent turns); null once the agent is gone. */
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    /** The person who spoke (founder turns); null once their account is gone. */
    userId: uuid("user_id").references(() => authUsers.id, { onDelete: "set null" }),
    /** 1 to 2,000 characters; agent text may name teammates as `[[ent:<uuid>|Name]]`. */
    text: text("text").notNull(),
    /** `"founder"`, `"team"` or `{ "agentId": "<uuid>" }`, stored as the shared `TeamCallAddressee`. */
    addressedTo: jsonb("addressed_to").$type<TeamCallAddressee>(),
    via: text("via", { enum: TEAM_CALL_TURN_VIA }),
    /** The founder's client id for the send (at most 64 characters): a retry returns the turn already written. */
    clientTurnId: text("client_turn_id"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({ name: "team_call_turns_call_fkey", columns: [t.callId, t.businessId], foreignColumns: [teamCalls.id, teamCalls.businessId] }).onDelete("cascade"),
    unique("team_call_turns_seq_key").on(t.callId, t.seq),
    uniqueIndex("team_call_turns_client_turn_idx").on(t.callId, t.clientTurnId).where(sql`client_turn_id is not null`),
    index("team_call_turns_business_id_idx").on(t.businessId, t.createdAt.desc()),
    index("team_call_turns_agent_id_idx").on(t.agentId),
    index("team_call_turns_user_id_idx").on(t.userId),
  ],
);
export type TeamCallTurn = typeof teamCallTurns.$inferSelect;
export type NewTeamCallTurn = typeof teamCallTurns.$inferInsert;

export const teamCallActions = pgTable(
  "team_call_actions",
  {
    id: id(),
    businessId: businessId(),
    callId: uuid("call_id").notNull(),
    /** Order in the wrap-up (0, 1, 2…; unique per call). */
    position: integer("position").notNull(),
    actionType: text("action_type", { enum: PLAN_ACTION_TYPES }).notNull(),
    /** One line in founder words (1 to 200 characters). */
    title: text("title").notNull(),
    detail: text("detail"),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    status: text("status", { enum: TEAM_CALL_ACTION_STATUSES }).notNull(),
    /** With `targetId`: the created task, roadmap item or plan (both null, or both set). */
    targetKind: text("target_kind", { enum: TEAM_CALL_TARGET_KINDS }),
    targetId: uuid("target_id"),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
    planActionId: uuid("plan_action_id").references(() => planActions.id, { onDelete: "set null" }),
    /** Why it was not filed, or what the go-ahead is for (at most 500 characters). */
    reason: text("reason"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({ name: "team_call_actions_call_fkey", columns: [t.callId, t.businessId], foreignColumns: [teamCalls.id, teamCalls.businessId] }).onDelete("cascade"),
    unique("team_call_actions_position_key").on(t.callId, t.position),
    index("team_call_actions_business_id_idx").on(t.businessId, t.status),
    index("team_call_actions_department_id_idx").on(t.departmentId),
    index("team_call_actions_agent_id_idx").on(t.agentId),
    index("team_call_actions_plan_id_idx").on(t.planId),
    index("team_call_actions_plan_action_id_idx").on(t.planActionId),
  ],
);
export type TeamCallAction = typeof teamCallActions.$inferSelect;
export type NewTeamCallAction = typeof teamCallActions.$inferInsert;
