/**
 * A domain registered through Foundmill (docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md, Path A). The api asks
 * (`POST /v1/domains/register`, service token `svc: api`, under the `/v1/domains/*` checks) when OpenSRS runs live; the
 * gateway is the only service that reaches OpenSRS (its live host allows the gateway's IP only) and SendGrid, and the
 * flow (`quoteDomain`, `registerDomain`, `setupRegisteredDomain`, shared with the api's mock path) writes
 * `project_domains` on the service connection.
 *
 * shortcut: a live `register` is refused until the founder can pay for the domain through Foundmill's Stripe (a domain
 * checkout and its webhook); registering then would spend the reseller balance with nothing charged. Upgrade when the
 * domain checkout lands: register only for a paid checkout, from the platform billing webhook.
 */
import { z } from "zod";
import { mockIntegrationRecord, OPENSRS_KEY, quoteDomain, registerDomain, SENDING_DOMAIN_KEY, setupRegisteredDomain, type ToolContext } from "@foundmill/connectors";
import { domainOrdersStore, projectDomainsStore, repos, type ProjectDomain } from "@foundmill/db";
import { mockResultsAllowed } from "@foundmill/shared";
import { GatewayError, modeFor, type GatewayDeps } from "./pipeline";
import { checkRateLimit } from "./rate-limit";

export const REGISTER_DOMAIN_ROUTE = "/v1/domains/register";

const NIL_ID = "00000000-0000-0000-0000-000000000000";
const SiteHost = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/).nullable();

export const RegisterDomainRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote"), businessId: z.guid(), domain: z.string().max(300) }),
  // Only for a paid domain checkout (0150): its domain, price and the founder's details come from the checkout.
  z.object({ action: z.literal("register"), businessId: z.guid(), userId: z.guid(), checkoutId: z.guid(), siteHost: SiteHost }),
  z.object({ action: z.literal("setup"), businessId: z.guid(), siteHost: SiteHost }),
]);
export type RegisterDomainRequest = z.infer<typeof RegisterDomainRequest>;

export type RegisterDomainResponse = { mode: "mock" | "live"; simulated: boolean } & ({ quote: { domain: string; available: boolean; priceMinor: number | null } } | { domain: ProjectDomain | null });

/** Lookups a project makes in a minute (each is up to two OpenSRS calls). */
export const QUOTE_LIMITS = { perMinute: 20, perDay: 300 };

export async function handleRegisterDomain(deps: GatewayDeps, input: RegisterDomainRequest): Promise<RegisterDomainResponse> {
  const mode = modeFor(deps, OPENSRS_KEY);
  const business = await repos.businesses.get(deps.db, input.businessId).catch(() => null);
  if (!business) throw new GatewayError("not_found", "No such project", 404);
  if (mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, business.isDemo)) {
    throw new GatewayError("not_available", "Getting a domain here is not available yet. Nothing was changed.", 409);
  }
  if (input.action === "quote") {
    const limit = await checkRateLimit(deps.rateLimits, { businessId: input.businessId, connector: `${OPENSRS_KEY}:quote`, limits: QUOTE_LIMITS }, (deps.now?.() ?? new Date()).getTime());
    if (!limit.allowed) throw new GatewayError("rate_limited", `Too many lookups. Try again in ${limit.retryAfterSeconds} seconds.`, 429, { retryAfterSeconds: limit.retryAfterSeconds });
  }
  const caller = (key: string) => {
    const connector = deps.registry.get(key, modeFor(deps, key));
    const ctx: ToolContext = { businessId: input.businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(key, input.businessId), log: deps.log, mode: modeFor(deps, key) };
    return async <T>(tool: string, args: Record<string, unknown>): Promise<T> => {
      const r = await connector.callTool(tool, args, ctx);
      if (!r.ok) {
        deps.log.warn({ businessId: input.businessId, connector: key, tool, code: r.error?.code, status: r.error?.status }, "domain registration call refused");
        // A definite refusal stays one (4xx), so the flow can give the payment back; anything else may have acted.
        const status = r.error?.status;
        if (typeof status === "number" && status >= 400 && status < 500) throw new GatewayError("registry_refused", "The registry refused this request.", 409);
        throw new GatewayError("domain_vendor_failed", "The registry did not answer as expected. Try again in a minute.", 502);
      }
      return r.data as T;
    };
  };
  const flow = { registrar: caller(OPENSRS_KEY), sending: caller(SENDING_DOMAIN_KEY), store: projectDomainsStore(deps.db), simulated: mode === "mock" };
  const base = { mode, simulated: mode === "mock" };
  if (input.action === "quote") return { ...base, quote: await quoteDomain(flow, input.domain) };
  if (input.action === "register") return { ...base, domain: await registerDomain({ ...flow, orders: domainOrdersStore(deps.db) }, input) };
  return { ...base, domain: await setupRegisteredDomain(flow, input) };
}
