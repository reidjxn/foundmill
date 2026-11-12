/**
 * Bring-your-own Anthropic key (BUILD §10.2). Validate the way the key will be used (`MODEL_MODE`, audit BILL-04: with
 * live models the gateway's `POST /v1/keys/validate`, a real one-token messages call that also refuses a key whose
 * account has no credit, then the live connector's model list for the routed models; with mock models the mock
 * connector, in-process), encrypt
 * with the business vault (envelope encryption, packages/shared/crypto) into `credentials`, never return or log the key.
 * Only the gateway/orchestrator decrypt. Revoke stops the team (the business's stop flag, reason `key_revoked`) and
 * posts an Inbox note; storing a key afterwards resumes it (and a stop for used-up credits), never Stop all agents.
 *
 * The key is sealed as the connector credential shape `{ kind: "api_key", secret }` under the default credential kind
 * (`BYOK_CREDENTIAL_KIND`), the row the gateway's `loadCredential` and the orchestrator's `loadByokApiKey` read. Storing
 * a key moves the business onto its own key (`model_billing = byok`); revoking it moves it back to credits (every tier
 * includes a bounded monthly credit since 2026-10-12; a tier without credits would stay on `byok`), team paused.
 * These two are the only ways in and out: Settings › Integrations hands the Anthropic row to them (routers/integrations.ts).
 */
import { TIERS } from "@foundmill/config";
import { mockIntegrationRecord, type Connector, type ToolContext } from "@foundmill/connectors";
import { autopilotChangedPayload, BYOK_CREDENTIAL_KIND, repos, resumeBusinessAgents, stopBusinessAgents, type Executor } from "@foundmill/db";
import { AppError, ValidationError, type AgentStopReason, type ModelBilling } from "@foundmill/shared";
import { buildAad, encryptJson, redactSecret } from "@foundmill/shared/crypto";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { emitResumed, restartAfterResume } from "./killswitch";

export interface KeyValidationResult {
  valid: boolean;
  reason: string | null;
  routedModels: { key: string; modelId: string; available: boolean }[];
  checkedAt: string;
  mode: "mock" | "live";
}

export const ANTHROPIC = "anthropic";
const NIL = "00000000-0000-0000-0000-000000000000";

/**
 * Checks a key the way it will be used. The models' mode decides, not the connectors': staging runs live models with
 * mock connectors, and the mock connector's look-alike check let any `sk-ant-…` string through, after which every model
 * call for the business failed (audit BILL-04). With live models the gateway checks it (SEC-14: Anthropic is reached
 * only from there): a real one-token messages call (a typo, a revoked key and an account with no credit or at its spend
 * limit are refused), then the routed models on the live connector (`models.list`, free). With mock models the mock
 * connector answers here, without a gateway, and reaches nothing. `checkedAt` is the time of this check.
 */
export async function validateAnthropicKey(ctx: BusinessContext, apiKey: string): Promise<KeyValidationResult> {
  const mode: "mock" | "live" = ctx.env.MODEL_MODE === "live" ? "live" : "mock";
  const checkedAt = () => new Date().toISOString();
  if (mode === "live") {
    const checked = await ctx.gateway.validateKey(ctx.businessId, apiKey);
    return { valid: checked.valid === true, reason: checked.reason ?? null, routedModels: checked.routedModels ?? [], checkedAt: checked.checkedAt ?? checkedAt(), mode };
  }
  const connector: Connector = ctx.connectors.get(ANTHROPIC, "mock");
  const toolCtx: ToolContext = {
    businessId: ctx.businessId,
    agentId: NIL,
    sessionId: NIL,
    integration: mockIntegrationRecord(ANTHROPIC, ctx.businessId),
    credential: { kind: "api_key", secret: apiKey },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    mode,
  };
  const result = await connector.callTool("validate_key", {}, toolCtx);
  if (!result.ok) return { valid: false, reason: result.error?.message ?? "validation failed", routedModels: [], checkedAt: checkedAt(), mode };
  const data = result.data as { valid: boolean; reason: string | null; routedModels: KeyValidationResult["routedModels"]; checkedAt: string };
  return { ...data, checkedAt: checkedAt(), mode };
}

export interface StoredKey {
  credentialId: string;
  integrationId: string;
  fingerprint: string;
  validation: KeyValidationResult;
  /** Always `byok` after a store: the business now runs on its own key. */
  modelBilling: ModelBilling;
  /** The team was stopped for a revoked key or used-up credits and resumed with this key (null: nothing to resume). */
  resumed: { reason: AgentStopReason | null; agents: number } | null;
}

/** The credential payload sealed for a stored key: the gateway's `DecryptedCredential` shape. */
const sealedKey = (apiKey: string) => ({ kind: "api_key" as const, secret: apiKey });

/** Where a business lands when its own key goes away: back on credits where the tier includes them, else it stays on `byok`. */
export function billingAfterRevoke(planTier: keyof typeof TIERS): ModelBilling {
  return TIERS[planTier].modelBilling === "credits_or_byok" ? "credits" : "byok";
}

