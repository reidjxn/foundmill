import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, routedFetch, type FetchLike } from "../../http";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { GH_MERGED_PR, GH_REPOS, MOCK_OWNER } from "./fixtures/repos";
import { createGithubConnector, slots } from "./index";
import { createGithubMock, githubMock, mergedPullRequestPayload, signedDeliveryRequest } from "./mock";
import { readTarGz, writeTarGz } from "./tarball";
import { BRANCH_MOVED, checksState, CommitFilesInput, GetChecksOutput, GITHUB_APP_SCOPES, gitBlobSha, RunChecksOutput } from "./tools";

/** A signed install state as apps/api issues it (the connector checks only its shape). */
const STATE = "eyJiIjoiYTEiLCJ1IjoidTEifQ.c2lnbmF0dXJl";

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
    { tool: "run_checks", args: { owner: MOCK_OWNER, repo: "northwind-site", branch: "main" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "get_checks", args: { owner: MOCK_OWNER, repo: "northwind-site", branch: "feat/annual-plan" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
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
    const created = await mock.callTool("create_branch", { owner: MOCK_OWNER, repo: "ledgerly-app", branch: "agent/vat" }, ctx);
    expect(created.data).toMatchObject({ branch: "agent/vat", sha: GH_REPOS[1]!.branches.main, created: true });
    expect((await mock.callTool("create_branch", { owner: MOCK_OWNER, repo: "ledgerly-app", branch: "agent/vat" }, ctx)).data).toMatchObject({ created: false });
    // Agents create only their own agent/ branches; a deploy branch such as main or production is never created by a tool.
    expect((await mock.callTool("create_branch", { owner: MOCK_OWNER, repo: "ledgerly-app", branch: "production" }, ctx)).error?.code).toBe("invalid_args");
    const opened = await mock.callTool("open_pr", { owner: MOCK_OWNER, repo: "ledgerly-app", title: "Fix VAT", head: "agent/vat", base: "main", draft: false }, ctx);
    const prNumber = (opened.data as { number: number }).number;
    const merged = await mock.callTool("merge_pr", { owner: MOCK_OWNER, repo: "ledgerly-app", prNumber }, ctx);
    expect(merged.ok).toBe(true);
    expect(merged.data).toMatchObject({ merged: true, prNumber, message: expect.stringContaining("Squashed") });
    const again = await mock.callTool("merge_pr", { owner: MOCK_OWNER, repo: "ledgerly-app", prNumber }, ctx);
    expect(again.ok).toBe(false);
    expect(again.error?.status).toBe(409);
    const main = await mock.callTool("read_tree", { owner: MOCK_OWNER, repo: "ledgerly-app", ref: "main" }, ctx);
    expect(isUntrusted(main.data) && (main.data.content as { sha: string }).sha).toBe((merged.data as { sha: string }).sha);
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
    expect(refused.error?.code).toBe("invalid_args");
    const fresh = await mock.callTool("commit_files", { owner: "acme", repo: "new-shop", branch: "agent/t9", message: "First", files: [{ path: "index.ts", content: "export {};\n" }] }, ctx);
    expect(fresh.data).toMatchObject({ created: true, committed: true, url: expect.stringContaining("https://github.com/acme/new-shop/commit/") });
    // The PR flow works on top of the pushed branch.
    expect((await mock.callTool("open_pr", { owner: "acme", repo: "new-shop", title: "Agent work", head: "agent/t9", base: "main" }, ctx)).ok).toBe(true);
    // Without a base, the pull request targets the repository's default branch (the merge step never names it).
    const defaulted = await mock.callTool("open_pr", { owner: "acme", repo: "new-shop", title: "Agent work", head: "agent/t9" }, ctx);
    expect(defaulted.ok).toBe(true);
    expect((isUntrusted(defaulted.data) ? defaulted.data.content : defaulted.data) as { base: { ref: string } }).toMatchObject({ base: { ref: "main" } });
    expect(mock.policyHints.commit_files).toEqual({});
  });
  it("compare_refs names the commit a branch left the default branch at and the branch's own changes, with nothing for the default branch itself", async () => {
    const mock = createGithubMock();
    const ctx = makeToolContext(mock);
    const mainSha = GH_REPOS[0]!.branches.main;
    await mock.callTool("commit_files", { owner: MOCK_OWNER, repo: "northwind-site", branch: "agent/t2", message: "Session 1", files: [{ path: "src/lib/pricing.ts", content: "export const PLANS = { starter: 3900 } as const;\n" }, { path: "NOTES.md", content: "notes\n" }], deletions: ["tests/pricing.test.ts"] }, ctx);
    const compared = await mock.callTool("compare_refs", { owner: MOCK_OWNER, repo: "northwind-site", head: "agent/t2" }, ctx);
    expect(compared.ok).toBe(true);
    const out = isUntrusted(compared.data) ? (compared.data.content as Record<string, unknown>) : (compared.data as Record<string, unknown>);
    expect(out).toMatchObject({ mergeBaseSha: mainSha, baseSha: mainSha, aheadBy: 1, behindBy: 0, truncated: false, files: [{ path: "NOTES.md", status: "added", previousPath: null }, { path: "src/lib/pricing.ts", status: "modified", previousPath: null }, { path: "tests/pricing.test.ts", status: "removed", previousPath: null }] });
    const same = await mock.callTool("compare_refs", { owner: MOCK_OWNER, repo: "northwind-site", base: "main", head: "main" }, ctx);
    expect(isUntrusted(same.data) ? same.data.content : same.data).toMatchObject({ mergeBaseSha: mainSha, aheadBy: 0, behindBy: 0, files: [] });
    expect((await mock.callTool("compare_refs", { owner: MOCK_OWNER, repo: "northwind-site", head: "agent/nowhere" }, ctx)).error?.code).toBe("not_found");
    expect(mock.policyHints.compare_refs).toEqual({});
  });
  it("keeps each business's repositories and branches to itself, and bounds what it holds", async () => {
    const mock = createGithubMock();
    const a = makeToolContext(mock);
    const b = makeToolContext(mock, { businessId: "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f61" });
    await mock.callTool("commit_files", { owner: "acme", repo: "secret-project", branch: "agent/t1", message: "x", files: [{ path: "plan.md", content: "launch on Friday\n" }] }, a);
    const listed = async (ctx: typeof a) => { const r = await mock.callTool("list_repos", {}, ctx); return isUntrusted(r.data) ? (r.data.content as { items: { fullName: string }[] }).items.map((i) => i.fullName) : []; };
    expect(await listed(a)).toContain("acme/secret-project");
    expect(await listed(b)).not.toContain("acme/secret-project");
    expect((await mock.callTool("read_file", { owner: "acme", repo: "secret-project", path: "plan.md", ref: "agent/t1" }, b)).error?.code).toBe("not_found");
    // The same fixture repository: B does not see A's branch either.
    await mock.callTool("commit_files", { owner: MOCK_OWNER, repo: "northwind-site", branch: "agent/t2", message: "x", files: [{ path: "a.ts", content: "a" }] }, a);
    expect((await mock.callTool("read_file", { owner: MOCK_OWNER, repo: "northwind-site", path: "a.ts", ref: "agent/t2" }, b)).ok).toBe(false);

    // Past the budget the oldest written branch goes first.
    const big = "x".repeat(4 * 1024 * 1024);
    for (let i = 0; i < 6; i++) expect((await mock.callTool("commit_files", { owner: "acme", repo: "big", branch: `agent/b${i}`, message: "x", files: [{ path: "big.txt", content: big }] }, a)).ok).toBe(true);
    expect((await mock.callTool("read_file", { owner: "acme", repo: "secret-project", path: "plan.md", ref: "agent/t1" }, a)).ok).toBe(false);
    expect((await mock.callTool("read_file", { owner: "acme", repo: "big", path: "big.txt", ref: "agent/b5" }, a)).ok).toBe(true);
  });
  it("forgets the least recently used business once all of them together pass the total budget", async () => {
    const mock = createGithubMock({ bytesPerBusiness: 1_000, bytesTotal: 2_500 });
    const ctx = (n: number) => makeToolContext(mock, { businessId: `6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f6${n}` });
    const write = (n: number) => mock.callTool("commit_files", { owner: "acme", repo: "shop", branch: "agent/t1", message: "x", files: [{ path: "a.txt", content: "x".repeat(900) }] }, ctx(n));
    const has = async (n: number) => (await mock.callTool("read_file", { owner: "acme", repo: "shop", path: "a.txt", ref: "agent/t1" }, ctx(n))).ok;
    for (const n of [1, 2]) expect((await write(n)).ok).toBe(true);
    expect(await has(1)).toBe(true); // 1 is now the most recently used
    expect((await write(3)).ok).toBe(true); // 2,700 bytes: business 2 (least recently used) goes
    expect(await has(2)).toBe(false);
    expect(await has(1)).toBe(true);
    expect(await has(3)).toBe(true);
  });
  it("refuses a commit that would make one branch outgrow the business's budget", async () => {
    const mock = createGithubMock({ bytesPerBusiness: 1_000, bytesTotal: 2_000 });
    const ctx = makeToolContext(mock);
    const write = (i: number) => mock.callTool("commit_files", { owner: "acme", repo: "shop", branch: "agent/one", message: "x", files: [{ path: `f${i}.txt`, content: "x".repeat(400) }] }, ctx);
    expect((await write(1)).ok).toBe(true);
    expect((await write(2)).ok).toBe(true);
    const third = await write(3);
    expect(third.ok).toBe(false);
    expect(third.error?.status).toBe(413);
  });
  it("simulates pr.merged deterministically", async () => {
    const a = await githubMock.simulate("pr.merged", { businessId: TEST_BUSINESS_ID, seed: "s1" });
    const b = await githubMock.simulate("pr.merged", { businessId: TEST_BUSINESS_ID, seed: "s1" });
    expect(a).toEqual(b);
    expect(a[0]!.type).toBe("pr.merged");
    expect(a[0]!.payload).toMatchObject({ repo: `${MOCK_OWNER}/northwind-site`, prNumber: 41, branch: "feat/annual-plan", baseBranch: "main", additions: 48, mergedBy: { kind: "webhook", id: "github:reidjxn" } });
  });
});

