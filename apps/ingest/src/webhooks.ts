/**
 * Webhook receivers (docs/ARCHITECTURE.md §1 "apps/ingest", BUILD §13.1 `webhooks`, §14).
 *
 * `POST /webhooks/:connector[/:businessId]` routes to the connector's `webhooks[]` entry whose path matches
 * (`stripe`, `sendgrid`, `sendgrid-inbound`, `github`, `shopify`, `dropbox_sign`…). The raw body is never
 * parsed before the connector's `verify()` has read it — verification is over the bytes the vendor signed.
 * Order of checks: known connector → replay probe (409 for a delivery already accepted) → timestamp window
 * (401 stale) → `verify()` (401 otherwise) → claim the nonce → `normalise()` → (staging/production) the business has
 * that connector connected (404 otherwise) → write through the outbox → after-commit follow-ups.
 *
 * Which webhooks exist depends on the deployment, not only on INTEGRATIONS_MODE: a mock connector's verifier checks
 * signatures against secrets committed to the repository, so mock webhooks are mounted only in development and test.
 * In staging and production a connector's webhook is mounted only when it runs live (INTEGRATIONS_MODE=live or
 * LIVE_CONNECTORS) and verifies with real per-business or platform secrets; any other `/webhooks/<connector>` is 404.
 */
import { DROPBOX_SIGN_CALLBACK_RESPONSE, mockWebhooksAllowed, type ConnectorMode, type ConnectorWebhook } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { AppError, NotFoundError, isUuid, type IntegrationStatus } from "@foundmill/shared";
import { ingestPlatformEvents, isValidationError, type IngestResult } from "./ingest";
import { nonceKey } from "./nonce-store";
import { identifyDelivery, splitConnectorSegment, withinReplayWindow, type DeliveryIdentity } from "./replay";
import type { IngestDeps } from "./types";

export interface MountedWebhook {
  /** Registry key of the connector (`sendgrid`). */
  connector: string;
  /** Path segment the vendor posts to (`sendgrid-inbound`). */
  segment: string;
  /** The connector's declared mount path (`/webhooks/sendgrid-inbound/:businessId`). */
  path: string;
  /** Whether the live connector or its mock verifies deliveries. */
  mode: ConnectorMode;
  webhook: ConnectorWebhook;
}

export interface WebhookMounts {
  mounted: MountedWebhook[];
  /** Connectors whose mock webhooks this deployment refuses (staging and production). */
  refused: string[];
}

