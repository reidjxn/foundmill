/** 0011 — integrations, credentials, webhooks, policies, approvals, audit log, events, outbox; 0085 — account events and their outbox. */
import { ACTOR_KINDS, CONNECTOR_AUTH_KINDS, DECISION_TYPES, INTEGRATION_STATUSES } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { bigint, boolean, char, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { bytea, createdAt, emptyArray, emptyObject, id, timestamps, timestampsWithArchive, tstz } from "./_common";
import { businessId } from "./_refs";
import { agentSessions, agents, tasks } from "./agents";
import { inboxItems, planActions } from "./inbox";

export const POLICY_SCOPES = ["business", "department", "agent"] as const;
export const APPROVAL_OUTCOMES = ["approved", "rejected", "expired"] as const;
export const APPROVAL_BY_KINDS = ["user", "chief_of_staff", "system", "agent"] as const;
/** 0054: who handles an approval by the Responsibilities matrix (null = the founder: owners and admins). */
export const APPROVAL_HANDLER_KINDS = ["user", "agent"] as const;
export const WEBHOOK_STATUSES = ["active", "paused", "failed"] as const;

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    businessId: businessId(),
    connectorKey: text("connector_key").notNull(),
    status: text("status", { enum: INTEGRATION_STATUSES }).notNull().default("disconnected"),
    authKind: text("auth_kind", { enum: CONNECTOR_AUTH_KINDS }),
    scopes: text("scopes").array().notNull().default(emptyArray),
    accountLabel: text("account_label"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default(emptyObject),
    lastHealthAt: tstz("last_health_at"),
    lastError: text("last_error"),
    connectedBy: uuid("connected_by"),
    ...timestampsWithArchive(),
  },
  (t) => [
    uniqueIndex("integrations_business_id_connector_key_key").on(t.businessId, t.connectorKey),
    index("integrations_business_id_idx").on(t.businessId),
    index("integrations_status_idx").on(t.businessId, t.status),
  ],
);
export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;

/**
 * 0015 — an App connector's installation as the gateway verified it at connect time (who proved they own or administer
 * its account). Written only by the gateway (service role); members read it. Disconnecting deletes it. The gateway trusts an
 * integration's installation id only when it matches this row.
 */
export const appInstallations = pgTable(
  "app_installations",
  {
    id: id(),
    businessId: businessId(),
    connectorKey: text("connector_key").notNull(),
    installationId: text("installation_id").notNull(),
    accountLabel: text("account_label"),
    verifiedBy: text("verified_by").notNull(),
    verifiedAt: tstz("verified_at").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("app_installations_business_connector_idx").on(t.businessId, t.connectorKey)],
);
export type AppInstallation = typeof appInstallations.$inferSelect;

