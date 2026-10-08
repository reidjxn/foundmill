/**
 * SEC-3 — the live runner (Claude Agent SDK) through `runAgentSession` on a non-mock sandbox with the SDK mocked:
 * the SDK process receives a from-scratch environment, tools by task kind, an isolated cwd, no host settings, and the
 * per-session workspace is deleted whether the run succeeds or the SDK throws. The mock-sandbox path is untouched
 * (session.test.ts).
 */
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repos } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import { LONG_LIVED_NAME_PATTERNS, parseSandboxSpec, type Sandbox, type SandboxProvider, type SandboxSpecInput } from "@foundmill/sandbox";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ACCEPTANCE_EGRESS, createSessionActivities } from "../activities/session";
import { FILE_TOOLS, SDK_MODEL_KEY_NAME, SDK_SESSION_TOKEN_NAME } from "../activities/sdk-isolation";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

type QueryCall = { prompt: unknown; options: Record<string, unknown> };
const calls: QueryCall[] = [];
let script: (call: QueryCall) => AsyncGenerator<Record<string, unknown>>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (call: QueryCall) => {
    calls.push(call);
    return script(call);
  },
}));

const MODEL_KEY = "sk-ant-api03-" + "m".repeat(60);
const SECRET_HOST_ENV = {
  DATABASE_URL: "postgres://fm:hunter2@db.internal/fm",
  SESSION_TOKEN_SECRET: "t".repeat(48),
  DEV_MASTER_KEY: "d".repeat(44),
  STRIPE_SECRET_KEY: "sk_live_51Hx8ZkLq9mN0pQrStUvWxYz",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nMIIE",
};

type ExecReply = { code: number; stdout: string; stderr: string; timedOut: boolean; durationMs: number };

/** A non-mock sandbox that records what runs inside it; `runAgentSession` takes the live path for anything but MockSandbox. */
function fakeSandboxProvider(): SandboxProvider & { execs: string[]; stopped: number; specs: ReturnType<typeof parseSandboxSpec>[]; writes: Map<string, string>[]; replies: ExecReply[]; log: string[]; closeFails: boolean } {
  const state = { execs: [] as string[], stopped: 0, specs: [] as ReturnType<typeof parseSandboxSpec>[], writes: [] as Map<string, string>[], replies: [] as ExecReply[], log: [] as string[], closeFails: false };
  return {
    mode: "docker",
    execs: state.execs,
    specs: state.specs,
    writes: state.writes,
    replies: state.replies,
    log: state.log,
    get closeFails() {
      return state.closeFails;
    },
    set closeFails(v: boolean) {
      state.closeFails = v;
    },
    get stopped() {
      return state.stopped;
    },
    async available() {
      return { available: true };
    },
    async create(input: SandboxSpecInput): Promise<Sandbox> {
      const spec = parseSandboxSpec(input);
      state.specs.push(spec);
      const written = new Map<string, string>();
      state.writes.push(written);
      return {
        id: `fake-${spec.taskId}`,
        provider: "docker",
        spec,
        workdir: "/work",
        state: "running",
        async start() {},
        async exec(cmd) {
          state.execs.push(cmd);
          state.log.push(cmd.includes("fm-acceptance-prepare.log") ? "exec:prepare" : "exec:run");
          return state.replies.shift() ?? { code: 0, stdout: "3 passed", stderr: "", timedOut: false, durationMs: 5 };
        },
        async writeFile(p, content) {
          state.log.push(`write:${p}`);
          written.set(p, typeof content === "string" ? content : Buffer.from(content).toString("utf8"));
        },
        async closeEgress() {
          state.log.push("closeEgress");
          if (state.closeFails) throw new Error("network update rejected");
        },
        async readFile() {
          return "";
        },
        async listFiles() {
          return [];
        },
        async snapshot() {
          return { id: "snap", sandboxId: "fake", provider: "docker", ref: "fake", createdAt: new Date().toISOString() };
        },
        async stop() {
          state.stopped += 1;
        },
      };
    },
  };
}

