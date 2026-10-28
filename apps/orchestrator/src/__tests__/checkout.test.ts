/**
 * Real checkouts (activities/checkout.ts, founder decision 2, 2026-10-23): a code session starts from the Code-tab
 * repository's archive (the task's branch, else the default branch), extracted safely; the save keeps only the diff
 * against it and the push sends only that diff; anything that goes wrong starts the session as before.
 */
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGithubMock } from "@foundmill/connectors/connectors/github/mock";
import { writeTarGz, type TarWriteEntry } from "@foundmill/connectors/connectors/github/tarball";
import { makeToolContext } from "@foundmill/connectors/testing/contract-suite";
import { isUntrusted } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CHECKOUT_BUSY_RETRIES, CHECKOUT_BUSY_WAIT_MS, CHECKOUT_LIMITS, checkoutMissingNote, checkoutRepository, defaultBranchChanges, describeCheckout, disposeCheckout, extractArchive, isTestFile, isTestRunnerConfig, packageTestSettings, testSetupChanges, testSetupReviewReason } from "../activities/checkout";
import { pushWorkspace } from "../activities/workspace-push";
import { restoreWorkspace, saveWorkspace } from "../activities/workspace-store";
import { readWorkspaceChanges, removeSandboxLinksCommand, syncCheckoutToSandbox } from "../activities/workspace-sync";
import { createOfflineGatewayClient, type ArchiveResponse, type GatewayClient } from "../gateway-client";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
const dirs: string[] = [];
const freshDir = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), "fm-checkout-"));
  dirs.push(d);
  return d;
};
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "checkout" });
});
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  await t?.close();
});
afterEach(async () => {
  const row = await repos.integrations.getByKey(t.deps.db, t.businessId, "github");
  if (row && !row.archivedAt) await repos.integrations.disconnect(t.deps.db, t.businessId, row.id);
});

const archiveOf = (entries: TarWriteEntry[], prefix = "acme-shop-aaaaaaa/") => writeTarGz(entries, { prefix, comment: "a".repeat(40) });
const list = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (d: string, rel: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  await walk(dir, "");
  return out.sort();
};

/** A gateway whose archives and commits come from one GitHub mock (so a pushed branch can be checked out). */
function githubGateway(github = createGithubMock(), options: { archive?: (req: { ref: string }) => ArchiveResponse | null } = {}) {
  const offline = createOfflineGatewayClient();
  const ctx = makeToolContext(github);
  const gateway: GatewayClient = {
    ...offline,
    async call(_token, req) {
      offline.calls.push(req);
      return { outcome: "allow", result: await github.callTool(req.tool, req.args, ctx), costMinor: 0 };
    },
    async downloadArchive(_token, req) {
      offline.archives.push(req);
      const forced = options.archive?.(req);
      if (forced) return forced;
      const r = await github.callTool("download_archive", req, ctx);
      if (!r.ok) return { outcome: "allow", error: { code: r.error!.code, message: r.error!.message } };
      const out = (isUntrusted(r.data) ? r.data.content : r.data) as { ref: string; sha: string; archive: Uint8Array };
      return { outcome: "allow", archive: { ref: out.ref, sha: out.sha, data: new Uint8Array(out.archive) } };
    },
  };
  return { github, gateway, offline, ctx };
}

