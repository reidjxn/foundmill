/**
 * Saved code goes to GitHub (activities/workspace-push.ts): pushed through the gateway with commit_files once the founder
 * turned pushing on, only what changed since the last pushed save, one commit per finished session, never .github, the
 * outcome recorded on the save. The gateway here is a
 * stand-in that runs the real GitHub mock connector, so branch contents can be read back.
 */
import { createGithubMock } from "@foundmill/connectors/connectors/github/mock";
import { makeToolContext } from "@foundmill/connectors/testing/contract-suite";
import { repos, type WorkspaceSnapshot } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commitShaOf, describePush, pushWorkspace, type PushContext } from "../activities/workspace-push";
import { createOfflineGatewayClient, type GatewayCallRequest, type GatewayCallResponse, type GatewayClient } from "../gateway-client";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "push" });
});
afterAll(() => t?.close());

const text = (s: string) => new TextEncoder().encode(s);

/** A gateway that answers commit_files with the GitHub mock connector, or with `override` when given. */
function githubGateway(override?: (req: GatewayCallRequest) => GatewayCallResponse | null) {
  const github = createGithubMock();
  const offline = createOfflineGatewayClient();
  const gateway: GatewayClient = {
    ...offline,
    async call(token, req) {
      offline.calls.push(req);
      const forced = override?.(req);
      if (forced) return forced;
      const result = await github.callTool(req.tool, req.args, makeToolContext(github));
      return { outcome: "allow", result, costMinor: 0 };
    },
  };
  const readFile = async (path: string, ref: string) => {
    const r = await github.callTool("read_file", { owner: "acme", repo: "shop", path, ref }, makeToolContext(github));
    return r.ok ? ((r.data as { content: { content: string } }).content.content as string) : null;
  };
  return { gateway, offline, readFile };
}

async function save(taskId: string, files: Record<string, string>): Promise<WorkspaceSnapshot> {
  const r = await t.deps.db.transaction((tx) => repos.workspaces.save(tx as never, t.businessId, { taskId, files: Object.entries(files).map(([path, c]) => ({ path, content: text(c) })) }));
  return r.snapshot!;
}