/** Only service_role may read or write this table (see 0011). Never expose through tRPC. */
export const credentials = pgTable(
  "credentials",
  {
    id: id(),
    businessId: businessId(),
    integrationId: uuid("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("secret"),
    ciphertext: bytea("ciphertext").notNull(),
    dataKeyCiphertext: bytea("data_key_ciphertext").notNull(),
    kmsKeyId: text("kms_key_id").notNull(),
    nonce: bytea("nonce"),
    expiresAt: tstz("expires_at"),
    rotatedAt: tstz("rotated_at"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("credentials_business_id_idx").on(t.businessId),
    index("credentials_integration_id_idx").on(t.integrationId),
    index("credentials_expires_at_idx").on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
  ],
);
export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;

export const webhooks = pgTable(
  "webhooks",
  {
    id: id(),
    businessId: businessId(),
    integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "cascade" }),
    connectorKey: text("connector_key").notNull(),
    externalId: text("external_id"),
    secretRef: uuid("secret_ref").references(() => credentials.id, { onDelete: "set null" }),
    endpointPath: text("endpoint_path").notNull(),
    events: text("events").array().notNull().default(emptyArray),
    status: text("status", { enum: WEBHOOK_STATUSES }).notNull().default("active"),
    lastReceivedAt: tstz("last_received_at"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("webhooks_business_id_idx").on(t.businessId),
    index("webhooks_integration_id_idx").on(t.integrationId),
    index("webhooks_connector_external_idx").on(t.connectorKey, t.externalId),
    index("webhooks_secret_ref_idx").on(t.secretRef),
  ],
);
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;

export const policies = pgTable(
  "policies",
  {
    id: id(),
    businessId: businessId(),
    scope: text("scope", { enum: POLICY_SCOPES }).notNull(),
    scopeId: uuid("scope_id"),
    name: text("name").notNull().default(""),
    cedarText: text("cedar_text").notNull(),
    version: integer("version").notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: uuid("created_by"),
    ...timestampsWithArchive(),
  },
  (t) => [index("policies_business_id_idx").on(t.businessId), index("policies_scope_idx").on(t.businessId, t.scope, t.scopeId).where(sql`${t.enabled}`)],
);
export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    businessId: businessId(),
    planActionId: uuid("plan_action_id").references((): AnyPgColumn => planActions.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    sessionId: uuid("session_id").references((): AnyPgColumn => agentSessions.id, { onDelete: "set null" }),
    inboxItemId: uuid("inbox_item_id").references((): AnyPgColumn => inboxItems.id, { onDelete: "set null" }),
    connectorKey: text("connector_key"),
    tool: text("tool"),
    args: jsonb("args").$type<Record<string, unknown>>().notNull().default(emptyObject),
    reasons: text("reasons").array().notNull().default(emptyArray),
    requestedAt: tstz("requested_at").notNull().defaultNow(),
    resolvedAt: tstz("resolved_at"),
    outcome: text("outcome", { enum: APPROVAL_OUTCOMES }),
    byKind: text("by_kind", { enum: APPROVAL_BY_KINDS }),
    byId: uuid("by_id"),
    /** The task the gated call was for (0030); a task waits while its approval is open and runs again once approved. */
    taskId: uuid("task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),
    /** What the call would commit, in `currency` (0030); null when it spends nothing. */
    amountMinor: bigint("amount_minor", { mode: "number" }),
    currency: char("currency", { length: 3 }),
    /** When a call ran under this approval (0030): a granted approval is used once. */
    usedAt: tstz("used_at"),
    usedBySessionId: uuid("used_by_session_id").references((): AnyPgColumn => agentSessions.id, { onDelete: "set null" }),
    /** 0054: the Responsibilities decision type, and who handles it (null handler = the founder: owners and admins). */
    decisionType: text("decision_type", { enum: DECISION_TYPES }),
    handlerKind: text("handler_kind", { enum: APPROVAL_HANDLER_KINDS }),
    handlerId: uuid("handler_id"),
    ...timestamps(),
  },
  (t) => [
    index("approvals_business_id_idx").on(t.businessId, t.requestedAt),
    index("approvals_handler_idx").on(t.businessId, t.handlerKind, t.handlerId).where(sql`${t.resolvedAt} is null`),
    index("approvals_pending_idx").on(t.businessId).where(sql`${t.resolvedAt} is null`),
    index("approvals_plan_action_id_idx").on(t.planActionId),
    index("approvals_agent_id_idx").on(t.agentId),
    index("approvals_session_id_idx").on(t.sessionId),
    index("approvals_inbox_item_id_idx").on(t.inboxItemId),
    index("approvals_task_id_idx").on(t.taskId),
    index("approvals_used_by_session_id_idx").on(t.usedBySessionId),
  ],
);
export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;

/**
 * Append-only, hash-chained per business. seq/prev_hash/hash are computed by the audit_log_chain
 * trigger — pass anything (or nothing) for them on insert; updates and deletes raise.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    businessId: businessId(),
    seq: bigint("seq", { mode: "number" }).notNull().default(0),
    actorKind: text("actor_kind", { enum: ACTOR_KINDS }).notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    target: jsonb("target").$type<Record<string, unknown>>().notNull().default(emptyObject),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default(emptyObject),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("audit_log_business_id_seq_key").on(t.businessId, t.seq),
    index("audit_log_business_id_idx").on(t.businessId, t.createdAt),
    index("audit_log_actor_idx").on(t.actorKind, t.actorId),
    index("audit_log_action_idx").on(t.businessId, t.action),
    // The business-deletion sweep's read (0028).
    index("audit_log_deletion_idx").on(t.businessId, t.seq.desc()).where(sql`${t.action} in ('business.request_deletion', 'business.cancel_deletion')`),
  ],
);
export type AuditEntry = typeof auditLog.$inferSelect;
export type NewAuditEntry = typeof auditLog.$inferInsert;

export const events = pgTable(
  "events",
  {
    id: id(),
    businessId: businessId(),
    type: text("type").notNull(),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    actor: jsonb("actor").$type<{ kind: string; id: string }>().notNull().default(sql`'{"kind":"system","id":"platform"}'::jsonb`),
    entityIds: uuid("entity_ids").array().notNull().default(emptyArray),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(emptyObject),
    narrated: boolean("narrated").notNull().default(false),
    idempotencyKey: text("idempotency_key"),
    ...timestamps(),
  },
  (t) => [
    index("events_business_id_idx").on(t.businessId, t.occurredAt),
    index("events_type_idx").on(t.businessId, t.type, t.occurredAt),
    index("events_unnarrated_idx").on(t.businessId, t.occurredAt).where(sql`not ${t.narrated}`),
    index("events_entity_ids_idx").using("gin", t.entityIds),
    uniqueIndex("events_idempotency_idx").on(t.businessId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  ],
);
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export const outbox = pgTable(
  "outbox",
  {
    id: id(),
    businessId: businessId(),
    eventId: uuid("event_id").notNull().unique().references(() => events.id, { onDelete: "cascade" }),
    publishedAt: tstz("published_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ...timestamps(),
  },
  (t) => [index("outbox_business_id_idx").on(t.businessId), index("outbox_unpublished_idx").on(t.createdAt).where(sql`${t.publishedAt} is null`)],
);
export type OutboxRow = typeof outbox.$inferSelect;
export type NewOutboxRow = typeof outbox.$inferInsert;

/**
 * 0085 — account-scoped events: facts about one person (their profile went public; later a follow, an ask, an answer),
 * keyed by the account they belong to and never by a business, so no project's members can read them. The types are
 * declared in the one event catalog (packages/events, `scope: "account"`) and written only by
 * `@foundmill/events` `writeAccountEvent`, on the service connection. A signed-in person reads their own rows and only
 * `ACCOUNT_EVENT_CLIENT_COLUMNS`; `actor` and `idempotency_key` are the services'. A fact about two people is one row
 * per person, each with a payload shaped for that reader: a payload never carries an account id (trigger
 * `fm_account_events_guard`), and the actor is the person themselves or the system (`account_events_actor_own`). Rows
 * are never changed once written and go with the account (`on delete cascade`).
 */
export const accountEvents = pgTable(
  "account_events",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    actor: jsonb("actor").$type<{ kind: "user" | "system"; id: string }>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(emptyObject),
    idempotencyKey: text("idempotency_key"),
    ...timestamps(),
  },
  (t) => [
    index("account_events_user_id_idx").on(t.userId, t.occurredAt.desc(), t.id.desc()),
    index("account_events_type_idx").on(t.userId, t.type, t.occurredAt.desc()),
    uniqueIndex("account_events_idempotency_idx").on(t.userId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    unique("account_events_id_user_id_key").on(t.id, t.userId),
  ],
);
export type AccountEventRow = typeof accountEvents.$inferSelect;

/** The columns of `account_events` the `authenticated` role may select (0085): everything but these is the services'. */
export const ACCOUNT_EVENT_CLIENT_COLUMNS = ["id", "user_id", "type", "occurred_at", "payload", "created_at"] as const;
/** The columns kept from client roles: who acted (a system name), the idempotency key (it may be built from other ids) and bookkeeping. */
export const ACCOUNT_EVENT_HIDDEN_COLUMNS = ["actor", "idempotency_key", "updated_at"] as const;

/**
 * 0085 — the delivery queue of `account_events`, written in the same transaction and relayed to Redis `ae:{userId}`
 * by apps/api (`runAccountOutboxRelay`). `attempts`, `lastError` and `nextAttemptAt` record a row the relay could not
 * publish and when it tries again; a row that can never be published is closed with its `lastError`. Service role only.
 */
export const accountOutbox = pgTable(
  "account_outbox",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().unique("account_outbox_event_id_key"),
    publishedAt: tstz("published_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: tstz("next_attempt_at"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({ name: "account_outbox_event_fkey", columns: [t.eventId, t.userId], foreignColumns: [accountEvents.id, accountEvents.userId] }).onDelete("cascade"),
    index("account_outbox_user_id_idx").on(t.userId),
    index("account_outbox_unpublished_idx").on(t.createdAt).where(sql`${t.publishedAt} is null`),
  ],
);
export type AccountOutboxRow = typeof accountOutbox.$inferSelect;
