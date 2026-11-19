/**
 * integrations.list/connect/disconnect/health and keys.setAnthropic/validate/rotate/revoke (BUILD §11.15, §10.2).
 * OAuth consents are founder clicks (hard gate): `connect` hands back the vendor's consent URL when the connector
 * needs one. A connector that runs live is connected and checked by the gateway (SEC-14), which holds the vendors' keys
 * and seals any secret the vendor hands back; the api never sees it. A mock one answers here.
 */
import { INPUT_LIMITS } from "@foundmill/config";
import { isServiceOnlyConnector, MOCK_ONLY_CONNECTORS, type HealthResult } from "@foundmill/connectors";
import { repos, type Executor } from "@foundmill/db";
import { AppError, boundedRecord, connectorMode, ForbiddenError, mockResultsAllowed, platformMailAddress, platformMailDomain, platformMailLive } from "@foundmill/shared";
import { z } from "zod";
import type { GatewayConnectResult } from "../services/gateway";
import { clearPostalAddress, isProjectFounder, postalAddressOf, setPostalAddress } from "../services/postal-address";
import { oauthRedirectUri, signConnectState, signInstallState, verifyConnectState, verifyInstallState } from "../services/install-state";
import { ANTHROPIC, revokeAnthropicKey, storeAnthropicKey, validateAnthropicKey } from "../services/keys";
import { Id, audit, router, sectionAdmin, sectionRead } from "../trpc";

/** What a project is told when the Stripe account it signed in with is another project's (0137; the gateway's own words). */
export const STRIPE_ACCOUNT_IN_USE = "This Stripe account is already connected to another project.";

/** A Stripe connection made by signing in (Connect), as `config.kind` records it. */
const isSignIn = (config: unknown): boolean => (config as { kind?: unknown } | null | undefined)?.kind === "connect";

/** A non-blank pasted key: the one input that takes a sign-in connector (Stripe) down the key path instead of OAuth. */
const pastedKey = (input: Record<string, unknown>): boolean => typeof input.apiKey === "string" && input.apiKey.trim() !== "";

/** The connect input without what only the OAuth exchange may carry. */
function withoutOAuthFields(input: Record<string, unknown>): Record<string, unknown> {
  const { code: _code, state: _state, redirectUri: _redirectUri, shop: _shop, ...rest } = input;
  return rest;
}

