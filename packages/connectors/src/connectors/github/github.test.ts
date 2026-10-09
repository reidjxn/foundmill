import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch, type FetchLike } from "../../http";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { GH_MERGED_PR, GH_REPOS, MOCK_OWNER } from "./fixtures/repos";
import { createGithubConnector } from "./index";
import { createGithubMock, githubMock, mergedPullRequestPayload, signedDeliveryRequest } from "./mock";
import { gitBlobSha } from "./tools";

let delivery = 0;
const nextDelivery = () => `delivery-${++delivery}`;

describeConnectorContract("github (mock)", {
  connector: githubMock,
  mode: "mock",
  calls: [
    { tool: "list_repos", args: {}, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { totalCount: number }).totalCount).toBe(2) },
    { tool: "read_tree", args: { owner: MOCK_OWNER, repo: "northwind-site" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { entries: { path: string; type: string }[] }).entries.map((e) => `${e.type}:${e.path}`)).toEqual(["blob:README.md", "blob:package.json", "tree:src", "tree:tests"]) },
    { tool: "read_tree", args: { owner: MOCK_OWNER, repo: "northwind-site", recursive: true }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { entries: unknown[] }).entries).toHaveLength(10) },
    { tool: "read_tree", args: { owner: MOCK_OWNER, repo: "northwind-site", path: "src/lib" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { entries: { path: string }[] }).entries.map((e) => e.path)).toEqual(["checkout.ts", "pricing.ts"]) },
    { tool: "read_file", args: { owner: MOCK_OWNER, repo: "northwind-site", path: "src/lib/pricing.ts" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ encoding: "utf-8", content: expect.stringContaining("PLANS") }) },
    { tool: "read_file", args: { owner: MOCK_OWNER, repo: "northwind-site", path: "nope.ts" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
    { tool: "read_file", args: { owner: MOCK_OWNER, repo: "northwind-site", path: "../etc/passwd" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "open_pr", args: { owner: MOCK_OWNER, repo: "northwind-site", title: "Annual plan", head: "feat/annual-plan", base: "main" }, check: (r) => expect(r.data).toMatchObject({ state: "open", draft: true, merged: false }) },
    { tool: "list_pull_requests", args: { owner: MOCK_OWNER, repo: "northwind-site", state: "all" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(2) },
    { tool: "get_pull_request", args: { owner: MOCK_OWNER, repo: "northwind-site", prNumber: 41 }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ merged: true, mergeCommitSha: GH_MERGED_PR.merge_commit_sha }) },
  ],
  webhooks: [
    {
      name: "pull_request closed + merged",
      valid: () => signedDeliveryRequest(TEST_BUSINESS_ID, "pull_request", mergedPullRequestPayload(), { deliveryId: nextDelivery() }),
      tampered: () => signedDeliveryRequest(TEST_BUSINESS_ID, "pull_request", mergedPullRequestPayload(), { secret: "wrong-secret", deliveryId: nextDelivery() }),
      replay: true,
      expectEvents: 1,
      expectTypes: ["pr.merged"],
    },
    { name: "push (verified, no platform event)", valid: () => signedDeliveryRequest(TEST_BUSINESS_ID, "push", { ref: "refs/heads/main", after: "abc", repository: { full_name: `${MOCK_OWNER}/northwind-site` }, commits: [] }, { deliveryId: nextDelivery() }), expectEvents: 0 },
    { name: "pull_request closed without merge", valid: () => signedDeliveryRequest(TEST_BUSINESS_ID, "pull_request", mergedPullRequestPayload({ ...GH_MERGED_PR, merged: false, merge_commit_sha: null }), { deliveryId: nextDelivery() }), expectEvents: 0 },
  ],
});

