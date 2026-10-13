/**
 * Domain availability for the Commit screen (audit 2026-10-13 #458). The api asks (`POST /v1/domains/check`, service token
 * `svc: api`) on behalf of a founder who has no business yet; the gateway is the only service that reaches registries,
 * so the `domains` connector's `check_domains` tool runs here (RDAP in live mode, the deterministic mock otherwise).
 *
 * The founder is the rate-limit scope, through the same per-connector window every tool call uses (`rl:<ownerKey>:domains`),
 * because there is no business to count against. Nothing is audited or stored: the audit log is per business, and the
 * names a founder tries are not worth keeping. The names are not logged either, only how many were asked.
 */
import { z } from "zod";
import { DOMAIN_CHECK_MAX, parseDomain } from "@foundmill/shared";
import { DOMAINS_KEY, mockIntegrationRecord, type ToolContext } from "@foundmill/connectors";
import type { DomainAnswer } from "@foundmill/connectors";
import { GatewayError, modeFor, type GatewayDeps } from "./pipeline";
import { checkRateLimit } from "./rate-limit";

export const CheckDomainsRequest = z.object({
  /** The founder asking (a user id): the rate-limit scope. */
  ownerKey: z.guid(),
  domains: z
    .array(z.string().trim().max(80))
    .min(1)
    .max(DOMAIN_CHECK_MAX)
    .refine((list) => list.every((d) => parseDomain(d) !== null), "Each domain must be a name like example.com, with an allowed top-level domain"),
});
export type CheckDomainsRequest = z.infer<typeof CheckDomainsRequest>;

export interface CheckDomainsResponse {
  mode: "mock" | "live";
  results: DomainAnswer[];
}

const NIL_ID = "00000000-0000-0000-0000-000000000000";

export async function checkDomains(deps: GatewayDeps, input: CheckDomainsRequest): Promise<CheckDomainsResponse> {
  const now = deps.now?.() ?? new Date();
  const mode = modeFor(deps, DOMAINS_KEY);
  const connector = deps.registry.get(DOMAINS_KEY, mode);
  const limit = await checkRateLimit(deps.rateLimits, { businessId: input.ownerKey, connector: DOMAINS_KEY, limits: connector.rateLimits ?? {} }, now.getTime());
  if (!limit.allowed) {
    throw new GatewayError("rate_limited", `Too many domain checks. Try again in ${limit.retryAfterSeconds} seconds.`, 429, { retryAfterSeconds: limit.retryAfterSeconds, scope: limit.scope, limit: limit.limit });
  }
  const ctx: ToolContext = { businessId: input.ownerKey, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(DOMAINS_KEY, input.ownerKey), log: deps.log, mode };
  const result = await connector.callTool("check_domains", { domains: input.domains }, ctx);
  if (!result.ok) {
    deps.log.warn({ count: input.domains.length, code: result.error?.code, status: result.error?.status }, "domain check refused");
    throw new GatewayError("domains_unavailable", `The domain check failed: ${result.error?.message ?? "unknown error"}`, 502);
  }
  return { mode, results: (result.data as { results: DomainAnswer[] }).results };
}
