/**
 * `POST /v1/github/archive` — a code session's checkout (founder decision 2, 2026-10-23). The orchestrator asks, with a
 * session token minted for `github:download_archive`, for the business's Code-tab repository at one ref; the answer is
 * the gzip-compressed tarball itself (`application/gzip`, the resolved ref and commit in headers), not a JSON envelope:
 * up to 60 MB would be 80 MB of base64 in JSON on both sides. The bytes stay bytes the whole way (the connector reads
 * them into one Buffer, the untrusted envelope hashes them where they are, and this route sends that Buffer).
 *
 * Nothing else changes about the call: it runs the same pipeline as `/v1/call` (session scope, rate limit, business and
 * agent state, Cedar, audit, usage, the untrusted envelope and its first-party rule), and only after the repository is
 * checked against the one chosen on Development › Code. Any other outcome (deny, ask, rate limited, a tool error such as
 * a missing branch) comes back as the usual JSON body. At most MAX_CONCURRENT_ARCHIVES archives are served at once per
 * gateway process (each holds up to 60 MB); one more is answered 429 with Retry-After.
 *
 * `download_archive` (and every other route-only tool, packages/connectors `ROUTE_ONLY_TOOLS`) is neither listed nor
 * callable through `/mcp/github`, no grant puts it in an agent's token, and `/v1/call` refuses it for an agent session; a
 * platform token outside any session (`sessionId: null`) may still run it there and gets the bytes as base64.
 */
import { z } from "zod";
import { repos } from "@foundmill/db";
import { isRouteOnlyTool, ROUTE_ONLY_TOOLS } from "@foundmill/connectors";
import { DOWNLOAD_ARCHIVE_TOOL } from "@foundmill/connectors/connectors/github/tools";
import { AUDIT_ACTION_TOOL_CALL, REPO_ARCHIVE_TOOLS, type GatewayDeps, type ToolCallResult } from "./pipeline";
import { tracedToolCall } from "./tracing";
import { CallRequest, type CallRequestParsed, type CallResponse, type DenyResponse, type RateLimitedResponse } from "./types";
import type { SessionToken } from "./tokens";

export { ROUTE_ONLY_TOOLS };

export const ARCHIVE_ROUTE = "/v1/github/archive";
/** Policy id on an archive request for any repository but the Code tab's. */
export const CODE_REPOSITORY_POLICY_ID = "github-code-repository";
/** Policy id on a route-only tool asked for on `/v1/call` by an agent session. */
export const ROUTE_ONLY_POLICY_ID = "route-only-tool";

/** Repository archives one gateway process serves at once (each holds up to 60 MB in memory). */
export const MAX_CONCURRENT_ARCHIVES = 3;
/** What a request past that limit is told to wait. */
export const ARCHIVE_BUSY_RETRY_SECONDS = 5;

export const ARCHIVE_HEADERS = { ref: "x-foundmill-archive-ref", sha: "x-foundmill-archive-sha", audit: "x-foundmill-audit-id" } as const;

export const ArchiveRequest = z
  .object({
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    ref: z.string().min(1).max(250).default("HEAD"),
  })
  .strict();
export type ArchiveRequest = z.input<typeof ArchiveRequest>;

const json = (body: unknown, status: number, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A counter of archives in flight; `tryAcquire` hands back a release (idempotent) or null when every slot is taken. */
export class ArchiveSlots {
  private active = 0;
  constructor(readonly size: number) {}
  tryAcquire(): (() => void) | null {
    if (this.active >= this.size) return null;
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
    };
  }
  get inFlight(): number {
    return this.active;
  }
}

const slotsByDeps = new WeakMap<GatewayDeps, ArchiveSlots>();
export function archiveSlotsFor(deps: GatewayDeps): ArchiveSlots {
  let slots = slotsByDeps.get(deps);
  if (!slots) {
    slots = new ArchiveSlots(Math.max(1, deps.archiveConcurrency ?? MAX_CONCURRENT_ARCHIVES));
    slotsByDeps.set(deps, slots);
  }
  return slots;
}

/** The 429 an archive request past the limit gets (no vendor call, no audit: like the per-connector rate limit). */
export function archivesBusy(limit: number): RateLimitedResponse {
  return { outcome: "rate_limited", reasons: [`${limit} repository archives are being served already; retry in ${ARCHIVE_BUSY_RETRY_SECONDS}s`], retryAfterSeconds: ARCHIVE_BUSY_RETRY_SECONDS, limit, scope: "concurrent", costMinor: 0 };
}

/** Runs `fn` in an archive slot, or answers busy without running it. */
async function inArchiveSlot<T>(deps: GatewayDeps, fn: () => Promise<T>): Promise<T | RateLimitedResponse> {
  const slots = archiveSlotsFor(deps);
  const release = slots.tryAcquire();
  if (!release) return archivesBusy(slots.size);
  try {
    return await fn();
  } finally {
    release();
  }
}

const isBusy = (v: unknown): v is RateLimitedResponse => !!v && typeof v === "object" && (v as { outcome?: unknown }).outcome === "rate_limited" && (v as { scope?: unknown }).scope === "concurrent";

interface ArchiveContent {
  ref: string;
  sha: string;
  bytes: number;
  archive: Uint8Array;
}

