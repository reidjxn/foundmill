/**
 * integrations + webhooks — connector accounts per business (BUILD §13; routers integrations.list / connect /
 * disconnect / health). Secrets never live here: they are ciphertext rows in `credentials` (repos.credentials).
 */
import { CONNECTOR_AUTH_KINDS, INTEGRATION_STATUSES, type IntegrationStatus } from "@founder-manager/shared";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { credentials, integrations, WEBHOOK_STATUSES, webhooks, type Integration, type Webhook } from "../schema";
import { defined, Id, IsoDateInput, JsonObject, one, parseInput, type Executor } from "./_shared";

export const UpsertIntegrationInput = z.object({
  connectorKey: z.string().trim().min(1).max(60),
  status: z.enum(INTEGRATION_STATUSES).optional(),
  authKind: z.enum(CONNECTOR_AUTH_KINDS).nullable().optional(),
  scopes: z.array(z.string().max(200)).optional(),
  accountLabel: z.string().max(200).nullable().optional(),
  settings: JsonObject.optional(),
  connectedBy: Id.nullable().optional(),
});
export type UpsertIntegrationInput = z.input<typeof UpsertIntegrationInput>;

export const IntegrationListFilter = z.object({
  status: z.union([z.enum(INTEGRATION_STATUSES), z.array(z.enum(INTEGRATION_STATUSES))]).optional(),
  includeArchived: z.boolean().default(false),
});
export type IntegrationListFilter = z.input<typeof IntegrationListFilter>;

export const CreateWebhookInput = z.object({
  integrationId: Id.nullable().optional(),
  connectorKey: z.string().trim().min(1).max(60),
  externalId: z.string().max(200).nullable().optional(),
  secretRef: Id.nullable().optional(),
  endpointPath: z.string().min(1).max(400),
  events: z.array(z.string().max(120)).default([]),
  status: z.enum(WEBHOOK_STATUSES).default("active"),
});
export type CreateWebhookInput = z.input<typeof CreateWebhookInput>;

const scoped = (businessId: string, id: string) => and(eq(integrations.businessId, businessId), eq(integrations.id, id));
const scopedWebhook = (businessId: string, id: string) => and(eq(webhooks.businessId, businessId), eq(webhooks.id, id));
const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

