/**
 * `POST /v1/github/archive` (archive.ts): a code session's checkout of the business's Code-tab repository. The tarball
 * comes back as bytes through the same pipeline as any tool call (scope, policy, audit), only for the Code tab's
 * repository, and `download_archive` never shows up in an agent's MCP tool list.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { createGithubMock } from "@foundmill/connectors/connectors/github/mock";
import { readTarGz } from "@foundmill/connectors/connectors/github/tarball";
import type { Connector } from "@foundmill/connectors";
import { ARCHIVE_HEADERS, ARCHIVE_ROUTE, CODE_REPOSITORY_POLICY_ID, MAX_CONCURRENT_ARCHIVES } from "../archive";
import { visibleTools } from "../mcp";
import type { SessionToken } from "../tokens";
import { MOCK_OWNER } from "@foundmill/connectors/connectors/github/fixtures/repos";
import { REPOSITORY_CHECK_ROUTE } from "../code-repository";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";

let g: GatewayFixture;
const github = createGithubMock({ publicRepos: [`${MOCK_OWNER}/ledgerly-app`], inaccessibleRepos: ["acme/gone"] });
/** Holds every download_archive until opened (the concurrency test); open otherwise. */
let gate: Promise<void> | null = null;
let entered = 0;
const gated: Connector = {
  ...github,
  callTool: async (name, args, ctx) => {
    if (name === "download_archive" && gate) {
      entered++;
      await gate;
    }
    return github.callTool(name, args, ctx);
  },
};
(gated as { mock: Connector }).mock = gated;

beforeAll(async () => {
  g = await setupGateway({ connectors: [gated] });
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

  it("pins the Code-tab repository's id on the first checkout (the mock's repository is private)", async () => {
    expect(await repos.integrations.codeRepository(g.db, g.businessId)).toMatchObject({ fullName: "acme/shop", repoId: expect.any(Number) });
  });

  it(`serves at most ${MAX_CONCURRENT_ARCHIVES} archives at once: one more is answered 429 with Retry-After, and the others complete`, async () => {
    let open!: () => void;
    gate = new Promise<void>((resolve) => (open = resolve));
    entered = 0;
    try {
      const tokens = await Promise.all(Array.from({ length: MAX_CONCURRENT_ARCHIVES + 1 }, () => archiveToken()));
      const first = tokens.slice(0, MAX_CONCURRENT_ARCHIVES).map((t) => post({ owner: "acme", repo: "shop" }, t));
      for (let i = 0; i < 200 && entered < MAX_CONCURRENT_ARCHIVES; i++) await new Promise((r) => setTimeout(r, 10));
      expect(entered).toBe(MAX_CONCURRENT_ARCHIVES);
      const fourth = await post({ owner: "acme", repo: "shop" }, tokens[MAX_CONCURRENT_ARCHIVES]);
      expect(fourth.status).toBe(429);
      expect(fourth.headers.get("retry-after")).toMatch(/^\d+$/);
      expect(await fourth.json()).toMatchObject({ outcome: "rate_limited", scope: "concurrent", limit: MAX_CONCURRENT_ARCHIVES });
      // The limited request never reached GitHub.
      expect(entered).toBe(MAX_CONCURRENT_ARCHIVES);
      open();
      for (const res of await Promise.all(first)) expect(res.status).toBe(200);
    } finally {
      gate = null;
      open?.();
    }
    // Slots are given back: the next request is served.
    expect((await post({ owner: "acme", repo: "shop" }, await archiveToken())).status).toBe(200);
  });

  it("never lists download_archive among an agent's MCP tools, whatever the token allows", () => {
    const session = { allowedTools: ["github:*"] } as unknown as SessionToken;
    const names = visibleTools(github, session).map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).not.toContain("download_archive");
    expect(names).not.toContain("get_repository");
  });
});

describe("POST /v1/github/repository", () => {
  const check = async (body: unknown, svc = "api") =>
    fetch(`${g.server.url}${REPOSITORY_CHECK_ROUTE}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, svc)}` }, body: JSON.stringify(body) });

  it("answers the repository's id, visibility and default branch as the business's installation sees it", async () => {
    const res = await check({ businessId: g.businessId, owner: "acme", repo: "shop" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "mock", repository: { id: expect.any(Number), fullName: "acme/shop", private: true, defaultBranch: "main" } });
    const pub = await check({ businessId: g.businessId, owner: MOCK_OWNER, repo: "ledgerly-app" });
    expect(await pub.json()).toMatchObject({ repository: { private: false } });
  });

  it("answers 404 for a repository the installation cannot reach, 409 without GitHub, and only to the api", async () => {
    const gone = await check({ businessId: g.businessId, owner: "acme", repo: "gone" });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: { code: "repository_not_accessible" } });
    expect((await check({ businessId: g.businessId, owner: "acme", repo: "shop" }, "orchestrator")).status).toBe(403);
    expect((await fetch(`${g.server.url}${REPOSITORY_CHECK_ROUTE}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    const row = (await repos.integrations.getByKey(g.db, g.businessId, "github"))!;
    await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "github", status: "disconnected", authKind: "app" });
    try {
      expect((await check({ businessId: g.businessId, owner: "acme", repo: "shop" })).status).toBe(409);
    } finally {
      await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "github", status: row.status, authKind: "app", settings: row.settings as Record<string, unknown> });
    }
  });
});
