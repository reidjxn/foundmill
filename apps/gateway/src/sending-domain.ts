/**
 * A project's own domain (docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md, Path B: a domain the founder already
 * owns). The api asks (`POST /v1/domains/own`, service token `svc: api`) once a founder (owner or admin) pressed Add,
 * Check now or Remove in Settings › Integrations and SendGrid runs live; the gateway is the only service that reaches
 * SendGrid and DNS, so the service-only `sending_domain` connector runs here and the flow (`runOwnDomain`, shared with
 * the api's mock path) writes `project_domains` on the service connection.
 *
 * A mock result is never written for a person's project on staging or production (`mockResultsAllowed`): a simulated
 * "verified" would send as a domain nobody checked. Nothing here is audited: the api audits the founder's press.
 */
import { z } from "zod";
import { mockIntegrationRecord, runOwnDomain, SENDING_DOMAIN_KEY, type ToolContext } from "@foundmill/connectors";
import { OwnDomainTakenError, projectDomainsStore, repos, type ProjectDomain } from "@foundmill/db";
import { mockResultsAllowed } from "@foundmill/shared";
import { GatewayError, modeFor, type GatewayDeps } from "./pipeline";
import { checkRateLimit } from "./rate-limit";

export const OWN_DOMAIN_ROUTE = "/v1/domains/own";

/** Domains one project may add in a day (each is an authentication at SendGrid). */
export const OWN_DOMAIN_ADD_LIMITS = { perDay: 10 };

const NIL_ID = "00000000-0000-0000-0000-000000000000";
/** The project's Foundmill site host (`<slug>.<SITES_DOMAIN>`), when it has a site; the api knows it. */
const SiteHost = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/).nullable();

export const OwnDomainRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), businessId: z.guid(), userId: z.guid(), domain: z.string().max(300), senderLocalPart: z.string().max(40), siteHost: SiteHost }),
  z.object({ action: z.literal("check"), businessId: z.guid(), siteHost: SiteHost }),
  z.object({ action: z.literal("remove"), businessId: z.guid() }),
]);
export type OwnDomainRequest = z.infer<typeof OwnDomainRequest>;

export interface OwnDomainResponse {
  mode: "mock" | "live";
  /** True when the answer came from the mock: nothing was asked of SendGrid or DNS. */
  simulated: boolean;
  domain: ProjectDomain | null;
}

export async function handleOwnDomain(deps: GatewayDeps, input: OwnDomainRequest): Promise<OwnDomainResponse> {
  const mode = modeFor(deps, SENDING_DOMAIN_KEY);
  const business = await repos.businesses.get(deps.db, input.businessId).catch(() => null);
  if (!business) throw new GatewayError("not_found", "No such project", 404);
  if (mode === "mock" && deps.appEnv !== undefined && !mockResultsAllowed(deps.appEnv, business.isDemo)) {
    throw new GatewayError("not_available", "Sending from your own domain is not available here yet. Nothing was changed.", 409);
  }
  // Each add is a domain authentication on the platform's one SendGrid account: a project adds a few a day at most.
  if (input.action === "add") {
    const limit = await checkRateLimit(deps.rateLimits, { businessId: input.businessId, connector: `${SENDING_DOMAIN_KEY}:add`, limits: OWN_DOMAIN_ADD_LIMITS }, (deps.now?.() ?? new Date()).getTime());
    if (!limit.allowed) throw new GatewayError("rate_limited", "Too many domains added today. Try again tomorrow.", 429, { retryAfterSeconds: limit.retryAfterSeconds });
  }
  const connector = deps.registry.get(SENDING_DOMAIN_KEY, mode);
  const ctx: ToolContext = { businessId: input.businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(SENDING_DOMAIN_KEY, input.businessId), log: deps.log, mode };
  const domain = await runOwnDomain(
    {
      call: async <T>(tool: string, args: Record<string, unknown>): Promise<T> => {
        const r = await connector.callTool(tool, args, ctx);
        if (!r.ok) {
          deps.log.warn({ businessId: input.businessId, tool, code: r.error?.code, status: r.error?.status }, "own domain call refused");
          throw new GatewayError("domain_vendor_failed", "SendGrid did not answer as expected. Nothing was changed; try again in a minute.", 502);
        }
        return r.data as T;
      },
      store: projectDomainsStore(deps.db),
      isTaken: (e) => e instanceof OwnDomainTakenError,
      now: () => deps.now?.() ?? new Date(),
      warn: (obj, msg) => deps.log.warn(obj, msg),
      simulated: mode === "mock",
    },
    input,
  );
  return { mode, simulated: mode === "mock", domain };
}