export const integrationsRepo = {
  async list(db: Executor, businessId: string, filter: IntegrationListFilter = {}): Promise<Integration[]> {
    const f = parseInput(IntegrationListFilter, filter, "integration filter");
    const statuses = toArray(f.status);
    return db
      .select()
      .from(integrations)
      .where(and(eq(integrations.businessId, businessId), f.includeArchived ? undefined : isNull(integrations.archivedAt), statuses?.length ? inArray(integrations.status, statuses) : undefined))
      .orderBy(asc(integrations.connectorKey));
  },

  async get(db: Executor, businessId: string, integrationId: string): Promise<Integration> {
    return one(await db.select().from(integrations).where(scoped(businessId, integrationId)).limit(1), "integration", integrationId);
  },

  async getByKey(db: Executor, businessId: string, connectorKey: string): Promise<Integration | null> {
    const rows = await db.select().from(integrations).where(and(eq(integrations.businessId, businessId), eq(integrations.connectorKey, connectorKey))).limit(1);
    return rows[0] ?? null;
  },

  /** One row per connector per business: connect creates it, reconnect updates it (and un-archives). */
  async upsert(db: Executor, businessId: string, input: UpsertIntegrationInput): Promise<Integration> {
    const v = parseInput(UpsertIntegrationInput, input, "integration");
    const patch = defined({ status: v.status, authKind: v.authKind, scopes: v.scopes, accountLabel: v.accountLabel, settings: v.settings, connectedBy: v.connectedBy, archivedAt: null });
    return one(
      await db
        .insert(integrations)
        .values({ businessId, connectorKey: v.connectorKey, ...patch })
        .onConflictDoUpdate({ target: [integrations.businessId, integrations.connectorKey], set: patch })
        .returning(),
      "integration",
    );
  },

  async setStatus(db: Executor, businessId: string, integrationId: string, status: IntegrationStatus, error?: string | null): Promise<Integration> {
    const s = parseInput(z.enum(INTEGRATION_STATUSES), status, "integration status");
    return one(await db.update(integrations).set({ status: s, ...(error !== undefined ? { lastError: error } : {}) }).where(scoped(businessId, integrationId)).returning(), "integration", integrationId);
  },

  /** Health check result: ok → connected (unless mock), error → degraded with the message. */
  async recordHealth(db: Executor, businessId: string, integrationId: string, result: { ok: boolean; error?: string | null; at?: Date }): Promise<Integration> {
    const v = parseInput(z.object({ ok: z.boolean(), error: z.string().max(2000).nullable().optional(), at: IsoDateInput.optional() }), result, "health result");
    return db.transaction(async (tx) => {
      const current = await integrationsRepo.get(tx, businessId, integrationId);
      const status: IntegrationStatus = current.status === "mock" || current.status === "disconnected" ? current.status : v.ok ? "connected" : "degraded";
      return one(
        await tx
          .update(integrations)
          .set({ status, lastHealthAt: v.at ?? new Date(), lastError: v.ok ? null : (v.error ?? "health check failed") })
          .where(scoped(businessId, integrationId))
          .returning(),
        "integration",
        integrationId,
      );
    });
  },

  /** Disconnect: status disconnected, credentials and webhooks archived (ciphertext stays for the audit trail, never usable). */
  async disconnect(db: Executor, businessId: string, integrationId: string): Promise<Integration> {
    return db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(credentials).set({ archivedAt: now }).where(and(eq(credentials.businessId, businessId), eq(credentials.integrationId, integrationId), isNull(credentials.archivedAt)));
      await tx.update(webhooks).set({ status: "paused", archivedAt: now }).where(and(eq(webhooks.businessId, businessId), eq(webhooks.integrationId, integrationId), isNull(webhooks.archivedAt)));
      return one(await tx.update(integrations).set({ status: "disconnected", scopes: [], lastError: null }).where(scoped(businessId, integrationId)).returning(), "integration", integrationId);
    });
  },

  async archive(db: Executor, businessId: string, integrationId: string): Promise<Integration> {
    await integrationsRepo.disconnect(db, businessId, integrationId);
    return one(await db.update(integrations).set({ archivedAt: new Date() }).where(scoped(businessId, integrationId)).returning(), "integration", integrationId);
  },

  // webhooks ----------------------------------------------------------------------------------------------------------
  async listWebhooks(db: Executor, businessId: string, filter: { integrationId?: string; connectorKey?: string; includeArchived?: boolean } = {}): Promise<Webhook[]> {
    return db
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.businessId, businessId),
          filter.includeArchived ? undefined : isNull(webhooks.archivedAt),
          filter.integrationId ? eq(webhooks.integrationId, filter.integrationId) : undefined,
          filter.connectorKey ? eq(webhooks.connectorKey, filter.connectorKey) : undefined,
        ),
      )
      .orderBy(desc(webhooks.createdAt));
  },

  async getWebhook(db: Executor, businessId: string, webhookId: string): Promise<Webhook> {
    return one(await db.select().from(webhooks).where(scopedWebhook(businessId, webhookId)).limit(1), "webhook", webhookId);
  },

  async createWebhook(db: Executor, businessId: string, input: CreateWebhookInput): Promise<Webhook> {
    const v = parseInput(CreateWebhookInput, input, "webhook");
    if (v.integrationId) await integrationsRepo.get(db, businessId, v.integrationId);
    return one(
      await db
        .insert(webhooks)
        .values({ businessId, integrationId: v.integrationId ?? null, connectorKey: v.connectorKey, externalId: v.externalId ?? null, secretRef: v.secretRef ?? null, endpointPath: v.endpointPath, events: v.events, status: v.status })
        .returning(),
      "webhook",
    );
  },

  async setWebhookStatus(db: Executor, businessId: string, webhookId: string, status: (typeof WEBHOOK_STATUSES)[number]): Promise<Webhook> {
    const s = parseInput(z.enum(WEBHOOK_STATUSES), status, "webhook status");
    return one(await db.update(webhooks).set({ status: s }).where(scopedWebhook(businessId, webhookId)).returning(), "webhook", webhookId);
  },

  /** Ingest stamps every verified delivery. */
  async markWebhookReceived(db: Executor, businessId: string, webhookId: string, at = new Date()): Promise<void> {
    await db.update(webhooks).set({ lastReceivedAt: at }).where(scopedWebhook(businessId, webhookId));
  },

  async archiveWebhook(db: Executor, businessId: string, webhookId: string): Promise<Webhook> {
    return one(await db.update(webhooks).set({ archivedAt: new Date(), status: "paused" }).where(scopedWebhook(businessId, webhookId)).returning(), "webhook", webhookId);
  },
};