let t: OrchestratorTestHarness;
let workspaceRoot: string;
let provider: ReturnType<typeof fakeSandboxProvider>;
let acts: ReturnType<typeof createSessionActivities>;
let researchTaskId: string;
const previousEnv = { ...process.env };

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "live" });
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "fm-live-ws-"));
  provider = fakeSandboxProvider();
  Object.assign(process.env, SECRET_HOST_ENV);
  const deps = { ...t.deps, env: { ...t.deps.env, ANTHROPIC_API_KEY: MODEL_KEY, ORCHESTRATOR_WORKSPACE_DIR: workspaceRoot }, sandbox: async () => ({ provider, mode: "docker" as const, fellBackFrom: null }) };
  acts = createSessionActivities(deps);
  const research = await repos.tasks.create(t.db, t.businessId, { kind: "research", title: "Shortlist three suppliers", goalMd: "Find suppliers.", assigneeAgentId: t.workerId, status: "ready" });
  researchTaskId = research.id;
});
afterAll(async () => {
  for (const k of Object.keys(process.env)) if (!(k in previousEnv)) delete process.env[k];
  Object.assign(process.env, previousEnv);
  await rm(workspaceRoot, { recursive: true, force: true });
  await t?.close();
});
afterEach(() => {
  calls.length = 0;
});

const success = (sessionId: string) =>
  async function* () {
    yield { type: "system", subtype: "init", session_id: `sdk-${sessionId}` };
    yield { type: "assistant", message: { content: [{ type: "text", text: "Starting." }] } };
    yield { type: "result", subtype: "success", modelUsage: { m: { inputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 5, costUSD: 0.01 } } };
  };

