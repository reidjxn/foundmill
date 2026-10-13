/**
 * integrations.list/connect/disconnect/health and keys.setAnthropic/validate/rotate/revoke (BUILD §11.15, §10.2).
 * OAuth consents are founder clicks (hard gate): `connect` hands back the vendor's consent URL when the connector
 * needs one; secrets returned by a connector are encrypted into `credentials` and never echoed.
 */
import type { HealthResult, IntegrationRecord } from "@foundmill/connectors";
import { INTEGRATION_CREDENTIAL_KIND, repos, type Executor } from "@foundmill/db";
import { AppError, connectorMode } from "@foundmill/shared";
import { buildAad, encryptJson, redactSecret } from "@foundmill/shared/crypto";
import { z } from "zod";
import { signInstallState, verifyInstallState } from "../services/install-state";
import { ANTHROPIC, revokeAnthropicKey, storeAnthropicKey, validateAnthropicKey } from "../services/keys";
import { Id, audit, router, sectionAdmin, sectionRead } from "../trpc";

const read = sectionRead("settings");

/**
 * Choices the founder made on an integration that a reconnect keeps (the repository code is pushed to), as long as the
 * reconnect is to the same account: a different GitHub installation starts with no repository chosen.
 */
function keptSettings(row: { settings: unknown } | null, externalAccountId: string | null): Record<string, unknown> {
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  if (settings.externalAccountId !== externalAccountId) return {};
  return Object.fromEntries(Object.entries(settings).filter(([k]) => k === "repo" || k === "writeEnabled"));
}

/** Finishing an App installation (GitHub): what GitHub sent back to the founder, with the state Connect signed. */
const AppInstallation = z.object({ installationId: z.number().int().positive(), code: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), state: z.string().min(1).max(600) });

const admin = sectionAdmin("settings");