describe("extractArchive", () => {
  it("writes the repository's regular files under the workspace, stripping GitHub's top directory, and records the base", async () => {
    const cwd = await freshDir();
    const out = await extractArchive(
      archiveOf([
        { path: "package.json", content: '{"name":"shop"}' },
        { path: "src/index.ts", content: "export const site = 'https://shop.example/help';\n" },
        { path: "docs/CONTACT.md", content: "Write to ops@shop.example\n" },
        { path: "test/fixture.ts", content: "export const key = 'sk_live_51Hx8ZkLq9mN0pQrStUvWxYz';\n" },
        { path: ".env", content: "STRIPE_SECRET_KEY=sk_live_77Ab8ZkLq9mN0pQrStUvWxYz\n" },
        // Left out: links of either kind, dependencies, git metadata, the CLI's and shells' start-up files, SDK state.
        { path: "link", type: "symlink", linkTarget: "/etc/passwd" },
        { path: "hard", type: "hardlink", linkTarget: "package.json" },
        { path: "node_modules/dep/index.js", content: "x" },
        { path: "pkg/node_modules/dep/index.js", content: "x" },
        { path: ".git/HEAD", content: "ref: refs/heads/main" },
        { path: "CLAUDE.md", content: "# House notes" },
        { path: ".npmrc", content: "registry=https://evil.example" },
        { path: ".mcp.json", content: "{}" },
        { path: ".claude/settings.json", content: "{}" },
      ]),
      cwd,
    );
    expect(await list(cwd)).toEqual([".env", "docs/CONTACT.md", "package.json", "src/index.ts", "test/fixture.ts"]);
    expect([...out.files.keys()].sort()).toEqual([".env", "docs/CONTACT.md", "package.json", "src/index.ts", "test/fixture.ts"]);
    expect(out.files.get("package.json")).toMatch(/^[0-9a-f]{64}$/);
    expect(out.skipped).toBe(9);
    expect([...out.recipients.emails]).toEqual(["ops@shop.example"]);
    expect([...out.recipients.urls]).toContain("https://shop.example/help");
    // Kept by the path that held them; a secret file's values are never kept anywhere.
    expect([...out.knownSecrets.entries()].map(([p, v]) => [p, [...v]])).toEqual([["test/fixture.ts", ["sk_live_51Hx8ZkLq9mN0pQrStUvWxYz"]]]);
    expect(out.packageScripts.get("package.json")).toBe('{"jest":null,"scripts":null}');
    await expect(lstat(path.join(cwd, "link"))).rejects.toThrow();
  });

  it("refuses path traversal, absolute paths and more than one top-level directory", async () => {
    await expect(extractArchive(archiveOf([{ path: "../escape.sh", content: "x" }]), await freshDir())).rejects.toThrow(/unsafe path/);
    await expect(extractArchive(archiveOf([{ path: "a/../../escape.sh", content: "x" }]), await freshDir())).rejects.toThrow(/unsafe path/);
    await expect(extractArchive(writeTarGz([{ path: "/etc/cron.d/x", content: "x" }]), await freshDir())).rejects.toThrow(/unsafe path/);
    await expect(extractArchive(writeTarGz([{ path: "one/a.ts", content: "a" }, { path: "two/b.ts", content: "b" }]), await freshDir())).rejects.toThrow(/more than one top-level/);
    const outside = await freshDir();
    const cwd = path.join(outside, "ws");
    await mkdir(cwd);
    await expect(extractArchive(archiveOf([{ path: "ok.ts", content: "x" }, { path: "../../x.ts", content: "x" }]), cwd)).rejects.toThrow(/unsafe path/);
    expect(await readdir(outside)).toEqual(["ws"]);
  });

  it("applies its caps: files, unpacked bytes, entries; a file over the per-file cap is left out", async () => {
    const many = archiveOf(Array.from({ length: 6 }, (_, i) => ({ path: `f${i}.ts`, content: "x" })));
    await expect(extractArchive(many, await freshDir(), { ...CHECKOUT_LIMITS, maxFiles: 5 })).rejects.toThrow(/more than 5 files/);
    await expect(extractArchive(many, await freshDir(), { ...CHECKOUT_LIMITS, maxEntries: 4 })).rejects.toThrow(/more than 4 entries/);
    const big = archiveOf([{ path: "big.bin", content: Buffer.alloc(64 * 1024) }, { path: "small.ts", content: "s" }]);
    await expect(extractArchive(big, await freshDir(), { ...CHECKOUT_LIMITS, maxTotalBytes: 32 * 1024 })).rejects.toThrow(/unpacks to more than/);
    const cwd = await freshDir();
    const out = await extractArchive(big, cwd, { ...CHECKOUT_LIMITS, maxFileBytes: 1024 });
    expect(await list(cwd)).toEqual(["small.ts"]);
    expect(out.skipped).toBe(1);
  });
});

