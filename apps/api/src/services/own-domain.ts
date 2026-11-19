/**
 * A project's own domain for Settings › Integrations (WP-08 domain plan, Path B). Members read it under RLS; the founders
 * (owner or admin) add, check and remove it. With SendGrid live the gateway does the work (SendGrid's domain
 * authentication and DNS) and writes `project_domains`; with SendGrid mock the api runs the same flow on the connector's
 * mock (`runOwnDomain`) and writes the row on the service connection, so the golden path needs no gateway, and never
 * for a person's project on staging or production (`mockResultsAllowed`). The api adds what only it knows: the project's Foundmill site host, for the `www`
 * record, and the audit row for the founder's press.
 */
import { mockIntegrationRecord, runOwnDomain, SENDING_DOMAIN_KEY, type ToolContext } from "@foundmill/connectors";
import { OwnDomainTakenError, projectDomainsStore, repos } from "@foundmill/db";
import { AppError, ForbiddenError, mockResultsAllowed, platformMailDomain, platformMailMode } from "@foundmill/shared";
import type { GatewayOwnDomain, GatewayOwnDomainRequest } from "./gateway";
import { audit, type BusinessContext } from "../trpc";
import { isProjectFounder } from "./postal-address";

/** What Settings shows: the domain without SendGrid's id, and whether the reader may change it. */
export interface OwnDomainView {
  domain: NonNullable<GatewayOwnDomain["domain"]> | null;
  canEdit: boolean;
  simulated?: boolean;
}

const view = (ctx: BusinessContext, row: GatewayOwnDomain["domain"] | { domain: string; senderLocalPart: string; records: unknown; status: string; checkedAt: Date | string | null; verifiedAt: Date | string | null } | null, simulated?: boolean): OwnDomainView => ({
  domain: row ? { domain: row.domain, senderLocalPart: row.senderLocalPart, records: row.records as NonNullable<GatewayOwnDomain["domain"]>["records"], status: row.status as "pending" | "verified", checkedAt: row.checkedAt ? new Date(row.checkedAt).toISOString() : null, verifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : null } : null,
  canEdit: isProjectFounder(ctx),
  ...(simulated !== undefined ? { simulated } : {}),
});

/** The project's Foundmill site host (`<slug>.<SITES_DOMAIN>`), for the `www` record; null without a site. */
async function siteHostOf(ctx: BusinessContext): Promise<string | null> {
  const sitesDomain = ctx.env.SITES_DOMAIN?.trim();
  if (!sitesDomain) return null;
  const site = await ctx.rls((tx) => repos.sites.get(tx, ctx.businessId));
  return site ? `${site.slug}.${sitesDomain}` : null;
}

export async function ownDomainOf(ctx: BusinessContext): Promise<OwnDomainView | null> {
  if (!platformMailDomain(ctx.env)) return null;
  return view(ctx, await ctx.rls((tx) => repos.projectDomains.view(tx, ctx.businessId)), platformMailMode(ctx.env) === "mock");
}

function gatewayFor(ctx: BusinessContext): (input: GatewayOwnDomainRequest) => Promise<GatewayOwnDomain> {
  if (!isProjectFounder(ctx)) throw new ForbiddenError("Only the founders set up the project's own domain.");
  if (!platformMailDomain(ctx.env)) throw new AppError("not_available", "Email from your project is not switched on here.", 409);
  if (platformMailMode(ctx.env) === "mock") {
    if (!mockResultsAllowed(ctx.env.APP_ENV, ctx.business.isDemo)) throw new AppError("not_available", "Sending from your own domain is not available here yet. Nothing was changed.", 409);
    return mockOwnDomain(ctx);
  }
  const call = ctx.gateway.ownDomain;
  if (!call) throw new AppError("gateway_unreachable", "The gateway cannot set up domains here.", 503);
  return call;
}

/** The flow on the connector's mock, here: it reaches nothing, and the row is written on the service connection. */
function mockOwnDomain(ctx: BusinessContext) {
  const connector = ctx.connectors.get(SENDING_DOMAIN_KEY, "mock");
  const nil = "00000000-0000-0000-0000-000000000000";
  const tool: ToolContext = { businessId: ctx.businessId, agentId: nil, sessionId: nil, integration: mockIntegrationRecord(SENDING_DOMAIN_KEY, ctx.businessId), log: ctx.log, mode: "mock" };
  return async (input: GatewayOwnDomainRequest): Promise<GatewayOwnDomain> => {
    const row = await runOwnDomain(
      {
        call: async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
          const r = await connector.callTool(name, args, tool);
          if (!r.ok) throw new AppError("domain_vendor_failed", "The domain could not be set up. Nothing was changed.", 502);
          return r.data as T;
        },
        store: projectDomainsStore(ctx.db),
        isTaken: (e) => e instanceof OwnDomainTakenError,
        now: () => new Date(),
        warn: (obj, msg) => ctx.log.warn(obj, msg),
        simulated: true,
      },
      input,
    );
    return { mode: "mock", simulated: true, domain: row ? { ...row, checkedAt: row.checkedAt?.toISOString() ?? null, verifiedAt: row.verifiedAt?.toISOString() ?? null } : null };
  };
}

export async function addOwnDomain(ctx: BusinessContext, input: { domain: string; senderLocalPart: string }): Promise<OwnDomainView> {
  const r = await gatewayFor(ctx)({ action: "add", businessId: ctx.businessId, userId: ctx.userId!, domain: input.domain, senderLocalPart: input.senderLocalPart, siteHost: await siteHostOf(ctx) });
  await ctx.rls((tx) => audit(tx, ctx, { action: "integrations.own_domain_added", target: { kind: "business", id: ctx.businessId }, details: { domain: r.domain?.domain ?? null, simulated: r.simulated } }));
  return view(ctx, r.domain, r.simulated);
}

export async function checkOwnDomain(ctx: BusinessContext): Promise<OwnDomainView> {
  const r = await gatewayFor(ctx)({ action: "check", businessId: ctx.businessId, siteHost: await siteHostOf(ctx) });
  await ctx.rls((tx) => audit(tx, ctx, { action: "integrations.own_domain_checked", target: { kind: "business", id: ctx.businessId }, details: { domain: r.domain?.domain ?? null, status: r.domain?.status ?? null, simulated: r.simulated } }));
  return view(ctx, r.domain, r.simulated);
}

export async function removeOwnDomain(ctx: BusinessContext): Promise<OwnDomainView> {
  const before = await ctx.rls((tx) => repos.projectDomains.view(tx, ctx.businessId));
  const r = await gatewayFor(ctx)({ action: "remove", businessId: ctx.businessId });
  await ctx.rls((tx) => audit(tx, ctx, { action: "integrations.own_domain_removed", target: { kind: "business", id: ctx.businessId }, details: { domain: before?.domain ?? null, simulated: r.simulated } }));
  return view(ctx, null, r.simulated);
}
