/**
 * The connectors the gateway serves itself next to the vendor catalogue (packages/connectors BUILTIN_CONNECTOR_FACTORIES):
 * `platform` (the task board, typed messages, the founder escalation and read-only views of the business, over this
 * gateway's database), `web` (search and page reads) and `quarantine` (the quarantined reader as a tool, BUILD §9.8
 * step 2). Agents reach them at `/mcp/<key>` through the same pipeline as every vendor tool.
 *
 * `platform` and `quarantine` run live in every INTEGRATIONS_MODE (ALWAYS_LIVE_CONNECTORS): their live side is the
 * platform's own data and its metered model client (which follows MODEL_MODE), so a mock-mode deployment still works on
 * the real task board. `web` follows the mode like a vendor (its mock serves generated pages, no network).
 */
import { loadByokApiKey, repos, type Db } from "@foundmill/db";
import { createBuiltinConnectors, quarantinedReaderRequest, type Connector, type LiveConnectorOptions, type QuarantinedReader } from "@foundmill/connectors";
import { createModelClient, QuarantinedReaderOutput, type ModelClient, type ModelMode } from "@foundmill/models";
import { AppError } from "@foundmill/shared";
import type { Vault } from "@foundmill/shared/crypto";
import { createDbPlatformHost } from "./platform-host";
import type { GatewayLogger } from "./pipeline";

export interface QuarantinedReaderDeps {
  db: Db;
  vault: Vault | null;
  /** The platform's model client (MODEL_MODE, the platform key). */
  models: ModelClient;
  /** The mode a business's own-key client runs in (the platform client's mode). */
  mode: ModelMode;
  log: GatewayLogger;
}

/**
 * The reader on the key that pays for it (BUILD §10.2): a business on its own Anthropic key runs it on that key, every
 * other business on the platform's. A business on its own key whose key is gone is refused (the pipeline refuses it
 * first, `key-revoked`), never quietly moved onto platform credits.
 */
export function createQuarantinedReader(deps: QuarantinedReaderDeps): QuarantinedReader {
  const clientFor = async (businessId: string): Promise<ModelClient> => {
    if (deps.mode === "mock") return deps.models;
    const business = await repos.businesses.get(deps.db, businessId, { includeArchived: true });
    if (business.modelBilling !== "byok") return deps.models;
    const key = deps.vault ? await loadByokApiKey(deps.db, deps.vault, businessId) : null;
    if (!key) throw new AppError("key_revoked", "This business runs on its own Anthropic key and none is stored; set one in Settings › Keys", 403);
    return createModelClient({ mode: "live", apiKey: key.apiKey, billedTo: "byok", logger: deps.log });
  };
  return async ({ businessId, agentId, sessionId, fields, content }) => {
    const { system, messages } = quarantinedReaderRequest(fields, content);
    const client = await clientFor(businessId);
    const result = await client.complete({ route: "quarantinedReader", system, messages, schema: QuarantinedReaderOutput, scope: sessionId ?? `business:${businessId}`, attribution: { businessId, agentId, ...(sessionId ? { sessionId } : {}), kind: "quarantined_reader" } });
    return result.json ?? {};
  };
}

export interface GatewayBuiltinsDeps extends QuarantinedReaderDeps {
  /** The live options of the vendor connectors (platform secrets, fetch, clock). */
  live?: LiveConnectorOptions;
}

/** The built-in connectors, wired to this gateway's database and model client. */
export function createGatewayBuiltins(deps: GatewayBuiltinsDeps): Connector[] {
  return createBuiltinConnectors({ ...deps.live, platform: createDbPlatformHost({ db: deps.db, log: deps.log }), quarantinedReader: createQuarantinedReader(deps) });
}
