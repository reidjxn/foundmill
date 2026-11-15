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
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { AppError, type EmailNotificationKind } from "@foundmill/shared";
import { isUntrusted, mockIntegrationRecord, type ToolContext } from "@foundmill/connectors";
import { createGithubMock } from "@foundmill/connectors/connectors/github/mock";

export const TOKEN_ISSUER = "foundmill-gateway";
export const SERVICE_AUDIENCE = "foundmill-gateway/service";
export const DEFAULT_SERVICE_TOKEN_TTL_SECONDS = 60;

export interface MintSessionTokenRequest {
  businessId: string;
  agentId: string;
  /** An `agent_sessions` row of this agent (the gateway checks it), or null for a call outside any agent session (plan actions, imports). */
  sessionId: string | null;
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

export interface ArchiveRequest {
  owner: string;
  repo: string;
  /** Branch, tag or commit; "HEAD" for the default branch. */
  ref: string;
}

/**
 * The tarball with the ref and commit it is of: as bytes, or (when the request named a `file`) written to that file,
 * streamed, never whole in memory.
 */
export type ArchiveData = { ref: string; sha: string; data: Uint8Array } | { ref: string; sha: string; file: string; bytes: number };

/**
 * The gateway's answer to an archive request (`POST /v1/github/archive`): the tarball; a tool error (`not_found` for a
 * branch that does not exist); or the policy outcome that stopped it.
 */
export type ArchiveResponse =
  | { outcome: "allow"; archive: ArchiveData }
  | { outcome: "allow"; error: { code: string; message: string } }
  | { outcome: "ask" | "deny" | "rate_limited"; reasons: string[]; retryAfterSeconds?: number };

/**
 * One email from Foundmill to one of its users about their own project (`POST /v1/notify/email`, the one sender): ids
 * only; the gateway reads everything again, builds the words, counts the limits and keeps the record.
 */
export interface NotifyEmailRequest {
  userId: string;
  kind: EmailNotificationKind;
  businessId: string;
  data: { inboxItemId?: string; milestoneId?: string; runId?: string; day?: string };
}
/** One email to an account about the account itself (WP-03 T2: the waitlist's place is open); ids only. */
export interface AccountEmailRequest {
  kind: "waitlist_admitted";
  userId: string;
  data: { waitlistEntryId: string };
}
/** Sent (on the mock: simulated), or not, with the gateway's reason and a plain sentence; never an error for "not sent". */
export type NotifyEmailResponse = { sent: true; simulated: boolean; eventId: string | null } | { sent: false; reason: string; message: string };

export interface GatewayClient {
  readonly baseUrl: string;
  mintSessionToken(input: MintSessionTokenRequest): Promise<MintSessionTokenResponse>;
  /**
   * A repository archive for a code session's checkout, given up past `maxBytes`. Only the business's Code-tab
   * repository is served; the token must allow `github:download_archive`. With `file`, the body is streamed into that
   * new file (0600, links never followed; removed again when the download fails); a client may still answer with bytes.
   */
  downloadArchive(sessionToken: string, request: ArchiveRequest, options?: { timeoutMs?: number; maxBytes?: number; file?: string }): Promise<ArchiveResponse>;
  /** `timeoutMs` overrides the client's default for one long call (a push of many files). */
  call(sessionToken: string, request: GatewayCallRequest, options?: { timeoutMs?: number }): Promise<GatewayCallResponse>;
  /** Asks for one email to a person, authenticated as this service (the api or the orchestrator). "Not sent" is an answer, not an error. */
  notifyEmail(input: NotifyEmailRequest): Promise<NotifyEmailResponse>;
  /** The same route for an email about the account itself (the orchestrator's only). */
  accountEmail(input: AccountEmailRequest): Promise<NotifyEmailResponse>;
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

const SILENT = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** The claims of an offline token (`offline.<base64url JSON>.sig`), or null for any other token. */
function offlineClaims(token: string): { businessId?: string } | null {
  const [head, body] = token.split(".");
  if (head !== "offline" || !body) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { businessId?: string };
  } catch {
    return null;
  }
}

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

/** Largest archive the client reads unless told otherwise (the connector's own cap). */
export const MAX_ARCHIVE_RESPONSE_BYTES = 60 * 1024 * 1024;
export const ARCHIVE_PATH = "/v1/github/archive";

/** A response body read as bytes, refused past `max` (the declared length first, then as it streams). */
async function readBytes(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > max) throw new GatewayClientError("archive_too_large", `the archive is larger than ${Math.round(max / (1024 * 1024))} MB`, 413);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new GatewayClientError("archive_too_large", `the archive is larger than ${Math.round(max / (1024 * 1024))} MB`, 413);
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}

/** A response body streamed into a new file (0600, O_EXCL | O_NOFOLLOW), refused past `max`; the file is removed on failure. */
async function streamToFile(res: Response, max: number, file: string): Promise<number> {
  const tooLarge = () => new GatewayClientError("archive_too_large", `the archive is larger than ${Math.round(max / (1024 * 1024))} MB`, 413);
  const declared = Number(res.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  let handle;
  try {
    handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (err) {
    await res.body?.cancel().catch(() => undefined);
    throw err;
  }
  let total = 0;
  let ok = false;
  try {
    if (!res.body) {
      const data = new Uint8Array(await res.arrayBuffer());
      if (data.byteLength > max) throw tooLarge();
      await handle.write(data);
      total = data.byteLength;
    } else {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
          await reader.cancel().catch(() => undefined);
          throw tooLarge();
        }
        let written = 0;
        while (written < value.byteLength) written += (await handle.write(value, written, value.byteLength - written)).bytesWritten;
      }
    }
    ok = true;
    return total;
  } finally {
    await handle.close();
    if (!ok) await unlink(file).catch(() => undefined);
  }
}