describe("checkoutRepository", () => {
  const input = async (taskId: string) => ({ businessId: t.businessId, agentId: t.workerId, sessionId: await openSessionRow(t, t.workerId, taskId), taskId });

  it("does nothing without a Code-tab repository", async () => {
    const { gateway, offline } = githubGateway();
    const r = await checkoutRepository({ db: t.deps.db, gateway }, await input(t.codeTaskId), await freshDir());
    expect(r).toEqual({ status: "none", reason: "no repository is chosen on the Code tab" });
    expect(describeCheckout(r).text).toBe("No repository is chosen on the Code tab: this session starts from the code saved on this task only.");
    expect(offline.archives).toEqual([]);
  });

  it("checks out the task's branch when it exists, else the default branch, with a token for the archive alone", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });
    const { github, gateway, offline, ctx } = githubGateway();
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Checkout", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    const cwd = await freshDir();
    const first = await checkoutRepository({ db: t.deps.db, gateway }, await input(task.id), cwd);
    expect(first.status).toBe("checked_out");
    if (first.status !== "checked_out") return;
    expect(offline.archives.map((a) => a.ref)).toEqual([`agent/${task.id}`, "HEAD"]);
    expect(offline.minted.at(-1)).toMatchObject({ allowedTools: ["github:download_archive"] });
    expect(first.checkout.base).toMatchObject({ repo: "acme/shop", ref: "main" });
    expect(await list(cwd)).toEqual(["README.md", "package.json", "src/index.ts"]);
    expect(describeCheckout(first).text).toMatch(/^Checked out acme\/shop@main \(3 files, commit [0-9a-f]{7}\)\.$/);

    await github.callTool("commit_files", { owner: "acme", repo: "shop", branch: `agent/${task.id}`, message: "m", files: [{ path: "BRANCH.md", content: "on the branch\n" }] }, ctx);
    offline.archives.length = 0;
    const cwd2 = await freshDir();
    const second = await checkoutRepository({ db: t.deps.db, gateway }, await input(task.id), cwd2);
    expect(offline.archives.map((a) => a.ref)).toEqual([`agent/${task.id}`]);
    expect(second.status === "checked_out" && second.checkout.base.ref).toBe(`agent/${task.id}`);
    expect(await list(cwd2)).toContain("BRANCH.md");
  });

  it("names what a branch changed against the default branch: added, changed and removed files, and leaves no files behind", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });
    const { github, gateway, offline, ctx } = githubGateway();
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Compare", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    const branch = `agent/${task.id}`;
    await github.callTool("commit_files", { owner: "acme", repo: "shop", branch, message: "m", files: [{ path: "BRANCH.md", content: "on the branch\n" }, { path: "src/index.ts", content: "export const changed = true;\n" }], deletions: ["README.md"] }, ctx);
    const cwd = await freshDir();
    const checked = await checkoutRepository({ db: t.deps.db, gateway }, await input(task.id), cwd);
    expect(checked.status === "checked_out" && checked.checkout.base.ref).toBe(branch);
    if (checked.status !== "checked_out") return;
    offline.archives.length = 0;
    const tmpDir = await freshDir();
    const compared = await defaultBranchChanges({ db: t.deps.db, gateway }, await input(task.id), checked.checkout, CHECKOUT_LIMITS, { tmpDir });
    expect(compared).toMatchObject({ status: "compared", ref: "main", changed: ["BRANCH.md", "README.md", "src/index.ts"] });
    expect(offline.archives.map((a) => a.ref)).toEqual(["HEAD"]);
    expect(offline.minted.at(-1)).toMatchObject({ allowedTools: ["github:download_archive"] });
    // The default branch's tree was unpacked in a private temp directory and removed; the workspace is untouched.
    expect(await readdir(tmpDir)).toEqual([]);
    expect(await list(cwd)).toContain("BRANCH.md");

    // Without a repository, or when the gateway refuses, it says why and the tests fall back to every package.
    const denied = githubGateway(undefined, { archive: () => ({ outcome: "deny", reasons: ["paused agent"] }) });
    expect(await defaultBranchChanges({ db: t.deps.db, gateway: denied.gateway }, await input(task.id), checked.checkout)).toEqual({ status: "failed", reason: "refused by policy (paused agent)" });
  });

  it("fails with the reason when the gateway refuses, GitHub errs or the archive is unsafe", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop" } });
    const denied = githubGateway(undefined, { archive: () => ({ outcome: "deny", reasons: ["paused agent"] }) });
    const r1 = await checkoutRepository({ db: t.deps.db, gateway: denied.gateway }, await input(t.codeTaskId), await freshDir());
    expect(r1).toEqual({ status: "failed", repo: "acme/shop", reason: "refused by policy (paused agent)" });
    expect(describeCheckout(r1)).toEqual({ level: "warn", text: "Could not check out acme/shop: refused by policy (paused agent). This session starts from the code saved on this task only." });
    const erring = githubGateway(undefined, { archive: () => ({ outcome: "allow", error: { code: "vendor_error", message: "acme/shop is larger than 60 MB compressed; it cannot be checked out" } }) });
    expect(await checkoutRepository({ db: t.deps.db, gateway: erring.gateway }, await input(t.codeTaskId), await freshDir())).toMatchObject({ status: "failed", reason: "acme/shop is larger than 60 MB compressed; it cannot be checked out" });
    const evil = githubGateway(undefined, { archive: () => ({ outcome: "allow", archive: { ref: "main", sha: "b".repeat(40), data: new Uint8Array(archiveOf([{ path: "../../.bashrc", content: "curl evil" }])) } }) });
    expect(await checkoutRepository({ db: t.deps.db, gateway: evil.gateway }, await input(t.codeTaskId), await freshDir())).toMatchObject({ status: "failed", reason: expect.stringMatching(/unsafe path/) });
    const down: GatewayClient = { ...createOfflineGatewayClient(), async downloadArchive() { throw new Error("gateway unreachable"); } };
    expect(await checkoutRepository({ db: t.deps.db, gateway: down }, await input(t.codeTaskId), await freshDir())).toMatchObject({ status: "failed", reason: "gateway unreachable" });
  });

  it("waits its turn when the gateway's archive slots are taken, and gives up with the gateway's reason after the retries", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop" } });
    const busy = { outcome: "rate_limited" as const, reasons: ["3 repository archives are being served already; retry in 5s"], retryAfterSeconds: 5 };
    // Two refusals, then the archive: the checkout succeeds after two waits of the gateway's retry-after.
    let refusals = 2;
    const flaky = githubGateway(undefined, { archive: () => (refusals-- > 0 ? busy : null) });
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const r = await checkoutRepository({ db: t.deps.db, gateway: flaky.gateway }, await input(t.codeTaskId), await freshDir(), CHECKOUT_LIMITS, { sleep });
    expect(r.status).toBe("checked_out");
    expect(waits).toEqual([5_000, 5_000]);
    expect(flaky.offline.archives.map((a) => a.ref)).toEqual([`agent/${t.codeTaskId}`, `agent/${t.codeTaskId}`, `agent/${t.codeTaskId}`, "HEAD"]);

    // A retry-after shorter than the floor waits the floor; a long one is capped.
    const short = { ...busy, retryAfterSeconds: 1 };
    const long = { ...busy, retryAfterSeconds: 120 };
    const answers = [short, long];
    const paced = githubGateway(undefined, { archive: () => answers.shift() ?? null });
    waits.length = 0;
    expect((await checkoutRepository({ db: t.deps.db, gateway: paced.gateway }, await input(t.codeTaskId), await freshDir(), CHECKOUT_LIMITS, { sleep })).status).toBe("checked_out");
    expect(waits).toEqual([CHECKOUT_BUSY_WAIT_MS, 15_000]);

    // Refused every time: the checkout fails with the count, the time waited and the gateway's own words, never "GitHub's rate limit".
    const always = githubGateway(undefined, { archive: () => busy });
    waits.length = 0;
    const gaveUp = await checkoutRepository({ db: t.deps.db, gateway: always.gateway }, await input(t.codeTaskId), await freshDir(), CHECKOUT_LIMITS, { sleep });
    expect(gaveUp).toEqual({ status: "failed", repo: "acme/shop", reason: `the gateway refused the archive ${CHECKOUT_BUSY_RETRIES + 1} times over ${(CHECKOUT_BUSY_RETRIES * 5_000) / 1000} s (3 repository archives are being served already; retry in 5s)` });
    expect(waits).toHaveLength(CHECKOUT_BUSY_RETRIES);
    expect(describeCheckout(gaveUp).text).toMatch(/^Could not check out acme\/shop: the gateway refused the archive/);
  });
});

