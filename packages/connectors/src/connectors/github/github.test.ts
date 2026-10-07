import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { GH_MERGED_PR, GH_REPOS, MOCK_OWNER } from "./fixtures/repos";
import { createGithubConnector } from "./index";
import { createGithubMock, githubMock, mergedPullRequestPayload, signedDeliveryRequest } from "./mock";

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
  it("throws ConfigError without App credentials or an installation token", async () => {
    const c = createGithubConnector({ secrets: {} });
    await expect(c.callTool("list_repos", {}, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    await expect(c.connect(TEST_BUSINESS_ID, { installationId: 1 })).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe.skipIf(!envKeysPresent("GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_TEST_INSTALLATION_ID"))("github (live)", () => {
  const connector = createGithubConnector({ secrets: { githubAppId: process.env.GITHUB_APP_ID, githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY, githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET } });
  describeConnectorContract("github live", { connector, mode: "live", deterministic: false, connectInput: { installationId: Number(process.env.GITHUB_TEST_INSTALLATION_ID) }, calls: [{ tool: "list_repos", args: { perPage: 1 } }] });
});