/** A Postgres unique violation of one named index, however the driver wraps it. */
function isUniqueViolation(e: unknown, constraint: string): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 4; cur = (cur as { cause?: unknown }).cause, i++) {
    const err = cur as { code?: unknown; constraint?: unknown; message?: unknown };
    if (err.code === "23505" && (err.constraint === constraint || (typeof err.message === "string" && err.message.includes(constraint)))) return true;
  }
  return false;
}

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
        catalogue: catalogue.map((c) => {
          const live = connectorMode(ctx.env, c.key) === "live";
          // Whether it can be connected here: live, or a mock where simulated results are allowed (WP-02 T3).
          // A connector with no live build (MOCK_ONLY_CONNECTORS) is not available live, so Settings hides it unless connected.
          return { ...c, live, available: live ? !MOCK_ONLY_CONNECTORS.has(c.key) : mockResultsAllowed(ctx.env.APP_ENV, ctx.business.isDemo), integration: rows.find((r) => r.connectorKey === c.key) ?? null };
        }),
      };
    }),
  ),

  /**
   * The project's Foundmill sending address (package 1.5), for Settings › Integrations: null when the deployment has no
   * sending domain (no row is shown). The address is chosen here on first view if no send chose it yet (service
   * connection: no app role writes `project_mail`), then kept. `sentToday` counts `mail.sent` since midnight UTC, the
   * window the gateway's cap uses; `cap` is the operator's override for this project, else the deployment's default.
   * `postalAddress` is the founders' own (0101, US CAN-SPAM), read under RLS: null for a collaborator, who sees only
   * whether one is needed (`canEditPostalAddress` false).
   */
  platformMail: read.query(async ({ ctx }) => {
    const domain = platformMailDomain(ctx.env);
    if (!domain) return null;
    const row = await repos.projectMail.ensure(ctx.db, ctx.businessId);
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const { counts, owns } = await ctx.rls(async (tx) => ({ counts: await repos.events.countByType(tx, ctx.businessId, { from: since }), owns: [await repos.integrations.getByKey(tx, ctx.businessId, "sendgrid"), await repos.integrations.getByKey(tx, ctx.businessId, "resend")] }));
    const postalAddress = await postalAddressOf(ctx);
    return {
      address: platformMailAddress(row.localPart, domain),
      sentToday: counts["mail.sent"] ?? 0,
      cap: row.dailyCap ?? ctx.env.PLATFORM_MAIL_DAILY_CAP,
      paused: row.status !== "active",
      live: platformMailLive(ctx.env),
      // The founder's own sender, SendGrid or Resend: the gateway sends from it and the project's address steps aside.
      ownSender: owns.some((own) => own !== null && own.archivedAt === null && (own.status === "connected" || (own.status === "degraded" && own.connectorKey !== "resend"))),
      postalAddress,
      canEditPostalAddress: isProjectFounder(ctx),
    };
  }),

  /** The founders enter or change the project's postal address for marketing email (US CAN-SPAM); answers the open note. */
  setPostalAddress: admin.input(z.object({ address: z.string().max(1_000) })).mutation(({ ctx, input }) => setPostalAddress(ctx, input.address)),

  /** The founders remove it: marketing email from the project's address waits again until one is entered. */
  clearPostalAddress: admin.mutation(({ ctx }) => clearPostalAddress(ctx)),

  connect: admin.input(z.object({ connectorKey: z.string().min(1).max(60), input: boundedRecord(INPUT_LIMITS.jsonObjectKeys, z.record(z.string(), z.unknown())).default({}) })).mutation(async ({ ctx, input }) => {
    const mode = connectorMode(ctx.env, input.connectorKey);
    if (!ctx.connectors.has(input.connectorKey)) throw new AppError("not_found", `Unknown connector ${input.connectorKey}`, 404);
    // The Anthropic key decides who pays for model calls and resumes a stopped team: it is stored only through
    // Settings › Keys (`storeAnthropicKey`), never as a generic connection that would skip all of that (audit ARB-04).
    if (input.connectorKey === ANTHROPIC) throw new AppError("validation", "The Anthropic key is stored in Settings › Keys, where it is checked and the team moves onto it.", 400, { manageIn: "keys" });
    // The platform's own connectors (openai_images) run on the platform key in the gateway; a business never connects one.
    if (isServiceOnlyConnector(input.connectorKey)) throw new AppError("service_only_connector", "This connector is run by the platform itself and cannot be connected for a business.", 400, { connector: input.connectorKey });
    // Static metadata only (auth kind, OAuth flow): a live connector never runs in the api (SEC-14).
    const connector = ctx.connectors.get(input.connectorKey, mode);
    // A mock connect on a person's project writes a row that looks connected and does nothing (audit a5 GTM-16).
    if (mode === "mock" && !mockResultsAllowed(ctx.env.APP_ENV, ctx.business.isDemo)) throw new AppError("connector_not_live", `${connector.displayName} is not available yet. Nothing was connected.`, 409, { connector: input.connectorKey });

    // The connection as it was before this connect: the gateway rewrites the row itself when it seals a key, so what is
    // replaced (the previous sign-in to withdraw, a key to revoke) is read first.
    const prior = await repos.integrations.getByKey(ctx.db, ctx.businessId, input.connectorKey);
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
    } else if (mode === "live" && connector.auth.authorizationCode && !pastedKey(input.input)) {
      // OAuth (Google, Notion, Shopify): the founder consents on the vendor's page, which sends them back to
      // /integrations/oauth/callback (apps/web) with a code and the state signed here. Nothing is written before the code
      // comes back signed for this founder, business and connector; the redirect URI is always the api's own. The
      // consent link and the code exchange run in the gateway, which holds the OAuth clients and seals the token.
      const redirectUri = oauthRedirectUri(ctx.env.APP_URL);
      if (typeof input.input.code !== "string") {
        const account = typeof input.input.shop === "string" ? input.input.shop.trim().toLowerCase() : null;
        const state = signConnectState(ctx.env.SESSION_TOKEN_SECRET, { userId: ctx.userId!, businessId: ctx.businessId, connectorKey: input.connectorKey, account });
        const first = (await ctx.gateway.connect(ctx.businessId, input.connectorKey, { ...(account ? { shop: account } : {}), ...(input.connectorKey === "gmail" && input.input.readMail === true ? { readMail: true } : {}), state, redirectUri })).record;
        const consentUrl = typeof first.config.authorizeUrl === "string" ? first.config.authorizeUrl : null;
        return { integration: await repos.integrations.getByKey(ctx.db, ctx.businessId, input.connectorKey), record: { ...first, connectorKey: input.connectorKey }, consentUrl, founderConsentRequired: consentUrl !== null };
      }
      const finish = OAuthFinish.parse(input.input);
      const { account } = verifyConnectState(ctx.env.SESSION_TOKEN_SECRET, finish.state, { userId: ctx.userId!, businessId: ctx.businessId, connectorKey: input.connectorKey });
      if (account !== null && finish.shop?.toLowerCase() !== account) throw new ForbiddenError("This sign-in came back for a different store: connect again from Settings › Integrations");
      connected = await ctx.gateway.connect(ctx.businessId, input.connectorKey, { code: finish.code, redirectUri, state: finish.state, ...(account ? { shop: account } : {}) });
    } else if (mode === "live") {
      // An API key the founder entered (SendGrid, Dropbox Sign, Cloudflare, or Stripe's second way in beside "Sign in with
      // Stripe"), a platform-key registry, a Plaid or Tink link.
      // Beside a sign-in (Stripe), the key path carries no OAuth fields: a code reaches the gateway only through the
      // branch above, after its state was checked for this founder, project and connector (security review, Nov 17).
      connected = await ctx.gateway.connect(ctx.businessId, input.connectorKey, connector.auth.authorizationCode ? withoutOAuthFields(input.input) : input.input);
    } else {
      // Mock: the connector's mock answers here, so the golden path needs no gateway. It reaches nothing and hands back no
      // secret; one it did hand back would be dropped, never sealed as a business's credential.
      const { credentialToStore: _dropped, ...record } = await connector.connect(ctx.businessId, input.input);
      connected = { mode: "mock", record, integrationId: null, credential: null };
    }

    const { record, credential } = connected;
    let releaseAfter: string | null = null;
    const integration = await ctx.db.transaction(async (tx: Executor) => {
      const before = await repos.integrations.getByKey(tx, ctx.businessId, input.connectorKey);
      const previousAccount = prior && prior.status !== "disconnected" ? ((prior.settings as { externalAccountId?: string | null } | null)?.externalAccountId ?? null) : null;
      const priorConfig = (prior?.settings as { config?: unknown } | null | undefined)?.config;
      // A sign-in that replaces a pasted key revokes the key in the same transaction (Stripe); the previous sign-in is
      // withdrawn at Stripe only after this commits (below).
      if (before && isSignIn(record.config) && !isSignIn(priorConfig)) {
        for (const m of await repos.credentials.listMetadata(tx, ctx.businessId, { integrationId: before.id })) await repos.credentials.revoke(tx, ctx.businessId, m.id);
      }
      if (previousAccount && isSignIn(priorConfig) && !(isSignIn(record.config) && previousAccount === record.externalAccountId)) releaseAfter = previousAccount;
      // The gateway already wrote this row (and sealed the credential with it) when the vendor handed back a secret;
      // the founder's choices, the settings and who connected it are written here.
      const row = await repos.integrations.upsert(tx, ctx.businessId, {
        connectorKey: input.connectorKey,
        status: connected.mode === "mock" ? "mock" : record.status,
        authKind: connector.auth.kind,
        scopes: record.scopes,
        accountLabel: record.accountLabel,
        settings: { ...keptSettings(before, record.externalAccountId), externalAccountId: record.externalAccountId, config: record.config, expiresAt: record.expiresAt },
        connectedBy: ctx.userId,
      });
      // A reconnect to another account names both, so the audit says which account replaced which.
      const replaced = previousAccount !== null && record.externalAccountId !== null && previousAccount !== record.externalAccountId ? { previousAccount, account: record.externalAccountId } : {};
      await audit(tx, ctx, { action: "integrations.connect", target: { kind: "integration", id: row.id }, details: { connectorKey: input.connectorKey, status: row.status, accountLabel: record.accountLabel, secretStored: credential !== null, secretHint: credential?.hint ?? null, ...(credential ? { credentialId: credential.credentialId } : {}), ...replaced } });
      return row;
    }).catch((e: unknown) => {
      // 0137: a Stripe account signed in with belongs to one project (the gateway refuses it first; this is the race).
      if (isUniqueViolation(e, "integrations_stripe_connect_account_key")) throw new AppError("account_in_use", STRIPE_ACCOUNT_IN_USE, 409, { connector: input.connectorKey });
      throw e;
    });
    // The new connection is saved: the previous sign-in's access at Stripe can go (best effort; the gateway audits it).
    if (releaseAfter && mode === "live" && ctx.gateway.release) await ctx.gateway.release(ctx.businessId, input.connectorKey, releaseAfter).catch(() => null);
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
    // A Stripe sign-in also has Foundmill's access withdrawn in Stripe first (the gateway does it; best effort, so a
    // founder who already removed it there can still disconnect here).
    const mode = connectorMode(ctx.env, target.connectorKey);
    const vendorAccess = mode === "live" && ctx.connectors.has(target.connectorKey) && typeof ctx.connectors.get(target.connectorKey, mode).disconnect === "function" && ctx.gateway.disconnect ? await ctx.gateway.disconnect(ctx.businessId, target.connectorKey).catch(() => ({ released: false })) : null;
    return ctx.db.transaction(async (tx: Executor) => {
      const integration = await repos.integrations.get(tx, ctx.businessId, input.integrationId);
      const metas = await repos.credentials.listMetadata(tx, ctx.businessId, { integrationId: integration.id });
      for (const m of metas) await repos.credentials.revoke(tx, ctx.businessId, m.id);
      const row = await repos.integrations.disconnect(tx, ctx.businessId, integration.id);
      await audit(tx, ctx, { action: "integrations.disconnect", target: { kind: "integration", id: row.id }, details: { connectorKey: row.connectorKey, credentialsRevoked: metas.length, ...(vendorAccess ? { vendorAccessReleased: vendorAccess.released } : {}) } });
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
