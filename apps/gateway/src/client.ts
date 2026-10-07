/**
 * Tiny gateway client for the orchestrator and the api (docs/ARCHITECTURE.md §9).
 *
 *   const gateway = createGatewayClient({ baseUrl: env.GATEWAY_URL, serviceSecret: env.SESSION_TOKEN_SECRET!, serviceName: "orchestrator" });
 *   const { token } = await gateway.mintSessionToken({ businessId, agentId, sessionId, allowedTools: ["gmail:*"] });
 *   const outcome = await gateway.call(token, { connector: "gmail", tool: "send_message", args, context: { recipient } });
 *   // outcome.outcome: "allow" | "ask" | "deny" | "rate_limited"
 *   sdkMcpServers: { gmail: { type: "http", url: gateway.mcpUrl("gmail"), headers: gateway.sessionHeaders(token) } }
 *
 * Only the service secret ever lives here; it signs short-lived service JWTs on each mint. Policy outcomes
 * (deny, rate_limited) are returned, not thrown; transport and request errors throw `GatewayClientError`.
 */
import { AppError } from "@foundmill/shared";
import type { ConnectorCatalogueEntry } from "@foundmill/connectors";
import { signServiceToken } from "./tokens";
import type { CallRequestInput, CallResponse, GatewayErrorBody, HealthResponse, MintSessionTokenRequest, MintSessionTokenResponse } from "./types";

export interface GatewayClientOptions {
  /** e.g. http://gateway.railway.internal:4001 or http://localhost:4001. */
  baseUrl: string;
  /** `SESSION_TOKEN_SECRET`, shared with the gateway. */
  serviceSecret: string;
  /** Appears in the gateway audit log as the minting service. Default "service". */
  serviceName?: string;
  fetch?: typeof fetch;
  /** Per-request timeout. Default 30 s (tool calls can be slow). */
  timeoutMs?: number;
}

export class GatewayClientError extends AppError {
  constructor(
    code: string,
    message: string,
    status: number,
    public readonly body?: unknown,
  ) {
    super(code, message, status, body);
    this.name = "GatewayClientError";
  }
}

export interface GatewayClient {
  readonly baseUrl: string;
  health(): Promise<HealthResponse>;
  listConnectors(): Promise<{ mode: "mock" | "live"; connectors: ConnectorCatalogueEntry[] }>;
  mintSessionToken(input: MintSessionTokenRequest): Promise<MintSessionTokenResponse>;
  call(sessionToken: string, request: CallRequestInput): Promise<CallResponse>;
  /** The MCP endpoint for a connector, for the Claude Agent SDK's `mcpServers`. */
  mcpUrl(connector: string): string;
  /** Headers an MCP client (or any caller) presents for a session. */
  sessionHeaders(sessionToken: string): Record<string, string>;
}

const stripSlash = (s: string) => s.replace(/\/+$/, "");

function parseJson(text: string, onError: () => Error): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw onError();
  }
}

export function createGatewayClient(options: GatewayClientOptions): GatewayClient {
  const baseUrl = stripSlash(options.baseUrl);
  const doFetch = options.fetch ?? globalThis.fetch;
  const serviceName = options.serviceName ?? "service";
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function request<T>(method: "GET" | "POST", path: string, init: { body?: unknown; token?: string; okStatuses?: number[] } = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    const json = parseJson(text, () => new GatewayClientError("gateway_bad_response", `Gateway returned non-JSON (${res.status}) for ${method} ${path}`, res.status, text.slice(0, 500)));
    const ok = init.okStatuses ? init.okStatuses.includes(res.status) : res.ok;
    if (!ok) {
      const err = (json as GatewayErrorBody | null)?.error;
      throw new GatewayClientError(err?.code ?? "gateway_error", err?.message ?? `Gateway ${method} ${path} returned ${res.status}`, res.status, json);
    }
    return json as T;
  }

  return {
    baseUrl,
    health: () => request<HealthResponse>("GET", "/health"),
    listConnectors: () => request("GET", "/v1/connectors"),
    async mintSessionToken(input) {
      const serviceToken = await signServiceToken(options.serviceSecret, serviceName);
      return request<MintSessionTokenResponse>("POST", "/v1/session-tokens", { body: input, token: serviceToken });
    },
    call: (sessionToken, body) => request<CallResponse>("POST", "/v1/call", { body, token: sessionToken, okStatuses: [200, 403, 429] }),
    mcpUrl: (connector) => `${baseUrl}/mcp/${connector}`,
    sessionHeaders: (sessionToken) => ({ authorization: `Bearer ${sessionToken}` }),
  };
}
