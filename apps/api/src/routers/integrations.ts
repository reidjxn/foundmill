/**
 * integrations.list/connect/disconnect/health and keys.setAnthropic/validate/rotate/revoke (BUILD §11.15, §10.2).
 * OAuth consents are founder clicks (hard gate): `connect` hands back the vendor's consent URL when the connector
 * needs one. A connector that runs live is connected and checked by the gateway (SEC-14), which holds the vendors' keys
 * and seals any secret the vendor hands back; the api never sees it. A mock one answers here.
 */
import { isServiceOnlyConnector, type HealthResult } from "@foundmill/connectors";
import { repos, type Executor } from "@foundmill/db";
import { AppError, connectorMode, ForbiddenError } from "@foundmill/shared";
import { z } from "zod";
import type { GatewayConnectResult } from "../services/gateway";
import { oauthRedirectUri, signConnectState, signInstallState, verifyConnectState, verifyInstallState } from "../services/install-state";
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
  return Object.fromEntries(Object.entries(settings).filter(([k]) => k === "repo" || k === "writeEnabled" || k === "repoId"));
}

/** Finishing an App installation (GitHub): what GitHub sent back to the founder, with the state Connect signed. */
const AppInstallation = z.object({ installationId: z.number().int().positive(), code: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), state: z.string().min(1).max(600) });

/** Finishing an OAuth consent (Google, Notion, Shopify): the code the vendor sent back, the state Connect signed and, for Shopify, the store. */
const OAuthFinish = z.object({ code: z.string().regex(/^[A-Za-z0-9._~/+=-]{1,2000}$/), state: z.string().min(1).max(1000), shop: z.string().max(200).optional() });

const admin = sectionAdmin("settings");

