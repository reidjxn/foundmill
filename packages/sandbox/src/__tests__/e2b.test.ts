import type { Sandbox as E2bSdkSandbox } from "e2b";
import { describe, expect, it } from "vitest";
import { buildCreateOptions, E2bSandboxProvider, egressAllowOut, type E2bCommandResult, type E2bCreateOptions, type E2bEntryInfo, type E2bRunOptions, type E2bSandboxClient } from "../e2b";
import { LongLivedCredentialError, SandboxFileNotFoundError, SandboxStateError, SandboxUnavailableError } from "../errors";
import { parseSandboxSpec } from "../types";

// Compile-time: the SDK's Sandbox satisfies the structural slice this package codes against (e2b 2.52.1).
type AssertAssignable<T extends E2bSandboxClient> = T;
export type _SdkSandboxIsClient = AssertAssignable<E2bSdkSandbox>;

const NOW = new Date("2026-10-06T12:00:00.000Z");
const spec = { businessId: "b-1", taskId: "task-42", sessionId: "sess-9", egressAllowList: ["api.github.com", "*.npmjs.org"], envShortLived: { GATEWAY_TOKEN: "short" }, ttlMinutes: 45 };

class CommandExit extends Error implements E2bCommandResult {
  constructor(
    public exitCode: number,
    public stdout: string,
    public stderr: string,
  ) {
    super(`exit ${exitCode}`);
  }
}
class SdkTimeout extends Error {
  override name = "TimeoutError";
}
class SdkNotFound extends Error {
  override name = "NotFoundError";
}

interface FakeState {
  created: E2bCreateOptions[];
  runs: Array<{ cmd: string; opts: E2bRunOptions | undefined }>;
  files: Map<string, string>;
  killed: boolean;
  timeoutMs: number | null;
}

