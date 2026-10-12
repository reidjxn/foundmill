/**
 * The gateway HTTP surface (docs/ARCHITECTURE.md §9). `createGatewayApp(deps)` returns a Hono app with no
 * listener so tests can run it on an ephemeral port and `index.ts` can bind it to PORT / GATEWAY_PORT.
 *
 *   GET  /health                   liveness + what this replica runs (mode, connectors, policy, vault)
 *   GET  /v1/connectors            catalogue: phase, auth kind, tools, policyHints (public within the private network)
 *   POST /v1/session-tokens        service JWT → session JWT for one agent session
 *   POST /v1/integrations/connect  service JWT → connect an App connector (GitHub) whose keys only the gateway holds
 *   POST /v1/integrations/health   service JWT → that integration's health check
 *   POST /v1/call                  session JWT → the pipeline (allow / ask / deny / rate_limited)
 *   ALL  /mcp/:connector           session JWT → that connector's tools as an MCP streamable-HTTP server
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError, z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { AppError, NotFoundError, UnauthorizedError } from "@foundmill/shared";
import { isConfigError, type Connector, type HealthResult } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { cedarVersion, getPolicyEngine } from "@foundmill/policy";
import { bearerToken, mintSessionToken, verifyServiceToken, verifySessionToken, type ServiceToken, type SessionToken } from "./tokens";
import { toIntegrationRecord } from "./credentials";
import { appInstallationVerified, executeToolCall, GatewayError, modeFor, type GatewayDeps } from "./pipeline";
import { handleMcpRequest } from "./mcp";
import { toCandidates } from "./recipients";
import { STATE_ERROR_CODES, stateDenial } from "./state";
import { CallRequest, ConnectIntegrationRequest, IntegrationHealthRequest, MintSessionTokenRequest, type GatewayErrorBody, type HealthResponse, type MintSessionTokenResponse } from "./types";
import { DEFAULT_SESSION_TTL_SECONDS, MAX_SESSION_TTL_SECONDS } from "./config";

export interface GatewayAppOptions {
  sessionTokenSecret: string;
  sessionTokenTtlSeconds?: number;
  sessionTokenMaxTtlSeconds?: number;
  /** For `/health`. */
  rateLimitStoreKind?: "memory" | "redis";
  /** For `/health`: whether the database answered at boot (see db-boot.ts). Defaults to true. */
  dbReady?: () => boolean;
}

/** Largest body per route (see the limits in createGatewayApp). */
export const MAX_CALL_BODY_BYTES = 16 * 1024 * 1024;
export const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;
export const MAX_SERVICE_BODY_BYTES = 1024 * 1024;

type Variables = { session: SessionToken; service: ServiceToken };
export type GatewayApp = Hono<{ Variables: Variables }>;

const errorBody = (code: string, message: string, details?: unknown): GatewayErrorBody => ({ error: { code, message, ...(details !== undefined ? { details } : {}) } });

