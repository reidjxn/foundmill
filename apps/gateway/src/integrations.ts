/**
 * `POST /v1/integrations/connect` and `POST /v1/integrations/health` (docs/ARCHITECTURE.md §9): Settings › Integrations
 * connects and checks a business's integration here, the one service holding the vendors' platform keys and OAuth
 * clients (BUILD §2.1 rule 2). Only the api asks (service token `svc: api`), after its own checks (settings
 * administration, the signed install or consent state); in mock mode it runs the connector's mock itself and never calls
 * these routes (SEC-14).
 *
 * - App connectors (GitHub): connect verifies the installer with the OAuth code and records the verified installation;
 *   health asks GitHub only for an installation this gateway verified.
 * - Every other connector: `connect()` runs here (an API key the founder entered, an OAuth consent link or code exchange,
 *   a Plaid or Tink link). A secret the vendor handed back (`credentialToStore`) is sealed with this gateway's vault
 *   under the row-bound AAD and stored under `INTEGRATION_CREDENTIAL_KIND`, with the integration row it belongs to, in
 *   one transaction; the answer carries the record without it, the row id, the credential's id and a four-character
 *   hint (what the api's audit row has always shown). Nothing is written for an answer without a secret (a consent
 *   link): the api writes the row's settings and its own audit row afterwards. `healthcheck()` runs on the stored row.
 *
 * Both are limited per business (`rl:<businessId>:integrations`) and audited; no secret reaches a log, an audit row or
 * the answer.
 */
import type { z } from "zod";
import { ANTHROPIC_KEY, BUILTIN_CONNECTOR_KEYS, isConfigError, isServiceOnlyConnector, type Connector, type HealthResult, type IntegrationRecord } from "@foundmill/connectors";
import { INTEGRATION_CREDENTIAL_KIND, repos, type Executor } from "@foundmill/db";
import { AppError, NotFoundError } from "@foundmill/shared";
import { buildAad, encryptJson, redactSecret } from "@foundmill/shared/crypto";
import { DecryptedCredentialSchema, loadCredential, PROVISIONAL_AAD_ROW, toIntegrationRecord } from "./credentials";
import { appInstallationVerified, GatewayError, modeFor, safeError, type GatewayDeps } from "./pipeline";
import { checkRateLimit } from "./rate-limit";
import type { ConnectIntegrationRequest, IntegrationHealthRequest } from "./types";

type ConnectInput = z.output<typeof ConnectIntegrationRequest>;
type HealthInput = z.output<typeof IntegrationHealthRequest>;

/** The window both routes count against, per business: a founder connects and checks a handful of times. */
export const INTEGRATIONS_SCOPE = "integrations";
export const INTEGRATIONS_LIMITS = { perMinute: 30, perDay: 500 } as const;

/** What connect answers: the record without any secret, plus where a sealed secret was stored. */
export interface ConnectIntegrationResponse {
  mode: "mock" | "live";
  record: Omit<IntegrationRecord, "credentialToStore">;
  /** The integration row the credential was stored with; null when nothing was written. */
  integrationId: string | null;
  /** The sealed credential, when the vendor handed one back: its row id and a hint (`redactSecret`, four characters). */
  credential: { stored: true; credentialId: string; hint: string } | null;
}

function stripSecret<T extends { credentialToStore?: unknown }>(record: T): Omit<T, "credentialToStore"> {
  const { credentialToStore: _never, ...safe } = record;
  return safe;
}

/** The connector a business may connect here: known, not the platform's own, not a built-in, not the Anthropic key. */
export function connectableConnector(deps: GatewayDeps, key: string, options: { allowAnthropic?: boolean } = {}): Connector {
  let connector: Connector;
  try {
    connector = deps.registry.get(key, modeFor(deps, key));
  } catch (e) {
    if (e instanceof NotFoundError) throw new GatewayError("unknown_connector", `Unknown connector "${key}"`, 404, { connector: key });
    throw e;
  }
  // The platform's own connectors run on the platform key; a business never connects one (or stores a key for one).
  if (isServiceOnlyConnector(key) || BUILTIN_CONNECTOR_KEYS.includes(key)) throw new GatewayError("service_only_connector", `${connector.displayName} is run by the platform itself and cannot be connected for a business`, 400, { connector: key });
  // The Anthropic key decides who pays for model calls: it is stored only through Settings › Keys (the api's keys.*).
  if (key === ANTHROPIC_KEY && !options.allowAnthropic) throw new GatewayError("manage_in_keys", "The Anthropic key is stored in Settings › Keys", 400, { connector: key });
  return connector;
}