describe("saving and pushing a checkout: only the diff", () => {
  it("saves and pushes only what changed against the checkout (unchanged files are not sent; deleted base files are), and the next session starts from the branch", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });
    const { github, gateway, offline, ctx } = githubGateway();
    // The repository has more on main than starter files: commit them as a fixture of the repository itself.
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Diff", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    const sessionId = await openSessionRow(t, t.workerId, task.id);
    const cwd = await freshDir();
    const checked = await checkoutRepository({ db: t.deps.db, gateway }, { businessId: t.businessId, agentId: t.workerId, sessionId, taskId: task.id }, cwd);
    if (checked.status !== "checked_out") throw new Error(`no checkout: ${JSON.stringify(checked)}`);
    // The agent changes one file, adds one, deletes one and leaves README.md alone.
    await writeFile(path.join(cwd, "src", "index.ts"), "export const v = 2;\n");
    await mkdir(path.join(cwd, "src", "lib"), { recursive: true });
    await writeFile(path.join(cwd, "src", "lib", "new.ts"), "export {};\n");
    await unlink(path.join(cwd, "package.json"));
    await mkdir(path.join(cwd, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(cwd, ".github", "workflows", "ci.yml"), "on: push\n");

    const changes = await readWorkspaceChanges(cwd, checked.checkout.base.files);
    expect(changes.files.map((f) => [f.rel, f.inBase])).toEqual([[".github/workflows/ci.yml", false], ["src/index.ts", true], ["src/lib/new.ts", false]]);
    expect(changes.removed).toEqual(["package.json"]);
    expect(changes.unchanged).toBe(1);

    const owner = { businessId: t.businessId, taskId: task.id, sessionId, agentId: t.workerId, branch: `agent/${task.id}` };
    const saved = await saveWorkspace(t.db, owner, cwd, { base: checked.checkout.base });
    expect(saved).toMatchObject({ status: "saved", files: 3, added: 2, changed: 1, removed: 1 });
    if (saved.status === "refused" || !saved.snapshot) throw new Error("not saved");
    expect(saved.snapshot.files.map((f) => f.path)).toEqual([".github/workflows/ci.yml", "src/index.ts", "src/lib/new.ts"]);
    expect(saved.snapshot).toMatchObject({ baseRepo: "acme/shop", baseRef: "main", baseCommitSha: checked.checkout.base.commitSha, removedPaths: ["package.json"] });

    const pushed = await pushWorkspace(t.db, gateway, { ...owner, agentName: "Worker", holdBack: null }, saved.snapshot);
    expect(pushed).toMatchObject({ status: "pushed", filesWritten: 2, filesDeleted: 1, leftOut: 1 });
    const commit = offline.calls.find((c) => c.tool === "commit_files")!;
    expect((commit.args.files as { path: string }[]).map((f) => f.path)).toEqual(["src/index.ts", "src/lib/new.ts"]);
    expect(commit.args).toMatchObject({ deletions: ["package.json"], fromRef: checked.checkout.base.commitSha, branch: `agent/${task.id}` });
    const tree = await github.callTool("read_tree", { owner: "acme", repo: "shop", ref: `agent/${task.id}`, recursive: true }, ctx);
    const paths = (isUntrusted(tree.data) ? (tree.data.content as { entries: { path: string; type: string }[] }).entries : []).filter((e) => e.type === "blob").map((e) => e.path);
    expect(paths.sort()).toEqual(["README.md", "src/index.ts", "src/lib/new.ts"]);

    // The next session checks out the pushed branch and applies the saved diff on top: the same tree, nothing to push.
    const next = await freshDir();
    const again = await checkoutRepository({ db: t.deps.db, gateway }, { businessId: t.businessId, agentId: t.workerId, sessionId: await openSessionRow(t, t.workerId, task.id), taskId: task.id }, next);
    if (again.status !== "checked_out") throw new Error("no second checkout");
    expect(again.checkout.base.ref).toBe(`agent/${task.id}`);
    const restored = await restoreWorkspace(t.db, t.businessId, task.id, next, undefined, undefined, { checkout: true });
    expect(restored).toMatchObject({ files: 3, removed: 0 });
    expect(await list(next)).toEqual([".github/workflows/ci.yml", "README.md", "src/index.ts", "src/lib/new.ts"]);
    expect(await readFile(path.join(next, "src", "index.ts"), "utf8")).toBe("export const v = 2;\n");
  });

  it("restores a diff over a checkout of the default branch: changed files replaced, deleted ones removed again", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop" } });
    const { gateway } = githubGateway();
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Restore", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    const sid = await openSessionRow(t, t.workerId, task.id);
    const cwd = await freshDir();
    const checked = await checkoutRepository({ db: t.deps.db, gateway }, { businessId: t.businessId, agentId: t.workerId, sessionId: sid, taskId: task.id }, cwd);
    if (checked.status !== "checked_out") throw new Error("no checkout");
    await writeFile(path.join(cwd, "README.md"), "# changed\n");
    await unlink(path.join(cwd, "src", "index.ts"));
    await saveWorkspace(t.db, { businessId: t.businessId, taskId: task.id, sessionId: sid, agentId: t.workerId, branch: `agent/${task.id}` }, cwd, { base: checked.checkout.base });
    // Pushing is off, so the next session checks out main again.
    const next = await freshDir();
    const again = await checkoutRepository({ db: t.deps.db, gateway }, { businessId: t.businessId, agentId: t.workerId, sessionId: await openSessionRow(t, t.workerId, task.id), taskId: task.id }, next);
    expect(again.status === "checked_out" && again.checkout.base.ref).toBe("main");
    expect(await restoreWorkspace(t.db, t.businessId, task.id, next, undefined, undefined, { checkout: true })).toMatchObject({ files: 1, removed: 1 });
    expect(await list(next)).toEqual(["README.md", "package.json"]);
    expect(await readFile(path.join(next, "README.md"), "utf8")).toBe("# changed\n");
  });

  it("keeps credential-shaped values the repository already holds, and masks new ones and the session's own secrets", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop" } });
    const known = "sk_live_51Hx8ZkLq9mN0pQrStUvWxYz";
    const fresh = "sk_live_99Zz8ZkLq9mN0pQrStUvWxAb";
    const github = createGithubMock();
    await github.callTool("commit_files", { owner: "acme", repo: "shop", branch: "agent/seed", message: "m", files: [{ path: "test/fixture.ts", content: `export const key = '${known}';\n` }] }, makeToolContext(github));
    const { gateway } = githubGateway(github, {});
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Secrets", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    const sid = await openSessionRow(t, t.workerId, task.id);
    const cwd = await freshDir();
    // Check out the seeded branch (as if it were the task's) by asking for it directly.
    const res = await gateway.downloadArchive("t", { owner: "acme", repo: "shop", ref: "agent/seed" });
    if (!("archive" in res) || !("data" in res.archive)) throw new Error("no archive");
    const extracted = await extractArchive(res.archive.data, cwd);
    const base = { repo: "acme/shop", ref: "agent/seed", commitSha: res.archive.sha, files: extracted.files, knownSecrets: extracted.knownSecrets, packageScripts: extracted.packageScripts, checkedOutAt: new Date() };
    const sessionKey = "fm-session-token-" + "s".repeat(40);
    await writeFile(path.join(cwd, "test", "fixture.ts"), `export const key = '${known}';\nexport const other = '${fresh}';\nexport const mine = '${sessionKey}';\n`);
    const saved = await saveWorkspace(t.db, { businessId: t.businessId, taskId: task.id, sessionId: sid, agentId: t.workerId, branch: `agent/${task.id}` }, cwd, { base, secrets: [sessionKey] });
    if (saved.status === "refused" || !saved.snapshot) throw new Error("not saved");
    const [file] = await repos.workspaces.readFiles(t.db, t.businessId, saved.snapshot, ["test/fixture.ts"]);
    const text = new TextDecoder().decode(file!.content);
    expect(text).toContain(known);
    expect(text).not.toContain(fresh);
    expect(text).not.toContain(sessionKey);
    expect(text).toContain("[redacted:value.stripe_secret]");
    expect(text).toContain("[redacted:session-secret]");
  });

  it("keeps a repository value only in the file that held it: a .env value or a fixture value copied into notes.md is masked", async () => {
    const fixture = "sk_live_51Hx8ZkLq9mN0pQrStUvWxYz";
    const dotenv = "sk_live_77Ab8ZkLq9mN0pQrStUvWxYz";
    const archive = archiveOf([
      { path: "test/fixture.ts", content: `export const key = '${fixture}';\n` },
      { path: ".env", content: `STRIPE_SECRET_KEY=${dotenv}\n` },
      { path: "notes.md", content: "# Notes\n" },
    ]);
    const cwd = await freshDir();
    const extracted = await extractArchive(archive, cwd);
    expect([...extracted.knownSecrets.keys()]).toEqual(["test/fixture.ts"]);
    const base = { repo: "acme/shop", ref: "main", commitSha: "c".repeat(40), files: extracted.files, knownSecrets: extracted.knownSecrets, packageScripts: extracted.packageScripts, checkedOutAt: new Date() };
    // The fixture changes around its unchanged value; notes.md gets both values pasted in.
    await writeFile(path.join(cwd, "test", "fixture.ts"), `export const key = '${fixture}';\nexport const more = 1;\n`);
    await writeFile(path.join(cwd, "notes.md"), `# Notes\nlive key: ${dotenv}\nfixture key: ${fixture}\n`);
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Copied secrets", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    const sid = await openSessionRow(t, t.workerId, task.id);
    const saved = await saveWorkspace(t.db, { businessId: t.businessId, taskId: task.id, sessionId: sid, agentId: t.workerId, branch: `agent/${task.id}` }, cwd, { base });
    if (saved.status === "refused" || !saved.snapshot) throw new Error("not saved");
    expect(saved.masked).toEqual(["notes.md"]);
    const files = await repos.workspaces.readFiles(t.db, t.businessId, saved.snapshot, ["notes.md", "test/fixture.ts"]);
    const byPath = new Map(files.map((f) => [f.path, new TextDecoder().decode(f.content)] as const));
    expect(byPath.get("test/fixture.ts")).toContain(fixture);
    expect(byPath.get("notes.md")).not.toContain(dotenv);
    expect(byPath.get("notes.md")).not.toContain(fixture);
    expect(byPath.get("notes.md")).toBe("# Notes\nlive key: [redacted:value.stripe_secret]\nfixture key: [redacted:value.stripe_secret]\n");
    // .env itself is never saved.
    expect(saved.leftOut).toEqual([]);
  });
});