export async function storeAnthropicKey(ctx: BusinessContext, apiKey: string, action: "keys.set_anthropic" | "keys.rotate"): Promise<StoredKey> {
  if (!apiKey.trim()) throw new ValidationError("Paste the key");
  if (!ctx.vault) throw new AppError("config", "No vault is configured (set KMS_KEY_ID or DEV_MASTER_KEY)", 412);
  const validation = await validateAnthropicKey(ctx, apiKey);
  if (!validation.valid) throw new ValidationError(validation.reason ?? "Anthropic rejected the key");
  const vault = ctx.vault;
  const fingerprint = redactSecret(apiKey);

  // The row id is part of the AAD and exists only after the insert: seal under a bootstrap AAD first (outside the
  // transaction, so the vault's lazy libsodium initialisation never runs while the single PGlite connection is
  // inside a transaction), store, then rotate under the row-bound AAD.
  const bootstrap = await encryptJson(vault, sealedKey(apiKey), buildAad(ctx.businessId, "credentials", "pending"));

  // credentials is service-written; membership and role were asserted by the procedure.
  const stored = await ctx.db.transaction(async (tx: Executor) => {
    const integration = await repos.integrations.upsert(tx, ctx.businessId, {
      connectorKey: ANTHROPIC,
      // Test data unless the key was checked against Anthropic for real (the models' mode, as the validation).
      status: validation.mode === "live" ? "connected" : "mock",
      authKind: "api_key",
      accountLabel: fingerprint,
      connectedBy: ctx.userId,
    });
    const meta = await repos.credentials.store(tx, ctx.businessId, { integrationId: integration.id, kind: BYOK_CREDENTIAL_KIND, record: bootstrap });
    const bound = await encryptJson(vault, sealedKey(apiKey), buildAad(ctx.businessId, "credentials", meta.id));
    const rotated = await repos.credentials.rotate(tx, ctx.businessId, meta.id, bound);
    // The business runs on its own key from the next call (sessions, cycle, training, tool calls on the gateway).
    const billingBefore = ctx.business.modelBilling;
    if (billingBefore !== "byok") await repos.businesses.update(tx, ctx.businessId, { modelBilling: "byok" });
    // The key is what a revoke (or used-up credits) stopped the team for: with it stored the team resumes by itself.
    // Stop all agents is the founder's own stop and stays until an owner or admin resumes.
    const resumed = await resumeBusinessAgents(tx, ctx.businessId, { reason: ["key_revoked", "credits_exhausted"] });
    await emitResumed(tx, ctx, resumed.agentIds, "Resumed: a new Anthropic key was stored");
    await audit(tx, ctx, { action, target: { kind: "credential", id: rotated.id }, details: { connector: ANTHROPIC, fingerprint, integrationId: integration.id, mode: validation.mode, modelBilling: { from: billingBefore, to: "byok" }, resumedAgents: resumed.resumed ? resumed.agentIds.length : null } });
    return { credentialId: rotated.id, integrationId: integration.id, resumed: resumed.resumed ? { reason: resumed.reason, agents: resumed.agentIds.length } : null };
  });
  if (stored.resumed) await restartAfterResume(ctx);
  return { ...stored, fingerprint, validation, modelBilling: "byok" };
}

export async function revokeAnthropicKey(ctx: BusinessContext): Promise<{ revoked: number; pausedAgents: number; noteId: string | null; modelBilling: ModelBilling }> {
  return ctx.db.transaction(async (tx: Executor) => {
    const integration = await repos.integrations.getByKey(tx, ctx.businessId, ANTHROPIC);
    if (!integration) throw new AppError("not_found", "No Anthropic key is stored for this business", 404);
    const metas = await repos.credentials.listMetadata(tx, ctx.businessId, { integrationId: integration.id });
    let revoked = 0;
    for (const m of metas) {
      await repos.credentials.revoke(tx, ctx.businessId, m.id);
      revoked++;
    }
    await repos.integrations.disconnect(tx, ctx.businessId, integration.id);
    const modelBilling = billingAfterRevoke(ctx.business.planTier);
    if (modelBilling !== ctx.business.modelBilling) await repos.businesses.update(tx, ctx.businessId, { modelBilling });
    // The team-wide stop (0023): nothing starts work until a new key is stored or an owner or admin resumes.
    const stop = await stopBusinessAgents(tx, ctx.businessId, { reason: "key_revoked" });
    const pausedAgents = stop.paused.length;
    if (stop.autopilotPaused) await emit(tx, ctx, { type: "autopilot.changed", payload: autopilotChangedPayload(ctx.business, "paused", "key_revoked") });
    for (const a of stop.paused) await emit(tx, ctx, { type: "agent.health_changed", payload: { agentId: a.id, from: a.from, to: "paused", reason: "Anthropic key revoked", signals: {}, expectedReturnAt: null, sessionId: null } });
    const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
    let noteId: string | null = null;
    if (chief) {
      const resume = modelBilling === "credits" ? "Press Resume agents in the top bar to run on your plan's credits, or set a new key in Settings → Keys and the team resumes by itself." : "Set a new key in Settings → Keys and the team resumes by itself.";
      const note = await repos.inbox.createItem(tx, ctx.businessId, {
        type: "warning",
        from_agent_id: chief.id,
        subject: "Anthropic key revoked: team paused",
        body_md: `The Anthropic key was revoked, so every agent is paused. ${resume} Nothing else changed; tasks resume where they stopped once the team is back.`,
        status_strip: [],
        exhibit: { kind: "none", spec_ref: null },
        decision: null,
        blocks_continue: true,
        source_event_ids: [],
        entity_ids: [],
      });
      noteId = note.id;
      // Through the outbox like every Inbox note, so an open Inbox, its badge and Continue update at once (audit BILL-21).
      await emit(tx, ctx, { type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: note.id, type: note.type, fromAgentId: chief.id, subject: note.subject, blocksContinue: note.blocksContinue, sourceEventIds: [], cost: null } });
    }
    await audit(tx, ctx, { action: "keys.revoke", target: { kind: "integration", id: integration.id }, details: { connector: ANTHROPIC, revoked, pausedAgents, modelBilling: { from: ctx.business.modelBilling, to: modelBilling } } });
    return { revoked, pausedAgents, noteId, modelBilling };
  });
}