const vendorFailure = (e: unknown, connector: string): never => {
  if (isConfigError(e)) throw new GatewayError("connector_unconfigured", e.message, 503, { connector });
  if (e instanceof AppError) throw e;
  const status = (e as { status?: unknown }).status;
  throw new GatewayError("vendor_error", typeof status === "number" ? `${connector} answered ${status}` : `${connector} could not be reached`, 502, { connector });
};

async function limitIntegrations(deps: GatewayDeps, businessId: string): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const limit = await checkRateLimit(deps.rateLimits, { businessId, connector: INTEGRATIONS_SCOPE, limits: INTEGRATIONS_LIMITS }, now().getTime());
  if (!limit.allowed) throw new GatewayError("rate_limited", `Too many integration requests for this business. Try again in ${limit.retryAfterSeconds} seconds.`, 429, { retryAfterSeconds: limit.retryAfterSeconds, scope: limit.scope, limit: limit.limit });
}

async function requireBusiness(deps: GatewayDeps, businessId: string): Promise<void> {
  await repos.businesses.get(deps.db, businessId).catch(() => {
    throw new GatewayError("business_not_found", `business ${businessId} is not available to this gateway`, 404);
  });
}

/** Best effort: an audit write that fails must not undo a connection already made with the vendor. */
async function auditIntegration(deps: GatewayDeps, businessId: string, action: string, connector: string, details: Record<string, unknown>): Promise<void> {
  await repos.audit.append(deps.db, businessId, { actorKind: "system", action, target: { connector }, details }).catch((e: unknown) => deps.log.warn({ err: safeError(e), businessId, connector }, "integration audit not written"));
}

/** Settings a reconnect to the same account keeps (the code repository chosen on Development › Code); the api uses the same rule. */
function keptSettings(row: { settings: unknown } | null, externalAccountId: string | null): Record<string, unknown> {
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  if (settings.externalAccountId !== externalAccountId) return {};
  return Object.fromEntries(Object.entries(settings).filter(([k]) => k === "repo" || k === "writeEnabled" || k === "repoId" || k === "contextReads"));
}

/**
 * Connect fields that carry a webhook signing secret, sealed as a second credential of `kind` on the same integration
 * (WP-11 T20, N2): ingest reads that kind to verify the project's own deliveries (apps/ingest secrets.ts).
 */
export const WEBHOOK_SECRET_FIELDS: Readonly<Record<string, { field: string; kind: "stripe_webhook_secret"; prefix: string }>> = {
  stripe: { field: "webhookSecret", kind: "stripe_webhook_secret", prefix: "whsec_" },
};

function takeWebhookSecret(connectorKey: string, connectInput: unknown): { input: unknown; secret: { kind: "stripe_webhook_secret"; value: string } | null } {
  const spec = Object.hasOwn(WEBHOOK_SECRET_FIELDS, connectorKey) ? WEBHOOK_SECRET_FIELDS[connectorKey]! : null;
  if (!spec || !connectInput || typeof connectInput !== "object") return { input: connectInput, secret: null };
  const { [spec.field]: raw, ...rest } = connectInput as Record<string, unknown>;
  const refuse = (message: string) => new GatewayError("invalid_webhook_secret", message, 400, { connector: connectorKey, field: spec.field });
  if (raw !== undefined && raw !== null && typeof raw !== "string") throw refuse(`A signing secret starts with ${spec.prefix}: copy it from the endpoint in your Stripe dashboard`);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") return { input: rest, secret: null };
  if (!new RegExp(`^${spec.prefix}[A-Za-z0-9]{8,200}$`).test(value)) throw refuse(`A signing secret starts with ${spec.prefix}: copy it from the endpoint in your Stripe dashboard`);
  // Stored only beside the founder's own key: a connect by account id alone verifies with the platform's secret.
  if (typeof (rest as { apiKey?: unknown }).apiKey !== "string" || !(rest as { apiKey: string }).apiKey.trim()) throw refuse("Add the signing secret together with your own restricted key");
  return { input: rest, secret: { kind: spec.kind, value } };
}

