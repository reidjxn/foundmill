/**
 * A project's own domain for Settings › Integrations (WP-08 domain plan, Path B). Members read it under RLS; the founders
 * (owner or admin) add, check and remove it. With SendGrid live the gateway does the work (SendGrid's domain
 * authentication and DNS) and writes `project_domains`; with SendGrid mock the api runs the same flow on the connector's
 * mock (`runOwnDomain`) and writes the row on the service connection, so the golden path needs no gateway, and never
 * for a person's project on staging or production (`mockResultsAllowed`). The api adds what only it knows: the project's Foundmill site host, for the `www`
 * record, and the audit row for the founder's press.
 */
import { mockIntegrationRecord, OPENSRS_KEY, quoteDomain, registerDomain, runOwnDomain, SENDING_DOMAIN_KEY, setupRegisteredDomain, type ToolContext } from "@foundmill/connectors";
import { OwnDomainTakenError, projectDomainsStore, repos } from "@foundmill/db";
import { AppError, connectorMode, ForbiddenError, mockResultsAllowed, platformMailDomain, platformMailMode, type RegistrantContact } from "@foundmill/shared";
import type { GatewayOwnDomain, GatewayOwnDomainRequest, GatewayRegisterDomainRequest, GatewayRegisterDomainResult } from "./gateway";
import { audit, type BusinessContext } from "../trpc";
import { isProjectFounder } from "./postal-address";

type Stamp = Date | string | null | undefined;
const iso = (v: Stamp): string | null => (v ? new Date(v).toISOString() : null);

/** A row as either service returns it (a Drizzle row here, JSON from the gateway). */
interface RowLike {
  domain: string;
  senderLocalPart: string;
  records: unknown;
  status: string;
  checkedAt: Stamp;
  verifiedAt: Stamp;
  source?: string;
  registeredAt?: Stamp;
  expiresAt?: Stamp;
  priceMinor?: number | null;
  forwardingOptedInAt?: Stamp;
  forwardingUserId?: string | null;
}

/** What Settings shows: the domain without SendGrid's id, and whether the reader may change it. */
export interface OwnDomainView {
  domain: (NonNullable<GatewayOwnDomain["domain"]> & { source: "own" | "registered"; registeredAt: string | null; expiresAt: string | null; priceMinor: number | null; forwarding: boolean; forwardingMine: boolean }) | null;
  canEdit: boolean;
  /** Whether "Get a domain" can register one here: simulated where mock results are allowed; live waits for payment. */
  canRegister: boolean;
  simulated?: boolean;
}

const view = (ctx: BusinessContext, row: RowLike | null, simulated?: boolean): OwnDomainView => ({
  domain: row
    ? {
        domain: row.domain,
        senderLocalPart: row.senderLocalPart,
        records: row.records as NonNullable<GatewayOwnDomain["domain"]>["records"],
        status: row.status as "pending" | "verified",
        checkedAt: iso(row.checkedAt),
        verifiedAt: iso(row.verifiedAt),
        source: row.source === "registered" ? "registered" : "own",
        registeredAt: iso(row.registeredAt),
        expiresAt: iso(row.expiresAt),
        priceMinor: row.priceMinor ?? null,
        forwarding: Boolean(row.forwardingOptedInAt),
        // Whose inbox: the reader's own, or another founder's (the button then offers to move it to the reader).
        forwardingMine: Boolean(row.forwardingOptedInAt) && row.forwardingUserId === ctx.userId,
      }
    : null,
  canEdit: isProjectFounder(ctx),
  canRegister: connectorMode(ctx.env, OPENSRS_KEY) === "mock" && mockResultsAllowed(ctx.env.APP_ENV, ctx.business.isDemo),
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
    return { mode: "mock", simulated: true, domain: row ? { ...row, checkedAt: iso(row.checkedAt), verifiedAt: iso(row.verifiedAt) } : null };
  };
}

export async function addOwnDomain(ctx: BusinessContext, input: { domain: string; senderLocalPart: string }): Promise<OwnDomainView> {
  const r = await gatewayFor(ctx)({ action: "add", businessId: ctx.businessId, userId: ctx.userId!, domain: input.domain, senderLocalPart: input.senderLocalPart, siteHost: await siteHostOf(ctx) });
  await ctx.rls((tx) => audit(tx, ctx, { action: "integrations.own_domain_added", target: { kind: "business", id: ctx.businessId }, details: { domain: r.domain?.domain ?? null, simulated: r.simulated } }));
  return view(ctx, r.domain as RowLike | null, r.simulated);
}

export async function checkOwnDomain(ctx: BusinessContext): Promise<OwnDomainView> {
  const r = await gatewayFor(ctx)({ action: "check", businessId: ctx.businessId, siteHost: await siteHostOf(ctx) });
  await ctx.rls((tx) => audit(tx, ctx, { action: "integrations.own_domain_checked", target: { kind: "business", id: ctx.businessId }, details: { domain: r.domain?.domain ?? null, status: r.domain?.status ?? null, simulated: r.simulated } }));
  return view(ctx, r.domain as RowLike | null, r.simulated);
}

export async function removeOwnDomain(ctx: BusinessContext): Promise<OwnDomainView> {
  const before = await ctx.rls((tx) => repos.projectDomains.view(tx, ctx.businessId));
  const r = await gatewayFor(ctx)({ action: "remove", businessId: ctx.businessId });
  await ctx.rls((tx) => audit(tx, ctx, { action: "integrations.own_domain_removed", target: { kind: "business", id: ctx.businessId }, details: { domain: before?.domain ?? null, simulated: r.simulated } }));
  return view(ctx, null, r.simulated);
}

