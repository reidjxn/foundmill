import { ValidationError } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { SandboxError } from "../errors";
import { MockSandboxProvider } from "../mock/replay";
import type { ExecOptions, ExecResult, Sandbox } from "../types";
import { agentBranch, cloneCommand, cloneRepo, createAgentWorktree, gitAuthEnv, gitIdentityEnv, isValidBranchComponent, parsePorcelainStatus, prepareAgentWorkspace, redactTokens, removeAgentWorktree, taskIdFromBranch, worktreeStatus } from "../worktree";

/** A sandbox whose exec is scripted by regex; records every call. */
function scripted(responses: Array<[RegExp, Partial<ExecResult>]>): { sandbox: Sandbox; calls: Array<{ cmd: string; opts: ExecOptions }> } {
  const calls: Array<{ cmd: string; opts: ExecOptions }> = [];
  const sandbox: Sandbox = {
    id: "scripted",
    provider: "mock",
    spec: { businessId: "b", taskId: "t", egressAllowList: [], envShortLived: {}, ttlMinutes: 1 },
    workdir: "/home/user/work",
    state: "running",
    start: async () => {},
    exec: async (cmd, opts = {}) => {
      calls.push({ cmd, opts });
      const hit = responses.find(([re]) => re.test(cmd));
      return { code: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1, ...(hit?.[1] ?? {}) };
    },
    writeFile: async () => {},
    readFile: async () => "",
    listFiles: async () => [],
    snapshot: async () => ({ id: "s", sandboxId: "scripted", provider: "mock", ref: "r", createdAt: "" }),
    closeEgress: async () => {},
    stop: async () => {},
  };
  return { sandbox, calls };
}

describe("agent branches", () => {
  it("names the branch agent/<taskId> and validates git ref rules", () => {
    expect(agentBranch("task-42")).toBe("agent/task-42");
    expect(agentBranch("7f21c0de-1a2b-4c3d-9e8f-000000000001")).toBe("agent/7f21c0de-1a2b-4c3d-9e8f-000000000001");
    for (const bad of ["", ".hidden", "-dash", "a..b", "with space", "x.lock", "end.", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "a/b", "a".repeat(121)]) {
      expect(isValidBranchComponent(bad), bad).toBe(false);
      expect(() => agentBranch(bad)).toThrow(ValidationError);
    }
    expect(taskIdFromBranch("agent/task-42")).toBe("task-42");
    expect(taskIdFromBranch("main")).toBeNull();
    expect(taskIdFromBranch("agent/..")).toBeNull();
  });
});

describe("git environment helpers", () => {
  it("puts the token in a basic auth header through GIT_CONFIG_*, never in argv", () => {
    const env = gitAuthEnv({ token: "ghs_tok", origin: "https://github.com/" });
    expect(env).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from("x-access-token:ghs_tok").toString("base64")}`,
      GIT_TERMINAL_PROMPT: "0",
    });
    expect(gitAuthEnv({ token: "t", username: "oauth2" }).GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from("oauth2:t").toString("base64")}`);
    expect(() => gitAuthEnv({ token: "" })).toThrow(ValidationError);
    expect(gitIdentityEnv({ name: "Northwind Frontend Agent", email: "agents@foundmill.invalid" })).toEqual({
      GIT_AUTHOR_NAME: "Northwind Frontend Agent",
      GIT_AUTHOR_EMAIL: "agents@foundmill.invalid",
      GIT_COMMITTER_NAME: "Northwind Frontend Agent",
      GIT_COMMITTER_EMAIL: "agents@foundmill.invalid",
    });
  });

  it("redacts tokens and basic auth from git output", () => {
    expect(redactTokens("fatal: Authorization: Basic eC1hY2Nlc3MtdG9rZW46Z2hzX3Rvaw== rejected")).toBe("fatal: Authorization: Basic [redacted] rejected");
    expect(redactTokens("remote: ghp_abcdefghijklmnop was used")).toBe("remote: [redacted-token] was used");
    expect(redactTokens("https://x-access-token:ghs_abc@github.com/a/b")).toBe("https://[redacted]@github.com/a/b");
  });
});