export async function connectIntegration(deps: GatewayDeps, input: ConnectInput, service: string): Promise<ConnectIntegrationResponse> {
  const connector = connectableConnector(deps, input.connector);
  await requireBusiness(deps, input.businessId);
  await limitIntegrations(deps, input.businessId);
  const mode = modeFor(deps, connector.key);
  // Tink's second step names the Tink user whose consents are read: it must be the user created for this business in
  // the first step (stored as the row's account), never one the request chooses.
  if (connector.key === "tink" && typeof (input.input as { userId?: unknown }).userId === "string") {
    const row = await repos.integrations.getByKey(deps.db, input.businessId, connector.key);
    const expected = (row?.settings as { externalAccountId?: unknown } | null | undefined)?.externalAccountId;
    if (typeof expected !== "string" || expected !== (input.input as { userId: string }).userId) {
      throw new GatewayError("account_mismatch", "This bank link does not belong to this business: start it again from Settings › Integrations", 403, { connector: connector.key });
    }
  }
  // IndexNow with no site address is for the project's Foundmill-hosted page (founder, 2026-11-12). The page's slug is
  // read here, from this business's own published page, and never taken from the request: a key then speaks only for
  // `/p/<that slug>`, and the web serves its key file only for the business that connected it.
  let connectInput: unknown = input.input;
  if (connector.key === "indexnow" && mode === "live") {
    const { hostedSlug: _never, ...given } = (input.input && typeof input.input === "object" ? input.input : {}) as Record<string, unknown>;
    connectInput = given;
    if (typeof given.host !== "string" || given.host.trim() === "") {
      const page = await repos.pages.get(deps.db, input.businessId);
      if (!page || page.published === null) throw new GatewayError("page_not_published", "Publish your public page first, or enter your own site's address", 400, { connector: connector.key });
      connectInput = { key: given.key, hostedSlug: page.slug };
    }
  }
  // A webhook signing secret given beside the key (WP-11 T20) is checked here, taken out before the connector sees the
  // input, and sealed below as its own credential row: never echoed, audited by kind only.
  const webhook = takeWebhookSecret(connector.key, connectInput);
  connectInput = webhook.input;
  const record = await connector.connect(input.businessId, connectInput).catch((e: unknown) => vendorFailure(e, connector.key));
  const safe = stripSecret(record);
  if (mode === "live" && record.status === "connected") await replacePreviousConnection(deps, input.businessId, connector, record);

  if (connector.auth.kind === "app") {
    const { verifiedBy, verifiedAt } = record.config as { verifiedBy?: unknown; verifiedAt?: unknown };
    if (record.status === "connected" && record.externalAccountId && typeof verifiedBy === "string" && typeof verifiedAt === "string") {
      // The one place a verified installation is recorded: only this service role write makes it usable.
      await repos.integrations.recordVerifiedInstallation(deps.db, input.businessId, { connectorKey: connector.key, installationId: record.externalAccountId, accountLabel: record.accountLabel, verifiedBy, verifiedAt: new Date(verifiedAt) });
      await repos.audit.append(deps.db, input.businessId, { actorKind: "system", action: "gateway.integration.connected", target: { connector: connector.key }, details: { service, mode, status: record.status, externalAccountId: record.externalAccountId, verifiedBy } });
    }
    return { mode, record: safe, integrationId: null, credential: null };
  }

  // A mock never hands back a secret, and nothing simulated is ever sealed as a business's credential.
  // A step that hands back no usable secret (Tink's first step names the user and nothing else) stores nothing.
  const secret = mode === "live" && record.credentialToStore?.secret ? record.credentialToStore : undefined;
  if (!secret) {
    await auditIntegration(deps, input.businessId, "gateway.integration.connect", connector.key, { service, mode, status: record.status, secretStored: false });
    return { mode, record: safe, integrationId: null, credential: null };
  }
  if (!deps.vault) throw new GatewayError("vault_unconfigured", "No vault is configured on the gateway (set KMS_KEY_ID or DEV_MASTER_KEY), so the credential cannot be stored", 503, { connector: connector.key });
  const vault = deps.vault;
  const credential = DecryptedCredentialSchema.parse(secret);
  const expiresAt = credential.expiresAt ? new Date(credential.expiresAt) : null;
  // The row id is part of the AAD and exists only after the insert: seal under the provisional AAD first (outside the
  // transaction, so the vault's lazy initialization never runs inside it), store, then re-seal under the row-bound AAD.
  const provisional = await encryptJson(vault, credential, buildAad(input.businessId, "credentials", PROVISIONAL_AAD_ROW));
  const webhookProvisional = webhook.secret ? await encryptJson(vault, { secret: webhook.secret.value }, buildAad(input.businessId, "credentials", PROVISIONAL_AAD_ROW)) : null;
  const stored = await deps.db.transaction(async (tx: Executor) => {
    // The account the credential belongs to is written with it, so the row never pairs a new credential with the
    // previous account's settings, even if the api's own write after this one fails. The api writes the same settings
    // again with who connected it.
    const existing = await repos.integrations.getByKey(tx, input.businessId, connector.key);
    const settings = { ...keptSettings(existing, record.externalAccountId), externalAccountId: record.externalAccountId, config: record.config, expiresAt: record.expiresAt };
    const row = await repos.integrations.upsert(tx, input.businessId, { connectorKey: connector.key, status: record.status, authKind: connector.auth.kind, scopes: record.scopes, accountLabel: record.accountLabel, settings });
    const meta = await repos.credentials.store(tx, input.businessId, { integrationId: row.id, kind: INTEGRATION_CREDENTIAL_KIND, record: provisional, expiresAt });
    const bound = await encryptJson(vault, credential, buildAad(input.businessId, "credentials", meta.id));
    await repos.credentials.rotate(tx, input.businessId, meta.id, bound);
    // A reconnect to another account without a new signing secret retires the old one: it would verify the previous
    // account's deliveries for this project (security review of WP-11 T20).
    const previousAccount = (existing?.settings as { externalAccountId?: unknown } | null | undefined)?.externalAccountId ?? null;
    const hookSpec = Object.hasOwn(WEBHOOK_SECRET_FIELDS, connector.key) ? WEBHOOK_SECRET_FIELDS[connector.key]! : null;
    if (hookSpec && !webhook.secret && previousAccount !== record.externalAccountId) {
      const stale = await repos.credentials.latest(tx, input.businessId, row.id, hookSpec.kind);
      if (stale) await repos.credentials.revoke(tx, input.businessId, stale.meta.id);
    }
    if (webhook.secret && webhookProvisional) {
      const hook = await repos.credentials.store(tx, input.businessId, { integrationId: row.id, kind: webhook.secret.kind, record: webhookProvisional, expiresAt: null });
      await repos.credentials.rotate(tx, input.businessId, hook.id, await encryptJson(vault, { secret: webhook.secret.value }, buildAad(input.businessId, "credentials", hook.id)));
    }
    return { integrationId: row.id, credentialId: meta.id };
  });
  await auditIntegration(deps, input.businessId, "gateway.integration.connect", connector.key, { service, mode, status: record.status, secretStored: true, integrationId: stored.integrationId, credentialId: stored.credentialId, ...(webhook.secret ? { webhookSecretStored: webhook.secret.kind } : {}) });
  return { mode, record: safe, integrationId: stored.integrationId, credential: { stored: true, credentialId: stored.credentialId, hint: redactSecret(credential.secret) } };
}

