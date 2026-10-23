/**
 * Real checkouts (activities/checkout.ts, founder decision 2, 2026-10-23): a code session starts from the Code-tab
 * repository's archive (the task's branch, else the default branch), extracted safely; the save keeps only the diff
 * against it and the push sends only that diff; anything that goes wrong starts the session as before.
 */
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGithubMock } from "@foundmill/connectors/connectors/github/mock";
import { writeTarGz, type TarWriteEntry } from "@foundmill/connectors/connectors/github/tarball";
import { makeToolContext } from "@foundmill/connectors/testing/contract-suite";
import { isUntrusted } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CHECKOUT_LIMITS, checkoutRepository, describeCheckout, extractArchive } from "../activities/checkout";
import { pushWorkspace } from "../activities/workspace-push";
import { restoreWorkspace, saveWorkspace } from "../activities/workspace-store";
import { readWorkspaceChanges, syncCheckoutToSandbox } from "../activities/workspace-sync";
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
      const out = (isUntrusted(r.data) ? r.data.content : r.data) as { ref: string; sha: string; base64: string };
      return { outcome: "allow", archive: { ref: out.ref, sha: out.sha, data: new Uint8Array(Buffer.from(out.base64, "base64")) } };
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
    expect(await list(cwd)).toEqual(["docs/CONTACT.md", "package.json", "src/index.ts", "test/fixture.ts"]);
    expect([...out.files.keys()].sort()).toEqual(["docs/CONTACT.md", "package.json", "src/index.ts", "test/fixture.ts"]);
    expect(out.files.get("package.json")).toMatch(/^[0-9a-f]{64}$/);
    expect(out.skipped).toBe(9);
    expect([...out.recipients.emails]).toEqual(["ops@shop.example"]);
    expect([...out.recipients.urls]).toContain("https://shop.example/help");
    expect([...out.knownSecrets]).toEqual(["sk_live_51Hx8ZkLq9mN0pQrStUvWxYz"]);
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
    if (!("archive" in res)) throw new Error("no archive");
    const extracted = await extractArchive(res.archive.data, cwd);
    const base = { repo: "acme/shop", ref: "agent/seed", commitSha: res.archive.sha, files: extracted.files, knownSecrets: extracted.knownSecrets };
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
    expect(sb.execs[1]).toBe("rm -f -- b.ts");
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
