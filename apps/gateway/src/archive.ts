/**
 * `POST /v1/github/archive` — a code session's checkout (founder decision 2, 2026-10-23). The orchestrator asks, with a
 * session token minted for `github:download_archive`, for the business's Code-tab repository at one ref; the answer is
 * the gzip-compressed tarball itself (`application/gzip`, the resolved ref and commit in headers), not a JSON envelope:
 * up to 60 MB would be 80 MB of base64 in JSON on both sides.
 *
 * Nothing else changes about the call: it runs the same pipeline as `/v1/call` (session scope, rate limit, business and
 * agent state, Cedar, audit, usage, the untrusted envelope and its first-party rule), and only after the repository is
 * checked against the one chosen on Development › Code. Any other outcome (deny, ask, rate limited, a tool error such as
 * a missing branch) comes back as the usual JSON body. `download_archive` is neither listed nor callable through
 * `/mcp/github`, so an archive never lands in an agent's context; `/v1/call` (services only) still runs it as JSON.
 */
import { z } from "zod";
import { repos } from "@foundmill/db";
import { DOWNLOAD_ARCHIVE_TOOL } from "@foundmill/connectors/connectors/github/tools";
import { AUDIT_ACTION_TOOL_CALL, type GatewayDeps } from "./pipeline";
import { tracedToolCall } from "./tracing";
import { CallRequest, type CallResponse } from "./types";
import type { SessionToken } from "./tokens";

export const ARCHIVE_ROUTE = "/v1/github/archive";
/** `connector:tool` refs agents never get through MCP (services reach them on their own route or `/v1/call`). */
export const ROUTE_ONLY_TOOLS: ReadonlySet<string> = new Set([`github:${DOWNLOAD_ARCHIVE_TOOL}`]);
/** Policy id on an archive request for any repository but the Code tab's. */
export const CODE_REPOSITORY_POLICY_ID = "github-code-repository";

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

/** The archive inside an allowed result: the untrusted envelope's content when it carries one (null when withheld). */
function archiveOf(data: unknown): { ref: string; sha: string; base64: string } | null {
  const content = data && typeof data === "object" && "content" in data ? (data as { content: unknown }).content : data;
  if (!content || typeof content !== "object") return null;
  const c = content as { ref?: unknown; sha?: unknown; base64?: unknown };
  return typeof c.ref === "string" && typeof c.sha === "string" && typeof c.base64 === "string" ? { ref: c.ref, sha: c.sha, base64: c.base64 } : null;
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
  const { status, body } = await tracedToolCall(deps, session, req);
  if (body.outcome !== "allow") return json(body, status, body.outcome === "rate_limited" ? { "retry-after": String(body.retryAfterSeconds) } : {});
  if (!body.result.ok) return json(body, 200);
  const archive = archiveOf(body.result.data);
  if (!archive) return json({ error: { code: "archive_withheld", message: "The archive was withheld: only the Code tab's repository is checked out" } }, 502);
  const bytes = Buffer.from(archive.base64, "base64");
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/gzip",
      "content-length": String(bytes.length),
      [ARCHIVE_HEADERS.ref]: encodeURIComponent(archive.ref),
      [ARCHIVE_HEADERS.sha]: archive.sha,
      [ARCHIVE_HEADERS.audit]: body.auditId,
    },
  });
}