/** What a project is told when the Stripe account it signed in with is another project's (0137). */
export const STRIPE_ACCOUNT_IN_USE = "This Stripe account is already connected to another project.";

const isSignIn = (config: unknown): boolean => (config as { kind?: unknown } | null | undefined)?.kind === "connect";

/**
 * Before a new live connection replaces the project's previous one: an account signed in with ("Sign in with Stripe")
 * may belong to one project only, so another project's account is refused before anything changes (0137 also refuses
 * it in the database). Withdrawing the previous sign-in waits until the api has saved the new connection
 * (`releaseAccount`), so a failed save never leaves the project without either (security review, Nov 17, 2026).
 */
async function replacePreviousConnection(deps: GatewayDeps, businessId: string, connector: Connector, record: IntegrationRecord): Promise<void> {
  if (connector.key !== "stripe" || !record.externalAccountId || !isSignIn(record.config)) return;
  const owner = await repos.integrations.businessForStripeAccount(deps.db, record.externalAccountId);
  if (owner !== null && owner !== businessId) throw new GatewayError("account_in_use", STRIPE_ACCOUNT_IN_USE, 409, { connector: connector.key });
}

/**
 * After the api saved a new connection over a sign-in: withdraws Foundmill's access to the previous account at Stripe.
 * Only for an account no project is signed in with any more, so it can never cut another project's connection (nor this
 * project's current one). Best effort and audited either way.
 */