describe("checksState", () => {
  const run = (status: string, conclusion: string | null = null) => ({ status, conclusion });
  it("is pending while a check is queued or running, or when no check exists", () => {
    expect(checksState([])).toBe("pending");
    expect(checksState([run("queued")])).toBe("pending");
    expect(checksState([run("in_progress")])).toBe("pending");
    expect(checksState([run("completed", "success"), run("in_progress")])).toBe("pending");
    expect(checksState([run("waiting")])).toBe("pending");
    // A failure does not settle the verdict while another check is still running.
    expect(checksState([run("completed", "failure"), run("queued")])).toBe("pending");
  });
  it("is failure when a check failed, timed out, was canceled or needs action", () => {
    for (const conclusion of ["failure", "timed_out", "cancelled", "action_required"]) expect(checksState([run("completed", "success"), run("completed", conclusion)]), conclusion).toBe("failure");
  });
  it("is failure for a conclusion it does not know, never success", () => {
    expect(checksState([run("completed", "stale")])).toBe("failure");
    expect(checksState([run("completed", null)])).toBe("failure");
  });
  it("is success only when every check succeeded, was neutral or was skipped", () => {
    expect(checksState([run("completed", "success"), run("completed", "neutral"), run("completed", "skipped")])).toBe("success");
    // The list was cut short: the rest could hold a failure.
    expect(checksState([run("completed", "success")], false)).toBe("pending");
  });
});

