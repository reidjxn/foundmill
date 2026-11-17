/**
 * `POST /v1/models/anthropic/:businessId/v1/messages` (WP-13 T11; founder D6, Nov 16, 2026): the api's and the
 * composer's model calls for a business on its own Anthropic key. They may not decrypt keys (BUILD §10.2), so their
 * client's Messages endpoint is this route (packages/models `ownKeyViaGateway`): the gateway puts the founder's key on
 * the request and forwards it to Anthropic unchanged, streamed or not, and sends Anthropic's answer back as it comes.
 * Schemas, retries and metering stay in the calling service, which books the usage as `byok`.
 *
 * - Only `svc: api` and `svc: composer` may call it, and only for a business whose `model_billing` is `byok` with a key
 *   that loads; anything else is refused with 409 `own_key_missing` and no call. A platform key is never used here.
 * - Only Foundmill's routed Anthropic models (`MODELS`, provider `anthropic`) are accepted.
 * - The key is never logged or echoed: the log line names the business, the model and Anthropic's status.
 * - Per business, a window wide enough for a busy founder (`rl:<businessId>:own_key_models`).
 */
import { loadByokApiKey, repos } from "@foundmill/db";
import { MODEL_PROVIDER, MODELS } from "@foundmill/models";
import { GatewayError, safeError, type GatewayDeps } from "./pipeline";
import { checkRateLimit } from "./rate-limit";

export const OWN_KEY_MODELS_ROUTE = "/v1/models/anthropic/:businessId/v1/messages";
/** A conversation with images travels as base64 in JSON. */
export const MAX_OWN_KEY_MODELS_BODY_BYTES = 10 * 1024 * 1024;
export const OWN_KEY_MODELS_SCOPE = "own_key_models";
export const OWN_KEY_MODELS_LIMITS = { perMinute: 120, perDay: 5_000 } as const;
export const OWN_KEY_MODELS_SERVICES: readonly string[] = ["api", "composer"];
/** Anthropic's Messages API (the only vendor this route reaches). */
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

const ROUTED_ANTHROPIC_MODELS = new Set<string>(Object.entries(MODELS).filter(([key]) => MODEL_PROVIDER[key as keyof typeof MODELS] === "anthropic").map(([, id]) => id));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** In Anthropic's error shape, so the caller's SDK reads it as any API error (status 409 → the "own key missing" sentence). */
const anthropicError = (status: number, type: string, message: string) => new Response(JSON.stringify({ type: "error", error: { type, message } }), { status, headers: { "content-type": "application/json" } });

export interface OwnKeyMessageRequest {
  businessId: string;
  /** The raw JSON body the caller's SDK sent. */
  body: string;
  /** `?beta=true` for the beta Messages endpoint (fast mode), else empty. */
  search: string;
  anthropicVersion: string | undefined;
  anthropicBeta: string | undefined;
  service: string;
}

export async function proxyOwnKeyMessage(deps: GatewayDeps, req: OwnKeyMessageRequest, upstream: typeof globalThis.fetch = globalThis.fetch): Promise<Response> {
  if (!OWN_KEY_MODELS_SERVICES.includes(req.service)) throw new GatewayError("forbidden_service", "Only the api and the composer call models on a founder's key", 403);
  if (!UUID.test(req.businessId)) throw new GatewayError("validation", "The business id is not valid", 400);
  const now = deps.now ?? (() => new Date());
  const limit = await checkRateLimit(deps.rateLimits, { businessId: req.businessId, connector: OWN_KEY_MODELS_SCOPE, limits: OWN_KEY_MODELS_LIMITS }, now().getTime());
  if (!limit.allowed) return anthropicError(429, "rate_limit_error", `Too many model calls for this project. Try again in ${limit.retryAfterSeconds} seconds.`);

  const business = await repos.businesses.get(deps.db, req.businessId).catch(() => null);
  if (!business) throw new GatewayError("business_not_found", `business ${req.businessId} is not available to this gateway`, 404);
  if (business.modelBilling !== "byok") return anthropicError(409, "own_key_missing", "This project is not on its own Anthropic key.");
  const key = deps.vault ? await loadByokApiKey(deps.db, deps.vault, req.businessId).catch(() => null) : null;
  if (!key) return anthropicError(409, "own_key_missing", "No working Anthropic key is stored for this project.");

  let model: unknown;
  try {
    model = (JSON.parse(req.body) as { model?: unknown }).model;
  } catch {
    return anthropicError(400, "invalid_request_error", "The request body is not JSON.");
  }
  if (typeof model !== "string" || !ROUTED_ANTHROPIC_MODELS.has(model)) return anthropicError(400, "invalid_request_error", "Only Foundmill's routed Claude models run on a founder's key.");

  const headers: Record<string, string> = { "content-type": "application/json", "anthropic-version": req.anthropicVersion ?? "2023-06-01", "x-api-key": key.apiKey };
  if (req.anthropicBeta) headers["anthropic-beta"] = req.anthropicBeta;
  let answer: Response;
  try {
    answer = await upstream(`${ANTHROPIC_MESSAGES_URL}${req.search === "?beta=true" ? req.search : ""}`, { method: "POST", headers, body: req.body });
  } catch (e) {
    deps.log.warn({ err: safeError(e), businessId: req.businessId }, "own-key model call could not reach Anthropic");
    return anthropicError(529, "overloaded_error", "Anthropic could not be reached. Try again in a minute.");
  }
  deps.log.info({ businessId: req.businessId, service: req.service, model, status: answer.status }, "own-key model call");
  // Anthropic's own answer, streamed through; only the headers the caller's SDK reads are kept.
  const out = new Headers();
  for (const name of ["content-type", "request-id", "retry-after", "anthropic-ratelimit-requests-remaining", "anthropic-ratelimit-requests-reset", "anthropic-ratelimit-input-tokens-remaining", "anthropic-ratelimit-input-tokens-reset", "anthropic-ratelimit-output-tokens-remaining", "anthropic-ratelimit-output-tokens-reset"]) {
    const value = answer.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(answer.body, { status: answer.status, headers: out });
}