describe("pushWorkspace", () => {
  it("skips when GitHub is not connected or no repository is chosen", async () => {
    const { gateway, offline } = githubGateway();
    const ctx: PushContext = { businessId: t.businessId, taskId: t.codeTaskId, sessionId: await openSessionRow(t, t.workerId, t.codeTaskId), agentId: t.workerId, branch: `agent/${t.codeTaskId}`, agentName: "Worker", holdBack: null };
    const snapshot = await save(t.codeTaskId, { "a.ts": "1" });
    expect(await pushWorkspace(t.deps.db, gateway, ctx, snapshot)).toEqual({ status: "skipped", reason: "connect GitHub and choose a repository on the Code tab" });
    expect(offline.calls).toEqual([]);
    expect(describePush({ status: "skipped", reason: "x" })?.text).toBe("Not pushed to GitHub: x. The code is saved on the Code tab.");
  });

  it("pushes the first save whole, then only what changed, one commit per session, and records each", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });
    const taskId = t.fixture.taskIds[0]!;
    const { gateway, offline, readFile } = githubGateway();
    const ctx = (sessionId: string): PushContext => ({ businessId: t.businessId, taskId, sessionId, agentId: t.workerId, branch: `agent/${taskId}`, agentName: "Worker", holdBack: null });

    const first = await save(taskId, { "src/verify.ts": "v1", "README.md": "# Notes", "old.txt": "old" });
    const s1 = await openSessionRow(t, t.workerId, taskId);
    const one = await pushWorkspace(t.deps.db, gateway, ctx(s1), first);
    expect(one).toMatchObject({ status: "pushed", repo: "acme/shop", branch: `agent/${taskId}`, filesWritten: 3, filesDeleted: 0 });
    expect(offline.minted.at(-1)).toMatchObject({ allowedTools: ["github:commit_files"], ttlSeconds: 300, sessionId: s1, agentId: t.workerId });
    const call = offline.calls.at(-1)!;
    expect(call).toMatchObject({ connector: "github", tool: "commit_files", args: { owner: "acme", repo: "shop", branch: `agent/${taskId}`, deletions: [] } });
    // No task title (the founder's words stay here), and CI does not run on agent code.
    expect(call.args.message).toBe(`Code saved by Worker at the end of a session (3 added, 0 changed, 0 removed)\n\nFoundmill task ${taskId}, session ${s1}.\n\n[skip ci]`);
    expect(await readFile("src/verify.ts", `agent/${taskId}`)).toBe("v1");
    expect((await repos.workspaces.getSnapshot(t.db, t.businessId, first.id))).toMatchObject({ pushedRepo: "acme/shop", pushedBranch: `agent/${taskId}`, pushedCommitSha: (one as { commitSha: string }).commitSha, pushError: null });

    const second = await save(taskId, { "src/verify.ts": "v2", "README.md": "# Notes", "src/dedupe.ts": "d" });
    const two = await pushWorkspace(t.deps.db, gateway, ctx(await openSessionRow(t, t.workerId, taskId)), second);
    expect(two).toMatchObject({ status: "pushed", filesWritten: 2, filesDeleted: 1 });
    const args = offline.calls.at(-1)!.args as { files: { path: string }[]; deletions: string[] };
    expect(args.files.map((f) => f.path).sort()).toEqual(["src/dedupe.ts", "src/verify.ts"]);
    expect(args.deletions).toEqual(["old.txt"]);
    expect(await readFile("src/verify.ts", `agent/${taskId}`)).toBe("v2");
    expect(await readFile("old.txt", `agent/${taskId}`)).toBeNull();
    expect(describePush(two)?.text).toMatch(new RegExp(`^Pushed to agent/${taskId} on acme/shop: 2 files written, 1 removed \\(commit [0-9a-f]{7}\\)\\.$`));

    // The same save again: nothing to send, no gateway call.
    const calls = offline.calls.length;
    const again = await pushWorkspace(t.deps.db, gateway, ctx(await openSessionRow(t, t.workerId, taskId)), (await repos.workspaces.getSnapshot(t.db, t.businessId, second.id))!);
    expect(again).toMatchObject({ status: "up_to_date" });
    expect(offline.calls.length).toBe(calls);
  });

  it("records a refusal, an approval wait or an error on the save, and the next push tries again", async () => {
    const taskId = t.fixture.taskIds[1]!;
    const ctx = async (): Promise<PushContext> => ({ businessId: t.businessId, taskId, sessionId: await openSessionRow(t, t.workerId, taskId), agentId: t.workerId, branch: `agent/${taskId}`, agentName: "Worker", holdBack: null });
    const snapshot = await save(taskId, { "page.tsx": "x" });

    const denied = await pushWorkspace(t.deps.db, githubGateway(() => ({ outcome: "deny", reasons: ["paused agent"] })).gateway, await ctx(), snapshot);
    expect(denied).toEqual({ status: "failed", repo: "acme/shop", branch: `agent/${taskId}`, reason: "refused by policy (paused agent)" });
    expect((await repos.workspaces.getSnapshot(t.db, t.businessId, snapshot.id))?.pushError).toBe("refused by policy (paused agent)");
    expect(describePush(denied)?.level).toBe("warn");

    const waiting = await pushWorkspace(t.deps.db, githubGateway(() => ({ outcome: "ask", approvalId: "a1" })).gateway, await ctx(), snapshot);
    expect(waiting).toMatchObject({ status: "awaiting_approval", approvalId: "a1" });

    const broken = githubGateway(() => ({ outcome: "allow", result: { ok: false, error: { code: "vendor_error", message: "Update is not a fast forward" } } }));
    expect(await pushWorkspace(t.deps.db, broken.gateway, await ctx(), snapshot)).toMatchObject({ status: "failed", reason: "Update is not a fast forward" });

    const throwing: GatewayClient = { ...createOfflineGatewayClient(), async mintSessionToken() { throw new Error("gateway unreachable"); } };
    expect(await pushWorkspace(t.deps.db, throwing, await ctx(), snapshot)).toMatchObject({ status: "failed", reason: "gateway unreachable" });

    const ok = await pushWorkspace(t.deps.db, githubGateway().gateway, await ctx(), (await repos.workspaces.getSnapshot(t.db, t.businessId, snapshot.id))!);
    expect(ok).toMatchObject({ status: "pushed", filesWritten: 1 });
    expect((await repos.workspaces.getSnapshot(t.db, t.businessId, snapshot.id))).toMatchObject({ pushError: null, pushedCommitSha: (ok as { commitSha: string }).commitSha });
  });

  it("does not push a session that was stopped, looped or failed, a branch that is not the task's, or more than one push carries", async () => {
    const taskId = t.fixture.taskIds[3] ?? t.codeTaskId;
    const { gateway, offline } = githubGateway();
    const snapshot = await save(taskId, { "a.ts": "1" });
    const ctx = async (extra: Partial<PushContext> = {}): Promise<PushContext> => ({ businessId: t.businessId, taskId, sessionId: await openSessionRow(t, t.workerId, taskId), agentId: t.workerId, branch: `agent/${taskId}`, agentName: "Worker", holdBack: null, ...extra });
    expect(await pushWorkspace(t.deps.db, gateway, await ctx({ holdBack: "the session was stopped" }), snapshot)).toEqual({ status: "skipped", reason: "the session was stopped" });
    expect(describePush({ status: "skipped", reason: "the session was stopped" })?.text).toBe("Not pushed to GitHub: the session was stopped. The code is saved on the Code tab.");
    expect(await pushWorkspace(t.deps.db, gateway, await ctx({ branch: "main" }), snapshot)).toEqual({ status: "skipped", reason: "main is not this task's branch" });
    expect(offline.calls).toEqual([]);

    const many = await save(taskId, Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`src/f${i}.ts`, `export const v = ${i};`])));
    expect(await pushWorkspace(t.deps.db, gateway, await ctx(), many)).toMatchObject({ status: "failed", reason: "301 changed files (0.0 MB) are more than one push carries (300 files, 10 MB)" });
    expect(offline.calls).toEqual([]);
  });

  it("never sends files under .github, and says so", async () => {
    const taskId = t.fixture.taskIds[4] ?? t.codeTaskId;
    const { gateway, offline, readFile } = githubGateway();
    const snapshot = await save(taskId, { "src/app.ts": "app", ".github/workflows/ci.yml": "on: push", ".github/actions/setup/action.yml": "runs: x" });
    const r = await pushWorkspace(t.deps.db, gateway, { businessId: t.businessId, taskId, sessionId: await openSessionRow(t, t.workerId, taskId), agentId: t.workerId, branch: `agent/${taskId}`, agentName: "Worker", holdBack: null }, snapshot);
    expect(r).toMatchObject({ status: "pushed", filesWritten: 1, leftOut: 2 });
    expect((offline.calls.at(-1)!.args as { files: { path: string }[] }).files.map((f) => f.path)).toEqual(["src/app.ts"]);
    expect(await readFile(".github/workflows/ci.yml", `agent/${taskId}`)).toBeNull();
    expect(describePush(r)?.text).toMatch(/2 files under \.github stayed here: agents never change a repository's workflows\.$/);
  });

  it("expects the branch at the last commit the task saw, and pushes nothing over a branch that moved (branch_moved)", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Moved", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    const branch = `agent/${task.id}`;
    // The repository's main as the mock serves it (deterministic per name): the commit the checkout saw.
    const head = await createOfflineGatewayClient().downloadArchive("t", { owner: "acme", repo: "shop", ref: "HEAD" });
    if (!("archive" in head)) throw new Error("no archive");
    const seen = head.archive.sha;
    const moved = "f".repeat(40);
    const onCheckout = async (files: Record<string, string>, sessionId: string) =>
      (await t.deps.db.transaction((tx) => repos.workspaces.save(tx as never, t.businessId, { taskId: task.id, sessionId, files: Object.entries(files).map(([path, c]) => ({ path, content: text(c), inBase: false })), base: { repo: "acme/shop", ref: branch, commitSha: seen }, removedPaths: [] }))).snapshot!;
    const ctx = (sessionId: string, extra: Partial<PushContext> = {}): PushContext => ({ businessId: t.businessId, taskId: task.id, sessionId, agentId: t.workerId, branch, agentName: "Worker", holdBack: null, ...extra });

    // GitHub says the branch head is elsewhere: nothing is written, the save says why, the note says what happens next.
    const s1 = await openSessionRow(t, t.workerId, task.id);
    const first = await onCheckout({ "src/a.ts": "1" }, s1);
    const refusing = githubGateway((req) => (req.tool === "commit_files" ? { outcome: "allow", result: { ok: false, error: { code: "branch_moved", message: `${branch} is at ${moved}`, details: { branch, expectedHeadSha: seen, currentHeadSha: moved } } } } : null));
    const r = await pushWorkspace(t.deps.db, refusing.gateway, ctx(s1), first);
    expect(refusing.offline.calls.at(-1)!.args).toMatchObject({ branch, fromRef: seen, expectedHeadSha: seen });
    expect(r).toEqual({ status: "moved", repo: "acme/shop", branch, headSha: moved });
    expect(seen).toMatch(/^[0-9a-f]{40}$/);
    expect(describePush(r)).toEqual({ level: "warn", text: `Not pushed: ${branch} moved since checkout (fffffff); the next session checks it out again.` });
    expect(await repos.workspaces.getSnapshot(t.db, t.businessId, first.id)).toMatchObject({ pushedCommitSha: null, pushError: `${branch} moved since checkout (fffffff); not pushed` });

    // The same save pushes once GitHub takes it: it expected the checkout's commit.
    const { gateway, offline } = githubGateway();
    const ok = await pushWorkspace(t.deps.db, gateway, ctx(s1), (await repos.workspaces.getSnapshot(t.db, t.businessId, first.id))!);
    expect(ok).toMatchObject({ status: "pushed" });
    expect(offline.calls.at(-1)!.args).toMatchObject({ expectedHeadSha: seen });
    const pushedSha = (ok as { commitSha: string }).commitSha;

    // A session that checked out the same commit before that push landed: the push from this task moved the branch,
    // so the last commit the task saw is the one it pushed.
    const s2 = await openSessionRow(t, t.workerId, task.id);
    const second = await onCheckout({ "src/a.ts": "2" }, s2);
    const before = new Date(Date.now() - 60_000);
    const two = await pushWorkspace(t.deps.db, gateway, ctx(s2, { checkout: { commitSha: seen, at: before } }), second);
    expect(offline.calls.at(-1)!.args).toMatchObject({ expectedHeadSha: pushedSha });
    expect(two).toMatchObject({ status: "pushed" });

    // A checkout taken after that push saw the branch where the checkout says.
    const s3 = await openSessionRow(t, t.workerId, task.id);
    const third = await onCheckout({ "src/a.ts": "3" }, s3);
    const three = await pushWorkspace(t.deps.db, gateway, ctx(s3, { checkout: { commitSha: seen, at: new Date(Date.now() + 60_000) } }), third);
    expect(offline.calls.at(-1)!.args).toMatchObject({ expectedHeadSha: seen });
    // The GitHub mock holds the branch at the second push: that checkout's diff is not written over it.
    expect(three).toEqual({ status: "moved", repo: "acme/shop", branch, headSha: (two as { commitSha: string }).commitSha });
    expect(await repos.workspaces.getSnapshot(t.db, t.businessId, third.id)).toMatchObject({ pushedCommitSha: null, pushError: expect.stringMatching(/moved since checkout/) });
  });

  it("goes on top of the commits the agent itself pushed to its branch during the session", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Own pushes", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    const branch = `agent/${task.id}`;
    const head = await createOfflineGatewayClient().downloadArchive("t", { owner: "acme", repo: "shop", ref: "HEAD" });
    if (!("archive" in head)) throw new Error("no archive");
    const seen = head.archive.sha;
    const { gateway, offline, readFile } = githubGateway();
    const sessionId = await openSessionRow(t, t.workerId, task.id);
    const ctx = (extra: Partial<PushContext> = {}): PushContext => ({ businessId: t.businessId, taskId: task.id, sessionId, agentId: t.workerId, branch, agentName: "Worker", holdBack: null, checkout: { commitSha: seen, at: new Date(Date.now() - 60_000) }, ...extra });
    const onCheckout = async (files: Record<string, string>) =>
      (await t.deps.db.transaction((tx) => repos.workspaces.save(tx as never, t.businessId, { taskId: task.id, sessionId, files: Object.entries(files).map(([path, c]) => ({ path, content: text(c), inBase: false })), base: { repo: "acme/shop", ref: branch, commitSha: seen }, removedPaths: [] }))).snapshot!;

    // The agent commits to its branch itself mid-session (engineers hold pulls.create, which carries commit_files).
    const own = await gateway.call("t", { connector: "github", tool: "commit_files", args: { owner: "acme", repo: "shop", branch, fromRef: seen, message: "agent's own commit", files: [{ path: "src/own.ts", content: "mine" }] } });
    const ownSha = (own.result as { data: { sha: string } }).data.sha;
    expect(ownSha).toMatch(/^[0-9a-f]{40}$/);
    expect(commitShaOf(JSON.stringify(own.result))).toBe(ownSha);
    expect(commitShaOf('{"ok":true,"data":{"committed":false}}')).toBeNull();

    // The session knows the head its agent pushed: the final push expects the branch there and lands.
    const first = await onCheckout({ "src/a.ts": "1", "src/own.ts": "mine" });
    const one = await pushWorkspace(t.deps.db, gateway, ctx({ agentPushed: { count: 1, lastSha: ownSha } }), first);
    expect(offline.calls.at(-1)!.args).toMatchObject({ expectedHeadSha: ownSha });
    expect(one).toMatchObject({ status: "pushed" });
    expect(await readFile("src/a.ts", branch)).toBe("1");
    const oneSha = (one as { commitSha: string }).commitSha;

    // The agent pushed again but the head was not read from the answer: the first try expects the last commit this task
    // saw, GitHub says the branch moved, and the push is retried once at the head it reports.
    const again = await gateway.call("t", { connector: "github", tool: "commit_files", args: { owner: "acme", repo: "shop", branch, message: "agent's second commit", files: [{ path: "src/own.ts", content: "mine 2" }] } });
    const againSha = (again.result as { data: { sha: string } }).data.sha;
    const s2 = await openSessionRow(t, t.workerId, task.id);
    const second = (await t.deps.db.transaction((tx) => repos.workspaces.save(tx as never, t.businessId, { taskId: task.id, sessionId: s2, files: [{ path: "src/a.ts", content: text("2"), inBase: false }], base: { repo: "acme/shop", ref: branch, commitSha: seen }, removedPaths: [] }))).snapshot!;
    const callsBefore = offline.calls.length;
    const two = await pushWorkspace(t.deps.db, gateway, ctx({ sessionId: s2, agentPushed: { count: 1, lastSha: null } }), second);
    expect(offline.calls.length - callsBefore).toBe(2);
    expect(offline.calls.at(-2)!.args).toMatchObject({ expectedHeadSha: oneSha });
    expect(offline.calls.at(-1)!.args).toMatchObject({ expectedHeadSha: againSha });
    expect(two).toMatchObject({ status: "pushed" });
    expect(await readFile("src/a.ts", branch)).toBe("2");

    // Without a push of its own, a moved branch is still not written over (the test above), and a second refusal at the
    // reported head is final: only one retry.
    const refusing = githubGateway((req) => (req.tool === "commit_files" ? { outcome: "allow", result: { ok: false, error: { code: "branch_moved", message: "moved", details: { branch, expectedHeadSha: seen, currentHeadSha: "a".repeat(40) } } } } : null));
    const s3 = await openSessionRow(t, t.workerId, task.id);
    const third = (await t.deps.db.transaction((tx) => repos.workspaces.save(tx as never, t.businessId, { taskId: task.id, sessionId: s3, files: [{ path: "src/a.ts", content: text("3"), inBase: false }], base: { repo: "acme/shop", ref: branch, commitSha: seen }, removedPaths: [] }))).snapshot!;
    const three = await pushWorkspace(t.deps.db, refusing.gateway, ctx({ sessionId: s3, agentPushed: { count: 2, lastSha: null } }), third);
    expect(refusing.offline.calls.filter((c) => c.tool === "commit_files")).toHaveLength(2);
    expect(three).toEqual({ status: "moved", repo: "acme/shop", branch, headSha: "a".repeat(40) });
  });

  it("rebuilds the branch on the default branch's commit when the save was made on a checkout of it (a handed-back task), expecting the branch where the task left it", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Handed back", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    const branch = `agent/${task.id}`;
    const { gateway, offline, readFile } = githubGateway();
    /** A read tool's data, out of the untrusted envelope when it is in one. */
    const unwrap = <T,>(result: unknown): T => {
      const data = (result as { data: unknown }).data;
      return (data && typeof data === "object" && "content" in data ? (data as { content: T }).content : (data as T));
    };
    const compare = async (head: string) => unwrap<{ baseSha: string; behindBy: number; aheadBy: number }>((await gateway.call("t", { connector: "github", tool: "compare_refs", args: { owner: "acme", repo: "shop", base: "HEAD", head } })).result);
    // The repository's main as the mock serves it (deterministic per name): the commit a checkout of the default branch sees.
    const head = await createOfflineGatewayClient().downloadArchive("t", { owner: "acme", repo: "shop", ref: "HEAD" });
    if (!("archive" in head)) throw new Error("no archive");
    const main = head.archive.sha;
    expect(main).toMatch(/^[0-9a-f]{40}$/);
    const saveOn = async (sessionId: string, ref: string, commitSha: string, files: Record<string, string>) =>
      (await t.deps.db.transaction((tx) => repos.workspaces.save(tx as never, t.businessId, { taskId: task.id, sessionId, files: Object.entries(files).map(([path, c]) => ({ path, content: text(c), inBase: false })), base: { repo: "acme/shop", ref, commitSha }, removedPaths: [] }))).snapshot!;
    const ctx = (sessionId: string, extra: Partial<PushContext> = {}): PushContext => ({ businessId: t.businessId, taskId: task.id, sessionId, agentId: t.workerId, branch, agentName: "Worker", holdBack: null, ...extra });

    // Session 1 on a checkout of the default branch: the branch does not exist and is created there (nothing to rebuild).
    const s1 = await openSessionRow(t, t.workerId, task.id);
    const one = await pushWorkspace(t.deps.db, gateway, ctx(s1), await saveOn(s1, "main", main, { "src/fix.ts": "v1", "scratch.txt": "left on the old branch" }));
    expect(one).toMatchObject({ status: "pushed", rebuilt: false, filesWritten: 2 });
    expect(offline.calls.at(-1)!.args).toMatchObject({ rebuild: true, fromRef: main });
    expect(offline.calls.at(-1)!.args).not.toHaveProperty("expectedHeadSha");
    const firstSha = (one as { commitSha: string }).commitSha;

    // Session 2 on a checkout of the branch itself: a commit on top, as always.
    const s2 = await openSessionRow(t, t.workerId, task.id);
    const two = await pushWorkspace(t.deps.db, gateway, ctx(s2, { checkout: { commitSha: firstSha, at: new Date() } }), await saveOn(s2, branch, firstSha, { "src/fix.ts": "v2" }));
    expect(two).toMatchObject({ status: "pushed", rebuilt: false });
    expect(offline.calls.at(-1)!.args).not.toHaveProperty("rebuild");
    expect(offline.calls.at(-1)!.args).toMatchObject({ expectedHeadSha: firstSha });
    const secondSha = (two as { commitSha: string }).commitSha;

    // The merge hands the task back; session 3 starts from the default branch's files with the saved change on top. The
    // save is a diff against main's commit, so the branch is rebuilt there: main's files plus the fix, and nothing the
    // old branch alone had; the push expected the branch at the task's last push, not at main.
    const s3 = await openSessionRow(t, t.workerId, task.id);
    const three = await pushWorkspace(t.deps.db, gateway, ctx(s3, { checkout: { commitSha: main, at: new Date() } }), await saveOn(s3, "main", main, { "src/fix.ts": "v3 on the newest main" }));
    expect(three).toMatchObject({ status: "pushed", rebuilt: true, filesWritten: 1 });
    const args = offline.calls.at(-1)!.args as { rebuild?: boolean; fromRef?: string; expectedHeadSha?: string; message: string };
    expect(args).toMatchObject({ rebuild: true, fromRef: main, expectedHeadSha: secondSha });
    expect(args.message).toContain(`Based on main at ${main.slice(0, 7)}.`);
    expect(await readFile("src/fix.ts", branch)).toBe("v3 on the newest main");
    expect(await readFile("scratch.txt", branch)).toBeNull();
    expect(describePush(three)?.text).toContain("The branch was rebuilt on the default branch's newest commit; its earlier commits are no longer its history.");
    expect(await compare(branch)).toMatchObject({ behindBy: 0, aheadBy: 1 });

    // The agent pushed to the old branch itself during the handed-back session: the rebuild still expects that head.
    const own = await gateway.call("t", { connector: "github", tool: "commit_files", args: { owner: "acme", repo: "shop", branch, message: "agent's own", files: [{ path: "src/own.ts", content: "mine" }] } });
    const ownSha = (own.result as { data: { sha: string } }).data.sha;
    const s4 = await openSessionRow(t, t.workerId, task.id);
    const four = await pushWorkspace(t.deps.db, gateway, ctx(s4, { checkout: { commitSha: main, at: new Date() }, agentPushed: { count: 1, lastSha: ownSha } }), await saveOn(s4, "main", main, { "src/fix.ts": "v4", "src/own.ts": "mine" }));
    expect(four).toMatchObject({ status: "pushed", rebuilt: true });
    expect(offline.calls.at(-1)!.args).toMatchObject({ rebuild: true, expectedHeadSha: ownSha });
  });

  it("never pushes a save made without the checkout its base names, and says why on that save only", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });
    const task = await repos.tasks.create(t.db, t.businessId, { kind: "code", title: "Held", goalMd: "x", assigneeAgentId: t.workerId, status: "ready" });
    const sid = await openSessionRow(t, t.workerId, task.id);
    const snapshot = (await t.deps.db.transaction((tx) => repos.workspaces.save(tx as never, t.businessId, { taskId: task.id, sessionId: sid, files: [{ path: "README.md", content: text("from memory") }], base: { repo: "acme/shop", ref: "main", commitSha: "b".repeat(40) }, removedPaths: [] }))).snapshot!;
    const { gateway, offline } = githubGateway();
    const reason = "this session had no checkout of acme/shop, so its files are not a diff against it; a session that checks it out pushes them";
    const ctx: PushContext = { businessId: t.businessId, taskId: task.id, sessionId: sid, agentId: t.workerId, branch: `agent/${task.id}`, agentName: "Worker", holdBack: null, saveHeldBack: reason };
    expect(await pushWorkspace(t.deps.db, gateway, ctx, snapshot)).toEqual({ status: "skipped", reason });
    expect(offline.calls).toEqual([]);
    expect(await repos.workspaces.getSnapshot(t.db, t.businessId, snapshot.id)).toMatchObject({ pushError: reason, pushedCommitSha: null });
    // Another session's save (an unchanged save hands back the latest) is left as it is.
    const other = await openSessionRow(t, t.workerId, task.id);
    await repos.workspaces.recordPush(t.db, t.businessId, snapshot.id, { repo: "acme/shop", branch: `agent/${task.id}`, error: "earlier" });
    expect(await pushWorkspace(t.deps.db, gateway, { ...ctx, sessionId: other }, (await repos.workspaces.getSnapshot(t.db, t.businessId, snapshot.id))!)).toMatchObject({ status: "skipped" });
    expect((await repos.workspaces.getSnapshot(t.db, t.businessId, snapshot.id))?.pushError).toBe("earlier");
  });

  it("does not push until the founder turns pushing on for the repository", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop" } });
    const taskId = t.fixture.taskIds[2]!;
    const { gateway, offline } = githubGateway();
    const snapshot = await save(taskId, { "a.ts": "1" });
    expect(await pushWorkspace(t.deps.db, gateway, { businessId: t.businessId, taskId, sessionId: await openSessionRow(t, t.workerId, taskId), agentId: t.workerId, branch: `agent/${taskId}`, agentName: "Worker", holdBack: null }, snapshot)).toEqual({ status: "skipped", reason: "pushing to acme/shop is turned off (the Code tab)" });
    expect(offline.calls).toEqual([]);
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: true } });
  });
});
