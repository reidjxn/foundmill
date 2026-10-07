/**
 * The gateway HTTP surface (docs/ARCHITECTURE.md §9). `createGatewayApp(deps)` returns a Hono app with no
 * listener so tests can run it on an ephemeral port and `index.ts` can bind it to PORT / GATEWAY_PORT.
 *
 *   GET  /health                   liveness + what this replica runs (mode, connectors, policy, vault)
 *   GET  /v1/connectors            catalogue: phase, auth kind, tools, policyHints (public within the private network)
 *   POST /v1/session-tokens        service JWT → session JWT for one agent session
 *   POST /v1/call                  session JWT → the pipeline (allow / ask / deny / rate_limited)
 *   ALL  /mcp/:connector           session JWT → that connector's tools as an MCP streamable-HTTP server
 */
import { Hono } from "hono";
import { ZodError, z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { AppError, UnauthorizedError } from "@foundmill/shared";
import { repos } from "@foundmill/db";
import { cedarVersion, getPolicyEngine } from "@foundmill/policy";
import { bearerToken, mintSessionToken, verifyServiceToken, verifySessionToken, type ServiceToken, type SessionToken } from "./tokens";
import { executeToolCall, GatewayError, type GatewayDeps } from "./pipeline";
import { handleMcpRequest } from "./mcp";
import { CallRequest, MintSessionTokenRequest, type GatewayErrorBody, type HealthResponse, type MintSessionTokenResponse } from "./types";
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
    return c.json(body);
  });

  app.get("/v1/connectors", (c) => c.json({ mode: deps.mode, connectors: deps.registry.catalogue(deps.mode) }));

  // --- service auth -------------------------------------------------------------------------------------------
  app.use("/v1/session-tokens", async (c, next) => {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) throw new UnauthorizedError("A service Bearer token is required");
    c.set("service", await verifyServiceToken(secret, token));
    await next();
  });

  app.post("/v1/session-tokens", async (c) => {
    const input = MintSessionTokenRequest.parse(await c.req.json());
    const ttl = Math.min(maxTtl, input.ttlSeconds ?? defaultTtl);
    const { ttlSeconds: _ttl, ...claims } = input;
    // The business and the agent must exist: a token can only be minted for a real session of a real club.
    await repos.businesses.get(deps.db, claims.businessId).catch(() => {
      throw new GatewayError("business_not_found", `business ${claims.businessId} is not available to this gateway`, 404);
    });
    await repos.agents.get(deps.db, claims.businessId, claims.agentId).catch(() => {
      throw new GatewayError("agent_not_found", `agent ${claims.agentId} is not in business ${claims.businessId}`, 404);
    });
    const minted = await mintSessionToken(secret, claims, ttl, now);
    await repos.audit.append(deps.db, claims.businessId, {
      actorKind: "system",
      action: "gateway.session_token.minted",
      target: { agentId: claims.agentId, sessionId: claims.sessionId },
      details: { service: c.var.service.svc, tokenId: minted.jti, allowedTools: claims.allowedTools, kitMode: claims.kitMode, expiresAt: minted.expiresAt },
    });
    const body: MintSessionTokenResponse = { token: minted.token, expiresAt: minted.expiresAt, jti: minted.jti };
    return c.json(body, 201);
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