describe("github mock: merge flow and simulation", () => {
  it("merges an open PR once, moves the base branch and refuses a second merge", async () => {
    const mock = createGithubMock();
    const ctx = makeToolContext(mock);
    const created = await mock.callTool("create_branch", { owner: MOCK_OWNER, repo: "ledgerly-app", branch: "fix/vat" }, ctx);
    expect(created.data).toMatchObject({ branch: "fix/vat", sha: GH_REPOS[1]!.branches.main, created: true });
    expect((await mock.callTool("create_branch", { owner: MOCK_OWNER, repo: "ledgerly-app", branch: "fix/vat" }, ctx)).data).toMatchObject({ created: false });
    const opened = await mock.callTool("open_pr", { owner: MOCK_OWNER, repo: "ledgerly-app", title: "Fix VAT", head: "fix/vat", base: "main", draft: false }, ctx);
    const prNumber = (opened.data as { number: number }).number;
    const merged = await mock.callTool("merge_pr", { owner: MOCK_OWNER, repo: "ledgerly-app", prNumber }, ctx);
    expect(merged.ok).toBe(true);
    expect(merged.data).toMatchObject({ merged: true, prNumber, message: expect.stringContaining("Squashed") });
    const again = await mock.callTool("merge_pr", { owner: MOCK_OWNER, repo: "ledgerly-app", prNumber }, ctx);
    expect(again.ok).toBe(false);
    expect(again.error?.status).toBe(409);
    const branch = await mock.callTool("create_branch", { owner: MOCK_OWNER, repo: "ledgerly-app", branch: "main" }, ctx);
    expect((branch.data as { sha: string }).sha).toBe((merged.data as { sha: string }).sha);
    expect(mock.policyHints.merge_pr).toEqual({ irreversible: true, spendsMoney: false });
  });
  it("commits to a working branch, reads it back at that ref, and creates an unknown repository on first write", async () => {
    const mock = createGithubMock();
    const ctx = makeToolContext(mock);
    const first = await mock.callTool("commit_files", { owner: MOCK_OWNER, repo: "northwind-site", branch: "agent/t1", message: "Session 1", files: [{ path: "src/lib/pricing.ts", content: "export const PLANS = { starter: 3900 } as const;\n" }, { path: "NOTES.md", content: "notes\n" }], deletions: ["tests/pricing.test.ts"] }, ctx);
    expect(first.data).toMatchObject({ branch: "agent/t1", created: true, committed: true, filesWritten: 2, filesDeleted: 1, parentSha: GH_REPOS[0]!.branches.main });
    const onBranch = await mock.callTool("read_file", { owner: MOCK_OWNER, repo: "northwind-site", path: "src/lib/pricing.ts", ref: "agent/t1" }, ctx);
    expect(isUntrusted(onBranch.data) && (onBranch.data.content as { content: string }).content).toContain("3900");
    const onMain = await mock.callTool("read_file", { owner: MOCK_OWNER, repo: "northwind-site", path: "src/lib/pricing.ts" }, ctx);
    expect(isUntrusted(onMain.data) && (onMain.data.content as { content: string }).content).toContain("2900");
    const tree = await mock.callTool("read_tree", { owner: MOCK_OWNER, repo: "northwind-site", ref: "agent/t1", recursive: true }, ctx);
    expect(isUntrusted(tree.data) && (tree.data.content as { entries: { path: string }[] }).entries.map((e) => e.path)).toContain("NOTES.md");
    expect((await mock.callTool("commit_files", { owner: MOCK_OWNER, repo: "northwind-site", branch: "agent/t1", message: "Session 2", files: [{ path: "NOTES.md", content: "notes\n" }] }, ctx)).data).toMatchObject({ committed: false, sha: (first.data as { sha: string }).sha });
    const refused = await mock.callTool("commit_files", { owner: MOCK_OWNER, repo: "northwind-site", branch: "main", message: "x", files: [{ path: "a", content: "b" }] }, ctx);
    expect(refused.error?.status).toBe(422);
    const fresh = await mock.callTool("commit_files", { owner: "acme", repo: "new-shop", branch: "agent/t9", message: "First", files: [{ path: "index.ts", content: "export {};\n" }] }, ctx);
    expect(fresh.data).toMatchObject({ created: true, committed: true, url: expect.stringContaining("https://github.com/acme/new-shop/commit/") });
    // The PR flow works on top of the pushed branch.
    expect((await mock.callTool("open_pr", { owner: "acme", repo: "new-shop", title: "Agent work", head: "agent/t9", base: "main" }, ctx)).ok).toBe(true);
    expect(mock.policyHints.commit_files).toEqual({});
  });
  it("simulates pr.merged deterministically", async () => {
    const a = await githubMock.simulate("pr.merged", { businessId: TEST_BUSINESS_ID, seed: "s1" });
    const b = await githubMock.simulate("pr.merged", { businessId: TEST_BUSINESS_ID, seed: "s1" });
    expect(a).toEqual(b);
    expect(a[0]!.type).toBe("pr.merged");
    expect(a[0]!.payload).toMatchObject({ repo: `${MOCK_OWNER}/northwind-site`, prNumber: 41, branch: "feat/annual-plan", baseBranch: "main", additions: 48, mergedBy: { kind: "webhook", id: "github:reidjxn" } });
  });
});