export const integrationsRouter = router({
  list: read.query(({ ctx }) =>
    ctx.rls(async (tx) => {
      const rows = await repos.integrations.list(tx, ctx.businessId);
      // A connector only the platform calls (openai_images, the faces of anthropomorphic agents) is not a business's to connect.
      const catalogue = ctx.connectors.catalogue(ctx.env.INTEGRATIONS_MODE).filter((c) => !isServiceOnlyConnector(c.key));
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
    // The platform's own connectors (openai_images) run on the platform key in the gateway; a business never connects one.
    if (isServiceOnlyConnector(input.connectorKey)) throw new AppError("service_only_connector", "This connector is run by the platform itself and cannot be connected for a business.", 400, { connector: input.connectorKey });
    // Static metadata only (auth kind, OAuth flow): a live connector never runs in the api (SEC-14).
    const connector = ctx.connectors.get(input.connectorKey, mode);

    let connected: GatewayConnectResult;
    if (mode === "live" && connector.auth.kind === "app") {
      // App connectors (GitHub) connect in the gateway, which holds the App's keys and checks with GitHub that the
      // founder who installed the App can manage the installation. The api only signs and checks the state.
      if (input.input.installationId === undefined) {
        const state = signInstallState(ctx.env.SESSION_TOKEN_SECRET, { userId: ctx.userId!, businessId: ctx.businessId });
        const first = (await ctx.gateway.connect(ctx.businessId, input.connectorKey, { state })).record;
        const consentUrl = typeof first.config.consentUrl === "string" ? first.config.consentUrl : null;
        // Nothing is written yet: an installation already connected stays as it is until the new one is confirmed.
        return { integration: await repos.integrations.getByKey(ctx.db, ctx.businessId, input.connectorKey), record: { ...first, connectorKey: input.connectorKey }, consentUrl, founderConsentRequired: consentUrl !== null };
      }
      const finish = AppInstallation.parse(input.input);
      verifyInstallState(ctx.env.SESSION_TOKEN_SECRET, finish.state, { userId: ctx.userId!, businessId: ctx.businessId });
      connected = await ctx.gateway.connect(ctx.businessId, input.connectorKey, { installationId: finish.installationId, code: finish.code });
    } else if (mode === "live" && connector.auth.authorizationCode) {
      // OAuth (Google, Notion, Shopify): the founder consents on the vendor's page, which sends them back to
      // /integrations/oauth/callback (apps/web) with a code and the state signed here. Nothing is written before the code
      // comes back signed for this founder, business and connector; the redirect URI is always the api's own. The
      // consent link and the code exchange run in the gateway, which holds the OAuth clients and seals the token.
      const redirectUri = oauthRedirectUri(ctx.env.APP_URL);
      if (typeof input.input.code !== "string") {
        const account = typeof input.input.shop === "string" ? input.input.shop.trim().toLowerCase() : null;
        const state = signConnectState(ctx.env.SESSION_TOKEN_SECRET, { userId: ctx.userId!, businessId: ctx.businessId, connectorKey: input.connectorKey, account });
        const first = (await ctx.gateway.connect(ctx.businessId, input.connectorKey, { ...(account ? { shop: account } : {}), state, redirectUri })).record;
        const consentUrl = typeof first.config.authorizeUrl === "string" ? first.config.authorizeUrl : null;
        return { integration: await repos.integrations.getByKey(ctx.db, ctx.businessId, input.connectorKey), record: { ...first, connectorKey: input.connectorKey }, consentUrl, founderConsentRequired: consentUrl !== null };
      }
      const finish = OAuthFinish.parse(input.input);
      const { account } = verifyConnectState(ctx.env.SESSION_TOKEN_SECRET, finish.state, { userId: ctx.userId!, businessId: ctx.businessId, connectorKey: input.connectorKey });
      if (account !== null && finish.shop?.toLowerCase() !== account) throw new ForbiddenError("This sign-in came back for a different store: connect again from Settings › Integrations");
      connected = await ctx.gateway.connect(ctx.businessId, input.connectorKey, { code: finish.code, redirectUri, ...(account ? { shop: account } : {}) });
    } else if (mode === "live") {
      // An API key the founder entered (SendGrid, Dropbox Sign, Cloudflare), a platform-key registry, a Plaid or Tink link.
      connected = await ctx.gateway.connect(ctx.businessId, input.connectorKey, input.input);
    } else {
      // Mock: the connector's mock answers here, so the golden path needs no gateway. It reaches nothing and hands back no
      // secret; one it did hand back would be dropped, never sealed as a business's credential.
      const { credentialToStore: _dropped, ...record } = await connector.connect(ctx.businessId, input.input);
      connected = { mode: "mock", record, integrationId: null, credential: null };
    }

    const { record, credential } = connected;
    const integration = await ctx.db.transaction(async (tx: Executor) => {
      // The gateway already wrote this row (and sealed the credential with it) when the vendor handed back a secret;
      // the founder's choices, the settings and who connected it are written here.
      const row = await repos.integrations.upsert(tx, ctx.businessId, {
        connectorKey: input.connectorKey,
        status: connected.mode === "mock" ? "mock" : record.status,
        authKind: connector.auth.kind,
        scopes: record.scopes,
        accountLabel: record.accountLabel,
        settings: { ...keptSettings(await repos.integrations.getByKey(tx, ctx.businessId, input.connectorKey), record.externalAccountId), externalAccountId: record.externalAccountId, config: record.config, expiresAt: record.expiresAt },
        connectedBy: ctx.userId,
      });
      await audit(tx, ctx, { action: "integrations.connect", target: { kind: "integration", id: row.id }, details: { connectorKey: input.connectorKey, status: row.status, accountLabel: record.accountLabel, secretStored: credential !== null, secretHint: credential?.hint ?? null, ...(credential ? { credentialId: credential.credentialId } : {}) } });
      return row;
    });
    const consentUrl = typeof record.config.linkUrl === "string" ? record.config.linkUrl : typeof record.config.consentUrl === "string" ? record.config.consentUrl : typeof record.config.authorizeUrl === "string" ? record.config.authorizeUrl : null;
    return { integration, record: { ...record, connectorKey: input.connectorKey }, consentUrl, founderConsentRequired: consentUrl !== null };
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

  // A health check can call the vendor in live mode and records its result, so it needs settings administration (a
  // viewer cannot run it). A disconnected integration is reported as such without calling anything.
  health: admin.input(z.object({ integrationId: Id })).mutation(async ({ ctx, input }) => {
    const integration = await repos.integrations.get(ctx.db, ctx.businessId, input.integrationId);
    if (integration.status === "disconnected" || integration.archivedAt !== null) {
      const result: HealthResult = { ok: false, status: "disconnected", checkedAt: new Date().toISOString(), latencyMs: 0, message: "Not connected: connect it again from Settings › Integrations" };
      return { integration, health: result };
    }
    const mode = connectorMode(ctx.env, integration.connectorKey);
    const settings = (integration.settings ?? {}) as Record<string, unknown>;
    // A live check reaches the vendor with keys only the gateway holds (SEC-14); a mock one answers here, without a gateway.
    const result: HealthResult = mode === "live" ? ((await ctx.gateway.health(ctx.businessId, integration.connectorKey)) as unknown as HealthResult) : await ctx.connectors.get(integration.connectorKey, "mock").healthcheck({
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