/** The archive inside an allowed result: the untrusted envelope's content when it carries one (null when withheld). */
function archiveOf(data: unknown): ArchiveContent | null {
  const content = data && typeof data === "object" && "content" in data ? (data as { content: unknown }).content : data;
  if (!content || typeof content !== "object") return null;
  const c = content as { ref?: unknown; sha?: unknown; bytes?: unknown; archive?: unknown };
  return typeof c.ref === "string" && typeof c.sha === "string" && c.archive instanceof Uint8Array ? { ref: c.ref, sha: c.sha, bytes: c.archive.byteLength, archive: c.archive } : null;
}

export async function serveArchive(deps: GatewayDeps, session: SessionToken, input: z.output<typeof ArchiveRequest>): Promise<Response> {
  // Only the repository the founder chose on the Code tab is ever checked out, whatever the token allows.
  const target = await repos.integrations.codeRepository(deps.db, session.businessId);
  if (!target || `${input.owner}/${input.repo}`.toLowerCase() !== target.fullName.toLowerCase()) {
    const reasons = [target ? `Code sessions check out only ${target.fullName}, the repository chosen on the Code tab` : "No repository is chosen on the Code tab"];
    const audit = await repos.audit.append(deps.db, session.businessId, {
      actorKind: "agent",
      actorId: session.agentId,
      action: AUDIT_ACTION_TOOL_CALL,
      target: { connector: "github", tool: DOWNLOAD_ARCHIVE_TOOL },
      details: { sessionId: session.sessionId, tokenId: session.jti, outcome: "deny", reasons, policyIds: [CODE_REPOSITORY_POLICY_ID], costMinor: 0 },
    });
    const body: CallResponse = { outcome: "deny", reasons, policyIds: [CODE_REPOSITORY_POLICY_ID], costMinor: 0, auditId: audit.id };
    return json(body, 403);
  }
  const req = CallRequest.parse({ connector: "github", tool: DOWNLOAD_ARCHIVE_TOOL, args: { owner: input.owner, repo: input.repo, ref: input.ref } });
  const served = await inArchiveSlot(deps, async () => {
    const { status, body } = await tracedToolCall(deps, session, req);
    if (body.outcome !== "allow") return json(body, status, body.outcome === "rate_limited" ? { "retry-after": String(body.retryAfterSeconds) } : {});
    if (!body.result.ok) return json(body, 200);
    const archive = archiveOf(body.result.data);
    if (!archive) return json({ error: { code: "archive_withheld", message: "The archive was withheld: only the Code tab's repository, private and at HEAD or a branch, is checked out" } }, 502);
    // The connector's own Buffer, sent as it is (no copy, no base64).
    const bytes = archive.archive;
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/gzip",
        "content-length": String(bytes.byteLength),
        [ARCHIVE_HEADERS.ref]: encodeURIComponent(archive.ref),
        [ARCHIVE_HEADERS.sha]: archive.sha,
        [ARCHIVE_HEADERS.audit]: body.auditId,
      },
    });
  });
  if (isBusy(served)) return json(served, 429, { "retry-after": String(served.retryAfterSeconds) });
  return served;
}

/**
 * `POST /v1/call` for a route-only tool. An agent session (a token with a session id) is refused, audited, whatever its
 * token allows: archives reach a session only through its checkout on the archive route. A platform token outside any
 * session runs it within the archive limit, and an archive's bytes are sent as base64 in the JSON body. Returns null for
 * every other tool (the caller runs the pipeline as usual).
 */
export async function routeOnlyCall(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed): Promise<ToolCallResult | null> {
  if (!isRouteOnlyTool(req.connector, req.tool)) return null;
  if (session.sessionId !== null) {
    const reasons = [`${req.connector}:${req.tool} is served only on its own route, never to an agent session`];
    const audit = await repos.audit.append(deps.db, session.businessId, {
      actorKind: "agent",
      actorId: session.agentId,
      action: AUDIT_ACTION_TOOL_CALL,
      target: { connector: req.connector, tool: req.tool },
      details: { sessionId: session.sessionId, tokenId: session.jti, outcome: "deny", reasons, policyIds: [ROUTE_ONLY_POLICY_ID], costMinor: 0 },
    });
    const body: DenyResponse = { outcome: "deny", reasons, policyIds: [ROUTE_ONLY_POLICY_ID], costMinor: 0, auditId: audit.id };
    return { status: 403, body };
  }
  const run = () => tracedToolCall(deps, session, req);
  const result = req.connector === "github" && REPO_ARCHIVE_TOOLS.has(req.tool) ? await inArchiveSlot(deps, run) : await run();
  if (isBusy(result)) return { status: 429, body: result };
  return { status: result.status, body: archiveAsBase64(result.body) };
}

/** An allowed archive result with its bytes as base64 (`content.base64`), for a JSON body. */
export function archiveAsBase64(body: CallResponse): CallResponse {
  if (body.outcome !== "allow" || !body.result.data || typeof body.result.data !== "object") return body;
  const data = body.result.data as Record<string, unknown>;
  const inner = "content" in data ? data.content : data;
  if (!inner || typeof inner !== "object" || !((inner as { archive?: unknown }).archive instanceof Uint8Array)) return body;
  const { archive, ...rest } = inner as { archive: Uint8Array } & Record<string, unknown>;
  const encoded = { ...rest, base64: Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength).toString("base64") };
  return { ...body, result: { ...body.result, data: "content" in data ? { ...data, content: encoded } : encoded } };
}
