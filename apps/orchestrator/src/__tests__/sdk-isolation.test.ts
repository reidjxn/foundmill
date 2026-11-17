/**
 * SEC-3 — the host process that runs the Claude Agent SDK gets a from-scratch environment, built-in tools by task kind
 * only and a path guard that keeps every file-tool call inside the per-session workspace.
 */
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LONG_LIVED_NAME_PATTERNS, LongLivedCredentialError } from "@foundmill/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSandboxEnv, mcpToolNames } from "../activities/session";
import { ALWAYS_DISALLOWED_TOOLS, FILE_TOOLS, SDK_HOST_PASSTHROUGH, SDK_MODEL_KEY_NAME, SDK_MODEL_SLOT_NAMES, SDK_SESSION_TOKEN_NAME, createSessionWorkspace, guardToolCall, hookOutputFor, removeSessionWorkspace, sdkEnvFor, sdkToolPolicyFor } from "../activities/sdk-isolation";

const MODEL_KEY = "sk-ant-api03-" + "k".repeat(60);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c2ln`;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const sessionToken = jwt({ sub: "agent", sessionId: "s", exp: nowSeconds() + 4 * 3600 });

/** A host environment full of platform secrets, the way an orchestrator container's really looks. */
const HOST = {
  PATH: "/usr/local/bin:/usr/bin",
  LANG: "en_GB.UTF-8",
  HOME: "/home/orchestrator",
  DATABASE_URL: "postgres://fm:hunter2@db.internal/fm",
  REDIS_URL: "redis://cache.internal:6379",
  SESSION_TOKEN_SECRET: "x".repeat(48),
  DEV_MASTER_KEY: "y".repeat(44),
  STRIPE_SECRET_KEY: "sk_live_51Hx8ZkLq9mN0pQrStUvWxYz",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nMIIE",
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }),
  ANTHROPIC_API_KEY: "sk-ant-api03-" + "p".repeat(60),
  E2B_API_KEY: "e2b_" + "e".repeat(30),
  AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  NODE_ENV: "production",
  TEMPORAL_ADDRESS: "temporal.internal:7233",
};

const sandboxEnv = buildSandboxEnv({ businessId: "b-1", agentId: "a-1", taskId: "t-1", sessionId: "s-1", gatewayUrl: "http://gateway.internal:4001" });

describe("sdkEnvFor (SEC-3)", () => {
  it("builds the SDK environment from scratch: nothing from the host but PATH/locale, nothing long-lived but the model key", () => {
    const env = sdkEnvFor({ cwd: "/work/s-1", apiKey: MODEL_KEY, sessionToken, sandboxEnv, host: HOST });
    expect(env.PATH).toBe(HOST.PATH);
    expect(env.LANG).toBe(HOST.LANG);
    expect(env.HOME).toBe("/work/s-1");
    expect(env.TMPDIR).toBe("/work/s-1/.tmp");
    expect(env.CLAUDE_CONFIG_DIR).toBe("/work/s-1/.claude");
    expect(env[SDK_MODEL_KEY_NAME]).toBe(MODEL_KEY);
    expect(env[SDK_SESSION_TOKEN_NAME]).toBe(sessionToken);
    expect(env.FM_SESSION_ID).toBe("s-1");
    expect(env.FM_GATEWAY_URL).toBe("http://gateway.internal:4001");
    // Every host variable that is not an explicit pass-through is absent, whatever its value.
    for (const name of Object.keys(HOST)) {
      if ((SDK_HOST_PASSTHROUGH as readonly string[]).includes(name) || name === "HOME" || name === SDK_MODEL_KEY_NAME) continue;
      expect(env).not.toHaveProperty(name);
    }
    expect(env.HOME).not.toBe(HOST.HOME);
    expect(env[SDK_MODEL_KEY_NAME]).not.toBe(HOST.ANTHROPIC_API_KEY);
    // No name in the environment matches a long-lived credential pattern, except the model key the SDK needs.
    const flagged = Object.keys(env).filter((name) => name !== SDK_MODEL_KEY_NAME && LONG_LIVED_NAME_PATTERNS.some((p) => p.name?.test(name)));
    expect(flagged).toEqual([]);
    // The values of the host's secrets never appear anywhere in the result.
    const serialised = JSON.stringify(env);
    for (const [name, value] of Object.entries(HOST)) {
      if ((SDK_HOST_PASSTHROUGH as readonly string[]).includes(name)) continue;
      expect(serialised).not.toContain(JSON.stringify(value).slice(1, -1));
    }
  });

  it("defaults to process.env for the pass-through names and never copies a secret from it", () => {
    const previous = { ...process.env };
    try {
      process.env.STRIPE_SECRET_KEY = "sk_live_51Hx8ZkLq9mN0pQrStUvWxYz";
      process.env.SESSION_TOKEN_SECRET = "s".repeat(40);
      process.env.DATABASE_URL = "postgres://fm:pw@db/fm";
      const env = sdkEnvFor({ cwd: "/work/s", apiKey: MODEL_KEY, sessionToken, sandboxEnv });
      expect(env.PATH).toBe(process.env.PATH);
      expect(env).not.toHaveProperty("STRIPE_SECRET_KEY");
      expect(env).not.toHaveProperty("SESSION_TOKEN_SECRET");
      expect(env).not.toHaveProperty("DATABASE_URL");
      expect(JSON.stringify(env)).not.toContain("sk_live_");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in previous)) delete process.env[k];
      Object.assign(process.env, previous);
    }
  });

  it("fails closed on a long-lived key anywhere but the model key, naming the variable and never its value", () => {
    const attempt = (extra: Record<string, string>, token = sessionToken) => () => sdkEnvFor({ cwd: "/w", apiKey: MODEL_KEY, sessionToken: token, sandboxEnv: { ...sandboxEnv, ...extra }, host: HOST });
    expect(attempt({ STRIPE_SECRET_KEY: "whatever" })).toThrow(LongLivedCredentialError);
    expect(attempt({ FM_DEPLOY_HINT: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" })).toThrow(LongLivedCredentialError);
    expect(attempt({ FM_SB: jwt({ role: "service_role" }) })).toThrow(LongLivedCredentialError);
    // A session token that does not expire, or expires too far out, is itself a long-lived credential.
    expect(attempt({}, jwt({ sub: "agent" }))).toThrow(LongLivedCredentialError);
    expect(attempt({}, jwt({ sub: "agent", exp: nowSeconds() + 40 * 24 * 3600 }))).toThrow(LongLivedCredentialError);
    let caught: unknown;
    try {
      attempt({ STRIPE_SECRET_KEY: "sk_live_51Hx8ZkLq9mN0pQrStUvWxYz" })();
    } catch (e) {
      caught = e;
    }
    expect((caught as LongLivedCredentialError).findings.map((f) => f.name)).toEqual(["STRIPE_SECRET_KEY"]);
    expect((caught as Error).message).not.toContain("sk_live_");
    // The sandbox env cannot smuggle the SDK's own names either.
    expect(attempt({ ANTHROPIC_API_KEY: MODEL_KEY })).toThrow(/may not set ANTHROPIC_API_KEY/);
    expect(attempt({ HOME: "/" })).toThrow(/may not set HOME/);
  });

  it("refuses a proxy URL that carries credentials and ignores empty pass-through values", () => {
    expect(() => sdkEnvFor({ cwd: "/w", apiKey: MODEL_KEY, sessionToken, sandboxEnv, host: { ...HOST, HTTPS_PROXY: "http://user:secret@proxy.internal:3128" } })).toThrow(/HTTPS_PROXY carries credentials/);
    const env = sdkEnvFor({ cwd: "/w", apiKey: MODEL_KEY, sessionToken, sandboxEnv, host: { ...HOST, HTTPS_PROXY: "http://proxy.internal:3128", NO_PROXY: "" } });
    expect(env.HTTPS_PROXY).toBe("http://proxy.internal:3128");
    expect(env).not.toHaveProperty("NO_PROXY");
    const bare = sdkEnvFor({ cwd: "/w", apiKey: MODEL_KEY, sessionToken, sandboxEnv, host: {} });
    expect(bare.PATH).toBeTruthy();
    expect(bare.LANG).toBe("C.UTF-8");
  });
});

describe("sdkToolPolicyFor", () => {
  const mcp = mcpToolNames([{ connectorKey: "github", tools: ["create_file", "*"] }, { connectorKey: "notion", tools: ["create_page"] }]);

  it("code tasks get the file tools and the MCP tools; nothing else exists", () => {
    const p = sdkToolPolicyFor("code", mcp);
    expect(p.fileTools).toBe(true);
    expect(p.tools).toEqual([...FILE_TOOLS]);
    expect(p.allowedTools).toEqual([...mcp, ...FILE_TOOLS]);
    for (const t of ALWAYS_DISALLOWED_TOOLS) expect(p.disallowedTools).toContain(t);
    expect(p.disallowedTools).toContain("Bash");
    expect(p.disallowedTools).toContain("WebFetch");
    expect(p.allowedTools).not.toContain("Bash");
  });

  it.each(["research", "channel", "specialist", "legal", "finance", "ops"] as const)("%s tasks get no host file tool at all", (kind) => {
    const p = sdkToolPolicyFor(kind, mcp);
    expect(p.fileTools).toBe(false);
    expect(p.tools).toEqual([]);
    expect(p.allowedTools).toEqual(mcp);
    for (const t of FILE_TOOLS) {
      expect(p.allowedTools).not.toContain(t);
      expect(p.disallowedTools).toContain(t);
    }
    for (const t of ALWAYS_DISALLOWED_TOOLS) expect(p.disallowedTools).toContain(t);
  });

  it("only mcp__ names reach allowedTools from the grants", () => {
    const p = sdkToolPolicyFor("research", ["mcp__github__create_file", "Bash", "Read"]);
    expect(p.allowedTools).toEqual(["mcp__github__create_file"]);
  });
});

describe("guardToolCall (path guard)", () => {
  let root: string;
  let cwd: string;
  let outside: string;
  const code = sdkToolPolicyFor("code", ["mcp__github__create_file"]);
  const research = sdkToolPolicyFor("research", ["mcp__github__create_file"]);

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "fm-sdk-guard-"));
    cwd = await createSessionWorkspace(root, "0123456789abcdef");
    outside = path.join(root, "elsewhere");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.env"), "DATABASE_URL=postgres://x:y@z/db\n");
    await writeFile(path.join(cwd, "README.md"), "# repo\n");
    await mkdir(path.join(cwd, "src"));
    // A symlink inside the workspace that points out of it (a cloned repo could carry one).
    await symlink(outside, path.join(cwd, "escape"));
    await symlink(path.join(outside, "secret.env"), path.join(cwd, "src", ".env"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("allows file tools on paths inside the workspace (relative, absolute, not yet existing)", async () => {
    expect(await guardToolCall("Read", { file_path: "README.md" }, { cwd, policy: code })).toEqual({ allow: true });
    expect(await guardToolCall("Read", { file_path: path.join(cwd, "README.md") }, { cwd, policy: code })).toEqual({ allow: true });
    expect(await guardToolCall("Write", { file_path: "src/new/deep/file.ts", content: "x" }, { cwd, policy: code })).toEqual({ allow: true });
    expect(await guardToolCall("Edit", { file_path: "./src/../README.md" }, { cwd, policy: code })).toEqual({ allow: true });
    expect(await guardToolCall("Glob", { pattern: "**/*.ts" }, { cwd, policy: code })).toEqual({ allow: true });
    expect(await guardToolCall("Grep", { pattern: "TODO", path: "src" }, { cwd, policy: code })).toEqual({ allow: true });
    expect(await guardToolCall("Read", { file_path: "~/README.md" }, { cwd, policy: code })).toEqual({ allow: true });
  });

  it("denies every way out of the workspace: absolute paths, .., symlinks, absolute or escaping patterns", async () => {
    const deny = async (tool: string, input: unknown) => {
      const v = await guardToolCall(tool, input, { cwd, policy: code });
      expect(v.allow).toBe(false);
      return v;
    };
    await deny("Read", { file_path: "/proc/self/environ" });
    await deny("Read", { file_path: "/etc/passwd" });
    await deny("Read", { file_path: "../elsewhere/secret.env" });
    await deny("Read", { file_path: "src/../../elsewhere/secret.env" });
    await deny("Read", { file_path: "escape/secret.env" }); // symlinked directory
    await deny("Read", { file_path: "src/.env" }); // symlinked file
    await deny("Write", { file_path: "escape/pwned.txt", content: "x" });
    await deny("Write", { file_path: path.join(root, "0123456789abcdef-sibling", "x"), content: "x" });
    await deny("Edit", { file_path: "/home/orchestrator/.env" });
    await deny("Glob", { pattern: "/etc/**" });
    await deny("Glob", { pattern: "../**/*.env" });
    await deny("Glob", { pattern: "*.ts", path: "/" });
    await deny("Grep", { pattern: "SECRET", path: "/proc/self" });
    await deny("Grep", { pattern: "x", glob: "../../**" });
    await deny("Read", { file_path: "README.md\0/etc/passwd" });
    await deny("Read", { file_path: 42 });
    const v = await deny("Read", { file_path: "/proc/self/environ" });
    expect((v as { reason: string }).reason).toMatch(/outside the session workspace/);
  });

  it("denies every non-MCP tool outside the policy and every file tool for non-code tasks; MCP tools pass to the gateway", async () => {
    expect((await guardToolCall("Bash", { command: "cat /proc/self/environ" }, { cwd, policy: code })).allow).toBe(false);
    expect((await guardToolCall("WebFetch", { url: "http://169.254.169.254/" }, { cwd, policy: code })).allow).toBe(false);
    expect((await guardToolCall("NotebookEdit", { notebook_path: "a.ipynb" }, { cwd, policy: code })).allow).toBe(false);
    for (const t of FILE_TOOLS) expect((await guardToolCall(t, { file_path: "README.md", pattern: "*" }, { cwd, policy: research })).allow).toBe(false);
    expect(await guardToolCall("mcp__github__create_file", { path: "/etc/x" }, { cwd, policy: research })).toEqual({ allow: true });
    expect(await guardToolCall("mcp__notion__create_page", {}, { cwd, policy: code })).toEqual({ allow: true });
  });

  it("denies when the workspace itself is gone", async () => {
    const v = await guardToolCall("Read", { file_path: "README.md" }, { cwd: path.join(root, "missing"), policy: code });
    expect(v).toMatchObject({ allow: false, reason: expect.stringMatching(/workspace is gone/) });
  });

  it("maps verdicts to the SDK PreToolUse hook output", () => {
    expect(hookOutputFor({ allow: true })).toEqual({ continue: true });
    expect(hookOutputFor({ allow: false, reason: "no" })).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "no" } });
  });
});

describe("session workspace", () => {
  it("is a fresh private directory under the root, wiped on retry and removed on cleanup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "fm-sdk-ws-"));
    try {
      const cwd = await createSessionWorkspace(root, "abcdef0123456789");
      expect(path.dirname(cwd)).toBe(path.resolve(root));
      expect((await stat(cwd)).mode & 0o777).toBe(0o700);
      await writeFile(path.join(cwd, "leftover.txt"), "from a previous attempt");
      const again = await createSessionWorkspace(root, "abcdef0123456789");
      expect(again).toBe(cwd);
      await expect(stat(path.join(cwd, "leftover.txt"))).rejects.toThrow();
      expect((await stat(path.join(cwd, ".tmp"))).isDirectory()).toBe(true);
      await removeSessionWorkspace(cwd);
      await expect(stat(cwd)).rejects.toThrow();
      await removeSessionWorkspace(cwd); // idempotent
      await expect(createSessionWorkspace(root, "../escape")).rejects.toThrow(/safe directory name/);
      await expect(createSessionWorkspace(root, "short")).rejects.toThrow(/safe directory name/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("sdkEnvFor on another provider's endpoint (WP-13 T4)", () => {
  const base = { cwd: "/tmp/fm-ws", apiKey: "zai-key-" + "z".repeat(32), sessionToken: "short", sandboxEnv: { FM_SESSION_ID: "s" } };
  const endpoint = { baseURL: "https://api.z.ai/api/anthropic", modelId: "glm-5.3-flash" };

  it("sends the key as a bearer token, overrides the host's base URL and pins every model slot", () => {
    const env = sdkEnvFor({ ...base, endpoint, host: { PATH: "/bin", ANTHROPIC_BASE_URL: "https://proxy.internal" } });
    expect(env.ANTHROPIC_BASE_URL).toBe(endpoint.baseURL);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(base.apiKey);
    expect(env[SDK_MODEL_KEY_NAME]).toBeUndefined();
    for (const k of SDK_MODEL_SLOT_NAMES) expect(env[k]).toBe(endpoint.modelId);
  });

  it("refuses a sandbox env that would set a model slot, the bearer key or the base URL", () => {
    for (const k of ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) expect(() => sdkEnvFor({ ...base, endpoint, sandboxEnv: { [k]: "x" } })).toThrow(/may not set/);
  });
});