/* ---- Path A: a domain registered through Foundmill on OpenSRS ---- */

/** The registration flow: in the gateway when OpenSRS runs live, here on the mocks otherwise (never for a person's project on staging or production). */
function registrarFor(ctx: BusinessContext): (input: GatewayRegisterDomainRequest) => Promise<GatewayRegisterDomainResult> {
  if (!isProjectFounder(ctx)) throw new ForbiddenError("Only the founders get a domain for the project.");
  if (!platformMailDomain(ctx.env)) throw new AppError("not_available", "Email from your project is not switched on here.", 409);
  if (connectorMode(ctx.env, OPENSRS_KEY) === "live") {
    const call = ctx.gateway.registerDomain;
    if (!call) throw new AppError("gateway_unreachable", "The gateway cannot register domains here.", 503);
    return call;
  }
  if (!mockResultsAllowed(ctx.env.APP_ENV, ctx.business.isDemo)) throw new AppError("not_available", "Getting a domain here is not available yet. Nothing was changed.", 409);
  const nil = "00000000-0000-0000-0000-000000000000";
  const caller = (key: string) => {
    const connector = ctx.connectors.get(key, "mock");
    const tool: ToolContext = { businessId: ctx.businessId, agentId: nil, sessionId: nil, integration: mockIntegrationRecord(key, ctx.businessId), log: ctx.log, mode: "mock" };
    return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const r = await connector.callTool(name, args, tool);
      if (!r.ok) throw new AppError("domain_vendor_failed", "The domain could not be registered. Nothing was changed.", 502);
      return r.data as T;
    };
  };
  const flow = { registrar: caller(OPENSRS_KEY), sending: caller(SENDING_DOMAIN_KEY), store: projectDomainsStore(ctx.db), simulated: true };
  return async (input) => {
    if (input.action === "quote") return { mode: "mock", simulated: true, quote: await quoteDomain(flow, input.domain) };
    const row = input.action === "register" ? await registerDomain(flow, input) : await setupRegisteredDomain(flow, input);
    return { mode: "mock", simulated: true, domain: row ? ({ ...row, checkedAt: iso(row.checkedAt), verifiedAt: iso(row.verifiedAt) } as never) : null };
  };
}

export async function quoteRegisteredDomain(ctx: BusinessContext, domain: string) {
  const r = await registrarFor(ctx)({ action: "quote", businessId: ctx.businessId, domain });
  return { ...("quote" in r ? r.quote : { domain, available: false, priceMinor: null }), simulated: r.simulated };
}

/**
 * The founder's own press: they saw the price (an Estimate) and Tucows' registration agreement and accepted it, and
 * they are the domain's owner with the contact details they entered. Never an agent's (hard gates: money, terms, the
 * founder's identity).
 */
export async function registerProjectDomain(ctx: BusinessContext, input: { domain: string; priceMinor: number; owner: RegistrantContact; acceptAgreement: true }): Promise<OwnDomainView> {
  const r = await registrarFor(ctx)({ action: "register", businessId: ctx.businessId, userId: ctx.userId!, domain: input.domain, owner: input.owner, priceMinor: input.priceMinor, siteHost: await siteHostOf(ctx) });
  const row = "domain" in r ? r.domain : null;
  await ctx.rls((tx) => audit(tx, ctx, { action: "integrations.domain_registered", target: { kind: "business", id: ctx.businessId }, details: { domain: row?.domain ?? input.domain, priceMinor: input.priceMinor, agreementAccepted: input.acceptAgreement, simulated: r.simulated } }));
  return view(ctx, row as RowLike | null, r.simulated);
}

/** "Finish setup": SendGrid's authentication and the zone again, after a step failed once the domain was registered. */
export async function finishRegisteredDomain(ctx: BusinessContext): Promise<OwnDomainView> {
  const r = await registrarFor(ctx)({ action: "setup", businessId: ctx.businessId, siteHost: await siteHostOf(ctx) });
  await ctx.rls((tx) => audit(tx, ctx, { action: "integrations.domain_setup", target: { kind: "business", id: ctx.businessId }, details: { simulated: r.simulated } }));
  return view(ctx, ("domain" in r ? r.domain : null) as RowLike | null, r.simulated);
}

/**
 * Forwarding to this founder's own inbox, on after their own click (it moves the copy to them from another founder);
 * off by any founder, audited. Registered domains only. The delivery (next change) checks the person is still a founder
 * before each copy, so someone who left the project never gets one.
 */
export async function setRegisteredDomainForwarding(ctx: BusinessContext, on: boolean): Promise<OwnDomainView> {
  if (!isProjectFounder(ctx)) throw new ForbiddenError("Only the founders turn forwarding on or off.");
  const row = await repos.projectDomains.setForwarding(ctx.db, ctx.businessId, { userId: on ? ctx.userId! : null, now: new Date() });
  if (!row) throw new AppError("not_found", "Forwarding is for a domain registered for the project.", 404);
  await ctx.rls((tx) => audit(tx, ctx, { action: on ? "integrations.domain_forwarding_on" : "integrations.domain_forwarding_off", target: { kind: "business", id: ctx.businessId }, details: { domain: row.domain } }));
  return view(ctx, row, platformMailMode(ctx.env) === "mock");
}
