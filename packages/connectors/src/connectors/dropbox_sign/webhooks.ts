/**
 * Dropbox Sign callbacks: POSTed as multipart/form-data with a `json` field. Authenticity = `event.event_hash`
 * equals HMAC-SHA256(api_key, event_time + event_type). Replays are rejected by event hash + signature id.
 * `signature_request_all_signed` → `contract.signed`.
 */
import type { ConnectorWebhook, PlatformEvent } from "../../contract";
import { makeEvent, uuidFromSeed } from "../../mock-utils";
import { formFields, hmacSha256, parseJsonBody, rawBody, type ReplayGuard, resolveBusinessId, safeEqual, webhookPath, type BusinessResolver } from "../../webhooks";
import { DROPBOX_SIGN_KEY, type HsSignatureRequest } from "./tools";

export interface HsCallbackEvent {
  event: { event_time: string | number; event_type: string; event_hash: string; event_metadata?: { related_signature_id?: string | null; reported_for_account_id?: string | null } };
  signature_request?: HsSignatureRequest;
}

export const eventHash = (apiKey: string, eventTime: string | number, eventType: string): string => hmacSha256(apiKey, `${eventTime}${eventType}`, "hex");

/** The callback body is multipart with a `json` field; accept raw JSON too (tests, some proxies). */
export async function readCallback(req: Request): Promise<HsCallbackEvent | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    const fields = await formFields(req);
    return fields.json ? parseJsonBody<HsCallbackEvent>(fields.json) : null;
  }
  return parseJsonBody<HsCallbackEvent>(await rawBody(req));
}

export interface DropboxSignWebhookDeps {
  /** API key used to verify callbacks for a business (per business when founders bring their own account). */
  apiKeyFor(businessId: string | null): Promise<string | null>;
  resolveBusinessId?: BusinessResolver;
  replay?: ReplayGuard;
  now?: () => Date;
}

export function createDropboxSignWebhook(deps: DropboxSignWebhookDeps): ConnectorWebhook {
  // No guard of its own unless one is passed (the mocks pass one): `apps/ingest` holds the replay record and releases it
  // when a delivery is not stored, so a vendor's retry after a refusal or a failed write is accepted (SEC-11).
  const replay = deps.replay ?? null;
  return {
    path: webhookPath(DROPBOX_SIGN_KEY),
    async verify(req) {
      const payload = await readCallback(req);
      if (!payload?.event?.event_hash || !payload.event.event_type || payload.event.event_time === undefined) return false;
      const businessId = await resolveBusinessId(req, DROPBOX_SIGN_KEY, payload.event.event_metadata?.reported_for_account_id ?? null, deps.resolveBusinessId);
      const apiKey = await deps.apiKeyFor(businessId);
      if (!apiKey) return false;
      const expected = eventHash(apiKey, payload.event.event_time, payload.event.event_type);
      if (!safeEqual(expected, payload.event.event_hash)) return false;
      const deliveryId = `${payload.event.event_hash}:${payload.event.event_metadata?.related_signature_id ?? payload.signature_request?.signature_request_id ?? ""}`;
      return replay ? replay.check(deliveryId) : true;
    },
    async normalise(req) {
      const payload = await readCallback(req);
      if (!payload) return [];
      const businessId = await resolveBusinessId(req, DROPBOX_SIGN_KEY, payload.event.event_metadata?.reported_for_account_id ?? null, deps.resolveBusinessId);
      if (!businessId) return [];
      return normaliseCallback(payload, businessId, deps.now);
    },
  };
}

export function normaliseCallback(payload: HsCallbackEvent, businessId: string, now: () => Date = () => new Date()): PlatformEvent[] {
  const sr = payload.signature_request;
  if (payload.event.event_type !== "signature_request_all_signed" || !sr) return [];
  const eventTime = Number(payload.event.event_time);
  const occurredAt = Number.isFinite(eventTime) ? new Date(eventTime * 1000) : now();
  const signed = sr.signatures.filter((s) => s.status_code === "signed");
  const counterparty = signed.find((s) => !(sr.metadata?.founderEmail && s.signer_email_address.toLowerCase() === sr.metadata.founderEmail.toLowerCase())) ?? sr.signatures[0];
  const counterpartyEntityId = uuidFromSeed("entity", "email", (counterparty?.signer_email_address ?? "unknown").toLowerCase());
  const lastSignedAt = Math.max(...signed.map((s) => s.signed_at ?? 0), 0);
  const value = sr.metadata?.valueMinor && sr.metadata?.currency ? { amountMinor: Number(sr.metadata.valueMinor), currency: sr.metadata.currency } : null;
  return [
    makeEvent("contract.signed", {
      businessId,
      occurredAt,
      actor: { kind: "webhook", id: DROPBOX_SIGN_KEY },
      entityIds: [counterpartyEntityId],
      seed: sr.signature_request_id,
      payload: {
        contractId: uuidFromSeed("contract", DROPBOX_SIGN_KEY, sr.signature_request_id),
        counterpartyEntityId,
        kind: sr.metadata?.kind ?? "agreement",
        title: sr.title,
        signedAt: (lastSignedAt ? new Date(lastSignedAt * 1000) : occurredAt).toISOString(),
        signedBy: { kind: "user", id: sr.metadata?.founderUserId ?? "founder" },
        value: value && Number.isFinite(value.amountMinor) ? value : null,
        provider: "dropbox_sign",
        docRef: sr.signature_request_id,
        obligationCount: 0,
      },
    }),
  ];
}
