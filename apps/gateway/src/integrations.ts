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
import { DecryptedCredentialSchema, PROVISIONAL_AAD_ROW, toIntegrationRecord } from "./credentials";
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
export function connectableConnector(deps: GatewayDeps, key: string): Connector {
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
  if (key === ANTHROPIC_KEY) throw new GatewayError("manage_in_keys", "The Anthropic key is stored in Settings › Keys", 400, { connector: key });
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

export async function connectIntegration(deps: GatewayDeps, input: ConnectInput, service: string): Promise<ConnectIntegrationResponse> {
  const connector = connectableConnector(deps, input.connector);
  await requireBusiness(deps, input.businessId);
  await limitIntegrations(deps, input.businessId);
  const mode = modeFor(deps, connector.key);
  const record = await connector.connect(input.businessId, input.input).catch((e: unknown) => vendorFailure(e, connector.key));
  const safe = stripSecret(record);

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
  const secret = mode === "live" ? record.credentialToStore : undefined;
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
  const stored = await deps.db.transaction(async (tx: Executor) => {
    const row = await repos.integrations.upsert(tx, input.businessId, { connectorKey: connector.key, status: record.status, authKind: connector.auth.kind, scopes: record.scopes, accountLabel: record.accountLabel });
    const meta = await repos.credentials.store(tx, input.businessId, { integrationId: row.id, kind: INTEGRATION_CREDENTIAL_KIND, record: provisional, expiresAt });
    const bound = await encryptJson(vault, credential, buildAad(input.businessId, "credentials", meta.id));
    await repos.credentials.rotate(tx, input.businessId, meta.id, bound);
    return { integrationId: row.id, credentialId: meta.id };
  });
  await auditIntegration(deps, input.businessId, "gateway.integration.connect", connector.key, { service, mode, status: record.status, secretStored: true, integrationId: stored.integrationId, credentialId: stored.credentialId });
  return { mode, record: safe, integrationId: stored.integrationId, credential: { stored: true, credentialId: stored.credentialId, hint: redactSecret(credential.secret) } };
}

export async function integrationHealth(deps: GatewayDeps, input: HealthInput, service: string): Promise<{ health: HealthResult }> {
  const connector = connectableConnector(deps, input.connector);
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
    health = await connector.healthcheck(toIntegrationRecord(row, null)).catch((e: unknown) => vendorFailure(e, connector.key));
  }
  await auditIntegration(deps, input.businessId, "gateway.integration.health_checked", connector.key, { service, mode, ok: health.ok, status: health.status });
  return { health };
}