/** The webhooks this deployment mounts, keyed by path segment, and the connectors it refuses (see the header). */
export function webhookMounts(deps: Pick<IngestDeps, "registry" | "mode" | "env" | "liveConnectors">): WebhookMounts {
  const { mounted, refused } = deps.registry.mountableWebhooks({ mode: deps.mode, appEnv: deps.env.APP_ENV, liveConnectors: deps.liveConnectors });
  return {
    mounted: mounted.map(({ connector, mode, path, webhook }) => {
      const segment = path.replace(/^\/webhooks\//, "").replace(/\/:businessId$/, "");
      return { connector, segment, path, mode, webhook };
    }),
    refused,
  };
}

/** Every webhook this deployment mounts, keyed by its path segment. */
export const mountedWebhooks = (deps: Pick<IngestDeps, "registry" | "mode" | "env" | "liveConnectors">): MountedWebhook[] => webhookMounts(deps).mounted;

/** Integration states that still receive the vendor's deliveries (an expired credential does not stop Stripe sending). */
export const RECEIVING_STATUSES: readonly IntegrationStatus[] = ["connected", "degraded", "expired"];

/**
 * Outside development and test a delivery is written only for a business that connected that connector live: the
 * `:businessId` in the URL is not part of what the vendor signs, so it is not proof on its own.
 */
export const requiresConnectedIntegration = (deps: Pick<IngestDeps, "env">): boolean => !mockWebhooksAllowed(deps.env.APP_ENV);

type IntegrationRow = NonNullable<Awaited<ReturnType<typeof repos.integrations.getByKey>>>;

/** The business's integration for the connector when it may receive deliveries (connected or degraded, not archived). */
async function connectedIntegration(deps: IngestDeps, businessId: string, connectorKey: string): Promise<IntegrationRow | null> {
  const integration = await repos.integrations.getByKey(deps.db, businessId, connectorKey);
  return integration !== null && integration.archivedAt === null && (RECEIVING_STATUSES as readonly string[]).includes(integration.status) ? integration : null;
}

const sameAccount = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether a delivery that names vendor account `claimed` belongs to the business whose integration this is
 * (SECURITY_REVIEW SEC-10). The signature proves the vendor sent it; with a secret shared by every business (a
 * platform endpoint secret, a GitHub App's secret) it does not prove for whom, so the account the delivery names must
 * be the one this business connected:
 * - GitHub: the installation the gateway verified for the business (`app_installations`), else the stored account id.
 * - Shopify: the shop domain the business connected.
 * - Stripe through the platform (Connect): the connected account. Stripe on the founder's own key: the delivery names
 *   no account, or the business's own, and the business has its own endpoint secret; without one the delivery could
 *   only have been verified with the platform's secret, which says nothing about this business.
 * Returns null when it belongs, else the reason for the log.
 */
export async function accountMismatch(deps: Pick<IngestDeps, "db">, integration: IntegrationRow, connectorKey: string, claimed: string | null): Promise<string | null> {
  const settings = (integration.settings ?? {}) as { externalAccountId?: string | null; config?: { kind?: unknown } };
  const stored = settings.externalAccountId ?? null;
  if (connectorKey === "github") {
    const verified = await repos.integrations.verifiedInstallation(deps.db, integration.businessId, connectorKey);
    const expected = verified?.installationId ?? stored;
    return sameAccount(claimed, expected) ? null : "the delivery names another installation than the one this business connected";
  }
  if (connectorKey === "stripe" && settings.config?.kind !== "connect") {
    if (claimed !== null && !sameAccount(claimed, stored)) return "the delivery names another Stripe account than the one this business connected";
    const own = await repos.credentials.latest(deps.db, integration.businessId, integration.id, "stripe_webhook_secret");
    return own ? null : "this business has no endpoint secret of its own, so the delivery was not verified for it";
  }
  return sameAccount(claimed, stored) ? null : "the delivery names another account than the one this business connected";
}

export const findWebhook = (mounted: readonly MountedWebhook[], segment: string): MountedWebhook | null => mounted.find((m) => m.segment === segment) ?? null;

/** Whether `/webhooks/<segment>` belongs to a connector whose mock webhooks this deployment refuses. */
function refusedSegment(deps: IngestDeps, segment: string): boolean {
  const { connector } = splitConnectorSegment(segment);
  return !mockWebhooksAllowed(deps.env.APP_ENV) && deps.registry.has(connector) && !(deps.mode === "live" || deps.liveConnectors.includes(connector));
}

export type WebhookOutcome =
  | { status: 200; body: { ok: true; connector: string; deliveryId: string; accepted: number; written: number; duplicates: number; eventIds: string[] } }
  | { status: 401 | 404 | 409 | 422; body: { ok: false; error: string; message: string; connector?: string; details?: unknown } };

export interface WebhookRequestContext {
  /** The route segment (`stripe`, `sendgrid-inbound`). */
  segment: string;
  /** `:businessId` from the URL when present. */
  businessId: string | null;
  req: Request;
}

/**
 * Handle one delivery. Pure with respect to HTTP framing: takes the Request, returns status + JSON body, so
 * tests can drive it directly and the Hono layer stays a few lines.
 */
export async function handleWebhook(deps: IngestDeps, mounted: readonly MountedWebhook[], ctx: WebhookRequestContext): Promise<WebhookOutcome> {
  const { log } = deps;
  const target = findWebhook(mounted, ctx.segment);
  const { connector } = splitConnectorSegment(ctx.segment);
  if (!target) {
    if (refusedSegment(deps, ctx.segment)) {
      log.warn({ connector, env: deps.env.APP_ENV }, "mock webhook delivery refused outside development/test");
      return { status: 404, body: { ok: false, error: "unknown_connector", message: `No webhook is mounted at /webhooks/${ctx.segment}: mock deliveries are accepted in development and test only`, connector } };
    }
    return { status: 404, body: { ok: false, error: "unknown_connector", message: `No webhook is mounted at /webhooks/${ctx.segment} in ${deps.mode} mode`, connector } };
  }
  if (ctx.businessId !== null && !isUuid(ctx.businessId)) return { status: 404, body: { ok: false, error: "unknown_business", message: "businessId must be a UUID", connector } };

  const body = await ctx.req.clone().text();
  const identity: DeliveryIdentity = identifyDelivery(target.connector, ctx.req.headers, body);
  const nonce = nonceKey(target.segment, identity.deliveryId);

  if (await deps.nonces.has(nonce)) {
    log.warn({ connector: target.connector, deliveryId: identity.deliveryId, businessId: ctx.businessId }, "replayed webhook delivery refused");
    return { status: 409, body: { ok: false, error: "replayed", message: "This delivery was already accepted", connector: target.connector } };
  }
  if (!withinReplayWindow(identity.timestampSeconds, deps.now().getTime(), deps.replayWindowSeconds)) {
    log.warn({ connector: target.connector, deliveryId: identity.deliveryId, timestamp: identity.timestampSeconds }, "stale webhook delivery refused");
    return { status: 401, body: { ok: false, error: "stale_timestamp", message: `Delivery timestamp is outside the ${deps.replayWindowSeconds} s window`, connector: target.connector } };
  }

  const verified = await target.webhook.verify(ctx.req).catch((e: unknown) => {
    log.warn({ connector: target.connector, err: (e as Error).message }, "webhook verify threw");
    return false;
  });
  if (!verified) {
    log.warn({ connector: target.connector, deliveryId: identity.deliveryId, businessId: ctx.businessId, idSource: identity.idSource }, "webhook signature verification failed");
    return { status: 401, body: { ok: false, error: "invalid_signature", message: "Signature verification failed", connector: target.connector } };
  }
  if (!(await deps.nonces.claim(nonce, deps.nonceTtlMs))) {
    return { status: 409, body: { ok: false, error: "replayed", message: "This delivery was already accepted", connector: target.connector } };
  }

  // From here on the nonce is held; any failure to persist releases it so the vendor's retry is accepted.
  let events;
  try {
    events = await target.webhook.normalise(ctx.req);
  } catch (e) {
    await deps.nonces.release(nonce);
    log.error({ connector: target.connector, err: (e as Error).message }, "webhook normalise failed");
    return { status: 422, body: { ok: false, error: "invalid_payload", message: (e as Error).message, connector: target.connector } };
  }

  // The founder withdrew Foundmill's access in the vendor's dashboard (a Stripe sign-in): that connection is marked
  // expired, so Settings › Integrations offers to sign in again and no agent call reaches the account meanwhile.
  const revoked = target.webhook.revokedAccount ? await target.webhook.revokedAccount(ctx.req).catch(() => null) : null;
  if (revoked) {
    const outcome = await markAccessRevoked(deps, target.connector, revoked, ctx.businessId);
    log.info({ connector: target.connector, deliveryId: identity.deliveryId, businessId: outcome.businessId, marked: outcome.marked }, "vendor access withdrawn");
    return { status: 200, body: { ok: true, connector: target.connector, deliveryId: identity.deliveryId, accepted: 0, written: 0, duplicates: 0, eventIds: [] } };
  }

  if (ctx.businessId) {
    const foreign = events.find((e) => e.businessId !== ctx.businessId);
    if (foreign) {
      await deps.nonces.release(nonce);
      return { status: 422, body: { ok: false, error: "business_mismatch", message: "Normalized events must belong to the business in the URL", connector: target.connector } };
    }
  }

  if (requiresConnectedIntegration(deps)) {
    // The account a delivery names is read once; a vendor whose scheme names none (`accountOf` absent) is not bound here.
    const claimed = target.webhook.accountOf ? await target.webhook.accountOf(ctx.req).catch(() => null) : undefined;
    for (const businessId of new Set(events.map((e) => e.businessId))) {
      const integration = await connectedIntegration(deps, businessId, target.connector);
      if (!integration) {
        await deps.nonces.release(nonce);
        log.warn({ connector: target.connector, businessId, deliveryId: identity.deliveryId }, "webhook for a business without that connector connected refused");
        return { status: 404, body: { ok: false, error: "not_connected", message: `This business has no connected ${target.connector} integration`, connector: target.connector } };
      }
      if (claimed === undefined) continue;
      const mismatch = await accountMismatch(deps, integration, target.connector, claimed);
      if (!mismatch) continue;
      await deps.nonces.release(nonce);
      log.warn({ connector: target.connector, businessId, deliveryId: identity.deliveryId, reason: mismatch }, "webhook for another account than the business connected refused");
      return { status: 422, body: { ok: false, error: "business_mismatch", message: "This delivery belongs to a different account than the business in the URL connected", connector: target.connector } };
    }
  }

  let result: IngestResult;
  try {
    result = await ingestPlatformEvents(deps.db, events, { source: target.connector, actor: { kind: "webhook", id: target.connector }, log });
  } catch (e) {
    await deps.nonces.release(nonce);
    if (e instanceof NotFoundError) return { status: 404, body: { ok: false, error: "unknown_business", message: e.message, connector: target.connector } };
    if (isValidationError(e)) return { status: 422, body: { ok: false, error: "invalid_payload", message: e.message, connector: target.connector, details: e.details } };
    throw e;
  }

  const businessIds = [...new Set(events.map((e) => e.businessId))];
  await stampWebhookRows(deps, target, businessIds);
  deps.followups.dispatch(result);

  return { status: 200, body: { ok: true, connector: target.connector, deliveryId: identity.deliveryId, accepted: events.length, written: result.written, duplicates: result.duplicates, eventIds: result.eventIds } };
}

/** What a Stripe connection says once the founder removed Foundmill's access in their Stripe dashboard. */
export const STRIPE_ACCESS_REMOVED = "Stripe access was removed in your Stripe dashboard. Sign in with Stripe again to reconnect.";

/**
 * Marks expired the one connection a withdrawal names: the business in the URL, else the project the account is
 * signed in to, and only when that connection is a sign-in for that very account (the same check as a payment).
 * Anything else is acknowledged and changes nothing.
 */
export async function markAccessRevoked(deps: Pick<IngestDeps, "db">, connectorKey: string, account: string, urlBusinessId: string | null): Promise<{ businessId: string | null; marked: boolean }> {
  if (connectorKey !== "stripe") return { businessId: urlBusinessId, marked: false };
  const businessId = urlBusinessId ?? (await repos.integrations.businessForStripeAccount(deps.db, account));
  if (!businessId) return { businessId: null, marked: false };
  const integration = await connectedIntegration(deps as IngestDeps, businessId, connectorKey);
  const settings = (integration?.settings ?? {}) as { externalAccountId?: string | null; config?: { kind?: unknown } };
  if (!integration || settings.config?.kind !== "connect" || !sameAccount(account, settings.externalAccountId ?? null)) return { businessId, marked: false };
  await repos.integrations.setStatus(deps.db, businessId, integration.id, "expired", STRIPE_ACCESS_REMOVED);
  return { businessId, marked: true };
}

/** `webhooks.last_received_at` for the business's registered endpoint (observability only; never blocks the ack). */
async function stampWebhookRows(deps: IngestDeps, target: MountedWebhook, businessIds: string[]): Promise<void> {
  for (const businessId of businessIds) {
    try {
      const rows = await repos.integrations.listWebhooks(deps.db, businessId, { connectorKey: target.connector });
      const at = deps.now();
      for (const row of rows) if (row.endpointPath === target.path || row.endpointPath.endsWith(`/${target.segment}/${businessId}`)) await repos.integrations.markWebhookReceived(deps.db, businessId, row.id, at);
    } catch (e) {
      deps.log.warn({ businessId, connector: target.connector, err: (e as Error).message }, "could not stamp webhook row");
    }
  }
}

/** The body the vendor expects as an acknowledgement; Dropbox Sign requires a fixed phrase, everybody else takes JSON. */
export function ackBody(connector: string, outcome: WebhookOutcome): { contentType: "text/plain" | "application/json"; text: string } {
  if (outcome.status === 200 && connector === "dropbox_sign") return { contentType: "text/plain", text: DROPBOX_SIGN_CALLBACK_RESPONSE };
  return { contentType: "application/json", text: JSON.stringify(outcome.body) };
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/**
 * The most a vendor delivery to `/webhooks/:connector` may carry before ingest reads it (WP-11 T15, A8-22): 1 MiB, and
 * GitHub's own 25 MB cap for GitHub, whose push and pull-request payloads can be large. A larger body is a 413 and the
 * connector's verifier never runs.
 */
export const WEBHOOK_MAX_BYTES = 1024 * 1024;
export const WEBHOOK_MAX_BYTES_BY_CONNECTOR: Readonly<Record<string, number>> = { github: 25 * 1024 * 1024 };