export async function releaseAccount(deps: GatewayDeps, input: { businessId: string; connector: string; externalAccountId: string }, service: string): Promise<{ released: boolean }> {
  const connector = connectableConnector(deps, input.connector);
  await limitIntegrations(deps, input.businessId);
  if (connector.key !== "stripe" || !connector.disconnect || modeFor(deps, connector.key) !== "live") return { released: false };
  if ((await repos.integrations.businessForStripeAccount(deps.db, input.externalAccountId)) !== null) throw new GatewayError("account_in_use", "That Stripe account is still connected to a project, so its access is kept", 409, { connector: connector.key });
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const previous: IntegrationRecord = { id: "released", businessId: input.businessId, connectorKey: connector.key, status: "connected", scopes: [], accountLabel: null, externalAccountId: input.externalAccountId, config: { kind: "connect" }, credentialRef: null, expiresAt: null, lastHealthAt: null, createdAt: now };
  const released = await connector.disconnect(previous).catch((e: unknown) => (deps.log.warn({ connector: connector.key, businessId: input.businessId, err: (e as Error).message }, "previous Stripe sign-in could not be withdrawn"), false));
  await auditIntegration(deps, input.businessId, "gateway.integration.access_released", connector.key, { service, released, from: input.externalAccountId, reason: "replaced" });
  return { released };
}

/**
 * Disconnecting: withdraws the platform's access at the vendor where the connector does that (a Stripe sign-in), before
 * the api forgets the connection and revokes its credentials. Best effort: the founder may already have removed it.
 */
export async function releaseIntegration(deps: GatewayDeps, input: HealthInput, service: string): Promise<{ released: boolean }> {
  const connector = connectableConnector(deps, input.connector);
  await limitIntegrations(deps, input.businessId);
  const row = await repos.integrations.getByKey(deps.db, input.businessId, connector.key);
  if (!row || row.archivedAt !== null || row.status === "disconnected" || modeFor(deps, connector.key) !== "live" || !connector.disconnect) return { released: false };
  const record = toIntegrationRecord(row, null);
  const released = await connector.disconnect(record).catch((e: unknown) => (deps.log.warn({ connector: connector.key, businessId: input.businessId, err: (e as Error).message }, "vendor access could not be withdrawn"), false));
  await auditIntegration(deps, input.businessId, "gateway.integration.access_released", connector.key, { service, released, from: record.externalAccountId, reason: "disconnected" });
  return { released };
}

export async function integrationHealth(deps: GatewayDeps, input: HealthInput, service: string): Promise<{ health: HealthResult }> {
  // The Anthropic key is stored only through Settings › Keys, but checking it is read-only and allowed here.
  const connector = connectableConnector(deps, input.connector, { allowAnthropic: true });
  await limitIntegrations(deps, input.businessId);
  const row = await repos.integrations.getByKey(deps.db, input.businessId, connector.key);
  if (!row || row.archivedAt !== null) throw new GatewayError("integration_not_connected", `${connector.displayName} is not connected for this business`, 409, { connector: connector.key });
  const mode = modeFor(deps, connector.key);
  const now = deps.now ?? (() => new Date());
  let health: HealthResult;
  if (connector.auth.kind === "app" && (mode !== "live" || !appInstallationVerified(row, await repos.integrations.verifiedInstallation(deps.db, input.businessId, connector.key)))) {
    // Only a live installation this gateway verified is ever checked with the vendor (no token for any other id).
    health = { ok: false, status: "disconnected", checkedAt: now().toISOString(), latencyMs: 0, message: `${connector.displayName} is not connected through a verified installation; connect it again from Settings › Integrations` };
  } else {
    // An API-key connector checks the business's own key (decrypted for this call only), never a platform key.
    const credential = mode === "live" && deps.vault && connector.auth.kind !== "none" ? await loadCredential(deps.db, deps.vault, input.businessId, row.id).catch(() => null) : null;
    health = await connector.healthcheck(toIntegrationRecord(row, credential), credential?.credential).catch((e: unknown) => vendorFailure(e, connector.key));
  }
  await auditIntegration(deps, input.businessId, "gateway.integration.health_checked", connector.key, { service, mode, ok: health.ok, status: health.status });
  return { health };
}