export const integrationsRouter = router({
  list: read.query(({ ctx }) =>
    ctx.rls(async (tx) => {
      const rows = await repos.integrations.list(tx, ctx.businessId);
      const catalogue = ctx.connectors.catalogue(ctx.env.INTEGRATIONS_MODE);
      return {
        mode: ctx.env.INTEGRATIONS_MODE,
        integrations: rows,
        catalogue: catalogue.map((c) => ({ ...c, live: connectorMode(ctx.env, c.key) === "live", integration: rows.find((r) => r.connectorKey === c.key) ?? null })),
      };
    }),
  ),

  connect: admin.input(z.object({ connectorKey: z.string().min(1).max(60), input: z.record(z.string(), z.unknown()).default({}) })).mutation(async ({ ctx, input }) => {
    const mode = connectorMode(ctx.env, input.connectorKey);
    if (!ctx.connectors.has(input.connectorKey)) throw new AppError("not_found", `Unknown connector ${input.connectorKey}`, 404);
    // The Anthropic key decides who pays for model calls and resumes a stopped team: it is stored only through
    // Settings › Keys (`storeAnthropicKey`), never as a generic connection that would skip all of that (audit ARB-04).
    if (input.connectorKey === ANTHROPIC) throw new AppError("validation", "The Anthropic key is stored in Settings › Keys, where it is checked and the team moves onto it.", 400, { manageIn: "keys" });
    const connector = ctx.connectors.get(input.connectorKey, mode);

    let record: Omit<IntegrationRecord, "id" | "businessId" | "connectorKey" | "credentialRef" | "lastHealthAt" | "createdAt"> & { credentialToStore?: IntegrationRecord["credentialToStore"] };
    if (mode === "live" && connector.auth.kind === "app") {
      // App connectors (GitHub) connect in the gateway, which holds the App's keys and checks with GitHub that the
      // founder who installed the App can manage the installation. The api only signs and checks the state.
      if (input.input.installationId === undefined) {
        const state = signInstallState(ctx.env.SESSION_TOKEN_SECRET, { userId: ctx.userId!, businessId: ctx.businessId });
        const first = await ctx.gateway.connect(ctx.businessId, input.connectorKey, { state });
        const consentUrl = typeof first.config.consentUrl === "string" ? first.config.consentUrl : null;
        // Nothing is written yet: an installation already connected stays as it is until the new one is confirmed.
        return { integration: await repos.integrations.getByKey(ctx.db, ctx.businessId, input.connectorKey), record: { ...first, connectorKey: input.connectorKey }, consentUrl, founderConsentRequired: consentUrl !== null };
      }
      const finish = AppInstallation.parse(input.input);
      verifyInstallState(ctx.env.SESSION_TOKEN_SECRET, finish.state, { userId: ctx.userId!, businessId: ctx.businessId });
      record = await ctx.gateway.connect(ctx.businessId, input.connectorKey, { installationId: finish.installationId, code: finish.code });
    } else {
      record = await connector.connect(ctx.businessId, input.input);
    }

    const { credentialToStore, ...safe } = record;
    const integration = await ctx.db.transaction(async (tx: Executor) => {
      const row = await repos.integrations.upsert(tx, ctx.businessId, {
        connectorKey: input.connectorKey,
        status: mode === "mock" ? "mock" : record.status,
        authKind: connector.auth.kind,
        scopes: record.scopes,
        accountLabel: record.accountLabel,
        settings: { ...keptSettings(await repos.integrations.getByKey(tx, ctx.businessId, input.connectorKey), record.externalAccountId), externalAccountId: record.externalAccountId, config: record.config, expiresAt: record.expiresAt },
        connectedBy: ctx.userId,
      });
      if (credentialToStore) {
        if (!ctx.vault) throw new AppError("config", "No vault is configured (set KMS_KEY_ID or DEV_MASTER_KEY)", 412);
        const bootstrap = await encryptJson(ctx.vault, credentialToStore, buildAad(ctx.businessId, "credentials", "pending"));
        // Stored under the one kind the gateway loads; the connector's auth kind is inside the sealed payload.
        const meta = await repos.credentials.store(tx, ctx.businessId, { integrationId: row.id, kind: INTEGRATION_CREDENTIAL_KIND, record: bootstrap, expiresAt: credentialToStore.expiresAt ? new Date(credentialToStore.expiresAt) : null });
        const bound = await encryptJson(ctx.vault, credentialToStore, buildAad(ctx.businessId, "credentials", meta.id));
        await repos.credentials.rotate(tx, ctx.businessId, meta.id, bound);
      }
      await audit(tx, ctx, { action: "integrations.connect", target: { kind: "integration", id: row.id }, details: { connectorKey: input.connectorKey, status: row.status, accountLabel: record.accountLabel, secretStored: Boolean(credentialToStore), secretHint: credentialToStore ? redactSecret(credentialToStore.secret) : null } });
      return row;
    });
    const consentUrl = typeof record.config.linkUrl === "string" ? record.config.linkUrl : typeof record.config.consentUrl === "string" ? record.config.consentUrl : typeof record.config.authorizeUrl === "string" ? record.config.authorizeUrl : null;
    return { integration, record: { ...safe, connectorKey: input.connectorKey }, consentUrl, founderConsentRequired: consentUrl !== null };
  }),

  disconnect: admin.input(z.object({ integrationId: Id })).mutation(async ({ ctx, input }) => {
    // Disconnecting the Anthropic key is revoking it (Settings › Keys): billing moves back to credits where the plan
    // includes them, the team stops and the Inbox says why. A plain disconnect left the business on a key it no longer
    // had, so every model call failed with no explanation (audit ARB-04).
    const target = await repos.integrations.get(ctx.db, ctx.businessId, input.integrationId);
    if (target.connectorKey === ANTHROPIC) {
      await revokeAnthropicKey(ctx);
      return repos.integrations.get(ctx.db, ctx.businessId, target.id);
    }
    return ctx.db.transaction(async (tx: Executor) => {
      const integration = await repos.integrations.get(tx, ctx.businessId, input.integrationId);
      const metas = await repos.credentials.listMetadata(tx, ctx.businessId, { integrationId: integration.id });
      for (const m of metas) await repos.credentials.revoke(tx, ctx.businessId, m.id);
      const row = await repos.integrations.disconnect(tx, ctx.businessId, integration.id);
      await audit(tx, ctx, { action: "integrations.disconnect", target: { kind: "integration", id: row.id }, details: { connectorKey: row.connectorKey, credentialsRevoked: metas.length } });
      return row;
    });
  }),

  health: read.input(z.object({ integrationId: Id })).mutation(async ({ ctx, input }) => {
    const integration = await repos.integrations.get(ctx.db, ctx.businessId, input.integrationId);
    const mode = connectorMode(ctx.env, integration.connectorKey);
    const connector = ctx.connectors.get(integration.connectorKey, mode);
    const settings = (integration.settings ?? {}) as Record<string, unknown>;
    // An App connector's health check needs the App's keys, which only the gateway holds.
    const result: HealthResult = mode === "live" && connector.auth.kind === "app" ? ((await ctx.gateway.health(ctx.businessId, integration.connectorKey)) as unknown as HealthResult) : await connector.healthcheck({
      id: integration.id,
      businessId: ctx.businessId,
      connectorKey: integration.connectorKey,
      status: integration.status,
      scopes: integration.scopes,
      accountLabel: integration.accountLabel,
      externalAccountId: typeof settings.externalAccountId === "string" ? settings.externalAccountId : null,
      config: (settings.config as Record<string, unknown> | undefined) ?? {},
      credentialRef: null,
      expiresAt: typeof settings.expiresAt === "string" ? settings.expiresAt : null,
      lastHealthAt: integration.lastHealthAt?.toISOString() ?? null,
      createdAt: integration.createdAt.toISOString(),
    });
    const updated = await repos.integrations.recordHealth(ctx.db, ctx.businessId, integration.id, { ok: result.ok, error: result.ok ? null : (result.message ?? "health check failed") });
    return { integration: updated, health: result };
  }),
});

export const keysRouter = router({
  status: read.query(async ({ ctx }) => {
    const integration = await ctx.rls((tx) => repos.integrations.getByKey(tx, ctx.businessId, "anthropic"));
    // credentials metadata is service-read (never the ciphertext); outside the RLS transaction by design.
    const metas = integration ? await repos.credentials.listMetadata(ctx.db, ctx.businessId, { integrationId: integration.id }) : [];
    return { configured: integration !== null && integration.status !== "disconnected" && metas.length > 0, integration, credentials: metas, advice: "Also set a spend limit in your Anthropic Console." };
  }),
  /** Validate with a minimal API call (BUILD §10.2 step 1); nothing is stored. */
  validate: admin.input(z.object({ apiKey: z.string().min(1).max(400) })).mutation(({ ctx, input }) => validateAnthropicKey(ctx, input.apiKey)),
  /** Validate, encrypt with the business data key, store; never shown again, never logged. */
  setAnthropic: admin.input(z.object({ apiKey: z.string().min(1).max(400) })).mutation(({ ctx, input }) => storeAnthropicKey(ctx, input.apiKey, "keys.set_anthropic")),
  rotate: admin.input(z.object({ apiKey: z.string().min(1).max(400) })).mutation(({ ctx, input }) => storeAnthropicKey(ctx, input.apiKey, "keys.rotate")),
  /** Revoke: credentials archived, integration disconnected, agents paused, Inbox note posted. */
  revoke: admin.mutation(({ ctx }) => revokeAnthropicKey(ctx)),
});