describe("clone and worktree commands", () => {
  const repo = { url: "https://github.com/foundmill-demo/ledgerly.git", branch: "main" };

  it("composes a quoted clone command", () => {
    expect(cloneCommand(repo, "/home/user/work")).toBe("git clone --branch main --single-branch --depth 50 https://github.com/foundmill-demo/ledgerly.git /home/user/work");
    expect(cloneCommand({ ...repo, branch: "feature/it's" }, "/w", { depth: null })).toBe("git clone --branch 'feature/it'\\''s' --single-branch https://github.com/foundmill-demo/ledgerly.git /w");
    expect(cloneCommand(repo, "/w", { depth: 1 })).toContain("--depth 1");
  });

  it("cloneRepo runs from / with the given env and throws a redacted SandboxError on failure", async () => {
    const good = scripted([]);
    await cloneRepo(good.sandbox, repo, "/w", { env: { GIT_TOKEN: "ghs_x" }, timeoutMs: 5 });
    expect(good.calls[0]).toMatchObject({ cmd: cloneCommand(repo, "/w"), opts: { cwd: "/", env: { GIT_TOKEN: "ghs_x" }, timeoutMs: 5 } });
    const bad = scripted([[/git clone/, { code: 128, stderr: "fatal: Authorization: Basic abc= rejected" }]]);
    await expect(cloneRepo(bad.sandbox, repo, "/w")).rejects.toBeInstanceOf(SandboxError);
    await expect(cloneRepo(bad.sandbox, repo, "/w")).rejects.toMatchObject({ details: { code: 128, stderr: "fatal: Authorization: Basic [redacted] rejected" } });
  });

  it("creates the agent worktree on agent/<taskId> and reports its head", async () => {
    const { sandbox, calls } = scripted([[/rev-parse HEAD/, { stdout: "9f3c2d1abc\n" }]]);
    const wt = await createAgentWorktree(sandbox, { taskId: "task-42", repoDir: "/home/user/work", env: { GIT_TOKEN: "ghs_x" } });
    expect(wt).toEqual({ branch: "agent/task-42", path: "/home/user/work-agent-task-42", headSha: "9f3c2d1abc" });
    expect(calls[0]).toMatchObject({ cmd: "git worktree add -B agent/task-42 /home/user/work-agent-task-42 HEAD", opts: { cwd: "/home/user/work", env: { GIT_TOKEN: "ghs_x" } } });
    expect(calls[1]).toMatchObject({ cmd: "git rev-parse HEAD", opts: { cwd: "/home/user/work-agent-task-42" } });
    const custom = await createAgentWorktree(scripted([[/rev-parse/, { stdout: "abc\n" }]]).sandbox, { taskId: "t1", repoDir: "/r", path: "/wt/t1", baseRef: "origin/main" });
    expect(custom.path).toBe("/wt/t1");
    const failing = scripted([[/worktree add/, { code: 128, stderr: "fatal: 'agent/task-42' is already checked out" }]]);
    await expect(createAgentWorktree(failing.sandbox, { taskId: "task-42", repoDir: "/r" })).rejects.toThrow(/worktree add for agent\/task-42 failed/);
    await expect(createAgentWorktree(failing.sandbox, { taskId: "bad id", repoDir: "/r" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("removes a worktree and optionally its branch", async () => {
    const { sandbox, calls } = scripted([]);
    await removeAgentWorktree(sandbox, { repoDir: "/r", path: "/r-agent-t", force: true, deleteBranch: "t" });
    expect(calls.map((c) => c.cmd)).toEqual(["git worktree remove --force /r-agent-t", "git branch -D agent/t"]);
    const failing = scripted([[/worktree remove/, { code: 1, stderr: "fatal: not a working tree" }]]);
    await expect(removeAgentWorktree(failing.sandbox, { repoDir: "/r", path: "/x" })).rejects.toBeInstanceOf(SandboxError);
  });

  it("parses porcelain status", () => {
    expect(parsePorcelainStatus("## agent/task-42...origin/agent/task-42 [ahead 2, behind 1]\n M src/a.ts\n?? new.md\nR  old.ts -> new.ts\n")).toEqual({
      branch: "agent/task-42",
      upstream: "origin/agent/task-42",
      ahead: 2,
      behind: 1,
      dirty: true,
      changedFiles: ["src/a.ts", "new.md", "new.ts"],
    });
    expect(parsePorcelainStatus("## main\n")).toEqual({ branch: "main", upstream: null, ahead: 0, behind: 0, dirty: false, changedFiles: [] });
    expect(parsePorcelainStatus("## No commits yet on agent/t\n")).toMatchObject({ branch: "agent/t", dirty: false });
  });

  it("worktreeStatus runs git status in the worktree", async () => {
    const { sandbox, calls } = scripted([[/git status/, { stdout: "## agent/t\n M a\n" }]]);
    expect(await worktreeStatus(sandbox, "/wt")).toMatchObject({ branch: "agent/t", dirty: true, changedFiles: ["a"] });
    expect(calls[0]).toMatchObject({ cmd: "git status --porcelain=v1 --branch", opts: { cwd: "/wt" } });
  });

  it("prepareAgentWorkspace chains clone and worktree, and works against the mock sandbox", async () => {
    const { sandbox, calls } = scripted([[/rev-parse/, { stdout: "abc\n" }]]);
    const ws = await prepareAgentWorkspace(sandbox, repo, { taskId: "task-42", env: gitAuthEnv({ token: "ghs_x" }) });
    expect(ws).toEqual({ repoDir: "/home/user/work", branch: "agent/task-42", path: "/home/user/work-agent-task-42", headSha: "abc" });
    expect(calls.map((c) => c.cmd)[0]).toContain("git clone");
    expect(calls.every((c) => !c.cmd.includes("ghs_"))).toBe(true);

    const mock = await new MockSandboxProvider({ speed: Infinity, autoplay: false }).create({ businessId: "b-1", taskId: "task-42", recording: "ledgerly-webhook-retry" });
    await mock.start();
    const onMock = await prepareAgentWorkspace(mock, repo, { taskId: "task-42" });
    expect(onMock.branch).toBe("agent/task-42");
    expect(mock.execLog.map((e) => e.cmd)).toEqual([cloneCommand(repo, mock.workdir), `git worktree add -B agent/task-42 ${mock.workdir}-agent-task-42 HEAD`, "git rev-parse HEAD"]);
    await mock.stop();
  });

  it("prepareAgentWorkspace does not clone again into a workdir the sandbox already cloned", async () => {
    const { sandbox, calls } = scripted([[/rev-parse/, { stdout: "abc\n" }]]);
    const cloned: Sandbox = { ...sandbox, spec: { ...sandbox.spec, repo } };
    const ws = await prepareAgentWorkspace(cloned, repo, { taskId: "task-42" });
    expect(ws.path).toBe("/home/user/work-agent-task-42");
    expect(calls.some((c) => c.cmd.includes("git clone"))).toBe(false);
    expect(calls.some((c) => c.cmd.includes("git worktree add"))).toBe(true);

    // A checkout in another directory is still cloned.
    const other = scripted([[/rev-parse/, { stdout: "abc\n" }]]);
    await prepareAgentWorkspace({ ...other.sandbox, spec: { ...other.sandbox.spec, repo } }, repo, { taskId: "task-42", repoDir: "/home/user/other" });
    expect(other.calls[0]?.cmd).toContain("git clone");
  });
});
