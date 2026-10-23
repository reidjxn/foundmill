/**
 * `POST /v1/github/archive` (archive.ts): a code session's checkout of the business's Code-tab repository. The tarball
 * comes back as bytes through the same pipeline as any tool call (scope, policy, audit), only for the Code tab's
 * repository, and `download_archive` never shows up in an agent's MCP tool list.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { createGithubMock } from "@foundmill/connectors/connectors/github/mock";
import { readTarGz } from "@foundmill/connectors/connectors/github/tarball";
import { ARCHIVE_HEADERS, ARCHIVE_ROUTE, CODE_REPOSITORY_POLICY_ID } from "../archive";
import { visibleTools } from "../mcp";
import type { SessionToken } from "../tokens";
import { setupGateway, type GatewayFixture } from "./harness";

let g: GatewayFixture;
const github = createGithubMock();

beforeAll(async () => {
  g = await setupGateway({ connectors: [github] });
  await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "github", status: "connected", authKind: "app", accountLabel: "acme", settings: { externalAccountId: "42", repo: "acme/shop" } });
}, 120_000);
afterAll(async () => {
  await g?.close();
});

const post = async (body: unknown, token?: string) =>
  fetch(`${g.server.url}${ARCHIVE_ROUTE}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const archiveToken = async (allowedTools = ["github:download_archive"]) => g.token({ sessionId: await g.newSession(), allowedTools });

describe("POST /v1/github/archive", () => {
  it("returns the Code-tab repository's tarball as bytes, with the resolved ref and commit, audited like any call", async () => {
    const res = await post({ owner: "acme", repo: "shop" }, await archiveToken());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/gzip");
    expect(decodeURIComponent(res.headers.get(ARCHIVE_HEADERS.ref)!)).toBe("main");
    const sha = res.headers.get(ARCHIVE_HEADERS.sha)!;
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const paths: string[] = [];
    for await (const e of readTarGz(bytes, { maxEntries: 100, maxEntryBytes: 1024 * 1024, maxTotalBytes: 1024 * 1024 })) if (e.type === "file") paths.push(e.path.split("/").slice(1).join("/"));
    expect(paths).toEqual(["README.md", "package.json", "src/index.ts"]);
    const auditId = res.headers.get(ARCHIVE_HEADERS.audit)!;
    const audit = (await repos.audit.list(g.db, g.businessId, { limit: 20 })).items.find((a) => a.id === auditId);
    expect(audit).toMatchObject({ action: "tool.call", target: { connector: "github", tool: "download_archive" }, details: { outcome: "allow" } });
  });

  it("answers a missing branch as a tool error in JSON (the orchestrator then checks out the default branch)", async () => {
    const res = await post({ owner: "acme", repo: "shop", ref: "agent/nope" }, await archiveToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "allow", result: { ok: false, error: { code: "not_found" } } });
  });

  it("refuses any repository but the Code tab's, a token without the tool and a request without a token", async () => {
    const other = await post({ owner: "acme", repo: "other" }, await archiveToken());
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ outcome: "deny", policyIds: [CODE_REPOSITORY_POLICY_ID], reasons: ["Code sessions check out only acme/shop, the repository chosen on the Code tab"] });
    const scoped = await post({ owner: "acme", repo: "shop" }, await archiveToken(["github:read_file"]));
    expect(scoped.status).toBe(403);
    expect(await scoped.json()).toMatchObject({ outcome: "deny", policyIds: ["session-scope"] });
    expect((await post({ owner: "acme", repo: "shop" })).status).toBe(401);
    expect((await post({ owner: "acme", repo: "shop", extra: true }, await archiveToken())).status).toBe(400);
  });

  it("never lists download_archive among an agent's MCP tools, whatever the token allows", () => {
    const session = { allowedTools: ["github:*"] } as unknown as SessionToken;
    const names = visibleTools(github, session).map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).not.toContain("download_archive");
  });
});