describe("testSetupChanges", () => {
  const base = (scripts: Record<string, string>) => ({ packageScripts: new Map([["package.json", packageTestSettings(JSON.stringify({ name: "shop", scripts }))]]) });
  const file = (rel: string, content: string, inBase = true) => ({ rel, content: new TextEncoder().encode(content), inBase });

  it("flags package.json scripts, test runner configs and deleted or renamed test files; nothing else", () => {
    const b = base({ test: "vitest run", build: "tsc" });
    expect(testSetupChanges({ files: [file("src/a.ts", "x"), file("package.json", JSON.stringify({ name: "shop2", version: "2.0.0", scripts: { build: "tsc", test: "vitest run" } }))], removed: ["docs/old.md"] }, b)).toEqual([]);
    expect(
      testSetupChanges(
        {
          files: [file("package.json", JSON.stringify({ scripts: { test: "exit 0", build: "tsc" } })), file("vitest.config.ts", "export default {}"), file("apps/web/playwright.config.ts", "x", false), file("packages/x/package.json", "{}", false)],
          removed: ["src/__tests__/pricing.test.ts", "tests/e2e.ts", "jest.config.js", "src/lib/math.spec.tsx", "src/lib/math.ts"],
        },
        b,
      ),
    ).toEqual(["package.json (scripts changed)", "vitest.config.ts (changed)", "apps/web/playwright.config.ts (added)", "src/__tests__/pricing.test.ts (deleted or renamed)", "tests/e2e.ts (deleted or renamed)", "jest.config.js (deleted)", "src/lib/math.spec.tsx (deleted or renamed)"]);
    expect(testSetupChanges({ files: [], removed: ["package.json"] }, b)).toEqual(["package.json (deleted)"]);
    expect(isTestRunnerConfig("vitest.workspace.ts")).toBe(true);
    expect(isTestRunnerConfig("vite.config.ts")).toBe(false);
    expect(isTestFile("src/index.ts")).toBe(false);
  });

  it("tells the agent not to rebuild a repository it could not check out", () => {
    expect(checkoutMissingNote("refused by policy (agent paused)")).toBe("The repository could not be checked out (refused by policy (agent paused)); do not recreate repository files from memory; block the task with block_task if you need them.");
  });

  it("says why the task waits for review", () => {
    expect(testSetupReviewReason(["vitest.config.ts (changed)"])).toBe("this session changed how the tests run, so passing tests do not show the task is done (vitest.config.ts (changed))");
  });
});

