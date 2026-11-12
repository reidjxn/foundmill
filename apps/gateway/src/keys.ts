/**
 * `POST /v1/keys/validate` (SEC-14): a founder's own Anthropic key, checked the way it will be used (audit BILL-04) before
 * Settings › Keys stores it. Only the api asks (service token `svc: api`), and only when its models run live; with mock
 * models it answers from the mock connector itself and never calls this route.
 *
 * Two checks, both against Anthropic and both here, the one service that reaches vendors: a one-token messages call
 * (`validateApiKey`, packages/models: a typo, a revoked key and an account with no credit or at its spend limit are
 * refused), then the live `anthropic` connector's `validate_key` (the routed models, `models.list`, free). The one-token
 * call is billed to the founder's own account, so nothing is booked to the business's ledger.
 *
 * The key is never logged, audited or echoed: the audit row says only `validated: ok | refused`, a refusal's reason is
 * one of the fixed sentences the checks give (with the key cut out should a vendor ever quote it), and the window is
 * the business's own (`rl:<businessId>:anthropic_key_validation`), tight enough that the route cannot test keys in bulk.
 */
import { z } from "zod";
import { ANTHROPIC_KEY, mockIntegrationRecord, type ToolContext } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { validateApiKey, type KeyValidation } from "@foundmill/models";
import { GatewayError, safeError, type GatewayDeps } from "./pipeline";
import { checkRateLimit } from "./rate-limit";

export const KEYS_VALIDATE_ROUTE = "/v1/keys/validate";

export const ValidateKeyRequest = z.object({
  businessId: z.guid(),
  /** The founder's key as pasted; never logged, audited or returned. */
  apiKey: z.string().min(1).max(400),
});
export type ValidateKeyRequest = z.infer<typeof ValidateKeyRequest>;

export interface RoutedModelCheck {
  key: string;
  modelId: string;
  available: boolean;
}

export interface ValidateKeyResponse {
  /** Always live: the route is asked only when the api's models are live. */
  mode: "live";
  valid: boolean;
  reason: string | null;
  routedModels: RoutedModelCheck[];
  checkedAt: string;
}

/** The rate-limit scope of key checks, apart from the agents' own `anthropic` tool calls. */
export const KEY_VALIDATION_SCOPE = "anthropic_key_validation";
/** A founder pastes a key a few times at most; past this the route is being used to test keys. */
export const KEY_VALIDATION_LIMITS = { perMinute: 10, perDay: 100 } as const;

const NIL_ID = "00000000-0000-0000-0000-000000000000";
const SILENT = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

/** The one-token check; tests pass their own (a fake Anthropic). */
export type ModelKeyValidator = (apiKey: string) => Promise<KeyValidation>;
const liveModelCheck: ModelKeyValidator = (apiKey) => validateApiKey(apiKey, { mode: "live" });

/** A refusal's words, with the key cut out (a vendor message never quotes it today; this keeps it so). */
const scrub = (text: string | null | undefined, apiKey: string): string | null => (text ? text.split(apiKey).join("[key]").slice(0, 300) : null);

export async function validateFounderKey(deps: GatewayDeps, input: ValidateKeyRequest, service: string, validateModelKey: ModelKeyValidator = liveModelCheck): Promise<ValidateKeyResponse> {
  const now = deps.now ?? (() => new Date());
  await repos.businesses.get(deps.db, input.businessId).catch(() => {
    throw new GatewayError("business_not_found", `business ${input.businessId} is not available to this gateway`, 404);
  });
  const limit = await checkRateLimit(deps.rateLimits, { businessId: input.businessId, connector: KEY_VALIDATION_SCOPE, limits: KEY_VALIDATION_LIMITS }, now().getTime());
  if (!limit.allowed) {
    throw new GatewayError("rate_limited", `Too many key checks for this business. Try again in ${limit.retryAfterSeconds} seconds.`, 429, { retryAfterSeconds: limit.retryAfterSeconds, scope: limit.scope, limit: limit.limit });
  }

  const refused = (reason: string | null, routedModels: RoutedModelCheck[] = []): ValidateKeyResponse => ({ mode: "live", valid: false, reason: reason ?? "Anthropic rejected the key", routedModels, checkedAt: now().toISOString() });
  let answer: ValidateKeyResponse;
  const call = await validateModelKey(input.apiKey);
  if (!call.ok) {
    answer = refused(scrub(call.message, input.apiKey) ?? "Anthropic rejected the key");
  } else {
    // Live whatever this gateway's INTEGRATIONS_MODE: the key is checked the way the business's live models will use it.
    const connector = deps.registry.get(ANTHROPIC_KEY, "live");
    const ctx: ToolContext = {
      businessId: input.businessId,
      agentId: NIL_ID,
      sessionId: NIL_ID,
      integration: mockIntegrationRecord(ANTHROPIC_KEY, input.businessId, { status: "connected" }),
      credential: { kind: "api_key", secret: input.apiKey },
      // The connector's own lines could name the request; nothing it logs is needed here.
      log: SILENT,
      mode: "live",
    };
    let result;
    try {
      result = await connector.callTool("validate_key", {}, ctx);
    } catch (e) {
      deps.log.warn({ err: safeError(e), businessId: input.businessId }, "key validation could not reach Anthropic");
      throw new GatewayError("key_check_unavailable", "Anthropic could not be reached to check the key. Try again in a minute.", 502);
    }
    if (!result.ok) {
      answer = refused(scrub(result.error?.message, input.apiKey) ?? "validation failed");
    } else {
      const data = result.data as { valid: boolean; reason: string | null; routedModels: RoutedModelCheck[] };
      answer = { mode: "live", valid: data.valid === true, reason: scrub(data.reason, input.apiKey), routedModels: Array.isArray(data.routedModels) ? data.routedModels : [], checkedAt: now().toISOString() };
    }
  }
  deps.log.info({ businessId: input.businessId, validated: answer.valid ? "ok" : "refused" }, "founder key checked");
  await repos.audit
    .append(deps.db, input.businessId, { actorKind: "system", action: "gateway.keys.validated", target: { kind: "integration", connector: ANTHROPIC_KEY }, details: { service, validated: answer.valid ? "ok" : "refused" } })
    .catch((e: unknown) => deps.log.warn({ err: safeError(e), businessId: input.businessId }, "key validation audit not written"));
  return answer;
}