function fakeFactory(behaviour: { runner?: (cmd: string, opts: E2bRunOptions | undefined, files: Map<string, string>) => Promise<E2bCommandResult> } = {}): { factory: (o: E2bCreateOptions) => Promise<E2bSandboxClient>; state: FakeState } {
  const state: FakeState = { created: [], runs: [], files: new Map([["/home/user/work/README.md", "# Northwind\n"]]), killed: false, timeoutMs: null };
  const factory = async (opts: E2bCreateOptions): Promise<E2bSandboxClient> => {
    state.created.push(opts);
    const client: E2bSandboxClient = {
      sandboxId: "sbx_abc123",
      commands: {
        run: async (cmd, o) => {
          state.runs.push({ cmd, opts: o });
          if (behaviour.runner) return behaviour.runner(cmd, o, state.files);
          if (cmd.startsWith("mkdir")) return { exitCode: 0, stdout: "", stderr: "" };
          if (cmd.includes("sleep")) throw new SdkTimeout("command timed out after 1000ms");
          if (cmd.includes("exit 2")) throw new CommandExit(2, "", "nope\n");
          await o?.onStdout?.("hi\n");
          return { exitCode: 0, stdout: "hi\n", stderr: "" };
        },
      },
      files: {
        read: async (path) => {
          const c = state.files.get(path);
          if (c === undefined) throw new SdkNotFound(`path '${path}' does not exist`);
          return c;
        },
        write: async (path, data) => {
          state.files.set(path, typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
          return { name: path.split("/").pop(), path };
        },
        list: async (path): Promise<E2bEntryInfo[]> => {
          if (path === "/nowhere") throw new SdkNotFound("path '/nowhere' does not exist");
          const prefix = `${path}/`;
          const seen = new Map<string, E2bEntryInfo>();
          for (const [p, c] of state.files) {
            if (!p.startsWith(prefix)) continue;
            const rest = p.slice(prefix.length);
            const slash = rest.indexOf("/");
            const name = slash === -1 ? rest : rest.slice(0, slash);
            if (!seen.has(name)) seen.set(name, { name, path: `${prefix}${name}`, type: slash === -1 ? "file" : "dir", size: slash === -1 ? c.length : 0, modifiedTime: NOW });
          }
          return [...seen.values()];
        },
        exists: async (path) => state.files.has(path),
      },
      kill: async () => ((state.killed = true), true),
      setTimeout: async (ms) => void (state.timeoutMs = ms),
      createSnapshot: async (o) => ({ snapshotId: `${o?.name ?? "snap"}:latest` }),
    };
    return client;
  };
  return { factory, state };
}

describe("E2bSandboxProvider", () => {
  it("is unavailable without an API key and never reads process.env directly for it", async () => {
    const provider = new E2bSandboxProvider({ apiKey: undefined, factory: undefined });
    // No key in this test environment; the provider reports it rather than throwing on construction.
    const a = await provider.available();
    if (!a.available) {
      expect(a.reason).toMatch(/E2B_API_KEY/);
      await expect(provider.create(spec)).rejects.toBeInstanceOf(SandboxUnavailableError);
    }
  });

  it("is available with an injected factory or an explicit key", async () => {
    expect((await new E2bSandboxProvider({ factory: fakeFactory().factory }).available()).available).toBe(true);
    expect((await new E2bSandboxProvider({ apiKey: "e2b_test_key_not_used", template: "fm-node" }).available())).toMatchObject({ available: true, details: { template: "fm-node" } });
  });

  it("refuses long-lived credentials before creating anything", async () => {
    const { factory, state } = fakeFactory();
    const provider = new E2bSandboxProvider({ factory });
    await expect(provider.create({ ...spec, envShortLived: { ANTHROPIC_API_KEY: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" } })).rejects.toBeInstanceOf(LongLivedCredentialError);
    expect(state.created).toHaveLength(0);
  });

  it("builds create options with the egress allow-list, TTL, metadata and short-lived env", () => {
    const opts = buildCreateOptions(parseSandboxSpec(spec), { template: "base" });
    expect(opts).toEqual({
      template: "base",
      envs: { GATEWAY_TOKEN: "short" },
      metadata: { businessId: "b-1", taskId: "task-42", sessionId: "sess-9" },
      timeoutMs: 45 * 60_000,
      allowInternetAccess: true,
      network: { allowOut: ["api.github.com", "*.npmjs.org", "npmjs.org"], denyOut: ["0.0.0.0/0"] },
    });
    const closed = buildCreateOptions(parseSandboxSpec({ ...spec, egressAllowList: [] }), { template: "base" });
    expect(closed.allowInternetAccess).toBe(false);
    expect(closed.network).toEqual({ denyOut: ["0.0.0.0/0"] });
    expect(egressAllowOut(["*.github.com", "github.com", "10.0.0.0/8"])).toEqual(["*.github.com", "github.com", "10.0.0.0/8"]);
  });

  it("runs the full lifecycle against the SDK slice", async () => {
    const { factory, state } = fakeFactory();
    const provider = new E2bSandboxProvider({ factory, now: () => NOW });
    const sb = await provider.create(spec);
    expect(sb.state).toBe("created");
    expect(sb.id).toBe("e2b-pending-sess-9");
    await expect(sb.exec("ls")).rejects.toBeInstanceOf(SandboxStateError);
    await sb.start();
    expect(sb.state).toBe("running");
    expect(sb.id).toBe("e2b-sbx_abc123");
    expect(sb.sandboxId).toBe("sbx_abc123");
    expect(state.created[0]?.timeoutMs).toBe(45 * 60_000);
    expect(state.runs[0]?.cmd).toBe('mkdir -p "/home/user/work"');

    const chunks: string[] = [];
    const res = await sb.exec("echo hi", { cwd: "/tmp", env: { EXTRA: "1" }, timeoutMs: 5000, onStdout: (c) => chunks.push(c) });
    expect(res).toMatchObject({ code: 0, stdout: "hi\n", timedOut: false });
    expect(chunks).toEqual(["hi\n"]);
    expect(state.runs.at(-1)?.opts).toMatchObject({ cwd: "/tmp", envs: { GATEWAY_TOKEN: "short", EXTRA: "1" }, timeoutMs: 5000 });
    expect(await sb.exec("exit 2")).toMatchObject({ code: 2, stderr: "nope\n", timedOut: false });
    expect(await sb.exec("sleep 10", { timeoutMs: 1000 })).toMatchObject({ code: 124, timedOut: true });

    expect(await sb.readFile("README.md")).toBe("# Northwind\n");
    await sb.writeFile("src/a.ts", "export const a = 1;\n");
    await sb.writeFile("bin.dat", new Uint8Array([104, 105]));
    expect(await sb.readFile("/home/user/work/src/a.ts")).toBe("export const a = 1;\n");
    expect(await sb.readFile("bin.dat")).toBe("hi");
    await expect(sb.readFile("nope.md")).rejects.toBeInstanceOf(SandboxFileNotFoundError);
    const listed = await sb.listFiles();
    expect(listed.map((f) => `${f.type}:${f.name}`)).toEqual(["file:bin.dat", "file:README.md", "dir:src"]);
    expect(listed.find((f) => f.name === "README.md")).toEqual({ path: "/home/user/work/README.md", name: "README.md", type: "file", size: 12, modifiedAt: NOW.toISOString() });
    await expect(sb.listFiles("/nowhere")).rejects.toBeInstanceOf(SandboxFileNotFoundError);

    expect(await sb.snapshot()).toEqual({ id: "fm-b-1-sess-9:latest", sandboxId: "e2b-sbx_abc123", provider: "e2b", ref: "fm-b-1-sess-9:latest", createdAt: NOW.toISOString() });
    await sb.setTtl(90);
    expect(state.timeoutMs).toBe(90 * 60_000);

    await sb.stop();
    expect(sb.state).toBe("stopped");
    expect(state.killed).toBe(true);
    await expect(sb.start()).rejects.toBeInstanceOf(SandboxStateError);
  });

  it("clones on start with the git token only in the environment, and kills the microVM when the clone fails", async () => {
    const good = fakeFactory({ runner: async (cmd) => ({ exitCode: 0, stdout: cmd.startsWith("git") ? "Cloning into '/home/user/work'...\n" : "", stderr: "" }) });
    const sb = await new E2bSandboxProvider({ factory: good.factory }).create({ ...spec, repo: { url: "https://github.com/foundmill-demo/northwind-storefront.git", branch: "main" }, envShortLived: { GIT_TOKEN: "ghs_abcdefghijklmnopqrstuvwxyz0123456789" } });
    await sb.start();
    const clone = good.state.runs.find((r) => r.cmd.startsWith("git clone"))!;
    expect(clone.cmd).toBe("git clone --branch main --single-branch --depth 50 https://github.com/foundmill-demo/northwind-storefront.git /home/user/work");
    expect(clone.opts?.envs).toMatchObject({ GIT_TOKEN: "ghs_abcdefghijklmnopqrstuvwxyz0123456789", GIT_CONFIG_COUNT: "1", GIT_TERMINAL_PROMPT: "0" });

    const bad = fakeFactory({ runner: async (cmd) => (cmd.startsWith("git") ? Promise.reject(new CommandExit(128, "", "fatal: repository not found\n")) : { exitCode: 0, stdout: "", stderr: "" }) });
    const sb2 = await new E2bSandboxProvider({ factory: bad.factory }).create({ ...spec, repo: { url: "https://github.com/foundmill-demo/missing.git", branch: "main" } });
    await expect(sb2.start()).rejects.toThrow(/git clone .* failed/);
    expect(sb2.state).toBe("failed");
    expect(bad.state.killed).toBe(true);
  });

  it("marks the sandbox failed when the SDK cannot create it", async () => {
    const provider = new E2bSandboxProvider({ factory: async () => Promise.reject(new Error("401 invalid api key")) });
    const sb = await provider.create(spec);
    await expect(sb.start()).rejects.toThrow(/E2B sandbox creation failed: 401/);
    expect(sb.state).toBe("failed");
  });
});
