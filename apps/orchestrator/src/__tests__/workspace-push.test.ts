/**
 * Saved code goes to GitHub (activities/workspace-push.ts): pushed through the gateway with commit_files, only what
 * changed since the last pushed save, one commit per session, the outcome recorded on the save. The gateway here is a
 * stand-in that runs the real GitHub mock connector, so branch contents can be read back.
 */
import { createGithubMock } from "@foundmill/connectors/connectors/github/mock";
import { makeToolContext } from "@foundmill/connectors/testing/contract-suite";
import { repos, type WorkspaceSnapshot } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describePush, pushWorkspace, type PushContext } from "../activities/workspace-push";
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
    const ctx: PushContext = { businessId: t.businessId, taskId: t.codeTaskId, sessionId: await openSessionRow(t, t.workerId, t.codeTaskId), agentId: t.workerId, branch: `agent/${t.codeTaskId}`, taskTitle: "Build onboarding", agentName: "Worker" };
    const snapshot = await save(t.codeTaskId, { "a.ts": "1" });
    expect(await pushWorkspace(t.deps.db, gateway, ctx, snapshot)).toEqual({ status: "skipped", reason: "connect GitHub and choose a repository on Development › Code" });
    expect(offline.calls).toEqual([]);
    expect(describePush({ status: "skipped", reason: "x" })?.text).toBe("Not pushed to GitHub: x. The code is saved on Development › Code.");
  });

  it("pushes the first save whole, then only what changed, one commit per session, and records each", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop" } });
    const taskId = t.fixture.taskIds[0]!;
    const { gateway, offline, readFile } = githubGateway();
    const ctx = (sessionId: string): PushContext => ({ businessId: t.businessId, taskId, sessionId, agentId: t.workerId, branch: `agent/${taskId}`, taskTitle: "Order webhook hardening", agentName: "Worker" });

    const first = await save(taskId, { "src/verify.ts": "v1", "README.md": "# Notes", "old.txt": "old" });
    const s1 = await openSessionRow(t, t.workerId, taskId);
    const one = await pushWorkspace(t.deps.db, gateway, ctx(s1), first);
    expect(one).toMatchObject({ status: "pushed", repo: "acme/shop", branch: `agent/${taskId}`, filesWritten: 3, filesDeleted: 0 });
    expect(offline.minted.at(-1)).toMatchObject({ allowedTools: ["github:commit_files"], ttlSeconds: 300, sessionId: s1, agentId: t.workerId });
    const call = offline.calls.at(-1)!;
    expect(call).toMatchObject({ connector: "github", tool: "commit_files", args: { owner: "acme", repo: "shop", branch: `agent/${taskId}`, deletions: [] } });
    expect(call.args.message).toMatch(/^Order webhook hardening\n\nSaved by Worker at the end of a session \(3 added, 0 changed, 0 removed\)\./);
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
    const ctx = async (): Promise<PushContext> => ({ businessId: t.businessId, taskId, sessionId: await openSessionRow(t, t.workerId, taskId), agentId: t.workerId, branch: `agent/${taskId}`, taskTitle: "Billing page", agentName: "Worker" });
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

  it("does not push when the founder turned pushing off for the repository", async () => {
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop", writeEnabled: false } });
    const taskId = t.fixture.taskIds[2]!;
    const { gateway, offline } = githubGateway();
    const snapshot = await save(taskId, { "a.ts": "1" });
    expect(await pushWorkspace(t.deps.db, gateway, { businessId: t.businessId, taskId, sessionId: await openSessionRow(t, t.workerId, taskId), agentId: t.workerId, branch: `agent/${taskId}`, taskTitle: "x", agentName: "Worker" }, snapshot)).toEqual({ status: "skipped", reason: "pushing to acme/shop is turned off" });
    expect(offline.calls).toEqual([]);
    await repos.integrations.upsert(t.deps.db, t.businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { repo: "acme/shop" } });
  });
});