describe("github live (canned responses)", () => {
  it("uses an injected installation token and maps file contents", async () => {
    const content = Buffer.from("export const PLANS = {};\n").toString("base64");
    let auth = "";
    const connector = createGithubConnector({
      secrets: { githubWebhookSecret: "whsec" },
      fetch: routedFetch({
        [`GET https://api.github.com/repos/${MOCK_OWNER}/northwind-site/contents/src%2Flib%2Fpricing.ts`]: (req) => ((auth = req.headers.get("authorization") ?? ""), jsonResponse({ type: "file", encoding: "base64", size: 24, name: "pricing.ts", path: "src/lib/pricing.ts", sha: "a".repeat(40), content, html_url: `https://github.com/${MOCK_OWNER}/northwind-site/blob/main/src/lib/pricing.ts` })),
      }),
    });
    const r = await connector.callTool("read_file", { owner: MOCK_OWNER, repo: "northwind-site", path: "src/lib/pricing.ts" }, makeToolContext(connector, { mode: "live", credential: { kind: "app", secret: "ghs_installation_token" } }));
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(auth).toBe("token ghs_installation_token");
    expect(isUntrusted(r.data) && r.data.content).toMatchObject({ encoding: "utf-8", content: "export const PLANS = {};\n", sha: "a".repeat(40) });
    expect(isUntrusted(r.data) && r.data.source).toMatchObject({ connector: "github", kind: "repo" });
  });
  it("verifies webhook deliveries with the platform secret and rejects unsigned ones", async () => {
    const connector = createGithubConnector({ secrets: { githubWebhookSecret: "platform-secret" } });
    const webhook = connector.webhooks![0]!;
    expect(await webhook.verify(signedDeliveryRequest(TEST_BUSINESS_ID, "pull_request", mergedPullRequestPayload(), { secret: "platform-secret", deliveryId: "live-1" }))).toBe(true);
    expect(await webhook.verify(signedDeliveryRequest(TEST_BUSINESS_ID, "pull_request", mergedPullRequestPayload(), { secret: "other", deliveryId: "live-2" }))).toBe(false);
    const unsigned = new Request(`https://ingest.example/webhooks/github/${TEST_BUSINESS_ID}`, { method: "POST", body: "{}" });
    expect(await webhook.verify(unsigned)).toBe(false);
    const noSecret = createGithubConnector({ secrets: {} });
    expect(await noSecret.webhooks![0]!.verify(signedDeliveryRequest(TEST_BUSINESS_ID, "push", {}, { secret: "platform-secret" }))).toBe(false);
  });
  it("connect() without an installation id hands back the App's installation page, which needs GITHUB_APP_SLUG", async () => {
    const withSlug = createGithubConnector({ secrets: { githubAppSlug: "foundmill-agents" } });
    const record = await withSlug.connect(TEST_BUSINESS_ID, {});
    expect(record).toMatchObject({ status: "disconnected", externalAccountId: null, config: { consentUrl: `https://github.com/apps/foundmill-agents/installations/new?state=${TEST_BUSINESS_ID}` } });
    await expect(createGithubConnector({ secrets: {} }).connect(TEST_BUSINESS_ID, {})).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
  it("throws ConfigError without App credentials or an installation token", async () => {
    const c = createGithubConnector({ secrets: {} });
    await expect(c.callTool("list_repos", {}, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    await expect(c.connect(TEST_BUSINESS_ID, { installationId: 1 })).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

/**
 * A small in-memory GitHub Git Data API (refs, commits, trees, blobs) with GitHub's rules that matter here: blob and
 * tree shas are content addresses, `PATCH refs` refuses a non-fast-forward unless forced, `POST refs` refuses an
 * existing ref. Requests are logged so tests can see what was uploaded.
 */
function fakeGitApi(owner: string, repo: string, files: Record<string, string>) {
  const hash = (x: string) => createHash("sha1").update(x).digest("hex");
  const blobs = new Map<string, Buffer>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  const refs = new Map<string, string>();
  const log: { method: string; path: string; body?: unknown }[] = [];
  const putTree = (entries: Map<string, string>) => {
    const sha = hash(`tree:${[...entries].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, b]) => `${p}=${b}`).join(",")}`);
    trees.set(sha, entries);
    return sha;
  };
  const putCommit = (tree: string, parents: string[], message: string) => {
    const sha = hash(`commit:${tree}:${parents.join(",")}:${message}`);
    commits.set(sha, { tree, parents, message });
    return sha;
  };
  const initial = new Map<string, string>();
  for (const [p, c] of Object.entries(files)) {
    const buf = Buffer.from(c);
    blobs.set(gitBlobSha(buf), buf);
    initial.set(p, gitBlobSha(buf));
  }
  refs.set("main", putCommit(putTree(initial), [], "initial"));
  const base = `/repos/${owner}/${repo}`;
  const fetch: FetchLike = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);
    const body = req.method === "GET" ? undefined : await req.json();
    log.push({ method: req.method, path, body });
    if (req.method === "GET" && path === base) return jsonResponse({ id: 1, name: repo, full_name: `${owner}/${repo}`, default_branch: "main", html_url: `https://github.com/${owner}/${repo}`, private: true, owner: { login: owner } });
    let m: RegExpMatchArray | null;
    if (req.method === "GET" && (m = path.match(new RegExp(`^${base}/git/ref/heads/(.+)$`)))) {
      const sha = refs.get(m[1]!);
      return sha ? jsonResponse({ ref: `refs/heads/${m[1]}`, object: { sha, type: "commit" } }) : jsonResponse({ message: "Not Found" }, { status: 404 });
    }
    if (req.method === "GET" && (m = path.match(new RegExp(`^${base}/commits/(.+)$`)))) {
      const sha = refs.get(m[1]!) ?? (commits.has(m[1]!) ? m[1]! : null);
      return sha ? new Response(sha, { headers: { "content-type": "application/vnd.github.sha; charset=utf-8" } }) : jsonResponse({ message: "No commit found" }, { status: 422 });
    }
    if (req.method === "GET" && (m = path.match(new RegExp(`^${base}/git/commits/(.+)$`)))) return jsonResponse({ sha: m[1], tree: { sha: commits.get(m[1]!)!.tree } });
    if (req.method === "GET" && (m = path.match(new RegExp(`^${base}/git/trees/(.+)$`)))) return jsonResponse({ sha: m[1], truncated: false, tree: [...trees.get(m[1]!)!].map(([p, sha]) => ({ path: p, type: "blob", sha, mode: "100644" })) });
    if (req.method === "POST" && path === `${base}/git/blobs`) {
      const b = body as { content: string; encoding: string };
      const buf = Buffer.from(b.content, b.encoding === "base64" ? "base64" : "utf8");
      blobs.set(gitBlobSha(buf), buf);
      return jsonResponse({ sha: gitBlobSha(buf) }, { status: 201 });
    }
    if (req.method === "POST" && path === `${base}/git/trees`) {
      const b = body as { base_tree: string; tree: { path: string; sha: string | null }[] };
      const next = new Map(trees.get(b.base_tree)!);
      for (const e of b.tree) {
        if (e.sha === null) {
          if (!next.delete(e.path)) return jsonResponse({ message: `path ${e.path} does not exist` }, { status: 422 });
        } else next.set(e.path, e.sha);
      }
      return jsonResponse({ sha: putTree(next) }, { status: 201 });
    }
    if (req.method === "POST" && path === `${base}/git/commits`) {
      const b = body as { tree: string; parents: string[]; message: string };
      const sha = putCommit(b.tree, b.parents, b.message);
      return jsonResponse({ sha, html_url: `https://github.com/${owner}/${repo}/commit/${sha}` }, { status: 201 });
    }
    if (req.method === "PATCH" && (m = path.match(new RegExp(`^${base}/git/refs/heads/(.+)$`)))) {
      const b = body as { sha: string; force?: boolean };
      const current = refs.get(m[1]!);
      if (!current) return jsonResponse({ message: "Reference does not exist" }, { status: 422 });
      if (!b.force && !commits.get(b.sha)?.parents.includes(current)) return jsonResponse({ message: "Update is not a fast forward" }, { status: 422 });
      refs.set(m[1]!, b.sha);
      return jsonResponse({ object: { sha: b.sha } });
    }
    if (req.method === "POST" && path === `${base}/git/refs`) {
      const b = body as { ref: string; sha: string };
      const name = b.ref.replace(/^refs\/heads\//, "");
      if (refs.has(name)) return jsonResponse({ message: "Reference already exists" }, { status: 422 });
      refs.set(name, b.sha);
      return jsonResponse({ ref: b.ref, object: { sha: b.sha } }, { status: 201 });
    }
    throw new Error(`fakeGitApi: no route for ${req.method} ${path}`);
  };
  /** The files a branch holds, as text. */
  const read = (branch: string) => Object.fromEntries([...trees.get(commits.get(refs.get(branch)!)!.tree)!].map(([p, sha]) => [p, blobs.get(sha)!.toString("utf8")]));
  return { fetch, log, refs, commits, read };
}

describe("github live: commit_files against the Git Data API", () => {
  const OWNER = "acme";
  const REPO = "shop";
  const setup = () => {
    const api = fakeGitApi(OWNER, REPO, { "README.md": "# Shop\n", "src/a.ts": "export const a = 1;\n", "src/same.ts": "same\n", "old.txt": "old\n" });
    const connector = createGithubConnector({ secrets: {}, fetch: api.fetch });
    const ctx = makeToolContext(connector, { mode: "live", credential: { kind: "app", secret: "ghs_installation_token" } });
    const commit = (args: Record<string, unknown>) => connector.callTool("commit_files", { owner: OWNER, repo: REPO, message: "Agent session 1", ...args }, ctx);
    return { api, commit };
  };

  it("creates the branch from the default branch, uploads only changed files, deletes existing paths, one commit", async () => {
    const { api, commit } = setup();
    const r = await commit({ branch: "agent/t1", files: [{ path: "src/a.ts", content: "export const a = 2;\n" }, { path: "src/same.ts", content: "same\n" }, { path: "src/new.ts", content: Buffer.from("new\n").toString("base64"), encoding: "base64" }], deletions: ["old.txt", "never-existed.txt"] });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.data).toMatchObject({ branch: "agent/t1", created: true, committed: true, parentSha: api.refs.get("main"), filesWritten: 2, filesDeleted: 1, url: expect.stringMatching(/^https:\/\/github\.com\/acme\/shop\/commit\/[0-9a-f]{40}$/) });
    expect(api.read("agent/t1")).toEqual({ "README.md": "# Shop\n", "src/a.ts": "export const a = 2;\n", "src/same.ts": "same\n", "src/new.ts": "new\n" });
    // The unchanged file was never uploaded; the default branch did not move.
    expect(api.log.filter((l) => l.path.endsWith("/git/blobs"))).toHaveLength(2);
    expect(api.read("main")["old.txt"]).toBe("old\n");
    expect(api.commits.get(api.refs.get("agent/t1")!)).toMatchObject({ message: "Agent session 1", parents: [api.refs.get("main")] });
  });

  it("fast-forwards an existing branch, makes no commit when nothing changed, and never force-pushes", async () => {
    const { api, commit } = setup();
    await commit({ branch: "agent/t1", files: [{ path: "src/a.ts", content: "v2" }] });
    const head = api.refs.get("agent/t1")!;
    const second = await commit({ branch: "agent/t1", message: "Agent session 2", files: [{ path: "src/a.ts", content: "v3" }] });
    expect(second.data).toMatchObject({ created: false, committed: true, parentSha: head, filesWritten: 1 });
    expect(api.commits.get(api.refs.get("agent/t1")!)?.parents).toEqual([head]);
    const writes = api.log.length;
    const same = await commit({ branch: "agent/t1", message: "Agent session 3", files: [{ path: "src/a.ts", content: "v3" }] });
    expect(same.data).toMatchObject({ committed: false, filesWritten: 0, sha: api.refs.get("agent/t1"), url: null });
    expect(api.log.slice(writes).filter((l) => l.method !== "GET")).toEqual([]);
    expect(api.log.filter((l) => l.method === "PATCH").every((l) => (l.body as { force?: boolean }).force === false)).toBe(true);
  });

  it("refuses the default branch and paths inside .git before writing anything", async () => {
    const { api, commit } = setup();
    const main = await commit({ branch: "main", files: [{ path: "x.ts", content: "x" }] });
    expect(main.ok).toBe(false);
    expect(main.error?.status).toBe(422);
    expect(main.error?.message).toMatch(/never writes the default branch/);
    const git = await commit({ branch: "agent/t1", files: [{ path: ".git/hooks/post-checkout", content: "x" }] });
    expect(git.ok).toBe(false);
    expect(git.error?.code).toBe("invalid_args");
    const twice = await commit({ branch: "agent/t1", files: [{ path: "a", content: "1" }], deletions: ["a"] });
    expect(twice.error?.code).toBe("invalid_args");
    expect(api.log.filter((l) => l.method !== "GET")).toEqual([]);
  });

  it("surfaces a branch that moved meanwhile as an error instead of overwriting it", async () => {
    const { api, commit } = setup();
    await commit({ branch: "agent/t1", files: [{ path: "src/a.ts", content: "v2" }] });
    // Someone else pushes to the branch between our read and our update.
    const fetchOnce = api.fetch;
    let moved = false;
    const racing = createGithubConnector({
      secrets: {},
      fetch: async (input, init) => {
        const req = new Request(input, init);
        if (!moved && req.method === "PATCH") {
          moved = true;
          api.refs.set("agent/t1", api.refs.get("main")!);
        }
        return fetchOnce(req);
      },
    });
    const r = await racing.callTool("commit_files", { owner: OWNER, repo: REPO, branch: "agent/t1", message: "late", files: [{ path: "src/a.ts", content: "v3" }] }, makeToolContext(racing, { mode: "live", credential: { kind: "app", secret: "ghs_installation_token" } }));
    expect(r.ok).toBe(false);
    expect(r.error?.status).toBe(422);
    expect(api.refs.get("agent/t1")).toBe(api.refs.get("main"));
  });
});

describe.skipIf(!envKeysPresent("GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TEST_INSTALLATION_ID"))("github (live)", () => {
  const connector = createGithubConnector({ secrets: { githubAppId: process.env.GITHUB_APP_ID, githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY, githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET } });
  describeConnectorContract("github live", { connector, mode: "live", deterministic: false, connectInput: { installationId: Number(process.env.GITHUB_TEST_INSTALLATION_ID) }, calls: [{ tool: "list_repos", args: { perPage: 1 } }] });
  // GITHUB_TEST_REPO=owner/name: a repository the test installation may write to; the check commits to a scratch branch.
  it.skipIf(!process.env.GITHUB_TEST_REPO)("commit_files writes a commit to a scratch branch and is a no-op when repeated", async () => {
    const [owner, repo] = process.env.GITHUB_TEST_REPO!.split("/") as [string, string];
    const integration = await connector.connect(TEST_BUSINESS_ID, { installationId: Number(process.env.GITHUB_TEST_INSTALLATION_ID) });
    const ctx = makeToolContext(connector, { mode: "live", integration });
    const args = { owner, repo, branch: "foundmill/commit-files-check", message: "Foundmill connector check", files: [{ path: "foundmill-check.txt", content: `checked ${new Date().toISOString()}\n` }] };
    const first = await connector.callTool("commit_files", args, ctx);
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    expect(first.data).toMatchObject({ committed: true, filesWritten: 1 });
    expect((await connector.callTool("commit_files", args, ctx)).data).toMatchObject({ committed: false });
  });
});