describe("github mock: run_checks and get_checks", () => {
  const repo = { owner: MOCK_OWNER, repo: "northwind-site" };
  const pushed = async (mock: ReturnType<typeof createGithubMock>, ctx: ReturnType<typeof makeToolContext>, branch = "agent/t1", content = "v1\n") => {
    const r = await mock.callTool("commit_files", { ...repo, branch, message: "Session", files: [{ path: "NOTES.md", content }] }, ctx);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    return (r.data as { sha: string }).sha;
  };
  const checks = async (mock: ReturnType<typeof createGithubMock>, ctx: ReturnType<typeof makeToolContext>, branch = "agent/t1") => {
    const r = await mock.callTool("get_checks", { ...repo, branch }, ctx);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.untrusted).toBe(true);
    expect(isUntrusted(r.data) && r.data.source).toMatchObject({ connector: "github", kind: "repo", ref: `${MOCK_OWNER}/northwind-site@${branch}:checks` });
    return GetChecksOutput.parse(isUntrusted(r.data) ? r.data.content : null);
  };

  it("declares run_checks as a write and get_checks as a quarantined read, and asks for the two App permissions", () => {
    const tool = (name: string) => githubMock.tools.find((t) => t.name === name)!;
    expect(tool("run_checks").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(tool("get_checks").annotations).toMatchObject({ readOnlyHint: true });
    expect(githubMock.policyHints.run_checks).toEqual({});
    expect(githubMock.policyHints.get_checks).toEqual({});
    expect(githubMock.auth.scopes).toEqual(expect.arrayContaining(["contents:write", "pull_requests:write", "metadata:read", "members:read", "actions:write", "checks:read"]));
    expect(GITHUB_APP_SCOPES).toEqual(["contents:write", "pull_requests:write", "metadata:read", "members:read", "actions:write", "checks:read"]);
  });

  it("refuses a branch that is not an agent/ working branch, before anything happens", async () => {
    const mock = createGithubMock();
    const ctx = makeToolContext(mock);
    await pushed(mock, ctx);
    for (const branch of ["main", "production", "feat/annual-plan", "release/1.2", "agent/", "agent/a/b", "agent/../main", "agent/x.lock"]) {
      for (const tool of ["run_checks", "get_checks"]) expect((await mock.callTool(tool, { ...repo, branch }, ctx)).error?.code, `${tool} ${branch}`).toBe("invalid_args");
    }
    expect((await checks(mock, ctx)).checks).toEqual([]);
  });

  it("refuses to run CI in a public repository", async () => {
    const mock = createGithubMock({ publicRepos: [`${MOCK_OWNER}/northwind-site`] });
    const ctx = makeToolContext(mock);
    await mock.callTool("create_branch", { ...repo, branch: "agent/t1" }, ctx);
    const refused = await mock.callTool("run_checks", { ...repo, branch: "agent/t1" }, ctx);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatchObject({ status: 422, message: `${MOCK_OWNER}/northwind-site is public; agents push only to private repositories` });
    expect((await mock.callTool("commit_files", { ...repo, branch: "agent/t2", message: "x", files: [{ path: "a", content: "b" }] }, ctx)).error?.message).toBe(refused.error?.message);
    expect((await checks(mock, ctx)).checks).toEqual([]);
    // The other fixture repository is still private.
    await mock.callTool("create_branch", { owner: MOCK_OWNER, repo: "ledgerly-app", branch: "agent/t1" }, ctx);
    expect((await mock.callTool("run_checks", { owner: MOCK_OWNER, repo: "ledgerly-app", branch: "agent/t1" }, ctx)).ok).toBe(true);
  });

  it("reports pending until run_checks dispatches CI, then success, and starts over on a new commit", async () => {
    const mock = createGithubMock();
    const ctx = makeToolContext(mock);
    const sha = await pushed(mock, ctx);
    const before = await checks(mock, ctx);
    expect(before).toEqual({ headSha: sha, state: "pending", checks: [] });

    const started = await mock.callTool("run_checks", { ...repo, branch: "agent/t1" }, ctx);
    expect(started.ok, JSON.stringify(started.error)).toBe(true);
    expect(RunChecksOutput.parse(started.data)).toEqual({ dispatched: true, branch: "agent/t1", workflow: "ci.yml" });

    const after = await checks(mock, ctx);
    expect(after).toMatchObject({ headSha: sha, state: "success" });
    expect(after.checks.map((c) => [c.name, c.status, c.conclusion])).toEqual([["lint", "completed", "success"], ["typecheck", "completed", "success"], ["test", "completed", "success"], ["e2e", "completed", "skipped"]]);
    expect(after.checks.every((c) => c.url?.startsWith(`https://github.com/${MOCK_OWNER}/northwind-site/actions/runs/`))).toBe(true);
    // Deterministic, and reading does not change anything.
    expect(await checks(mock, ctx)).toEqual(after);

    // A new commit moves the head: the old run says nothing about it.
    const next = await pushed(mock, ctx, "agent/t1", "v2\n");
    expect(next).not.toBe(sha);
    expect(await checks(mock, ctx)).toEqual({ headSha: next, state: "pending", checks: [] });
  });

  it("produces a failure for a branch the mock is told fails, and keeps businesses apart", async () => {
    const mock = createGithubMock({ failingBranches: ["agent/bad"] });
    const ctx = makeToolContext(mock);
    const other = makeToolContext(mock, { businessId: "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f61" });
    await pushed(mock, ctx, "agent/bad");
    await pushed(mock, ctx, "agent/good");
    await mock.callTool("run_checks", { ...repo, branch: "agent/bad" }, ctx);
    await mock.callTool("run_checks", { ...repo, branch: "agent/good" }, ctx);
    const bad = await checks(mock, ctx, "agent/bad");
    expect(bad.state).toBe("failure");
    expect(bad.checks.find((c) => c.name === "test")).toMatchObject({ status: "completed", conclusion: "failure" });
    expect((await checks(mock, ctx, "agent/good")).state).toBe("success");
    // Another business has no such branch, and a dispatch in one does not start CI in the other.
    expect((await mock.callTool("get_checks", { ...repo, branch: "agent/bad" }, other)).error?.code).toBe("not_found");
    await pushed(mock, other, "agent/bad");
    expect((await checks(mock, other, "agent/bad")).state).toBe("pending");
  });

  it("refuses a branch whose .github differs from the default branch's, before anything is dispatched", async () => {
    const mock = createGithubMock({ branchesWithChangedGithub: ["agent/changed"] });
    const ctx = makeToolContext(mock);
    await pushed(mock, ctx, "agent/changed");
    await pushed(mock, ctx, "agent/clean");
    const refused = await mock.callTool("run_checks", { ...repo, branch: "agent/changed" }, ctx);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatchObject({ status: 422, message: "run_checks refuses to run a workflow that differs from the default branch (.github changed on agent/changed); rebase the branch onto the default branch" });
    // Nothing was dispatched: still no run and no checks.
    expect(await checks(mock, ctx, "agent/changed")).toMatchObject({ state: "pending", checks: [] });
    // Other branches of the same repository are unaffected.
    expect((await mock.callTool("run_checks", { ...repo, branch: "agent/clean" }, ctx)).ok).toBe(true);
    expect((await checks(mock, ctx, "agent/clean")).state).toBe("success");
  });

  it("never lets commit_files change .github: a commit leaves a clean branch runnable and a workflow path is refused", async () => {
    const mock = createGithubMock();
    const ctx = makeToolContext(mock);
    await pushed(mock, ctx, "agent/t1");
    await pushed(mock, ctx, "agent/t1", "v2\n");
    expect((await mock.callTool("commit_files", { ...repo, branch: "agent/t1", message: "x", files: [{ path: ".github/workflows/ci.yml", content: "on: push" }] }, ctx)).error?.code).toBe("invalid_args");
    expect((await mock.callTool("commit_files", { ...repo, branch: "agent/t1", message: "x", deletions: [".github/workflows/ci.yml"] }, ctx)).error?.code).toBe("invalid_args");
    expect((await mock.callTool("run_checks", { ...repo, branch: "agent/t1" }, ctx)).ok).toBe(true);
  });

  it("reports the CI run as pending until dispatched, success after, and failure for a failing branch", async () => {
    const mock = createGithubMock({ failingBranches: ["agent/bad"] });
    const ctx = makeToolContext(mock);
    for (const branch of ["agent/ok", "agent/bad"]) {
      await pushed(mock, ctx, branch);
      expect((await checks(mock, ctx, branch)).state).toBe("pending");
      expect((await mock.callTool("run_checks", { ...repo, branch }, ctx)).ok).toBe(true);
    }
    expect((await checks(mock, ctx, "agent/ok")).state).toBe("success");
    expect((await checks(mock, ctx, "agent/bad")).state).toBe("failure");
  });

  it("fails for a branch or repository that does not exist", async () => {
    const mock = createGithubMock();
    const ctx = makeToolContext(mock);
    expect((await mock.callTool("get_checks", { ...repo, branch: "agent/none" }, ctx)).error?.code).toBe("not_found");
    expect((await mock.callTool("run_checks", { ...repo, branch: "agent/none" }, ctx)).error?.status).toBe(422);
    expect((await mock.callTool("run_checks", { owner: "acme", repo: "nope", branch: "agent/t1" }, ctx)).error?.code).toBe("not_found");
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
  it("connect() without an installation id hands back the App's installation page carrying the host's signed state", async () => {
    const withSlug = createGithubConnector({ secrets: { githubAppSlug: "foundmill-agents" } });
    const record = await withSlug.connect(TEST_BUSINESS_ID, { state: STATE });
    expect(record).toMatchObject({ status: "disconnected", externalAccountId: null, config: { consentUrl: `https://github.com/apps/foundmill-agents/installations/new?state=${STATE}` } });
    await expect(withSlug.connect(TEST_BUSINESS_ID, {})).rejects.toMatchObject({ code: "validation" });
    await expect(withSlug.connect(TEST_BUSINESS_ID, { state: TEST_BUSINESS_ID })).rejects.toMatchObject({ code: "validation" });
    await expect(createGithubConnector({ secrets: {} }).connect(TEST_BUSINESS_ID, { state: STATE })).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
  it("throws ConfigError without App credentials or an installation token", async () => {
    const c = createGithubConnector({ secrets: {} });
    await expect(c.callTool("list_repos", {}, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
    await expect(c.connect(TEST_BUSINESS_ID, { installationId: 1, code: "abc123" })).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe("github live: connecting proves who installed the App", () => {
  const INSTALLATION = 48213377;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const appSecrets = { githubAppId: "123", githubAppPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), githubAppClientId: "Iv1.client", githubAppClientSecret: "client-secret" };

  /**
   * GitHub's OAuth and installation endpoints for one installer (user id 7, "founder-login") who sees `listed`
   * installations; installation INSTALLATION belongs to `account`, and the installer's membership of an organization
   * is `membership` (null: not a member).
   */
  function installer(listed: number[], options: { exchange?: "ok" | "bad_code"; account?: { login: string; id: number; type: string }; membership?: { state: string; role: string } | null } = {}) {
    const calls: string[] = [];
    const account = options.account ?? { login: "acme", id: 99, type: "Organization" };
    const membership = options.membership === undefined ? { state: "active", role: "admin" } : options.membership;
    const fetch = routedFetch({
      "POST https://github.com/login/oauth/access_token": async (req) => {
        calls.push("exchange");
        const body = (await req.json()) as { client_id: string; client_secret: string; code: string };
        expect(body).toEqual({ client_id: "Iv1.client", client_secret: "client-secret", code: "c0de" });
        return options.exchange === "bad_code" ? jsonResponse({ error: "bad_verification_code" }) : jsonResponse({ access_token: "ghu_user_token", token_type: "bearer" });
      },
      "GET https://api.github.com/user/installations": (req) => {
        calls.push(`installations ${req.headers.get("authorization")}`);
        return jsonResponse({ total_count: listed.length, installations: listed.map((id) => ({ id, account: { login: `org-${id}` } })) });
      },
      "GET https://api.github.com/user": () => (calls.push("user"), jsonResponse({ login: "founder-login", id: 7 })),
      [`GET https://api.github.com/user/memberships/orgs/${account.login}`]: () => (calls.push(`membership ${account.login}`), membership ? jsonResponse({ ...membership, organization: { login: account.login } }) : jsonResponse({ message: "Not Found" }, { status: 404 })),
      "DELETE https://api.github.com/applications/Iv1.client/token": async (req) => {
        calls.push(`revoke ${((await req.json()) as { access_token: string }).access_token}`);
        return new Response(null, { status: 204 });
      },
      [`GET https://api.github.com/app/installations/${INSTALLATION}`]: (req) => {
        calls.push(`installation ${req.headers.get("authorization")?.split(" ")[0]}`);
        return jsonResponse({ id: INSTALLATION, account, permissions: { contents: "write", metadata: "read" }, repository_selection: "selected" });
      },
    });
    return { calls, connector: createGithubConnector({ secrets: appSecrets, fetch }) };
  }

  it("connects an organization's installation for an active admin, records who verified it, and revokes their token", async () => {
    const { connector, calls } = installer([1, INSTALLATION]);
    const record = await connector.connect(TEST_BUSINESS_ID, { installationId: INSTALLATION, code: "c0de" });
    expect(record).toMatchObject({ status: "connected", accountLabel: "acme", externalAccountId: String(INSTALLATION), scopes: ["contents:write", "metadata:read"], config: { installationId: INSTALLATION, account: "acme", verifiedBy: "founder-login", verifiedAt: expect.any(String) } });
    expect(calls).toEqual(["exchange", "installations token ghu_user_token", "user", "installation bearer", "membership acme", "revoke ghu_user_token"]);
  });

  it("connects a personal installation only for that account", async () => {
    const own = installer([INSTALLATION], { account: { login: "founder-login", id: 7, type: "User" } });
    expect(await own.connector.connect(TEST_BUSINESS_ID, { installationId: INSTALLATION, code: "c0de" })).toMatchObject({ status: "connected", accountLabel: "founder-login" });
    const someoneElse = installer([INSTALLATION], { account: { login: "mallory", id: 8, type: "User" } });
    await expect(someoneElse.connector.connect(TEST_BUSINESS_ID, { installationId: INSTALLATION, code: "c0de" })).rejects.toMatchObject({ code: "forbidden", message: `GitHub installation ${INSTALLATION} belongs to mallory; only that account can connect it` });
    expect(someoneElse.calls.at(-1)).toBe("revoke ghu_user_token");
  });

  it("refuses an org member who is not an admin, a non-member, someone else's installation, a bad code and a missing code", async () => {
    // Listed in /user/installations because they can read one of its repositories: not enough.
    const member = installer([INSTALLATION], { membership: { state: "active", role: "member" } });
    await expect(member.connector.connect(TEST_BUSINESS_ID, { installationId: INSTALLATION, code: "c0de" })).rejects.toMatchObject({ code: "forbidden", message: "Only an owner of the acme organization on GitHub can connect its installation" });
    const pending = installer([INSTALLATION], { membership: { state: "pending", role: "admin" } });
    await expect(pending.connector.connect(TEST_BUSINESS_ID, { installationId: INSTALLATION, code: "c0de" })).rejects.toMatchObject({ code: "forbidden" });
    const outsider = installer([INSTALLATION], { membership: null });
    await expect(outsider.connector.connect(TEST_BUSINESS_ID, { installationId: INSTALLATION, code: "c0de" })).rejects.toMatchObject({ code: "forbidden" });
    expect(outsider.calls.at(-1)).toBe("revoke ghu_user_token");

    const other = installer([1, 2]);
    await expect(other.connector.connect(TEST_BUSINESS_ID, { installationId: INSTALLATION, code: "c0de" })).rejects.toMatchObject({ code: "forbidden", message: `GitHub installation ${INSTALLATION} is not one you can manage` });
    expect(other.calls).toEqual(["exchange", "installations token ghu_user_token", "revoke ghu_user_token"]);

    const bad = installer([INSTALLATION], { exchange: "bad_code" });
    await expect(bad.connector.connect(TEST_BUSINESS_ID, { installationId: INSTALLATION, code: "c0de" })).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("bad_verification_code") });
    expect(bad.calls).toEqual(["exchange"]);

    const none = installer([INSTALLATION]);
    await expect(none.connector.connect(TEST_BUSINESS_ID, { installationId: INSTALLATION })).rejects.toMatchObject({ code: "validation" });
    await expect(none.connector.connect(TEST_BUSINESS_ID, { installationId: INSTALLATION, code: "a b" })).rejects.toMatchObject({ code: "validation" });
    await expect(none.connector.connect(TEST_BUSINESS_ID, { installationId: -4, code: "c0de" })).rejects.toMatchObject({ code: "validation" });
    expect(none.calls).toEqual([]);
  });
});

/**
 * A small in-memory GitHub Git Data API (refs, commits, trees, blobs) with GitHub's rules that matter here: blob and
 * tree shas are content addresses, `PATCH refs` refuses a non-fast-forward unless forced, `POST refs` refuses an
 * existing ref. Requests are logged so tests can see what was uploaded.
 */
function fakeGitApi(owner: string, repo: string, files: Record<string, string>, options: { public?: boolean } = {}) {
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
    if (req.method === "GET" && path === base) return jsonResponse({ id: 1, name: repo, full_name: `${owner}/${repo}`, default_branch: "main", html_url: `https://github.com/${owner}/${repo}`, private: !options.public, owner: { login: owner } });
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
      const b = body as { base_tree: string; tree: { path: string; sha?: string | null; content?: string }[] };
      const next = new Map(trees.get(b.base_tree)!);
      for (const e of b.tree) {
        if (e.content !== undefined) {
          // Inline content: GitHub writes the blob itself.
          const buf = Buffer.from(e.content, "utf8");
          blobs.set(gitBlobSha(buf), buf);
          next.set(e.path, gitBlobSha(buf));
        } else if (e.sha === null) {
          if (!next.delete(e.path)) return jsonResponse({ message: `path ${e.path} does not exist` }, { status: 422 });
        } else next.set(e.path, e.sha!);
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
  const read = (branch: string) => Object.fromEntries([...trees.get(commits.get(refs.get(branch)!)!.tree)!].map(([p, sha]) => [p, blobs.get(sha)!.toString(p.endsWith(".png") ? "base64" : "utf8")]));
  return { fetch, log, refs, commits, trees, blobs, putTree, putCommit, read };
}

describe("commit_files limits", () => {
  it("validates a multi-megabyte base64 file without blowing the regexp stack", () => {
    const big = Buffer.alloc(4.5 * 1024 * 1024, 7).toString("base64");
    expect(CommitFilesInput.safeParse({ owner: "acme", repo: "shop", branch: "agent/t1", message: "m", files: [{ path: "big.bin", content: big, encoding: "base64" }] }).success).toBe(true);
    expect(CommitFilesInput.safeParse({ owner: "acme", repo: "shop", branch: "agent/t1", message: "m", files: [{ path: "x.bin", content: "abc", encoding: "base64" }] }).success).toBe(false);
  });

  it("runs a few commits at once, queues a bounded number in order, and turns the rest away", async () => {
    vi.useFakeTimers();
    try {
      const s = slots(2, 2, 1_000);
      const order: string[] = [];
      const gates = new Map<string, () => void>();
      const job = (name: string) => () => new Promise<string>((resolve) => gates.set(name, () => (order.push(name), resolve(name))));
      const a = s.run(job("a"));
      const b = s.run(job("b"));
      const c = s.run(job("c"));
      const d = s.run(job("d"));
      await expect(s.run(job("e"))).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(0);
      expect([...gates.keys()]).toEqual(["a", "b"]);
      gates.get("a")!();
      await a;
      await vi.advanceTimersByTimeAsync(0);
      expect([...gates.keys()]).toEqual(["a", "b", "c"]);
      // d waited past its deadline and gives up; c and b still finish.
      const dGaveUp = expect(d).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(1_000);
      await dGaveUp;
      gates.get("b")!();
      gates.get("c")!();
      expect(await Promise.all([b, c])).toEqual(["b", "c"]);
      expect(order).toEqual(["a", "b", "c"]);
      // The slots are all free again.
      const f = s.run(async () => "f");
      expect(await f).toBe("f");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("github live: commit_files against the Git Data API", () => {
  const OWNER = "acme";
  const REPO = "shop";
  const setup = (options: { public?: boolean } = {}) => {
    const api = fakeGitApi(OWNER, REPO, { "README.md": "# Shop\n", "src/a.ts": "export const a = 1;\n", "src/same.ts": "same\n", "old.txt": "old\n" }, options);
    const connector = createGithubConnector({ secrets: {}, fetch: api.fetch });
    const ctx = makeToolContext(connector, { mode: "live", credential: { kind: "app", secret: "ghs_installation_token" } });
    const call = (args: Record<string, unknown>) => connector.callTool("commit_files", args, ctx);
    const commit = (args: Record<string, unknown>) => call({ owner: OWNER, repo: REPO, message: "Agent session 1", ...args });
    return { api, commit, call };
  };

  it("creates the branch from the default branch, uploads only changed files, deletes existing paths, one commit", async () => {
    const { api, commit } = setup();
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).toString("base64");
    const r = await commit({ branch: "agent/t1", files: [{ path: "src/a.ts", content: "export const a = 2;\n" }, { path: "src/same.ts", content: "same\n" }, { path: "src/new.ts", content: Buffer.from("new\n").toString("base64"), encoding: "base64" }, { path: "logo.png", content: png, encoding: "base64" }], deletions: ["old.txt", "never-existed.txt"] });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.data).toMatchObject({ branch: "agent/t1", created: true, committed: true, parentSha: api.refs.get("main"), filesWritten: 3, filesDeleted: 1, url: expect.stringMatching(/^https:\/\/github\.com\/acme\/shop\/commit\/[0-9a-f]{40}$/) });
    expect(api.read("agent/t1")).toEqual({ "README.md": "# Shop\n", "src/a.ts": "export const a = 2;\n", "src/same.ts": "same\n", "src/new.ts": "new\n", "logo.png": png });
    // The unchanged file was never uploaded; text went inline in the tree and only the binary file needed a blob.
    expect(api.log.filter((l) => l.path.endsWith("/git/blobs"))).toHaveLength(1);
    const tree = api.log.find((l) => l.path.endsWith("/git/trees"))!.body as { tree: { path: string; content?: string; sha?: string | null }[] };
    expect(tree.tree.map((e) => [e.path, "content" in e ? "inline" : e.sha === null ? "delete" : "blob"])).toEqual([["src/a.ts", "inline"], ["src/new.ts", "inline"], ["logo.png", "blob"], ["old.txt", "delete"]]);
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

  it("writes only agent/ branches of private repositories, never .git or .github, within its limits, before writing anything", async () => {
    const { api, commit, call } = setup();
    for (const branch of ["main", "production", "release/1.2", "gh-pages", "agent/", "agent/a/b", "agent/../main", "agent/x.lock"]) {
      const r = await commit({ branch, files: [{ path: "x.ts", content: "x" }] });
      expect(r.error?.code, branch).toBe("invalid_args");
    }
    for (const files of [[{ path: ".git/hooks/post-checkout", content: "x" }], [{ path: ".github/workflows/ci.yml", content: "on: push" }], [{ path: ".GitHub/actions/setup/action.yml", content: "x" }], [{ path: "x.bin", content: "not base64!", encoding: "base64" }], Array.from({ length: 301 }, (_, i) => ({ path: `f${i}.ts`, content: "x" })), Array.from({ length: 3 }, (_, i) => ({ path: `big${i}.txt`, content: "x".repeat(4 * 1024 * 1024) }))]) {
      const r = await commit({ branch: "agent/t1", files });
      expect(r.error?.code, files[0]!.path).toBe("invalid_args");
    }
    expect((await commit({ branch: "agent/t1", deletions: [".github/workflows/ci.yml"] })).error?.code).toBe("invalid_args");
    expect((await call({ owner: OWNER, repo: "..", branch: "agent/t1", message: "m", files: [] })).error?.code).toBe("invalid_args");
    expect(api.log).toEqual([]);

    const open = setup({ public: true });
    const r = await open.commit({ branch: "agent/t1", files: [{ path: "x.ts", content: "x" }] });
    expect(r.error).toMatchObject({ status: 422, message: "acme/shop is public; agents push only to private repositories" });
    expect(open.api.log.filter((l) => l.method !== "GET")).toEqual([]);
    const twice = await commit({ branch: "agent/t1", files: [{ path: "a", content: "1" }], deletions: ["a"] });
    expect(twice.error?.code).toBe("invalid_args");
    expect(api.log.filter((l) => l.method !== "GET")).toEqual([]);
  });

  it("refuses a branch whose head is not expectedHeadSha with branch_moved before writing anything", async () => {
    const { api, commit } = setup();
    await commit({ branch: "agent/t1", files: [{ path: "src/a.ts", content: "v2" }] });
    const head = api.refs.get("agent/t1")!;
    const writes = api.log.length;
    const stale = "f".repeat(40);
    const r = await commit({ branch: "agent/t1", message: "late", files: [{ path: "src/a.ts", content: "v3" }], expectedHeadSha: stale });
    expect(r.error).toMatchObject({ code: BRANCH_MOVED, status: 409, details: { branch: "agent/t1", expectedHeadSha: stale, currentHeadSha: head } });
    expect(api.log.slice(writes).filter((l) => l.method !== "GET")).toEqual([]);
    expect(api.refs.get("agent/t1")).toBe(head);
    expect((await commit({ branch: "agent/t1", message: "on time", files: [{ path: "src/a.ts", content: "v3" }], expectedHeadSha: head })).data).toMatchObject({ committed: true, parentSha: head });
    // No branch yet: created from the default branch, the expected head notwithstanding.
    expect((await commit({ branch: "agent/t2", files: [{ path: "src/a.ts", content: "v9" }], expectedHeadSha: stale })).data).toMatchObject({ created: true, committed: true });
  });

  it("rebuilds an existing branch on fromRef when asked: the commit's parent is fromRef, the ref is moved there (forced), and the old commits are left behind", async () => {
    const { api, commit } = setup();
    await commit({ branch: "agent/t1", files: [{ path: "src/a.ts", content: "v2" }, { path: "stale.txt", content: "old branch only" }] });
    const oldHead = api.refs.get("agent/t1")!;
    // The default branch moves on meanwhile.
    const movedTree = new Map([...api.trees.get(api.commits.get(api.refs.get("main")!)!.tree)!]);
    const newBlob = Buffer.from("export const b = 2;\n");
    api.blobs.set(gitBlobSha(newBlob), newBlob);
    movedTree.set("src/b.ts", gitBlobSha(newBlob));
    const mainSha = api.putCommit(api.putTree(movedTree), [api.refs.get("main")!], "main moved");
    api.refs.set("main", mainSha);

    // A head the caller did not see is refused before anything is written, rebuild or not.
    const writes = api.log.length;
    expect((await commit({ branch: "agent/t1", rebuild: true, fromRef: mainSha, expectedHeadSha: "f".repeat(40), files: [{ path: "src/a.ts", content: "v3" }] })).error?.code).toBe(BRANCH_MOVED);
    expect(api.log.slice(writes).filter((l) => l.method !== "GET")).toEqual([]);

    const r = await commit({ branch: "agent/t1", message: "rebuilt", rebuild: true, fromRef: mainSha, expectedHeadSha: oldHead, files: [{ path: "src/a.ts", content: "v3" }] });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.data).toMatchObject({ created: false, committed: true, rebuilt: true, parentSha: mainSha, filesWritten: 1 });
    const head = api.refs.get("agent/t1")!;
    expect(head).not.toBe(oldHead);
    expect(api.commits.get(head)).toMatchObject({ message: "rebuilt", parents: [mainSha] });
    // Main's newest files, the agent's change, and nothing the old branch alone had.
    expect(api.read("agent/t1")).toEqual({ "README.md": "# Shop\n", "src/a.ts": "v3", "src/same.ts": "same\n", "old.txt": "old\n", "src/b.ts": "export const b = 2;\n" });
    // The branch was created with POST refs; the rebuild is the only ref update, and the only forced one.
    const patches = api.log.filter((l) => l.method === "PATCH").map((l) => (l.body as { force?: boolean }).force);
    expect(patches).toEqual([true]);

    // Nothing differs from fromRef: the branch is moved to fromRef itself, with no commit.
    const same = await commit({ branch: "agent/t1", message: "again", rebuild: true, fromRef: mainSha, files: [{ path: "src/a.ts", content: "export const a = 1;\n" }] });
    expect(same.data).toMatchObject({ committed: false, rebuilt: true, sha: mainSha, filesWritten: 0 });
    expect(api.refs.get("agent/t1")).toBe(mainSha);
    // Without fromRef a rebuild is not a valid call.
    expect((await commit({ branch: "agent/t1", rebuild: true, files: [{ path: "src/a.ts", content: "v4" }] })).error?.code).toBe("invalid_args");
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

  it("answers branch_moved when the branch moves between the check and the update and expectedHeadSha was given", async () => {
    const { api, commit } = setup();
    await commit({ branch: "agent/t1", files: [{ path: "src/a.ts", content: "v2" }] });
    const head = api.refs.get("agent/t1")!;
    let moved = false;
    const racing = createGithubConnector({
      secrets: {},
      fetch: async (input, init) => {
        const req = new Request(input, init);
        if (!moved && req.method === "PATCH") {
          moved = true;
          api.refs.set("agent/t1", api.refs.get("main")!);
        }
        return api.fetch(req);
      },
    });
    const r = await racing.callTool("commit_files", { owner: OWNER, repo: REPO, branch: "agent/t1", message: "late", files: [{ path: "src/a.ts", content: "v3" }], expectedHeadSha: head }, makeToolContext(racing, { mode: "live", credential: { kind: "app", secret: "ghs_installation_token" } }));
    expect(r.error).toMatchObject({ code: BRANCH_MOVED, details: { expectedHeadSha: head, currentHeadSha: api.refs.get("main") } });
  });
});

/**
 * The slice of GitHub's REST API run_checks and get_checks use: repository, branch ref, workflow dispatch
 * (`status` 204 or 200 with a run id) and the paged check runs of a commit. Requests are logged.
 */
function fakeCiApi(owner: string, repo: string, options: { public?: boolean; dispatchStatus?: number; branches?: Record<string, string>; checkRuns?: Record<string, unknown>[]; totalCount?: number; githubTrees?: Record<string, string | null>; workflowRun?: { status: string; conclusion: string | null } | null } = {}) {
  const branches = options.branches ?? { "agent/t1": "c".repeat(40), main: "a".repeat(40) };
  const checkRuns = options.checkRuns ?? [];
  /** The sha of each branch's `.github` entry in its root tree (null: no such entry); every branch shares one tree unless told otherwise. */
  const githubTree = (branch: string): string | null => (options.githubTrees && branch in options.githubTrees ? options.githubTrees[branch]! : "g".repeat(40));
  /** The newest CI workflow run for a head (default: completed, success); null: CI has not run on it. */
  const workflowRun = options.workflowRun === undefined ? { status: "completed", conclusion: "success" } : options.workflowRun;
  const log: { method: string; path: string; query: string; body?: unknown }[] = [];
  const base = `/repos/${owner}/${repo}`;
  const fetch: FetchLike = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);
    const body = req.method === "GET" ? undefined : await req.json();
    log.push({ method: req.method, path, query: url.search, body });
    if (req.method === "GET" && path === base) return jsonResponse({ id: 1, name: repo, full_name: `${owner}/${repo}`, default_branch: "main", html_url: `https://github.com/${owner}/${repo}`, private: !options.public, owner: { login: owner } });
    let m: RegExpMatchArray | null;
    if (req.method === "GET" && (m = path.match(new RegExp(`^${base}/git/ref/heads/(.+)$`)))) {
      const sha = branches[m[1]!];
      return sha ? jsonResponse({ ref: `refs/heads/${m[1]}`, object: { sha, type: "commit" } }) : jsonResponse({ message: "Not Found" }, { status: 404 });
    }
    if (req.method === "POST" && path === `${base}/actions/workflows/ci.yml/dispatches`) {
      const ref = ((body as { ref?: string }).ref ?? "").replace(/^refs\/heads\//, "");
      if (!branches[ref]) return jsonResponse({ message: "No ref found for: " + ref }, { status: 422 });
      return options.dispatchStatus === 200 ? jsonResponse({ workflow_run_id: 7, run_url: "https://api.github.com/x", html_url: "https://github.com/x" }) : new Response(null, { status: 204 });
    }
    if (req.method === "GET" && new RegExp(`^${base}/commits/[0-9a-f]{40}/check-runs$`).test(path)) {
      const perPage = Number(url.searchParams.get("per_page"));
      const page = Number(url.searchParams.get("page") ?? "1");
      return jsonResponse({ total_count: options.totalCount ?? checkRuns.length, check_runs: checkRuns.slice((page - 1) * perPage, page * perPage) });
    }
    // A branch's commit (only `commit.tree.sha` is read) and its root tree, which holds a `.github` entry unless told otherwise.
    if (req.method === "GET" && (m = path.match(new RegExp(`^${base}/commits/(.+)$`)))) {
      const sha = branches[m[1]!];
      return sha ? jsonResponse({ sha, commit: { tree: { sha: `root:${m[1]}` } } }) : jsonResponse({ message: "No commit found for SHA: " + m[1] }, { status: 422 });
    }
    if (req.method === "GET" && (m = path.match(new RegExp(`^${base}/git/trees/root:(.+)$`)))) {
      const sha = githubTree(m[1]!);
      return jsonResponse({ sha: `root:${m[1]}`, truncated: false, tree: [{ path: "README.md", type: "blob", sha: "b".repeat(40), mode: "100644" }, ...(sha ? [{ path: ".github", type: "tree", sha, mode: "040000" }] : [])] });
    }
    // Workflow runs are listed for one head only; asking without `head_sha` would return another head's run.
    if (req.method === "GET" && path === `${base}/actions/workflows/ci.yml/runs`) {
      const head = url.searchParams.get("head_sha");
      const known = head !== null && Object.values(branches).includes(head);
      return jsonResponse({ total_count: known && workflowRun ? 1 : 0, workflow_runs: known && workflowRun ? [{ id: 9, head_sha: head, ...workflowRun }] : [] });
    }
    throw new Error(`fakeCiApi: no route for ${req.method} ${path}`);
  };
  return { fetch, log, branches };
}

describe("github live: run_checks and get_checks against the Actions and Checks APIs", () => {
  const OWNER = "acme";
  const REPO = "shop";
  const setup = (options: Parameters<typeof fakeCiApi>[2] = {}) => {
    const api = fakeCiApi(OWNER, REPO, options);
    const connector = createGithubConnector({ secrets: {}, fetch: api.fetch });
    const ctx = makeToolContext(connector, { mode: "live", credential: { kind: "app", secret: "ghs_installation_token" } });
    return { api, runChecks: (branch: string) => connector.callTool("run_checks", { owner: OWNER, repo: REPO, branch }, ctx), getChecks: (branch: string) => connector.callTool("get_checks", { owner: OWNER, repo: REPO, branch }, ctx) };
  };
  const checkRun = (name: string, status: string, conclusion: string | null, extra: Record<string, unknown> = {}) => ({ id: 1, name, status, conclusion, html_url: `https://github.com/acme/shop/runs/${name}`, details_url: null, ...extra });
  const content = (r: { data?: unknown }) => GetChecksOutput.parse(isUntrusted(r.data) ? r.data.content : null);

  it("dispatches ci.yml on the branch, whether GitHub answers 204 or 200 with a run id", async () => {
    for (const dispatchStatus of [204, 200]) {
      const { api, runChecks } = setup({ dispatchStatus });
      const r = await runChecks("agent/t1");
      expect(r.ok, JSON.stringify(r.error)).toBe(true);
      expect(RunChecksOutput.parse(r.data)).toEqual({ dispatched: true, branch: "agent/t1", workflow: "ci.yml" });
      expect(r.untrusted).toBeUndefined();
      expect(api.log.filter((l) => l.method === "POST")).toEqual([{ method: "POST", path: `/repos/${OWNER}/${REPO}/actions/workflows/ci.yml/dispatches`, query: "", body: { ref: "refs/heads/agent/t1" } }]);
    }
  });

  it("refuses a branch whose .github differs from the default branch's, and dispatches nothing", async () => {
    const message = "run_checks refuses to run a workflow that differs from the default branch (.github changed on agent/t1); rebase the branch onto the default branch";
    // The branch changed a workflow, dropped .github, or added one the default branch does not have.
    const cases: Record<string, string | null>[] = [{ "agent/t1": "d".repeat(40) }, { "agent/t1": null }, { main: null }];
    for (const githubTrees of cases) {
      const { api, runChecks } = setup({ githubTrees });
      const r = await runChecks("agent/t1");
      expect(r.ok, JSON.stringify(githubTrees)).toBe(false);
      expect(r.error, JSON.stringify(githubTrees)).toMatchObject({ status: 422, message });
      expect(api.log.filter((l) => l.method === "POST")).toEqual([]);
    }
  });

  it("still dispatches a branch whose .github matches the default branch's, including when neither has one", async () => {
    const cases: Record<string, string | null>[] = [{ "agent/t1": "e".repeat(40), main: "e".repeat(40) }, { "agent/t1": null, main: null }];
    for (const githubTrees of cases) {
      const { api, runChecks } = setup({ githubTrees });
      expect((await runChecks("agent/t1")).ok, JSON.stringify(githubTrees)).toBe(true);
      expect(api.log.filter((l) => l.method === "POST")).toHaveLength(1);
      // Both refs were compared through their root trees.
      expect(api.log.filter((l) => l.path.includes("/git/trees/")).map((l) => l.path).sort()).toEqual([`/repos/${OWNER}/${REPO}/git/trees/root:agent/t1`, `/repos/${OWNER}/${REPO}/git/trees/root:main`]);
    }
  });

  it("refuses non-agent branches before any request, and public repositories before dispatching", async () => {
    const { api, runChecks, getChecks } = setup();
    for (const branch of ["main", "production", "release/1.2", "agent/", "agent/../main"]) {
      expect((await runChecks(branch)).error?.code, `run_checks ${branch}`).toBe("invalid_args");
      expect((await getChecks(branch)).error?.code, `get_checks ${branch}`).toBe("invalid_args");
    }
    expect(api.log).toEqual([]);

    const open = setup({ public: true });
    const r = await open.runChecks("agent/t1");
    expect(r.error).toMatchObject({ status: 422, message: "acme/shop is public; agents push only to private repositories" });
    expect(open.api.log.filter((l) => l.method !== "GET")).toEqual([]);
  });

  it("returns GitHub's refusal when the branch is missing or ci.yml cannot be dispatched", async () => {
    const { runChecks, getChecks } = setup();
    expect((await runChecks("agent/none")).error).toMatchObject({ status: 422 });
    expect((await getChecks("agent/none")).error?.code).toBe("not_found");
  });

  it("reads the head's check runs and maps them to one verdict, as quarantined repository text", async () => {
    const head = "c".repeat(40);
    const pending = setup({ checkRuns: [checkRun("lint", "completed", "success"), checkRun("test", "in_progress", null, { html_url: null, details_url: "https://ci.example/test" })] });
    const r = await pending.getChecks("agent/t1");
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.untrusted).toBe(true);
    expect(isUntrusted(r.data) && r.data.source).toMatchObject({ connector: "github", kind: "repo", ref: "acme/shop@agent/t1:checks" });
    expect(content(r)).toEqual({ headSha: head, state: "pending", checks: [{ name: "lint", status: "completed", conclusion: "success", url: "https://github.com/acme/shop/runs/lint" }, { name: "test", status: "in_progress", conclusion: null, url: "https://ci.example/test" }] });
    expect(pending.api.log.find((l) => l.path.endsWith("/check-runs"))).toMatchObject({ path: `/repos/${OWNER}/${REPO}/commits/${head}/check-runs`, query: "?per_page=100&page=1" });

    expect(content(await setup({}).getChecks("agent/t1"))).toEqual({ headSha: head, state: "pending", checks: [] });
    expect(content(await setup({ checkRuns: [checkRun("lint", "completed", "success"), checkRun("e2e", "completed", "skipped"), checkRun("docs", "completed", "neutral")] }).getChecks("agent/t1")).state).toBe("success");
    for (const conclusion of ["failure", "timed_out", "cancelled", "action_required"]) expect(content(await setup({ checkRuns: [checkRun("lint", "completed", "success"), checkRun("test", "completed", conclusion)] }).getChecks("agent/t1")).state, conclusion).toBe("failure");
  });

  it("reads further pages, and never reports success for a list it did not finish", async () => {
    const pass = (n: number) => Array.from({ length: n }, (_, i) => checkRun(`job-${i}`, "completed", "success"));
    const second = setup({ checkRuns: [...pass(100), checkRun("late", "completed", "failure")] });
    const failed = content(await second.getChecks("agent/t1"));
    expect(failed.state).toBe("failure");
    expect(failed.checks).toHaveLength(101);
    expect(second.api.log.filter((l) => l.path.endsWith("/check-runs")).map((l) => l.query)).toEqual(["?per_page=100&page=1", "?per_page=100&page=2"]);

    const many = setup({ checkRuns: pass(600) });
    const cut = content(await many.getChecks("agent/t1"));
    expect(cut.checks).toHaveLength(500);
    expect(cut.state).toBe("pending");
    expect(many.api.log.filter((l) => l.path.endsWith("/check-runs"))).toHaveLength(5);
  });

  describe("the CI workflow's own run decides before the check runs do", () => {
    const green = [checkRun("lint", "completed", "success"), checkRun("test", "completed", "success")];

    it("is pending when check runs exist (even successful ones from another workflow) but CI has not run on the head", async () => {
      const t = setup({ checkRuns: green, workflowRun: null });
      const r = content(await t.getChecks("agent/t1"));
      expect(r.state).toBe("pending");
      // The checks are still reported as read.
      expect(r.checks.map((c) => [c.name, c.conclusion])).toEqual([["lint", "success"], ["test", "success"]]);
      // The newest run is asked for by workflow file, for this head only.
      expect(t.api.log.find((l) => l.path.endsWith("/actions/workflows/ci.yml/runs"))).toMatchObject({ query: `?head_sha=${"c".repeat(40)}&per_page=1` });
    });

    it("is pending while the CI run is queued or in progress, even when the check runs so far are green", async () => {
      for (const status of ["queued", "in_progress", "waiting"]) expect(content(await setup({ checkRuns: green, workflowRun: { status, conclusion: null } }).getChecks("agent/t1")).state, status).toBe("pending");
    });

    it("is failure when the CI run concludes anything but success, even when the check runs look successful", async () => {
      for (const conclusion of ["failure", "cancelled", "timed_out", "action_required", "skipped", "neutral", null]) expect(content(await setup({ checkRuns: green, workflowRun: { status: "completed", conclusion } }).getChecks("agent/t1")).state, String(conclusion)).toBe("failure");
    });

    it("is success only after the CI run concludes success and every check is success", async () => {
      expect(content(await setup({ checkRuns: green, workflowRun: { status: "completed", conclusion: "success" } }).getChecks("agent/t1")).state).toBe("success");
      // A successful run does not excuse a failing, running or missing check.
      expect(content(await setup({ checkRuns: [...green, checkRun("e2e", "completed", "failure")] }).getChecks("agent/t1")).state).toBe("failure");
      expect(content(await setup({ checkRuns: [...green, checkRun("e2e", "in_progress", null)] }).getChecks("agent/t1")).state).toBe("pending");
      expect(content(await setup({ checkRuns: [] }).getChecks("agent/t1")).state).toBe("pending");
    });
  });
});

describe.skipIf(!envKeysPresent("GITHUB_APP_ID","GITHUB_APP_PRIVATE_KEY", "GITHUB_TEST_INSTALLATION_ID"))("github (live)", () => {
  const connector = createGithubConnector({ secrets: { githubAppId: process.env.GITHUB_APP_ID, githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY, githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET } });
  // connect() needs the OAuth code GitHub sends the installer, which a test cannot fabricate: the installation is given.
  const integration = { ...makeToolContext(connector, { mode: "live" }).integration, externalAccountId: String(process.env.GITHUB_TEST_INSTALLATION_ID) };
  describeConnectorContract("github live", { connector, mode: "live", deterministic: false, skipConnect: true, integration, calls: [{ tool: "list_repos", args: { perPage: 1 } }] });
  // GITHUB_TEST_REPO=owner/name: a repository the test installation may write to; the check commits to a scratch branch.
  it.skipIf(!process.env.GITHUB_TEST_REPO)("commit_files writes a commit to a scratch branch and is a no-op when repeated", async () => {
    const [owner, repo] = process.env.GITHUB_TEST_REPO!.split("/") as [string, string];
    const ctx = makeToolContext(connector, { mode: "live", integration });
    const args = { owner, repo, branch: "foundmill/commit-files-check", message: "Foundmill connector check", files: [{ path: "foundmill-check.txt", content: `checked ${new Date().toISOString()}\n` }] };
    const first = await connector.callTool("commit_files", args, ctx);
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    expect(first.data).toMatchObject({ committed: true, filesWritten: 1 });
    expect((await connector.callTool("commit_files", args, ctx)).data).toMatchObject({ committed: false });
  });
});

describe("download_archive", () => {
  type ArchiveOut = { ref: string; sha: string; bytes: number; archive: Uint8Array; base64?: string };
  const archiveOf = (r: { data?: unknown }): ArchiveOut => (isUntrusted(r.data) ? r.data.content : r.data) as ArchiveOut;
  const entriesOf = async (bytes: Uint8Array) => {
    const out: { path: string; content: string | null }[] = [];
    for await (const e of readTarGz(bytes, { maxEntries: 100, maxEntryBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 })) if (e.type === "file") out.push({ path: e.path, content: e.content?.toString("utf8") ?? null });
    return out;
  };

  it("mock: the default branch of a fixture repository as a deterministic tarball, an agent branch with its own commits, a starter tree for an unknown repository", async () => {
    const mock = createGithubMock();
    const ctx = makeToolContext(mock);
    const main = await mock.callTool("download_archive", { owner: MOCK_OWNER, repo: "northwind-site" }, ctx);
    expect(main.ok, JSON.stringify(main.error)).toBe(true);
    expect(isUntrusted(main.data) && main.data.source).toMatchObject({ connector: "github", kind: "repo", ref: `${MOCK_OWNER}/northwind-site@HEAD:archive` });
    const out = archiveOf(main);
    expect(out).toMatchObject({ ref: "main", sha: GH_REPOS[0]!.branches.main });
    expect(Buffer.isBuffer(out.archive)).toBe(true);
    expect(out.archive.byteLength).toBe(out.bytes);
    // The deprecated base64 copy (mock only) is the same bytes.
    expect(Buffer.from(out.base64!, "base64").equals(Buffer.from(out.archive))).toBe(true);
    // The untrusted envelope hashes the bytes themselves, never a JSON array of them (the mock's base64 copy is still text).
    expect(isUntrusted(main.data) && main.data.byteLength).toBeLessThan(out.bytes + out.base64!.length + 400);
    const files = await entriesOf(out.archive);
    expect(files.map((f) => f.path)).toEqual(GH_REPOS[0]!.files.map((f) => `${MOCK_OWNER}-northwind-site-${out.sha.slice(0, 7)}/${f.path}`).sort());
    // Deterministic: the same call gives the same bytes.
    const again = await mock.callTool("download_archive", { owner: MOCK_OWNER, repo: "northwind-site", ref: "main" }, ctx);
    expect(Buffer.from(archiveOf(again).archive).equals(Buffer.from(out.archive))).toBe(true);
    expect(isUntrusted(again.data) && isUntrusted(main.data) && again.data.contentHash).toBe(isUntrusted(main.data) && main.data.contentHash);

    // A missing branch is not found (the orchestrator then checks out the default branch).
    expect((await mock.callTool("download_archive", { owner: MOCK_OWNER, repo: "northwind-site", ref: "agent/t1" }, ctx)).error?.code).toBe("not_found");
    await mock.callTool("commit_files", { owner: MOCK_OWNER, repo: "northwind-site", branch: "agent/t1", message: "x", files: [{ path: "NOTES.md", content: "notes\n" }], deletions: ["README.md"] }, ctx);
    const branch = await mock.callTool("download_archive", { owner: MOCK_OWNER, repo: "northwind-site", ref: "agent/t1" }, ctx);
    const onBranch = await entriesOf(archiveOf(branch).archive);
    expect(onBranch.some((f) => f.path.endsWith("/NOTES.md"))).toBe(true);
    expect(onBranch.some((f) => f.path.endsWith("/README.md"))).toBe(false);

    const fresh = await mock.callTool("download_archive", { owner: "acme", repo: "shop" }, ctx);
    const starter = await entriesOf(archiveOf(fresh).archive);
    expect(starter.map((f) => f.path.split("/").slice(1).join("/"))).toEqual(["README.md", "package.json", "src/index.ts"]);
    expect(mock.policyHints.download_archive).toEqual({});

    const pub = createGithubMock({ publicRepos: [`${MOCK_OWNER}/northwind-site`] });
    expect((await pub.callTool("download_archive", { owner: MOCK_OWNER, repo: "northwind-site" }, makeToolContext(pub))).error).toMatchObject({ status: 422 });
  });

  const tarball = writeTarGz([{ path: "package.json", content: "{}" }], { prefix: "acme-shop-aaaaaaa/" });
  const SHA = "a".repeat(40);
  const live = (options: { private?: boolean; body?: () => BodyInit; length?: string; refs?: Record<string, string> } = {}) => {
    const seen: string[] = [];
    const fetch = routedFetch({
      "GET https://api.github.com/repos/acme/shop": () => jsonResponse({ id: 1, full_name: "acme/shop", name: "shop", private: options.private ?? true, default_branch: "main", description: null, html_url: "https://github.com/acme/shop", owner: { login: "acme" } }),
      "GET https://api.github.com/repos/acme/shop/commits/*": (_req, url) => {
        const ref = decodeURIComponent(url.pathname.split("/commits/")[1]!);
        const sha = (options.refs ?? { main: SHA })[ref];
        return sha ? new Response(sha, { headers: { "content-type": "application/vnd.github.sha; charset=utf-8" } }) : jsonResponse({ message: `No commit found for SHA: ${ref}` }, { status: 422 });
      },
      "GET https://api.github.com/repos/acme/shop/tarball/*": (req, url) => {
        seen.push(`${url.pathname} ${req.headers.get("authorization")}`);
        return new Response(options.body ? options.body() : new Uint8Array(tarball), { headers: { "content-type": "application/x-gzip", ...(options.length ? { "content-length": options.length } : {}) } });
      },
    });
    const connector = createGithubConnector({ secrets: {}, fetch });
    const ctx = makeToolContext(connector, { mode: "live", credential: { kind: "app", secret: "ghs_installation_token" } });
    return { seen, call: (args: Record<string, unknown>) => connector.callTool("download_archive", { owner: "acme", repo: "shop", ...args }, ctx) };
  };

  it("live: resolves the ref, downloads the tarball of that exact commit with the installation token", async () => {
    const { seen, call } = live();
    const r = await call({});
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const out = archiveOf(r);
    expect(out).toMatchObject({ ref: "main", sha: SHA, bytes: tarball.length });
    // The live connector hands the bytes on as they are: no base64 copy.
    expect(Buffer.from(out.archive).equals(tarball)).toBe(true);
    expect(out.base64).toBeUndefined();
    expect(seen).toEqual([`/repos/acme/shop/tarball/${SHA} token ghs_installation_token`]);
    expect((await call({ ref: "agent/t1" })).error).toMatchObject({ code: "not_found", message: "ref agent/t1 not found in acme/shop" });
  });

  it("live: refuses public repositories and archives over 60 MB (declared or streamed)", async () => {
    expect((await live({ private: false }).call({})).error).toMatchObject({ status: 422, message: "acme/shop is public; code sessions check out only private repositories" });
    expect((await live({ length: String(61 * 1024 * 1024) }).call({})).error).toMatchObject({ status: 413 });
    const chunk = new Uint8Array(8 * 1024 * 1024);
    const stream = () => new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(chunk); } });
    expect((await live({ body: stream }).call({})).error).toMatchObject({ status: 413, message: "acme/shop is larger than 60 MB compressed; it cannot be checked out" });
  });
});

describe("get_repository", () => {
  it("mock: a fixture repository's id, visibility and default branch; an unknown one is created private with a stable id; an unreachable one is not found", async () => {
    const mock = createGithubMock({ publicRepos: [`${MOCK_OWNER}/ledgerly-app`], inaccessibleRepos: ["Acme/Gone"] });
    const ctx = makeToolContext(mock);
    const content = (r: { data?: unknown }) => (isUntrusted(r.data) ? r.data.content : r.data) as { id: number; fullName: string; private: boolean; defaultBranch: string };
    expect(content(await mock.callTool("get_repository", { owner: MOCK_OWNER, repo: "northwind-site" }, ctx))).toMatchObject({ id: GH_REPOS[0]!.repo.id, private: true, defaultBranch: "main" });
    expect(content(await mock.callTool("get_repository", { owner: MOCK_OWNER, repo: "ledgerly-app" }, ctx))).toMatchObject({ private: false });
    const created = content(await mock.callTool("get_repository", { owner: "acme", repo: "shop" }, ctx));
    expect(created).toMatchObject({ fullName: "acme/shop", private: true });
    // Another process's mock (the api's, the gateway's) gives the same id.
    expect(content(await createGithubMock().callTool("get_repository", { owner: "acme", repo: "shop" }, makeToolContext(mock))).id).toBe(created.id);
    expect((await mock.callTool("get_repository", { owner: "acme", repo: "gone" }, ctx)).error?.code).toBe("not_found");
  });

  it("live: reads GET /repos/{owner}/{repo} with the installation token", async () => {
    const fetch = routedFetch({ "GET https://api.github.com/repos/acme/shop": () => jsonResponse({ id: 4242, full_name: "acme/shop", name: "shop", private: true, default_branch: "trunk", description: null, html_url: "https://github.com/acme/shop", owner: { login: "acme" } }) });
    const connector = createGithubConnector({ secrets: {}, fetch });
    const r = await connector.callTool("get_repository", { owner: "acme", repo: "shop" }, makeToolContext(connector, { mode: "live", credential: { kind: "app", secret: "ghs_installation_token" } }));
    expect(isUntrusted(r.data) && r.data.content).toMatchObject({ id: 4242, private: true, defaultBranch: "trunk" });
  });
});

describe("commit_files expectedHeadSha", () => {
  it("mock: refuses with branch_moved (and the current head) when the branch moved, writes nothing; the right head commits", async () => {
    const mock = createGithubMock();
    const ctx = makeToolContext(mock);
    const repo = { owner: MOCK_OWNER, repo: "northwind-site", branch: "agent/t1" };
    const first = await mock.callTool("commit_files", { ...repo, message: "one", files: [{ path: "NOTES.md", content: "1\n" }] }, ctx);
    const head = (first.data as { sha: string }).sha;
    const stale = "f".repeat(40);
    const refused = await mock.callTool("commit_files", { ...repo, message: "two", files: [{ path: "NOTES.md", content: "2\n" }], expectedHeadSha: stale }, ctx);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatchObject({ code: BRANCH_MOVED, status: 409, details: { branch: "agent/t1", expectedHeadSha: stale, currentHeadSha: head } });
    const file = await mock.callTool("read_file", { owner: MOCK_OWNER, repo: "northwind-site", path: "NOTES.md", ref: "agent/t1" }, ctx);
    expect(isUntrusted(file.data) && (file.data.content as { content: string }).content).toBe("1\n");
    const ok = await mock.callTool("commit_files", { ...repo, message: "two", files: [{ path: "NOTES.md", content: "2\n" }], expectedHeadSha: head }, ctx);
    expect(ok.data).toMatchObject({ committed: true, parentSha: head });
    // A branch that does not exist yet is created whatever the expected head says.
    expect((await mock.callTool("commit_files", { ...repo, branch: "agent/t2", message: "new", files: [{ path: "a.ts", content: "a" }], expectedHeadSha: stale }, ctx)).data).toMatchObject({ created: true, committed: true });
    expect((await mock.callTool("commit_files", { ...repo, message: "x", files: [], expectedHeadSha: "abc123" }, ctx)).error?.code).toBe("invalid_args");
  });
});

describe("commit_files rebuild", () => {
  it("mock: rebuilds an existing branch on fromRef (its old commits left behind), moves its pull request's head, clears its conflict; a new branch is simply created", async () => {
    const mock = createGithubMock({ conflictingBranches: ["agent/t1"] });
    const ctx = makeToolContext(mock);
    const repo = { owner: MOCK_OWNER, repo: "northwind-site" };
    const branch = "agent/t1";
    // The branch as the agent first left it: one commit on an older main, then the base moves on.
    const first = await mock.callTool("commit_files", { ...repo, branch, message: "one", files: [{ path: "src/fix.ts", content: "fix v1\n" }, { path: "stale.txt", content: "from the old branch\n" }] }, ctx);
    const oldHead = (first.data as { sha: string }).sha;
    const pr = await mock.callTool("open_pr", { ...repo, title: "Fix", body: "", head: branch, base: "HEAD", draft: false }, ctx);
    const prNumber = (isUntrusted(pr.data) ? pr.data.content : pr.data) as { number: number; mergeableState: string };
    expect(prNumber.mergeableState).toBe("dirty");
    const main = await mock.callTool("compare_refs", { ...repo, base: "HEAD", head: branch }, ctx);
    const mainSha = (isUntrusted(main.data) ? main.data.content : main.data) as { baseSha: string };

    // Without fromRef the rebuild is refused before anything is written.
    expect((await mock.callTool("commit_files", { ...repo, branch, message: "x", rebuild: true, files: [{ path: "src/fix.ts", content: "v2" }] }, ctx)).error?.code).toBe("invalid_args");
    // A head the caller did not see is still refused.
    expect((await mock.callTool("commit_files", { ...repo, branch, message: "x", rebuild: true, fromRef: mainSha.baseSha, expectedHeadSha: "f".repeat(40), files: [{ path: "src/fix.ts", content: "v2" }] }, ctx)).error?.code).toBe(BRANCH_MOVED);

    // The rebuild: parented on main's commit, the branch holds main's files plus the diff, not the old branch's extras.
    const rebuilt = await mock.callTool("commit_files", { ...repo, branch, message: "two", rebuild: true, fromRef: mainSha.baseSha, expectedHeadSha: oldHead, files: [{ path: "src/fix.ts", content: "fix v2\n" }] }, ctx);
    expect(rebuilt.data).toMatchObject({ created: false, committed: true, rebuilt: true, parentSha: mainSha.baseSha, filesWritten: 1 });
    const newHead = (rebuilt.data as { sha: string }).sha;
    expect(newHead).not.toBe(oldHead);
    const stale = await mock.callTool("read_file", { ...repo, path: "stale.txt", ref: branch }, ctx);
    expect(stale.ok).toBe(false);
    const compared = await mock.callTool("compare_refs", { ...repo, base: "HEAD", head: branch }, ctx);
    expect(isUntrusted(compared.data) && compared.data.content).toMatchObject({ behindBy: 0, aheadBy: 1, files: [{ path: "src/fix.ts", status: "added" }] });
    const after = await mock.callTool("get_pull_request", { ...repo, prNumber: prNumber.number }, ctx);
    expect(isUntrusted(after.data) && after.data.content).toMatchObject({ head: { sha: newHead }, mergeableState: "clean" });

    // Nothing differs from fromRef: the branch becomes fromRef itself, no commit.
    const none = await mock.callTool("commit_files", { ...repo, branch, message: "three", rebuild: true, fromRef: mainSha.baseSha, files: [] }, ctx);
    expect(none.data).toMatchObject({ committed: false, rebuilt: true, sha: mainSha.baseSha });
    // A branch that does not exist yet: created from fromRef, nothing to rebuild.
    expect((await mock.callTool("commit_files", { ...repo, branch: "agent/t2", message: "new", rebuild: true, fromRef: mainSha.baseSha, files: [{ path: "a.ts", content: "a" }] }, ctx)).data).toMatchObject({ created: true, rebuilt: false, committed: true });
    // Without rebuild, a commit still goes on top of the branch as before.
    expect((await mock.callTool("commit_files", { ...repo, branch: "agent/t2", message: "more", files: [{ path: "b.ts", content: "b" }] }, ctx)).data).toMatchObject({ created: false, rebuilt: false, committed: true });
  });
});
