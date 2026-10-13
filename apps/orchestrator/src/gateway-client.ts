/**
 * Minimal gateway client for the orchestrator (docs/ARCHITECTURE.md §9).
 *
 * Mirrors apps/gateway/src/client.ts + tokens.ts: a short-lived HS256 service JWT (`iss foundmill-gateway`,
 * `aud foundmill-gateway/service`, `svc`) mints a session token scoped to `{ businessId, agentId, sessionId,
 * allowedTools }`; the Claude Agent SDK then reaches `GATEWAY_URL/mcp/<connector>` with that token. The orchestrator
 * cannot depend on @foundmill/gateway (not a workspace dependency of this app) nor on `jose`, so the JWT is signed with
 * node:crypto here (docs/NEEDED_DEPS.md). Only the service secret lives in this process; vendor secrets never do.
 */
import { createHmac, randomUUID } from "node:crypto";
import { AppError } from "@foundmill/shared";

export const TOKEN_ISSUER = "foundmill-gateway";
export const SERVICE_AUDIENCE = "foundmill-gateway/service";
export const DEFAULT_SERVICE_TOKEN_TTL_SECONDS = 60;

export interface MintSessionTokenRequest {
  businessId: string;
  agentId: string;
  sessionId: string;
  /** `connector:tool`, `connector:*` or `*`. */
  allowedTools: string[];
  kitMode?: boolean;
  ttlSeconds?: number;
  /** Recipients to treat as first seen in untrusted content from the first call (files restored from earlier sessions). */
  untrusted?: { emails: string[]; urls: string[]; phones: string[]; all?: boolean };
}

export interface MintSessionTokenResponse {
  token: string;
  expiresAt: string;
  jti: string;
}

export interface GatewayCallRequest {
  connector: string;
  tool: string;
  args: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface GatewayCallResponse {
  outcome: "allow" | "ask" | "deny" | "rate_limited";
  result?: unknown;
  approvalId?: string;
  costMinor?: number;
  auditId?: string;
  reasons?: string[];
  retryAfterSeconds?: number;
}

export interface GatewayClient {
  readonly baseUrl: string;
  mintSessionToken(input: MintSessionTokenRequest): Promise<MintSessionTokenResponse>;
  /** `timeoutMs` overrides the client's default for one long call (a push of many files). */
  call(sessionToken: string, request: GatewayCallRequest, options?: { timeoutMs?: number }): Promise<GatewayCallResponse>;
  health(): Promise<{ ok: boolean; mode?: "mock" | "live" }>;
  mcpUrl(connector: string): string;
  sessionHeaders(sessionToken: string): Record<string, string>;
}

export class GatewayClientError extends AppError {
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(code, message, status, details);
    this.name = "GatewayClientError";
  }
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

/** HS256 JWT identical in shape to apps/gateway's `signServiceToken`. */
export function signServiceToken(secret: string, svc: string, ttlSeconds = DEFAULT_SERVICE_TOKEN_TTL_SECONDS, now: () => Date = () => new Date()): string {
  if (!secret) throw new GatewayClientError("gateway_config", "SESSION_TOKEN_SECRET is required to talk to the gateway", 500);
  const iat = Math.floor(now().getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ svc, iss: TOKEN_ISSUER, aud: SERVICE_AUDIENCE, iat, exp: iat + Math.max(1, Math.floor(ttlSeconds)), jti: randomUUID() }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export interface GatewayClientOptions {
  baseUrl: string;
  serviceSecret: string;
  serviceName?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

const stripSlash = (s: string) => s.replace(/\/+$/, "");

export function createGatewayClient(options: GatewayClientOptions): GatewayClient {
  const baseUrl = stripSlash(options.baseUrl);
  const doFetch = options.fetch ?? globalThis.fetch;
  const serviceName = options.serviceName ?? "orchestrator";
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function request<T>(method: "GET" | "POST", path: string, init: { body?: unknown; token?: string; okStatuses?: number[]; timeoutMs?: number } = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
    } catch (e) {
      throw new GatewayClientError("gateway_unreachable", `Gateway request ${method} ${path} failed: ${(e as Error).message}`, 503);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new GatewayClientError("gateway_bad_response", `Gateway returned non-JSON (${res.status}) for ${method} ${path}`, res.status, text.slice(0, 300));
      }
    }
    const ok = init.okStatuses ? init.okStatuses.includes(res.status) : res.ok;
    if (!ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new GatewayClientError(err?.code ?? "gateway_error", err?.message ?? `Gateway ${method} ${path} returned ${res.status}`, res.status, json);
    }
    return json as T;
  }

  return {
    baseUrl,
    health: () => request("GET", "/health"),
    mintSessionToken: (input) => request<MintSessionTokenResponse>("POST", "/v1/session-tokens", { body: input, token: signServiceToken(options.serviceSecret, serviceName, DEFAULT_SERVICE_TOKEN_TTL_SECONDS, options.now) }),
    call: (sessionToken, body, opts) => request<GatewayCallResponse>("POST", "/v1/call", { body, token: sessionToken, okStatuses: [200, 403, 429], ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) }),
    mcpUrl: (connector) => `${baseUrl}/mcp/${connector}`,
    sessionHeaders: (sessionToken) => ({ authorization: `Bearer ${sessionToken}` }),
  };
}

/**
 * Gateway stand-in for tests and for mock runs without a gateway process: mints structurally valid, unsigned-looking
 * tokens and answers every call as a mock allow. Never used when `INTEGRATIONS_MODE=live`.
 */
export function createOfflineGatewayClient(baseUrl = "http://gateway.offline"): GatewayClient & { minted: MintSessionTokenRequest[]; calls: GatewayCallRequest[] } {
  const minted: MintSessionTokenRequest[] = [];
  const calls: GatewayCallRequest[] = [];
  return {
    baseUrl,
    minted,
    calls,
    async health() {
      return { ok: true, mode: "mock" };
    },
    async mintSessionToken(input) {
      minted.push(input);
      const exp = Date.now() + (input.ttlSeconds ?? 3600) * 1000;
      return { token: `offline.${b64url(JSON.stringify({ ...input, exp: Math.floor(exp / 1000) }))}.sig`, expiresAt: new Date(exp).toISOString(), jti: randomUUID() };
    },
    async call(_token, req) {
      calls.push(req);
      return { outcome: "allow", result: { ok: true, untrusted: true, content: null, mock: true }, costMinor: 0 };
    },
    mcpUrl: (connector) => `${baseUrl}/mcp/${connector}`,
    sessionHeaders: (sessionToken) => ({ authorization: `Bearer ${sessionToken}` }),
  };
}
