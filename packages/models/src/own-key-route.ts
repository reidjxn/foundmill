/**
 * A founder's own Anthropic key for the services that may not hold it (WP-13 T11; founder D6, Nov 16, 2026). The api and
 * the composer never decrypt keys (BUILD §10.2); the gateway does. So their calls for a business on its own key run on
 * an ordinary live client whose Messages API endpoint is the gateway's `/v1/models/anthropic/<businessId>`: the gateway
 * puts the founder's key on the request and forwards it to Anthropic, unchanged. Schemas, repair retries, streaming and
 * metering stay in the calling service, and usage reaches its sink as `billedTo: "byok"`.
 *
 * `routeOwnKeyCalls` sends a call there when its business is on its own key, and every other call to the platform
 * client (which keeps its credits gate, the free-plan rule and the cap). Web search stays on the platform client: it is
 * a platform tool, booked to credits whoever pays for the agent's model (WP-13 T5). A refused or missing key ends in one
 * of the sentences below: never a silent fallback to Foundmill's key or to GLM.
 */
import { ModelBillingError, ModelRequestError } from "./errors";
import { createModelClient } from "./client";
import { streamStructured } from "./structured-stream";
import type { CompleteRequest, ModelClient, ModelLogger, StreamStructuredRequest, UsageAttribution, UsageSink } from "./types";

/** Anthropic did not accept the founder's key (401 or 403 from Anthropic through the gateway). */
export const OWN_KEY_REFUSED = "This project runs on its own Anthropic key, and Anthropic did not accept it. Check the key in Settings › Keys.";
/** The project is on its own key but none that works is stored (the gateway's 409 `own_key_missing`). */
export const OWN_KEY_MISSING = "This project is set to use its own Anthropic key, but no working key is stored. Add it in Settings › Keys.";

/** The gateway route's prefix; the Anthropic SDK appends `/v1/messages`. */
export const OWN_KEY_GATEWAY_PATH = "/v1/models/anthropic";

export interface OwnKeyViaGatewayOptions {
  gatewayUrl: string;
  /** A fresh service token for the gateway (`svc: api` or `svc: composer`). */
  serviceToken: () => Promise<string>;
  onUsage?: UsageSink;
  logger?: ModelLogger;
  /** Injectable fetch (tests). */
  fetch?: typeof globalThis.fetch;
}

/** One live client per business, on the gateway's route for it. The placeholder key is replaced at the gateway. */
export function ownKeyViaGateway(opts: OwnKeyViaGatewayOptions): (businessId: string) => ModelClient {
  const base = opts.gatewayUrl.replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const signed: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${await opts.serviceToken()}`);
    headers.delete("x-api-key");
    return fetchImpl(input, { ...init, headers });
  };
  const clients = new Map<string, ModelClient>();
  return (businessId) => {
    let client = clients.get(businessId);
    if (!client) {
      client = createModelClient({
        mode: "live",
        apiKey: "own-key-at-gateway",
        billedTo: "byok",
        baseURL: `${base}${OWN_KEY_GATEWAY_PATH}/${encodeURIComponent(businessId)}`,
        rateLimitKey: `own-key:${businessId}`,
        fetch: signed,
        ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
        ...(opts.logger ? { logger: opts.logger } : {}),
      });
      clients.set(businessId, client);
    }
    return client;
  };
}

/** A refused or missing key reads as one of the sentences above; a billing refusal on the founder's account passes as is. */
function ownKeyError(err: unknown): unknown {
  if (err instanceof ModelBillingError || !(err instanceof ModelRequestError)) return err;
  if (err.status === 401 || err.status === 403) return new ModelRequestError(OWN_KEY_REFUSED, err.status, "own_key_refused", undefined, "auth");
  if (err.status === 409) return new ModelRequestError(OWN_KEY_MISSING, 409, "own_key_missing", undefined, "auth");
  return err;
}

export interface RouteOwnKeyOptions {
  /** Whether a call's business runs on its own Anthropic key. */
  ownKey: (attribution: UsageAttribution | undefined) => Promise<boolean>;
  clientFor: (businessId: string) => ModelClient;
}

export function routeOwnKeyCalls(platform: ModelClient, opts: RouteOwnKeyOptions): ModelClient {
  const pick = async (attribution: UsageAttribution | undefined): Promise<ModelClient | null> => (attribution?.businessId && (await opts.ownKey(attribution)) ? opts.clientFor(attribution.businessId) : null);
  const run = async <R>(own: ModelClient | null, call: (c: ModelClient) => Promise<R>): Promise<R> => {
    if (!own) return call(platform);
    try {
      return await call(own);
    } catch (err) {
      throw ownKeyError(err);
    }
  };
  const client: ModelClient = {
    mode: platform.mode,
    complete: (async (req: CompleteRequest<unknown>) => run(await pick(req.attribution), (c) => c.complete(req as never))) as ModelClient["complete"],
    // The helper falls back to `complete()` for a client that cannot stream (test doubles).
    streamStructured: async <T, E>(req: StreamStructuredRequest<T, E>) => run(await pick(req.attribution), (c) => streamStructured(c, req)),
    ...(platform.searchWeb ? { searchWeb: platform.searchWeb.bind(platform) } : {}),
  };
  return client;
}