/** The archive answer from a gateway response: bytes (or a file) for `application/gzip`, else the JSON outcome. */
async function archiveResponse(res: Response, max: number, file?: string): Promise<ArchiveResponse> {
  if (res.status === 200 && (res.headers.get("content-type") ?? "").startsWith("application/gzip")) {
    const ref = decodeURIComponent(res.headers.get("x-foundmill-archive-ref") ?? "");
    const sha = res.headers.get("x-foundmill-archive-sha") ?? "";
    if (file) return { outcome: "allow", archive: { ref, sha, file, bytes: await streamToFile(res, max, file) } };
    return { outcome: "allow", archive: { ref, sha, data: await readBytes(res, max) } };
  }
  const text = await res.text();
  let json: Record<string, unknown> | null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    throw new GatewayClientError("gateway_bad_response", `Gateway returned non-JSON (${res.status}) for ${ARCHIVE_PATH}`, res.status, text.slice(0, 300));
  }
  const outcome = json?.outcome;
  if (outcome === "ask" || outcome === "deny" || outcome === "rate_limited") {
    const retryAfterSeconds = json?.retryAfterSeconds;
    return { outcome, reasons: Array.isArray(json?.reasons) ? (json.reasons as string[]) : [], ...(typeof retryAfterSeconds === "number" && retryAfterSeconds > 0 ? { retryAfterSeconds } : {}) };
  }
  if (outcome === "allow") {
    const error = (json?.result as { error?: { code?: string; message?: string } } | undefined)?.error;
    return { outcome: "allow", error: { code: error?.code ?? "tool_failed", message: error?.message ?? "GitHub gave no archive" } };
  }
  const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
  throw new GatewayClientError(err?.code ?? "gateway_error", err?.message ?? `Gateway POST ${ARCHIVE_PATH} returned ${res.status}`, res.status, json);
}

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
    notifyEmail: (input) => request<NotifyEmailResponse>("POST", "/v1/notify/email", { body: input, token: signServiceToken(options.serviceSecret, serviceName, DEFAULT_SERVICE_TOKEN_TTL_SECONDS, options.now) }),
    accountEmail: (input) => request<NotifyEmailResponse>("POST", "/v1/notify/email", { body: input, token: signServiceToken(options.serviceSecret, serviceName, DEFAULT_SERVICE_TOKEN_TTL_SECONDS, options.now) }),
    async downloadArchive(sessionToken, body, opts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? timeoutMs);
      try {
        let res: Response;
        try {
          res = await doFetch(`${baseUrl}${ARCHIVE_PATH}`, { method: "POST", headers: { accept: "application/gzip, application/json", "content-type": "application/json", authorization: `Bearer ${sessionToken}` }, body: JSON.stringify(body), signal: controller.signal });
        } catch (e) {
          throw new GatewayClientError("gateway_unreachable", `Gateway request POST ${ARCHIVE_PATH} failed: ${(e as Error).message}`, 503);
        }
        return await archiveResponse(res, opts?.maxBytes ?? MAX_ARCHIVE_RESPONSE_BYTES, opts?.file);
      } finally {
        clearTimeout(timer);
      }
    },
    mcpUrl: (connector) => `${baseUrl}/mcp/${connector}`,
    sessionHeaders: (sessionToken) => ({ authorization: `Bearer ${sessionToken}` }),
  };
}

/**
 * Gateway stand-in for tests and for mock runs without a gateway process: mints structurally valid, unsigned-looking
 * tokens and answers every call as a mock allow. Never used when `INTEGRATIONS_MODE=live`.
 */
export function createOfflineGatewayClient(baseUrl = "http://gateway.offline"): GatewayClient & { minted: MintSessionTokenRequest[]; calls: GatewayCallRequest[]; archives: ArchiveRequest[]; notifyEmails: NotifyEmailRequest[]; accountEmails: AccountEmailRequest[] } {
  const minted: MintSessionTokenRequest[] = [];
  const calls: GatewayCallRequest[] = [];
  const archives: ArchiveRequest[] = [];
  const notifyEmails: NotifyEmailRequest[] = [];
  const accountEmails: AccountEmailRequest[] = [];
  // Checkouts come from the GitHub connector's mock (a small deterministic repository per name), per client.
  const github = createGithubMock();
  return {
    baseUrl,
    minted,
    calls,
    archives,
    notifyEmails,
    accountEmails,
    async notifyEmail(input) {
      // Like every offline answer, a mock one: recorded, never sent.
      notifyEmails.push(input);
      return { sent: true, simulated: true, eventId: null };
    },
    async accountEmail(input) {
      accountEmails.push(input);
      return { sent: true, simulated: true, eventId: null };
    },
    async health() {
      return { ok: true, mode: "mock" };
    },
    async downloadArchive(token, req) {
      archives.push(req);
      const businessId = offlineClaims(token)?.businessId ?? "00000000-0000-4000-8000-000000000000";
      const result = await github.callTool("download_archive", req, { businessId, agentId: null, sessionId: null, integration: mockIntegrationRecord("github", businessId), log: SILENT, mode: "mock" } as unknown as ToolContext);
      if (!result.ok) return { outcome: "allow", error: { code: result.error?.code ?? "tool_failed", message: result.error?.message ?? "no archive" } };
      // The connector's `archive` holds the tarball's bytes as they are (never base64).
      const out = (isUntrusted(result.data) ? result.data.content : result.data) as { ref: string; sha: string; archive: Uint8Array };
      return { outcome: "allow", archive: { ref: out.ref, sha: out.sha, data: new Uint8Array(out.archive.buffer, out.archive.byteOffset, out.archive.byteLength) } };
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
