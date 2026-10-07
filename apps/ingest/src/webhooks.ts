/**
 * Webhook receivers (docs/ARCHITECTURE.md §1 "apps/ingest", BUILD §13.1 `webhooks`, §14).
 *
 * `POST /webhooks/:connector[/:businessId]` routes to the connector's `webhooks[]` entry whose path matches
 * (`stripe`, `sendgrid`, `sendgrid-inbound`, `github`, `shopify`, `dropbox_sign`…). The raw body is never
 * parsed before the connector's `verify()` has read it — verification is over the bytes the vendor signed.
 * Order of checks: known connector → replay probe (409 for a delivery already accepted) → timestamp window
 * (401 stale) → `verify()` (401 otherwise) → claim the nonce → `normalise()` → write through the outbox.
 */
import { DROPBOX_SIGN_CALLBACK_RESPONSE, type ConnectorWebhook } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { AppError, NotFoundError, isUuid } from "@foundmill/shared";
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
  webhook: ConnectorWebhook;
}

/** Every webhook of every connector in the current mode, keyed by its path segment. */
export function mountedWebhooks(deps: Pick<IngestDeps, "registry" | "mode">): MountedWebhook[] {
  return deps.registry.webhooks(deps.mode).map(({ connector, path, webhook }) => {
    const segment = path.replace(/^\/webhooks\//, "").replace(/\/:businessId$/, "");
    return { connector, segment, path, webhook };
  });
}

export const findWebhook = (mounted: readonly MountedWebhook[], segment: string): MountedWebhook | null => mounted.find((m) => m.segment === segment) ?? null;

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
  if (!target) return { status: 404, body: { ok: false, error: "unknown_connector", message: `No webhook is mounted at /webhooks/${ctx.segment} in ${deps.mode} mode`, connector } };
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

  if (ctx.businessId) {
    const foreign = events.find((e) => e.businessId !== ctx.businessId);
    if (foreign) {
      await deps.nonces.release(nonce);
      return { status: 422, body: { ok: false, error: "business_mismatch", message: "Normalised events must belong to the business in the URL", connector: target.connector } };
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

  return { status: 200, body: { ok: true, connector: target.connector, deliveryId: identity.deliveryId, accepted: events.length, written: result.written, duplicates: result.duplicates, eventIds: result.eventIds } };
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
