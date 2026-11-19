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
import { bookUsage, loadByokApiKey, repos, type Db } from "@foundmill/db";
import { createBuiltinConnectors, quarantinedReaderRequest, type Connector, type LiveConnectorOptions, type QuarantinedReader } from "@foundmill/connectors";
import { createModelClient, QuarantinedReaderOutput, usageForLedger, type ModelClient, type ModelMode, type UsageSink } from "@foundmill/models";
import { AppError } from "@foundmill/shared";
import type { Vault } from "@foundmill/shared/crypto";
import { createDbPlatformHost, type RepositoryFiles } from "./platform-host";
import { createSkillReader } from "./skill-reader";
import { safeError, type GatewayLogger } from "./pipeline";

/**
 * The gateway's model usage into `usage_ledger` (BUILD §10.4), like the orchestrator's and the composer's sinks: every
 * call of the quarantined reader and every web search is booked as tokens at the routed model's list price (a search
 * adds its per-search fee; an Estimate, in the pricing currency) at its exact cost, to the agent and session that asked
 * and to whoever's key ran it (`credits` on the platform key, `byok` on the business's own), so credits are charged for
 * what the call cost. The call has already run: a failed write is logged, never thrown.
 */
export function gatewayUsageSink(db: Db, log: GatewayLogger, topUps = false): UsageSink {
  return async (event) => {
    const a = event.attribution;
    if (!a?.businessId) return;
    const { quantity, tokens } = usageForLedger(event.usage);
    try {
      await bookUsage(db, a.businessId, {
        agentId: a.agentId ?? null,
        sessionId: a.sessionId ?? null,
        kind: "tokens",
        modelKey: event.modelKey,
        quantity,
        unit: "tokens",
        costMinor: Math.max(0, event.cost.costMinorInt),
        // The exact cost (0039): credits are charged this, so a 0.6-cent read is not booked as 1 cent (or 0).
        costMicroMinor: Math.max(0, event.cost.costMicroMinor),
        currency: event.cost.currency,
        billedTo: event.billedTo,
        occurredAt: event.occurredAt,
        details: {
          service: "gateway",
          route: event.route,
          model: event.model,
          mode: event.mode,
          kind: a.kind ?? null,
          label: event.cost.label,
          pricingAsOf: event.cost.pricingAsOf,
          attempt: event.attempt,
          tokens,
          ...(event.cost.breakdown.webSearch ? { webSearchFeeMinor: event.cost.breakdown.webSearch } : {}),
          ...(event.aborted ? { aborted: true } : {}),
        },
      }, { topUps });
    } catch (e) {
      log.error({ err: safeError(e), route: event.route }, "model usage could not be booked");
    }
  };
}

export interface QuarantinedReaderDeps {
  db: Db;
  vault: Vault | null;
  /**
   * The platform's model client (MODEL_MODE, the platform key), metered through `onUsage` and gated on the business's
   * credits (`gatePlatformModels`, reader-models.ts) by `buildGateway`.
   */
  models: ModelClient;
  /**
   * The platform client before the credits gate (mock mode only): a business on its own key reads on it, ungated, as it
   * reads on its own key ungated when live. Absent, it falls back to `models`.
   */
  ungatedMock?: ModelClient;
  /** The mode a business's own-key client runs in (the platform client's mode). */
  mode: ModelMode;
  log: GatewayLogger;
  /** Where a business's own-key client books its usage (`gatewayUsageSink`); the platform client is built with the same. */
  onUsage?: UsageSink;
  /** The fetch a business's own-key client sends with (tests); the global fetch otherwise. */
  fetch?: typeof globalThis.fetch;
}

/**
 * The reader's client on the key that pays for it (BUILD §10.2): a business on its own Anthropic key runs it on that key
 * (the founder's money, so no credits check), every other business on the platform's gated client. A business on its
 * own key whose key is gone is refused (the pipeline refuses it first, `key-revoked`), never quietly moved onto platform
 * credits. Shared by the pipeline's digest (untrusted-reader.ts) and `quarantine.read_untrusted`.
 */
export function readerClientFor(deps: QuarantinedReaderDeps): (businessId: string) => Promise<ModelClient> {
  return async (businessId) => {
    const business = await repos.businesses.get(deps.db, businessId, { includeArchived: true });
    if (business.modelBilling !== "byok") return deps.models;
    // Mock mode: the own-key business reads on the simulated client, ungated, the same as live on its own key.
    if (deps.mode === "mock") return deps.ungatedMock ?? deps.models;
    const key = deps.vault ? await loadByokApiKey(deps.db, deps.vault, businessId) : null;
    if (!key) throw new AppError("key_revoked", "This business runs on its own Anthropic key and none is stored; set one in Settings › Keys", 403);
    return createModelClient({ mode: "live", apiKey: key.apiKey, billedTo: "byok", logger: deps.log, ...(deps.onUsage ? { onUsage: deps.onUsage } : {}), ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  };
}

/**
 * The web search behind live `web.search_web` (WP-09 T3): always the platform client (gated, booked to the caller's
 * credits, whatever the business's model billing: SEC2). None when the platform client is not live or cannot search,
 * so live search says the platform key is missing instead of answering with made-up results.
 */
export function platformSearchWeb(models: ModelClient): LiveConnectorOptions["searchWeb"] {
  if (models.mode !== "live" || !models.searchWeb) return undefined;
  return async ({ businessId, agentId, sessionId, query, limit }) => {
    const out = await models.searchWeb!({ query, limit, scope: sessionId ?? `business:${businessId}`, attribution: { businessId, ...(agentId ? { agentId } : {}), ...(sessionId ? { sessionId } : {}), kind: "web_search" } });
    return out.results;
  };
}

export function createQuarantinedReader(deps: QuarantinedReaderDeps): QuarantinedReader {
  const clientFor = readerClientFor(deps);
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
  /** The business's code repository for the skill tools; late-bound (the pipeline is built after the connectors). */
  repository?: () => RepositoryFiles | null;
}

/** The built-in connectors, wired to this gateway's database and model client. */
export function createGatewayBuiltins(deps: GatewayBuiltinsDeps): Connector[] {
  const searchWeb = deps.live?.searchWeb ?? platformSearchWeb(deps.models);
  // read_skill comes from its own module (./skill-reader), next to the rest of the platform host.
  const platform = { ...createDbPlatformHost({ db: deps.db, log: deps.log, ...(deps.repository ? { repository: deps.repository } : {}) }), readSkill: createSkillReader({ db: deps.db, log: deps.log }) };
  return createBuiltinConnectors({ ...deps.live, platform, quarantinedReader: createQuarantinedReader(deps), ...(searchWeb ? { searchWeb } : {}) });
}