describe("the checkout's archive file", () => {
  it("is kept in a private temp directory outside the workspace and removed by disposeCheckout; a failed checkout leaves none", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop" } });
    const tmpDir = await freshDir();
    const cwd = await freshDir();
    const { gateway } = githubGateway();
    const sid = await openSessionRow(t, t.workerId, t.codeTaskId);
    const r = await checkoutRepository({ db: t.deps.db, gateway }, { businessId: t.businessId, agentId: t.workerId, sessionId: sid, taskId: t.codeTaskId }, cwd, CHECKOUT_LIMITS, { tmpDir });
    if (r.status !== "checked_out") throw new Error("no checkout");
    expect(r.checkout).not.toHaveProperty("archive");
    expect(path.dirname(path.dirname(r.checkout.archivePath))).toBe(tmpDir);
    expect(r.checkout.archivePath.startsWith(cwd)).toBe(false);
    const st = await stat(r.checkout.archivePath);
    expect(st.size).toBe(r.checkout.archiveBytes);
    expect(st.mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(r.checkout.archivePath))).mode & 0o777).toBe(0o700);
    // Extracting again from the file gives the same base.
    const again = await extractArchive(r.checkout.archivePath, await freshDir());
    expect(again.files).toEqual(r.checkout.base.files);
    await disposeCheckout(r.checkout);
    expect(await readdir(tmpDir)).toEqual([]);
    await disposeCheckout(r.checkout);

    const evil = githubGateway(undefined, { archive: () => ({ outcome: "allow", archive: { ref: "main", sha: "b".repeat(40), data: new Uint8Array(archiveOf([{ path: "../../.bashrc", content: "curl evil" }])) } }) });
    expect((await checkoutRepository({ db: t.deps.db, gateway: evil.gateway }, { businessId: t.businessId, agentId: t.workerId, sessionId: sid, taskId: t.codeTaskId }, await freshDir(), CHECKOUT_LIMITS, { tmpDir })).status).toBe("failed");
    expect(await readdir(tmpDir)).toEqual([]);
  });

  it("is streamed into the file by a client that supports it", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop" } });
    const tarball = archiveOf([{ path: "a.ts", content: "a" }]);
    const offline = createOfflineGatewayClient();
    const asked: (string | undefined)[] = [];
    const gateway: GatewayClient = {
      ...offline,
      async downloadArchive(_token, _req, opts) {
        asked.push(opts?.file);
        await writeFile(opts!.file!, tarball, { mode: 0o600, flag: "wx" });
        return { outcome: "allow", archive: { ref: "main", sha: "d".repeat(40), file: opts!.file!, bytes: tarball.byteLength } };
      },
    };
    const tmpDir = await freshDir();
    const cwd = await freshDir();
    const r = await checkoutRepository({ db: t.deps.db, gateway }, { businessId: t.businessId, agentId: t.workerId, sessionId: await openSessionRow(t, t.workerId, t.codeTaskId), taskId: t.codeTaskId }, cwd, CHECKOUT_LIMITS, { tmpDir });
    if (r.status !== "checked_out") throw new Error(`no checkout: ${JSON.stringify(r)}`);
    expect(asked).toEqual([r.checkout.archivePath]);
    expect(await list(cwd)).toEqual(["a.ts"]);
    await disposeCheckout(r.checkout);
  });
});

