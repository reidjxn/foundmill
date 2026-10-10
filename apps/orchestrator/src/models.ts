/**
 * Routes every model call onto the key that should pay for it (BUILD §10.2 "Bring-your-own key", §10.4).
 *
 * The orchestrator makes model calls for many businesses from one process (the Chief of Staff cycle, skill grading,
 * foundations). A business on its own key (`model_billing = byok`) must run those calls on that key and book them as
 * `byok`; everyone else runs on the platform client and books to credits. This wrapper picks the client per call from
 * `attribution.businessId`: the business row and its decrypted key are cached for `ttlMs` (a stored, rotated or revoked
 * key is picked up within that window), and clients are shared per key fingerprint so the limiter's buckets stay per key.
 *
 * A `byok` business whose key cannot be read in live mode (no vault, no live credential, a record that fails to decrypt)
 * is refused with `ModelRequestError("missing_api_key")` rather than quietly spending platform credits; the gateway makes
 * the same call for tool calls (`key-revoked`). Under MODEL_MODE=mock a `byok` business gets a mock client that books to
 * `byok`, so the golden path and the ledger behave the same with INTEGRATIONS_MODE=mock.
 */
import { loadByokApiKey, repos, type Db } from "@foundmill/db";
import { createModelClient, keyFingerprint, ModelRequestError, type CompleteRequest, type CompleteResult, type CompleteResultWithJson, type ModelClient, type ModelLogger, type ModelMode, type StreamStructuredRequest, type StreamStructuredResult, type UsageSink } from "@foundmill/models";
import { NotFoundError, type ModelBilling } from "@foundmill/shared";
import type { Vault } from "@foundmill/shared/crypto";
import type { z } from "zod";

export const BUSINESS_KEY_TTL_MS = 30_000;

export interface BusinessModelClientOptions {
  db: Db;
  vault: Vault | null;
  /** The mode business-key clients run in (the platform client's mode). */
  mode: ModelMode;
  onUsage?: UsageSink;
  logger?: ModelLogger;
  /** How long one business's billing mode and key are reused before being re-read (default 30 s). */
  ttlMs?: number;
  now?: () => number;
  /** Builds the client for a business's own key (tests inject a capturing one). */
  createClient?: (opts: { mode: ModelMode; apiKey: string | null; onUsage?: UsageSink; logger?: ModelLogger }) => ModelClient;
}

export interface BusinessRoute {
  billedTo: ModelBilling;
  /** `platform` for the shared client; `byok` for a client on the business's own key (`mock` when no key is needed). */
  source: "platform" | "byok" | "mock";
}

export interface BusinessModelClient extends ModelClient {
  /** Which client a call for this business would run on (no call is made). Throws like a call would. */
  routeFor(businessId: string | undefined): Promise<BusinessRoute>;
  /** Forget a business's cached route (a stored, rotated or revoked key is otherwise seen within `ttlMs`). */
  forget(businessId: string): void;
}

interface CachedRoute {
  expiresAt: number;
  route: BusinessRoute;
  client: ModelClient;
}

const byokRefused = (businessId: string, why: string) =>
  new ModelRequestError(`This business runs on its own Anthropic key and ${why}; set a key in Settings → Keys`, undefined, "missing_api_key", { businessId });

export function createBusinessModelClient(platform: ModelClient, opts: BusinessModelClientOptions): BusinessModelClient {
  const ttlMs = opts.ttlMs ?? BUSINESS_KEY_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const build = opts.createClient ?? (({ mode, apiKey, onUsage, logger }) => createModelClient({ mode, apiKey: apiKey ?? undefined, billedTo: "byok", onUsage, logger }));
  const routes = new Map<string, CachedRoute>();
  /** One client per key, shared by businesses on the same key (rate-limit buckets are per key). */
  const byKey = new Map<string, ModelClient>();
  const platformRoute: BusinessRoute = { billedTo: "credits", source: "platform" };

  async function resolve(businessId: string): Promise<CachedRoute> {
    const cached = routes.get(businessId);
    if (cached && cached.expiresAt > now()) return cached;
    const entry = await load(businessId);
    routes.set(businessId, entry);
    return entry;
  }

  async function load(businessId: string): Promise<CachedRoute> {
    const expiresAt = now() + ttlMs;
    let billing: ModelBilling;
    try {
      billing = (await repos.businesses.get(opts.db, businessId)).modelBilling;
    } catch (err) {
      if (err instanceof NotFoundError) return { expiresAt, route: platformRoute, client: platform };
      throw err;
    }
    if (billing !== "byok") return { expiresAt, route: platformRoute, client: platform };
    if (opts.mode === "mock") {
      const client = byKey.get("mock") ?? build({ mode: "mock", apiKey: null, onUsage: opts.onUsage, logger: opts.logger });
      byKey.set("mock", client);
      return { expiresAt, route: { billedTo: "byok", source: "mock" }, client };
    }
    if (!opts.vault) throw byokRefused(businessId, "this service has no vault to read it");
    const key = await loadByokApiKey(opts.db, opts.vault, businessId);
    if (!key) throw byokRefused(businessId, "no live key is stored (revoked or never set)");
    const fingerprint = keyFingerprint(key.apiKey);
    const client = byKey.get(fingerprint) ?? build({ mode: "live", apiKey: key.apiKey, onUsage: opts.onUsage, logger: opts.logger });
    byKey.set(fingerprint, client);
    return { expiresAt, route: { billedTo: "byok", source: "byok" }, client };
  }

  async function pick(businessId: string | undefined): Promise<ModelClient> {
    if (!businessId) return platform;
    return (await resolve(businessId)).client;
  }

  async function complete<T>(req: CompleteRequest<T> & { schema: z.ZodType<T> }): Promise<CompleteResultWithJson<T>>;
  async function complete(req: CompleteRequest<unknown> & { schema?: undefined }): Promise<CompleteResult<unknown>>;
  async function complete(req: CompleteRequest<unknown>): Promise<CompleteResult<unknown>> {
    const client = await pick(req.attribution?.businessId);
    return client.complete(req as CompleteRequest<unknown> & { schema?: undefined });
  }

  return {
    mode: platform.mode,
    complete,
    async streamStructured<T, E>(req: StreamStructuredRequest<T, E>): Promise<StreamStructuredResult<T, E>> {
      const client = await pick(req.attribution?.businessId);
      if (!client.streamStructured) throw new ModelRequestError("this model client cannot stream structured output", undefined, "unsupported");
      return client.streamStructured(req);
    },
    async routeFor(businessId) {
      if (!businessId) return platformRoute;
      return (await resolve(businessId)).route;
    },
    forget(businessId) {
      routes.delete(businessId);
    },
  };
}
