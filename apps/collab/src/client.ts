/**
 * Service client for the collab server's HTTP surface (what apps/orchestrator uses when an agent updates a spec
 * block without a WebSocket editor). Mints the collab service token per call from `SESSION_TOKEN_SECRET`.
 * Dependency-free (global fetch) so it can be imported as `@foundmill/collab/client`.
 */
import { mintCollabServiceToken } from "./auth";
import type { EditResult, ReadResult } from "./server";
import type { PmNode } from "./prosemirror";

export interface CollabClientOptions {
  /** `http://collab.railway.internal:4004` or the local URL. */
  baseUrl: string;
  /** `SESSION_TOKEN_SECRET` (shared with the gateway). */
  serviceSecret: string;
  service?: string;
  fetch?: typeof fetch;
  tokenTtlSeconds?: number;
}

export interface CollabClientError extends Error {
  status: number;
  code: string;
  details?: unknown;
}

export interface CollabClient {
  /** Current content of a block (live document when open, stored row otherwise). */
  read(input: { businessId: string; agentId: string; specBlockId: string; sessionId?: string | null }): Promise<ReadResult>;
  /**
   * Applies a whole ProseMirror document as a minimal edit. Pass the `revision` from `read` as `expectedRevision`
   * to refuse the edit (409 `stale_revision`) when anyone changed the block in between; 409 `spec_block_pinned`
   * when the block is pinned (agents may only propose changes to pinned blocks).
   */
  edit(input: { businessId: string; agentId: string; specBlockId: string; sessionId?: string | null; content: PmNode; expectedRevision?: string | null }): Promise<EditResult>;
  health(): Promise<{ ok: boolean; documents: number; connections: number }>;
}

function makeError(status: number, body: unknown): CollabClientError {
  const b = (body ?? {}) as { error?: string; message?: string; details?: unknown };
  const err = new Error(b.message ?? `collab request failed (${status})`) as CollabClientError;
  err.name = "CollabClientError";
  err.status = status;
  err.code = b.error ?? "request_failed";
  err.details = b.details;
  return err;
}

export function createCollabClient(options: CollabClientOptions): CollabClient {
  const f = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");

  const call = async <T>(method: "GET" | "POST", path: string, auth: { businessId: string; agentId: string; sessionId?: string | null } | null, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (auth) {
      const token = await mintCollabServiceToken({ secret: options.serviceSecret, businessId: auth.businessId, agentId: auth.agentId, sessionId: auth.sessionId ?? null, service: options.service, ttlSeconds: options.tokenTtlSeconds ?? 300 });
      headers.authorization = `Bearer ${token}`;
    }
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await f(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) throw makeError(res.status, json);
    return json as T;
  };

  return {
    read: (input) => call("GET", `/v1/spec-blocks/${input.businessId}/${input.specBlockId}`, input),
    edit: (input) => call("POST", `/v1/spec-blocks/${input.businessId}/${input.specBlockId}`, input, { content: input.content, expectedRevision: input.expectedRevision ?? undefined }),
    health: () => call("GET", "/health", null),
  };
}
