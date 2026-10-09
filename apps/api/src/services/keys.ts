/**
 * Bring-your-own Anthropic key (BUILD §10.2). Validate through the anthropic connector (mock or live), encrypt with
 * the business vault (envelope encryption, packages/shared/crypto) into `credentials`, never return or log the key.
 * Only the gateway/orchestrator decrypt. Revoke pauses the squad and posts an Inbox note.
 */
import { mockIntegrationRecord, type Connector, type ToolContext } from "@foundmill/connectors";
import { repos, type Executor } from "@foundmill/db";
import { AppError, ValidationError } from "@foundmill/shared";
import { buildAad, encryptJson, redactSecret } from "@foundmill/shared/crypto";
import type { BusinessContext } from "../trpc";
import { audit } from "../trpc";

export interface KeyValidationResult {
  valid: boolean;
  reason: string | null;
  routedModels: { key: string; modelId: string; available: boolean }[];
  checkedAt: string;
  mode: "mock" | "live";
}

const ANTHROPIC = "anthropic";
const CREDENTIAL_KIND = "api_key";
const NIL = "00000000-0000-0000-0000-000000000000";

export async function validateAnthropicKey(ctx: BusinessContext, apiKey: string): Promise<KeyValidationResult> {
  const mode = ctx.env.INTEGRATIONS_MODE;
  const connector: Connector = ctx.connectors.get(ANTHROPIC, mode);
  const toolCtx: ToolContext = {
    businessId: ctx.businessId,
    agentId: NIL,
    sessionId: NIL,
    integration: mockIntegrationRecord(ANTHROPIC, ctx.businessId, mode === "live" ? { status: "connected" } : {}),
    credential: { kind: "api_key", secret: apiKey },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    mode,
  };
  const result = await connector.callTool("validate_key", {}, toolCtx);
  if (!result.ok) return { valid: false, reason: result.error?.message ?? "validation failed", routedModels: [], checkedAt: new Date().toISOString(), mode };
  const data = result.data as { valid: boolean; reason: string | null; routedModels: KeyValidationResult["routedModels"]; checkedAt: string };
  return { ...data, mode };
}

export interface StoredKey {
  credentialId: string;
  integrationId: string;
  fingerprint: string;
  validation: KeyValidationResult;
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
  const bootstrap = await encryptJson(vault, { apiKey }, buildAad(ctx.businessId, "credentials", "pending"));

  // credentials is service-written; membership and role were asserted by the procedure.
  const stored = await ctx.db.transaction(async (tx: Executor) => {
    const integration = await repos.integrations.upsert(tx, ctx.businessId, {
      connectorKey: ANTHROPIC,
      status: ctx.env.INTEGRATIONS_MODE === "mock" ? "mock" : "connected",
      authKind: "api_key",
      accountLabel: fingerprint,
      connectedBy: ctx.userId,
    });
    const meta = await repos.credentials.store(tx, ctx.businessId, { integrationId: integration.id, kind: CREDENTIAL_KIND, record: bootstrap });
    const bound = await encryptJson(vault, { apiKey }, buildAad(ctx.businessId, "credentials", meta.id));
    const rotated = await repos.credentials.rotate(tx, ctx.businessId, meta.id, bound);
    await audit(tx, ctx, { action, target: { kind: "credential", id: rotated.id }, details: { connector: ANTHROPIC, fingerprint, integrationId: integration.id, mode: validation.mode } });
    return { credentialId: rotated.id, integrationId: integration.id };
  });
  return { ...stored, fingerprint, validation };
}

export async function revokeAnthropicKey(ctx: BusinessContext): Promise<{ revoked: number; pausedAgents: number; noteId: string | null }> {
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
    const pausedAgents = await repos.agents.pauseAll(tx, ctx.businessId);
    const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
    let noteId: string | null = null;
    if (chief) {
      const note = await repos.inbox.createItem(tx, ctx.businessId, {
        type: "warning",
        from_agent_id: chief.id,
        subject: "Anthropic key revoked: team paused",
        body_md: "The Anthropic key was revoked, so every agent is paused until a new key is set in Settings → Keys. Nothing else changed; tasks resume where they stopped once the team is back.",
        status_strip: [],
        exhibit: { kind: "none", spec_ref: null },
        decision: null,
        blocks_continue: true,
        source_event_ids: [],
        entity_ids: [],
      });
      noteId = note.id;
    }
    await audit(tx, ctx, { action: "keys.revoke", target: { kind: "integration", id: integration.id }, details: { connector: ANTHROPIC, revoked, pausedAgents } });
    return { revoked, pausedAgents, noteId };
  });
}