describe("runAgentSession (live runner, SDK mocked)", () => {
  it("code task: isolated cwd under the workspace root, from-scratch env, file tools + MCP tools, no host settings; workspace removed after", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    expect(launch.sandboxMode).toBe("docker");
    let cwdSeen = "";
    const verdicts: Record<string, unknown> = {};
    script = async function* (call) {
      cwdSeen = call.options.cwd as string;
      // The workspace exists while the SDK runs and is private to this session.
      expect((await stat(cwdSeen)).isDirectory()).toBe(true);
      expect((await stat(cwdSeen)).mode & 0o777).toBe(0o700);
      // Exercise the PreToolUse hook the way the SDK would, while the workspace is live.
      const hooks = (call.options.hooks as { PreToolUse: { hooks: ((i: unknown) => Promise<unknown>)[] }[] }).PreToolUse;
      expect(hooks).toHaveLength(1);
      const hook = hooks[0]!.hooks[0]!;
      const base = { hook_event_name: "PreToolUse", tool_use_id: "x", session_id: "s", transcript_path: "", cwd: cwdSeen };
      verdicts.environ = await hook({ ...base, tool_name: "Read", tool_input: { file_path: "/proc/self/environ" } });
      verdicts.bash = await hook({ ...base, tool_name: "Bash", tool_input: { command: "env" } });
      verdicts.inside = await hook({ ...base, tool_name: "Write", tool_input: { file_path: "src/index.ts", content: "" } });
      verdicts.mcp = await hook({ ...base, tool_name: (call.options.allowedTools as string[]).find((x) => x.startsWith("mcp__"))!, tool_input: {} });
      // What the agent's file tools would leave behind, next to what the SDK itself writes under HOME.
      await mkdir(path.join(cwdSeen, "src"), { recursive: true });
      await writeFile(path.join(cwdSeen, "package.json"), '{"scripts":{"test":"vitest run"}}');
      await writeFile(path.join(cwdSeen, "src", "index.ts"), "export const ok = true;\n");
      await mkdir(path.join(cwdSeen, ".claude"), { recursive: true });
      await writeFile(path.join(cwdSeen, ".claude", "settings.json"), "{}");
      await writeFile(path.join(cwdSeen, ".claude.json"), "{}");
      await mkdir(path.join(cwdSeen, "node_modules", "dep"), { recursive: true });
      await writeFile(path.join(cwdSeen, "node_modules", "dep", "index.js"), "");
      await mkdir(path.join(cwdSeen, "src", ".git"), { recursive: true });
      await writeFile(path.join(cwdSeen, "src", ".git", "HEAD"), "ref: refs/heads/main");
      await symlink("/etc/hostname", path.join(cwdSeen, "src", "host.txt"));
      yield* success(sessionId)();
    };
    const result = await acts.runAgentSession(input, launch);
    expect(result.outcome).toBe("done");
    expect(result.tokensIn).toBe(10);
    expect(calls).toHaveLength(1);
    const options = calls[0]!.options;

    // cwd: the session's own directory under ORCHESTRATOR_WORKSPACE_DIR, gone once the run ends.
    expect(cwdSeen).toBe(path.join(workspaceRoot, sessionId));
    await expect(stat(cwdSeen)).rejects.toThrow();
    expect(await readdir(workspaceRoot)).toEqual([]);

    // env: never process.env.
    const env = options.env as Record<string, string>;
    expect(env.HOME).toBe(cwdSeen);
    expect(env.TMPDIR).toBe(path.join(cwdSeen, ".tmp"));
    expect(env[SDK_MODEL_KEY_NAME]).toBe(MODEL_KEY);
    expect(env[SDK_SESSION_TOKEN_NAME]).toBeTruthy();
    expect(env.FM_SESSION_ID).toBe(sessionId);
    expect(env.FM_BUSINESS_ID).toBe(t.businessId);
    for (const name of Object.keys(SECRET_HOST_ENV)) expect(env).not.toHaveProperty(name);
    for (const value of Object.values(SECRET_HOST_ENV)) expect(JSON.stringify(env)).not.toContain(value.slice(0, 16));
    expect(Object.keys(env).filter((n) => n !== SDK_MODEL_KEY_NAME && LONG_LIVED_NAME_PATTERNS.some((p) => p.name?.test(n)))).toEqual([]);
    expect(env).not.toHaveProperty("TEMPORAL_ADDRESS");
    expect(env).not.toHaveProperty("APP_ENV");

    // tools: the five file tools plus the gateway MCP tools; Bash & co removed; host settings off; no prompts.
    expect(options.tools).toEqual([...FILE_TOOLS]);
    const allowed = options.allowedTools as string[];
    for (const tool of FILE_TOOLS) expect(allowed).toContain(tool);
    expect(allowed.filter((x) => x.startsWith("mcp__")).length).toBeGreaterThan(0);
    expect(allowed).not.toContain("Bash");
    expect(options.disallowedTools).toContain("Bash");
    expect(options.disallowedTools).toContain("WebFetch");
    expect(options.settingSources).toEqual([]);
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.permissionPrompts).toBe("none");
    expect(options.persistSession).toBe(false);
    expect(options).not.toHaveProperty("additionalDirectories");

    // The PreToolUse hook is wired and enforces the path guard with the session's cwd.
    expect(verdicts.environ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: expect.stringMatching(/outside the session workspace/) } });
    expect(verdicts.bash).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(verdicts.inside).toEqual({ continue: true });
    expect(verdicts.mcp).toEqual({ continue: true });
    const notes = await readSessionEvents(t.redis, sessionId, { kinds: ["note"] });
    expect(notes.some((r) => r.event.kind === "note" && r.event.source === "system" && /Blocked Read: .*outside the session workspace/.test(r.event.text))).toBe(true);

    // The sandbox may reach the npm registry and nothing else; the agent's files (not the SDK's HOME state, dependencies,
    // git metadata or symlinks) are copied into it, and the acceptance tests run there, never on the host.
    expect(provider.specs.at(-1)!.egressAllowList).toEqual([...ACCEPTANCE_EGRESS]);
    expect([...provider.writes.at(-1)!.keys()].sort()).toEqual(["package.json", "src/index.ts"]);
    expect(provider.writes.at(-1)!.get("src/index.ts")).toBe("export const ok = true;\n");
    // Online: dependencies only, with scripts and pnpmfiles off. Then the network closes. Offline: the task's command.
    const order = provider.log.filter((e) => !e.startsWith("write:"));
    expect(order.slice(-3)).toEqual(["exec:prepare", "closeEgress", "exec:run"]);
    expect(provider.log.indexOf("write:package.json")).toBeLessThan(provider.log.lastIndexOf("exec:prepare"));
    const [prepare, run] = provider.execs.slice(-2) as [string, string];
    expect(prepare).toContain("pnpm install");
    expect(prepare).toContain("--ignore-scripts");
    expect(prepare).toContain("--ignore-pnpmfile");
    expect(prepare).not.toMatch(/\npnpm test\n/);
    expect(run).toMatch(/\npnpm test\n\) >\/tmp\/fm-acceptance\.log 2>&1\n/);
    expect(run).toMatch(/tail -c 32768/);
    const allNotes = await readSessionEvents(t.redis, sessionId, { kinds: ["note"] });
    expect(allNotes.some((r) => r.event.kind === "note" && /Copied 2 files .* into the sandbox/.test(r.event.text))).toBe(true);
    const tests = await readSessionEvents(t.redis, sessionId, { kinds: ["test_result"] });
    expect(tests.at(-1)?.event).toMatchObject({ kind: "test_result", acceptance: true, command: "pnpm test", passed: 3, failed: 0 });
    expect(provider.stopped).toBeGreaterThan(0);
  });

  it("code task: a failing acceptance run is recorded with its output", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    script = async function* (call) {
      await writeFile(path.join(call.options.cwd as string, "package.json"), "{}");
      yield* success(sessionId)();
    };
    const leaked = "npm_" + "x".repeat(36);
    provider.replies.push({ code: 0, stdout: "Done in 2s", stderr: "", timedOut: false, durationMs: 30 }, { code: 1, stdout: "Tests  1 failed | 2 passed", stderr: `AssertionError: expected 2 to be 3 ${leaked}`, timedOut: false, durationMs: 40 });
    const result = await acts.runAgentSession(input, launch);
    expect(result.outcome).toBe("done");
    const tests = await readSessionEvents(t.redis, sessionId, { kinds: ["test_result"] });
    expect(tests.at(-1)?.event).toMatchObject({ kind: "test_result", acceptance: true, passed: 2, failed: 1, durationMs: 70 });
    const notes = await readSessionEvents(t.redis, sessionId, { kinds: ["note"] });
    const exitNote = notes.find((r) => r.event.kind === "note" && /exited with code 1/.test(r.event.text))?.event;
    // The task's own output is the agent's words, never a system message, and credential shapes are masked.
    expect(exitNote).toMatchObject({ source: "agent", level: "warn", text: expect.stringContaining("AssertionError") });
    expect(exitNote && "text" in exitNote ? exitNote.text : "").not.toContain(leaked);
    expect(exitNote && "text" in exitNote ? exitNote.text : "").toContain("[redacted:value.npm_token]");
  });

  it("code task: a failed dependency install, or a network that will not close, records a failed run and never runs the tests", async () => {
    for (const mode of ["install", "close"] as const) {
      const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
      const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
      const launch = await acts.prepareSession(input);
      script = async function* (call) {
        await writeFile(path.join(call.options.cwd as string, "package.json"), "{}");
        yield* success(sessionId)();
      };
      if (mode === "install") provider.replies.push({ code: 1, stdout: "", stderr: "ERR_PNPM_FETCH_404 left-pad-nope", timedOut: false, durationMs: 9 });
      else provider.closeFails = true;
      const logBefore = provider.log.length;
      const result = await acts.runAgentSession(input, launch);
      provider.closeFails = false;
      expect(result.outcome).toBe("done");
      expect(provider.log.slice(logBefore)).not.toContain("exec:run");
      const tests = await readSessionEvents(t.redis, sessionId, { kinds: ["test_result"] });
      expect(tests.at(-1)?.event).toMatchObject({ kind: "test_result", acceptance: true, passed: 0, failed: 1, failures: [mode === "install" ? "Dependency install failed" : "Sandbox network could not be closed; tests not run"] });
    }
  });

  it("code task: a workspace over the size cap is not copied and the acceptance run is recorded as failed, not run", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    script = async function* (call) {
      await writeFile(path.join(call.options.cwd as string, "blob.bin"), Buffer.alloc(5 * 1024 * 1024 + 1));
      yield* success(sessionId)();
    };
    const execsBefore = provider.execs.length;
    await acts.runAgentSession(input, launch);
    expect(provider.execs.length).toBe(execsBefore);
    expect(provider.writes.at(-1)!.size).toBe(0);
    const tests = await readSessionEvents(t.redis, sessionId, { kinds: ["test_result"] });
    expect(tests.at(-1)?.event).toMatchObject({ kind: "test_result", acceptance: true, passed: 0, failed: 1, failures: [expect.stringMatching(/blob\.bin is larger than 5 MB/)] });
    expect(await readdir(workspaceRoot)).toEqual([]);
  });

  it("non-code task: no Read/Glob/Grep/Edit/Write at all, only the gateway MCP tools", async () => {
    const sessionId = await openSessionRow(t, t.workerId, researchTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: researchTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    script = success(sessionId);
    const execsBefore = provider.execs.length;
    const result = await acts.runAgentSession(input, launch);
    expect(result.outcome).toBe("done");
    const options = calls[0]!.options;
    expect(options.tools).toEqual([]);
    const allowed = options.allowedTools as string[];
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.every((x) => x.startsWith("mcp__"))).toBe(true);
    for (const tool of FILE_TOOLS) expect(options.disallowedTools).toContain(tool);
    const hook = (options.hooks as { PreToolUse: { hooks: ((i: unknown) => Promise<unknown>)[] }[] }).PreToolUse[0]!.hooks[0]!;
    const read = await hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "README.md" }, tool_use_id: "x", session_id: "s", transcript_path: "", cwd: options.cwd });
    expect(read).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: expect.stringMatching(/not available/) } });
    expect(provider.execs.length).toBe(execsBefore); // no acceptance command for a research task
    expect(provider.specs.at(-1)!.egressAllowList).toEqual([]); // and no network at all
    expect(provider.writes.at(-1)!.size).toBe(0);
    await expect(stat(options.cwd as string)).rejects.toThrow();
  });

  it("cleans the workspace up when the SDK throws mid-run, and the failure is reported without the environment", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    let cwdSeen = "";
    script = async function* (call) {
      cwdSeen = call.options.cwd as string;
      await writeFile(path.join(cwdSeen, "scratch.txt"), "half-written");
      yield { type: "system", subtype: "init", session_id: "sdk-boom" };
      throw new Error("SDK transport closed");
    };
    const result = await acts.runAgentSession(input, launch);
    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("SDK transport closed");
    expect(cwdSeen).toBe(path.join(workspaceRoot, sessionId));
    await expect(stat(cwdSeen)).rejects.toThrow();
    expect(await readdir(workspaceRoot)).toEqual([]);
    const stream = await readSessionEvents(t.redis, sessionId);
    const serialised = JSON.stringify(stream);
    expect(serialised).not.toContain(MODEL_KEY);
    for (const value of Object.values(SECRET_HOST_ENV)) expect(serialised).not.toContain(value.slice(0, 16));
    expect(provider.stopped).toBeGreaterThan(0);
  });

  it("refuses to launch when the sandbox env would carry a long-lived credential, before any SDK process starts", async () => {
    const sessionId = await openSessionRow(t, t.workerId, t.codeTaskId);
    const input = { businessId: t.businessId, agentId: t.workerId, taskId: t.codeTaskId, sessionId };
    const launch = await acts.prepareSession(input);
    // A gateway that mints a token with no expiry hands the agent a standing credential: the launch must fail closed.
    const badGateway = { ...t.gateway, async mintSessionToken() { return { token: "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ sub: "agent" })).toString("base64url") + ".sig", expiresAt: "2099-01-01T00:00:00.000Z", jti: "j" }; } };
    const localActs = createSessionActivities({ ...t.deps, env: { ...t.deps.env, ANTHROPIC_API_KEY: MODEL_KEY, ORCHESTRATOR_WORKSPACE_DIR: workspaceRoot }, gateway: badGateway, sandbox: async () => ({ provider, mode: "docker" as const, fellBackFrom: null }) });
    script = success(sessionId);
    const result = await localActs.runAgentSession(input, launch);
    expect(result.outcome).toBe("failed");
    expect(result.reason).toMatch(/long-lived credentials/);
    expect(result.reason).toContain(SDK_SESSION_TOKEN_NAME);
    expect(calls).toHaveLength(0);
    expect(await readdir(workspaceRoot)).toEqual([]);
  });
});
