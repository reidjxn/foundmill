/**
 * `POST /v1/registry/lookup` (SEC-14): Legal › Import's company-registry lookups. Only the api asks (service token
 * `svc: api`), and only when the registry runs live (`INTEGRATIONS_MODE=live` or `LIVE_CONNECTORS` naming it); in mock
 * mode the api reads the connector's mock itself and never calls this route, so the golden path needs no gateway.
 *
 * The route is an allow-list, not a general tool call: exactly the three public registries and the read tools Import
 * uses (`REGISTRY_LOOKUP_TOOLS`); any other connector or tool is 403 `lookup_not_allowed`. They run on the platform's
 * keys, which live only here (COMPANIES_HOUSE_API_KEY, OPENCORPORATES_API_TOKEN, BOLAGSVERKET_CLIENT_ID/SECRET).
 *
 * Same bookkeeping as an agent's call: the business's window on the connector (`rl:<businessId>:<connector>`, shared
 * with the agents' calls, since it is the registry's quota), an audit row (connector, tool, outcome; never the
 * arguments), a usage row when the connector reports a cost (the registries are free today), errors through
 * `safeError()`. The registry's answer is third-party content and comes back as the untrusted envelope
 * (`{ untrusted: true, content, source, notice }`), never unwrapped here: the api reads its typed fields.
 */
import { z } from "zod";
import { BOLAGSVERKET_KEY, COMPANIES_HOUSE_KEY, isConfigError, isUntrusted, mockIntegrationRecord, OPENCORPORATES_KEY, toAgentEnvelope, type ToolContext } from "@foundmill/connectors";
import { bookUsage, repos } from "@foundmill/db";
import { GatewayError, modeFor, safeError, type GatewayDeps } from "./pipeline";
import { checkRateLimit } from "./rate-limit";
import { SIMULATED_NOTICE } from "./types";

export const REGISTRY_LOOKUP_ROUTE = "/v1/registry/lookup";

/** The only connectors and tools this route runs: the lookups of Legal › Import (apps/api routers/legal.ts). */
export const REGISTRY_LOOKUP_TOOLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [COMPANIES_HOUSE_KEY]: Object.freeze(["get_company", "list_officers"]),
  [BOLAGSVERKET_KEY]: Object.freeze(["get_organisation"]),
  [OPENCORPORATES_KEY]: Object.freeze(["get_company"]),
});

export const isAllowedRegistryLookup = (connector: string, tool: string): boolean => Object.hasOwn(REGISTRY_LOOKUP_TOOLS, connector) && (REGISTRY_LOOKUP_TOOLS[connector] ?? []).includes(tool);

export const RegistryLookupRequest = z.object({
  businessId: z.guid(),
  connector: z.string().min(1).max(60),
  tool: z.string().min(1).max(120),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type RegistryLookupRequest = z.infer<typeof RegistryLookupRequest>;

export interface RegistryLookupResponse {
  mode: "mock" | "live";
  ok: boolean;
  /** The untrusted envelope of the registry's answer (or the bare data, for a tool that returns none). */
  data?: unknown;
  /** Why a lookup failed: the tool's code and the registry's HTTP status, never its own words. */
  error?: { code: string; status: number | null };
  costMinor: number;
  /** Set when this gateway ran the registry's mock (it disagrees with the api on the mode). */
  simulated?: true;
  notice?: string;
}

const NIL_ID = "00000000-0000-0000-0000-000000000000";

export async function lookupRegistry(deps: GatewayDeps, input: RegistryLookupRequest, service: string): Promise<RegistryLookupResponse> {
  if (!isAllowedRegistryLookup(input.connector, input.tool)) {
    throw new GatewayError("lookup_not_allowed", "Only the company registries' lookups run through this route", 403, { connector: input.connector, tool: input.tool });
  }
  const now = deps.now ?? (() => new Date());
  const business = await repos.businesses.get(deps.db, input.businessId).catch(() => {
    throw new GatewayError("business_not_found", `business ${input.businessId} is not available to this gateway`, 404);
  });
  const mode = modeFor(deps, input.connector);
  const connector = deps.registry.get(input.connector, mode);
  const limit = await checkRateLimit(deps.rateLimits, { businessId: input.businessId, connector: input.connector, limits: connector.rateLimits ?? {} }, now().getTime());
  if (!limit.allowed) {
    throw new GatewayError("rate_limited", `Too many registry lookups for this business. Try again in ${limit.retryAfterSeconds} seconds.`, 429, { retryAfterSeconds: limit.retryAfterSeconds, scope: limit.scope, limit: limit.limit });
  }
  const ctx: ToolContext = {
    businessId: input.businessId,
    agentId: NIL_ID,
    sessionId: NIL_ID,
    integration: mockIntegrationRecord(input.connector, input.businessId, mode === "live" ? { status: "connected" } : {}),
    log: deps.log,
    mode,
  };
  let result;
  try {
    result = await connector.callTool(input.tool, input.args, ctx);
  } catch (e) {
    if (isConfigError(e)) throw new GatewayError("registry_unconfigured", `${connector.displayName} lookups are not set up on this server yet`, 503, { connector: input.connector });
    deps.log.warn({ err: safeError(e), businessId: input.businessId, connector: input.connector, tool: input.tool }, "registry lookup failed");
    throw new GatewayError("registry_unavailable", `${connector.displayName} could not be reached`, 502, { connector: input.connector });
  }
  const costMinor = Math.max(0, Math.round(result.costMinor ?? connector.costModel?.(input.tool, input.args) ?? 0));
  // The lookup has run: the audit row comes first and on its own; booking its usage cannot fail it.
  const audit = await repos.audit.append(deps.db, input.businessId, {
    actorKind: "system",
    action: "gateway.registry.lookup",
    target: { kind: "registry", connector: input.connector, tool: input.tool },
    details: { service, mode, ok: result.ok, errorCode: result.error?.code ?? null, costMinor, untrusted: isUntrusted(result.data) },
  });
  if (result.ok && costMinor > 0) {
    try {
      await bookUsage(deps.db, input.businessId, {
        kind: "tool",
        quantity: 1,
        unit: "calls",
        costMinor,
        currency: business.currency,
        billedTo: business.modelBilling,
        occurredAt: now(),
        details: { connector: input.connector, tool: input.tool, mode, label: "Estimate", auditId: audit.id, service },
      });
    } catch (e) {
      deps.log.error({ err: safeError(e), auditId: audit.id, costMinor }, "registry lookup ran but its usage could not be booked");
    }
  }
  const data = result.data === undefined ? undefined : isUntrusted(result.data) ? toAgentEnvelope(result.data) : result.data;
  return {
    mode,
    ok: result.ok,
    ...(data !== undefined ? { data } : {}),
    ...(result.error ? { error: { code: result.error.code, status: typeof result.error.status === "number" ? result.error.status : null } } : {}),
    costMinor,
    ...(mode === "mock" ? { simulated: true as const, notice: SIMULATED_NOTICE } : {}),
  };
}
