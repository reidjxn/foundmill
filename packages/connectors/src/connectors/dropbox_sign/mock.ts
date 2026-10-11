import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { makeWebhookRequest, ReplayGuard } from "../../webhooks";
import { HS_REQUESTS, MOCK_DROPBOX_SIGN_API_KEY } from "./fixtures/requests";
import { DROPBOX_SIGN_KEY, DROPBOX_SIGN_RATE_LIMITS, dropboxSignTools, mapSignatureRequest, type HsSignatureRequest } from "./tools";
import { createDropboxSignWebhook, eventHash, normaliseCallback, type HsCallbackEvent } from "./webhooks";

const notFound = (id: string) => Object.assign(new Error(`signature request ${id} not found`), { status: 404 });

/** Build a correctly signed callback Request (used by `simulate` and by tests). */
export function signedCallbackRequest(businessId: string, event: Omit<HsCallbackEvent, "event"> & { eventType: string; eventTime?: number }, apiKey = MOCK_DROPBOX_SIGN_API_KEY): Request {
  const eventTime = event.eventTime ?? Math.floor(MOCK_NOW.getTime() / 1000);
  const body: HsCallbackEvent = { event: { event_time: String(eventTime), event_type: event.eventType, event_hash: eventHash(apiKey, String(eventTime), event.eventType), event_metadata: { related_signature_id: event.signature_request?.signatures[0]?.signature_id ?? null } }, signature_request: event.signature_request };
  const form = new FormData();
  form.set("json", JSON.stringify(body));
  const req = new Request(`https://ingest.example/webhooks/${DROPBOX_SIGN_KEY}/${businessId}`, { method: "POST", body: form });
  return makeWebhookRequest(req.url, "", {}) && req;
}

export function createDropboxSignMock() {
  const requests = new Map<string, HsSignatureRequest>(HS_REQUESTS.map((r) => [r.signature_request_id, structuredClone(r)]));
  const webhook = createDropboxSignWebhook({ apiKeyFor: async () => MOCK_DROPBOX_SIGN_API_KEY, replay: new ReplayGuard({ now: () => MOCK_NOW.getTime() }), now: () => MOCK_NOW });

  return buildMockConnector({
    key: DROPBOX_SIGN_KEY,
    displayName: "Dropbox Sign",
    phase: 1,
    auth: { kind: "api_key" },
    tools: dropboxSignTools,
    rateLimits: DROPBOX_SIGN_RATE_LIMITS,
    now: () => MOCK_NOW,
    webhooks: [webhook],
    handlers: {
      list_signature_requests: async ({ page, pageSize }) => {
        const all = [...requests.values()].sort((a, b) => b.created_at - a.created_at);
        return { items: all.slice((page - 1) * pageSize, page * pageSize).map(mapSignatureRequest), numPages: Math.max(1, Math.ceil(all.length / pageSize)) };
      },
      get_signature_request: async ({ signatureRequestId }) => {
        const r = requests.get(signatureRequestId);
        if (!r) throw notFound(signatureRequestId);
        return mapSignatureRequest(r);
      },
      send_signature_request: async ({ title, subject, message, signers, fileUrls, testMode, metadata }) => {
        const id = stableHash(["hs", title, signers.map((s) => s.email), fileUrls], 40);
        const r: HsSignatureRequest = { signature_request_id: id, title, subject: subject ?? null, message: message ?? null, is_complete: false, is_declined: false, has_error: false, test_mode: testMode, created_at: Math.floor(MOCK_NOW.getTime() / 1000), signing_url: null, details_url: `https://app.hellosign.com/home/manage?guid=${id.slice(0, 8)}`, metadata, signatures: signers.map((s, i) => ({ signature_id: stableHash([id, s.email, i], 32), signer_email_address: s.email, signer_name: s.name, status_code: "awaiting_signature", signed_at: null })) };
        requests.set(id, r);
        return mapSignatureRequest(r);
      },
      cancel_signature_request: async ({ signatureRequestId }) => {
        const r = requests.get(signatureRequestId);
        if (!r) throw notFound(signatureRequestId);
        if (r.is_complete) throw Object.assign(new Error("completed requests cannot be canceled"), { status: 409 });
        requests.delete(signatureRequestId);
        return { cancelled: true as const, signatureRequestId };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(DROPBOX_SIGN_KEY, businessId, { accountLabel: "Dropbox Sign (mock, test mode)" }),
    healthcheck: async () => mockHealth(DROPBOX_SIGN_KEY, { requests: requests.size }),
    simulations: {
      // Normalises the payload a signed callback would carry; the replay guard is a webhook concern, so
      // re-simulating the same seed yields the same event (the Simulate panel may fire it repeatedly).
      "contract.signed": (params) => {
        const eventTime = Math.floor((params.occurredAt ?? MOCK_NOW).getTime() / 1000) + (typeof params.seed === "string" ? params.seed.length : 0);
        return normaliseCallback({ event: { event_time: String(eventTime), event_type: "signature_request_all_signed", event_hash: eventHash(MOCK_DROPBOX_SIGN_API_KEY, String(eventTime), "signature_request_all_signed") }, signature_request: HS_REQUESTS[0] }, params.businessId, () => MOCK_NOW);
      },
    },
  });
}

export const dropboxSignMock = createDropboxSignMock();