describe("syncCheckoutToSandbox", () => {
  const sandbox = (code = 0) => {
    const writes = new Map<string, Uint8Array | string>();
    const execs: string[] = [];
    return { writes, execs, workdir: "/home/user/work", async writeFile(p: string, c: Uint8Array | string) { writes.set(p, c); }, async exec(cmd: string) { execs.push(cmd); return { code: cmd.startsWith("mkdir") ? code : 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 }; } };
  };

  it("uploads the archive once, unpacks it in the workdir, then writes only the changes and removes deleted files", async () => {
    const archive = archiveOf([{ path: "a.ts", content: "a" }, { path: "b.ts", content: "b" }, { path: "c.ts", content: "c" }]);
    const cwd = await freshDir();
    const ex = await extractArchive(archive, cwd);
    await writeFile(path.join(cwd, "a.ts"), "A");
    await unlink(path.join(cwd, "b.ts"));
    await writeFile(path.join(cwd, "d.ts"), "d");
    const sb = sandbox();
    const r = await syncCheckoutToSandbox(cwd, sb as never, { archive, files: ex.files });
    expect(r).toMatchObject({ unpacked: true, changed: 2, removed: 1, refused: null, files: 3 });
    expect([...sb.writes.keys()].sort()).toEqual(["/tmp/fm-checkout.tgz", "a.ts", "d.ts"]);
    expect(sb.execs[0]).toBe("mkdir -p /home/user/work && tar -xzf /tmp/fm-checkout.tgz -C /home/user/work --strip-components=1 --no-same-owner --exclude=node_modules --exclude=.git && rm -f /tmp/fm-checkout.tgz");
    // Every link the archive carried is gone before anything is written or removed there.
    expect(sb.execs[1]).toBe(`if [ -d /home/user/work ]; then find /home/user/work -type l -delete && test -z "$(find /home/user/work -type l -print -quit)"; fi`);
    expect(sb.execs[2]).toBe("rm -f -- b.ts");
  });

  it("removes the links an archive unpacked before writing through them, and refuses when they cannot be removed (a real shell and tar)", async () => {
    const { execFile } = await import("node:child_process");
    const run = (cmd: string, cwd = "/") => new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean; durationMs: number }>((resolve) => execFile("sh", ["-c", cmd], { cwd }, (err, stdout, stderr) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr, timedOut: false, durationMs: 1 })));
    const outside = await freshDir();
    const workdir = path.join(await freshDir(), "work dir");
    // An archive whose `src` is a link out of the workdir: a later write of src/index.ts would land outside.
    const archive = archiveOf([{ path: "src", type: "symlink", linkTarget: outside }, { path: "README.md", content: "r" }, { path: "lib", type: "symlink", linkTarget: "../.." }]);
    const cwd = await freshDir();
    await extractArchive(archive, cwd);
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "index.ts"), "export {};\n");
    const archivePath = path.join(await freshDir(), "archive.tgz");
    await writeFile(archivePath, archive);
    const sandboxRoot = await freshDir();
    const real = {
      workdir,
      async writeFile(p: string, c: Uint8Array | string) {
        const abs = p.startsWith("/tmp/fm-checkout") ? path.join(sandboxRoot, path.basename(p)) : path.join(workdir, p);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, c);
      },
      async exec(cmd: string) {
        return run(cmd.split("/tmp/fm-checkout.tgz").join(path.join(sandboxRoot, "fm-checkout.tgz")));
      },
    };
    const r = await syncCheckoutToSandbox(cwd, real as never, { archive: archivePath, files: (await extractArchive(archive, await freshDir())).files });
    expect(r).toMatchObject({ unpacked: true, changed: 1, refused: null });
    expect(await readdir(outside)).toEqual([]);
    expect((await lstat(path.join(workdir, "src"))).isDirectory()).toBe(true);
    expect(await readFile(path.join(workdir, "src", "index.ts"), "utf8")).toBe("export {};\n");
    await expect(lstat(path.join(workdir, "lib"))).rejects.toThrow();

    const stuck = { ...sandbox(), async exec(cmd: string) { return { code: cmd.startsWith("if [ -d") ? 1 : 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 }; } };
    await expect(syncCheckoutToSandbox(cwd, stuck as never, { archive: archivePath, files: new Map() })).rejects.toThrow(/symbolic links .* could not be removed/);
    expect([...stuck.writes.keys()]).toEqual(["/tmp/fm-checkout.tgz"]);
    expect(removeSandboxLinksCommand("/w d")).toBe(`if [ -d '/w d' ]; then find '/w d' -type l -delete && test -z "$(find '/w d' -type l -print -quit)"; fi`);
  });

  it("uploads an archive file in parts, joined in the sandbox, never reading it whole", async () => {
    const archive = archiveOf(Array.from({ length: 30 }, (_, i) => ({ path: `f${i}.bin`, content: Buffer.from(Array.from({ length: 700 }, (_, j) => (i * 31 + j * 7) % 251)) })));
    const archivePath = path.join(await freshDir(), "archive.tgz");
    await writeFile(archivePath, archive);
    const cwd = await freshDir();
    const ex = await extractArchive(archivePath, cwd);
    const sb = sandbox();
    const chunk = Math.ceil(archive.byteLength / 3);
    const r = await syncCheckoutToSandbox(cwd, sb as never, { archive: archivePath, files: ex.files }, undefined, chunk);
    expect(r).toMatchObject({ unpacked: true, changed: 0, bytes: archive.byteLength });
    const parts = [...sb.writes.keys()];
    expect(parts).toEqual(["/tmp/fm-checkout.tgz.part-0000", "/tmp/fm-checkout.tgz.part-0001", "/tmp/fm-checkout.tgz.part-0002"]);
    expect(Buffer.concat(parts.map((p) => Buffer.from(sb.writes.get(p) as Uint8Array)))).toEqual(archive);
    expect(parts.every((p) => (sb.writes.get(p) as Uint8Array).byteLength <= chunk)).toBe(true);
    expect(sb.execs[0]).toBe(`cat ${parts.join(" ")} > /tmp/fm-checkout.tgz && rm -f -- ${parts.join(" ")}`);
    expect(sb.execs[1]).toMatch(/^mkdir -p \/home\/user\/work && tar -xzf \/tmp\/fm-checkout\.tgz/);
  });

  it("copies the whole workspace when the sandbox cannot unpack, and refuses changes over the limits", async () => {
    const archive = archiveOf([{ path: "a.ts", content: "a" }]);
    const cwd = await freshDir();
    const ex = await extractArchive(archive, cwd);
    await writeFile(path.join(cwd, "b.ts"), "b");
    const sb = sandbox(2);
    const r = await syncCheckoutToSandbox(cwd, sb as never, { archive, files: ex.files });
    expect(r).toMatchObject({ unpacked: false, files: 2, refused: null });
    expect([...sb.writes.keys()].sort()).toEqual(["/tmp/fm-checkout.tgz", "a.ts", "b.ts"]);
    const refused = await syncCheckoutToSandbox(cwd, sandbox() as never, { archive, files: ex.files }, { maxFiles: 1, maxFileBytes: 1024, maxTotalBytes: 1024, concurrency: 1 });
    expect(refused.refused).toBe("the workspace has more than 1 files");
  });
});