export function createGatewayApp(deps: GatewayDeps, options: GatewayAppOptions): GatewayApp {
  const app = new Hono<{ Variables: Variables }>();
  const now = deps.now ?? (() => new Date());
  const secret = options.sessionTokenSecret;
  const defaultTtl = options.sessionTokenTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const maxTtl = options.sessionTokenMaxTtlSeconds ?? MAX_SESSION_TTL_SECONDS;

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json(errorBody("validation", "Invalid request", err.issues), 400);
    if (err instanceof AppError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) deps.log.error({ err, code: err.code }, "gateway request failed");
      return c.json(errorBody(err.code, err.message, status < 500 ? err.details : undefined), status as 400);
    }
    deps.log.error({ err }, "unhandled gateway error");
    return c.json(errorBody("internal", "Internal error"), 500);
  });

  app.notFound((c) => c.json(errorBody("not_found", `No route for ${c.req.method} ${c.req.path}`), 404));

  // Request bodies are bounded before anything parses them: a direct call can carry one commit_files push (10 MB of
  // files, base64 in JSON), an agent's MCP call far less, the service routes a few kilobytes.
  const limit = (maxSize: number) => bodyLimit({ maxSize, onError: (c) => c.json(errorBody("payload_too_large", `Request body is larger than ${Math.round(maxSize / 1024)} KB`), 413) });
  app.use("/v1/call", limit(MAX_CALL_BODY_BYTES));
  app.use("/mcp/*", limit(MAX_MCP_BODY_BYTES));
  app.use("/v1/session-tokens", limit(MAX_SERVICE_BODY_BYTES));
  app.use("/v1/integrations/*", limit(MAX_SERVICE_BODY_BYTES));

  app.get("/health", (c) => {
    const engine = getPolicyEngine();
    const db = options.dbReady ? options.dbReady() : true;
    const body: HealthResponse = {
      ok: db,
      service: "gateway",
      app: APP_NAME,
      db,
      mode: deps.mode,
      connectors: deps.registry.keys().length,
      policy: { cedar: cedarVersion(), policies: Object.keys(engine.policySet.byId).length },
      vault: deps.vault?.kind ?? "none",
      rateLimitStore: options.rateLimitStoreKind ?? "memory",
      time: now().toISOString(),
    };
    // Readiness for Railway's healthcheck (railway/gateway.toml): 503 while the database is unavailable.
    return c.json(body, db ? 200 : 503);
  });

  app.get("/v1/connectors", (c) => c.json({ mode: deps.mode, connectors: deps.registry.catalogue(deps.mode) }));

  // --- service auth -------------------------------------------------------------------------------------------
  const requireService = async (c: { req: { header(name: string): string | undefined }; set(key: "service", value: ServiceToken): void }, next: () => Promise<void>) => {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) throw new UnauthorizedError("A service Bearer token is required");
    c.set("service", await verifyServiceToken(secret, token));
    await next();
  };
  app.use("/v1/session-tokens", requireService);
  app.use("/v1/integrations/*", requireService);
  // Connecting an App installation is the api's job alone (it checked the founder's signed state).
  app.use("/v1/integrations/*", async (c, next) => {
    if (c.var.service.svc !== "api") throw new GatewayError("forbidden_service", "Only the api connects App installations", 403);
    await next();
  });

  app.post("/v1/session-tokens", async (c) => {
    const input = MintSessionTokenRequest.parse(await c.req.json());
    const ttl = Math.min(maxTtl, input.ttlSeconds ?? defaultTtl);
    const { ttlSeconds: _ttl, untrusted, ...claims } = input;
    // The business and the agent must exist: a token can only be minted for a real session of a real club.
    const business = await repos.businesses.get(deps.db, claims.businessId, { includeArchived: true }).catch(() => {
      throw new GatewayError("business_not_found", `business ${claims.businessId} is not available to this gateway`, 404);
    });
    const agent = await repos.agents.get(deps.db, claims.businessId, claims.agentId).catch(() => {
      throw new GatewayError("agent_not_found", `agent ${claims.agentId} is not in business ${claims.businessId}`, 404);
    });
    // ...and be allowed to work (SEC-1): no token for an archived club, a released agent or a paused one.
    const denial = stateDenial(business, agent);
    if (denial) {
      await repos.audit.append(deps.db, claims.businessId, {
        actorKind: "system",
        action: "gateway.session_token.refused",
        target: { agentId: claims.agentId, sessionId: claims.sessionId },
        details: { service: c.var.service.svc, policyIds: [denial.policyId], reasons: denial.reasons, allowedTools: claims.allowedTools },
      });
      throw new GatewayError(STATE_ERROR_CODES[denial.policyId], denial.reasons[0] ?? denial.policyId, 403, { policyIds: [denial.policyId] });
    }
    // Recipients found in what an earlier session left behind are untrusted here from the first call (§9.8 step 4); the
    // token records that a seed exists, so a replica without it fails closed.
    const seeded = untrusted ? deps.recipients.seed(claims.sessionId, toCandidates(untrusted), untrusted.all) : 0;
    const minted = await mintSessionToken(secret, { ...claims, untrustedSeeded: claims.untrustedSeeded || !!untrusted }, ttl, now);
    await repos.audit.append(deps.db, claims.businessId, {
      actorKind: "system",
      action: "gateway.session_token.minted",
      target: { agentId: claims.agentId, sessionId: claims.sessionId },
      details: { service: c.var.service.svc, tokenId: minted.jti, allowedTools: claims.allowedTools, kitMode: claims.kitMode, expiresAt: minted.expiresAt, ...(untrusted ? { untrustedSeeded: seeded, untrustedAll: untrusted.all } : {}) },
    });
    const body: MintSessionTokenResponse = { token: minted.token, expiresAt: minted.expiresAt, jti: minted.jti };
    return c.json(body, 201);
  });

  // --- App connectors: connect and health run here, where the App's keys are (BUILD §2.1 rule 2) ---------------
  const appConnector = (key: string): Connector => {
    let connector: Connector;
    try {
      connector = deps.registry.get(key, modeFor(deps, key));
    } catch (e) {
      if (e instanceof NotFoundError) throw new GatewayError("unknown_connector", `Unknown connector "${key}"`, 404, { connector: key });
      throw e;
    }
    if (connector.auth.kind !== "app") throw new GatewayError("not_app_connector", `${connector.displayName} is not connected through the gateway`, 400, { connector: key });
    return connector;
  };
  const vendorFailure = (e: unknown, connector: string): never => {
    if (isConfigError(e)) throw new GatewayError("connector_unconfigured", e.message, 503, { connector });
    if (e instanceof AppError) throw e;
    const status = (e as { status?: unknown }).status;
    throw new GatewayError("vendor_error", typeof status === "number" ? `${connector} answered ${status}` : `${connector} could not be reached`, 502, { connector });
  };

  app.post("/v1/integrations/connect", async (c) => {
    const input = ConnectIntegrationRequest.parse(await c.req.json());
    const connector = appConnector(input.connector);
    await repos.businesses.get(deps.db, input.businessId).catch(() => {
      throw new GatewayError("business_not_found", `business ${input.businessId} is not available to this gateway`, 404);
    });
    const record = await connector.connect(input.businessId, input.input).catch((e: unknown) => vendorFailure(e, connector.key));
    const { credentialToStore: _never, ...safe } = record;
    const { verifiedBy, verifiedAt } = record.config as { verifiedBy?: unknown; verifiedAt?: unknown };
    if (record.status === "connected" && record.externalAccountId && typeof verifiedBy === "string" && typeof verifiedAt === "string") {
      // The one place a verified installation is recorded: only this service role write makes it usable.
      await repos.integrations.recordVerifiedInstallation(deps.db, input.businessId, { connectorKey: connector.key, installationId: record.externalAccountId, accountLabel: record.accountLabel, verifiedBy, verifiedAt: new Date(verifiedAt) });
      await repos.audit.append(deps.db, input.businessId, {
        actorKind: "system",
        action: "gateway.integration.connected",
        target: { connector: connector.key },
        details: { service: c.var.service.svc, status: record.status, externalAccountId: record.externalAccountId, verifiedBy },
      });
    }
    return c.json({ mode: modeFor(deps, connector.key), record: safe });
  });

  app.post("/v1/integrations/health", async (c) => {
    const input = IntegrationHealthRequest.parse(await c.req.json());
    const connector = appConnector(input.connector);
    const row = await repos.integrations.getByKey(deps.db, input.businessId, connector.key);
    if (!row || row.archivedAt !== null) throw new GatewayError("integration_not_connected", `${connector.displayName} is not connected for this business`, 409, { connector: connector.key });
    // Only a live installation this gateway verified is ever checked with the vendor (no token for any other id).
    if (modeFor(deps, connector.key) !== "live" || !appInstallationVerified(row, await repos.integrations.verifiedInstallation(deps.db, input.businessId, connector.key))) {
      const health: HealthResult = { ok: false, status: "disconnected", checkedAt: now().toISOString(), latencyMs: 0, message: `${connector.displayName} is not connected through a verified installation; connect it again from Settings › Integrations` };
      return c.json({ health });
    }
    const health = await connector.healthcheck(toIntegrationRecord(row, null)).catch((e: unknown) => vendorFailure(e, connector.key));
    return c.json({ health });
  });

  // --- session auth -------------------------------------------------------------------------------------------
  const requireSession = async (c: { req: { header(name: string): string | undefined }; set(key: "session", value: SessionToken): void }, next: () => Promise<void>) => {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) throw new UnauthorizedError("A session Bearer token is required");
    c.set("session", await verifySessionToken(secret, token, now));
    await next();
  };
  app.use("/v1/call", requireSession);
  app.use("/mcp/*", requireSession);

  app.post("/v1/call", async (c) => {
    const req = CallRequest.parse(await c.req.json());
    const { status, body } = await executeToolCall(deps, c.var.session, req);
    if (status === 429 && body.outcome === "rate_limited") c.header("Retry-After", String(body.retryAfterSeconds));
    return c.json(body, status);
  });

  app.all("/mcp/:connector", async (c) => {
    const key = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).parse(c.req.param("connector"));
    return handleMcpRequest(deps, c.var.session, key, c.req.raw);
  });

  return app;
}
