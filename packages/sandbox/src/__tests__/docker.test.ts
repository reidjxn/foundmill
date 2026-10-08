import { describe, expect, it } from "vitest";
import { buildRunArgs, containerName, DockerSandboxProvider, parseFindListing, type DockerCommandOptions, type DockerCommandResult, type DockerCommandRunner } from "../docker";
import { LongLivedCredentialError, SandboxFileNotFoundError, SandboxStateError, SandboxUnavailableError } from "../errors";
import { parseSandboxSpec } from "../types";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const ok = (stdout = "", stderr = ""): DockerCommandResult => ({ code: 0, stdout, stderr, timedOut: false });
const fail = (code: number, stderr = ""): DockerCommandResult => ({ code, stdout: "", stderr, timedOut: false });

const missingDocker: DockerCommandRunner = async () => ({ code: null, stdout: "", stderr: "", timedOut: false, spawnError: { code: "ENOENT", message: "spawn docker ENOENT" } });
const daemonDown: DockerCommandRunner = async () => fail(1, "failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running");

interface Call {
  args: string[];
  opts: DockerCommandOptions;
}

/** A scripted docker: records every call and answers by the subcommand. */
function scriptedDocker(handlers: Record<string, (args: string[], opts: DockerCommandOptions) => DockerCommandResult | Promise<DockerCommandResult>>): { run: DockerCommandRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: DockerCommandRunner = async (args, opts = {}) => {
    calls.push({ args: [...args], opts });
    const handler = handlers[args[0] ?? ""];
    if (!handler) return fail(125, `unexpected docker ${args[0]}`);
    return handler([...args], opts);
  };
  return { run, calls };
}

const spec = { businessId: "b-1", taskId: "task-42", sessionId: "sess-9", egressAllowList: ["api.github.com", "*.npmjs.org"], envShortLived: { GATEWAY_TOKEN: "short", FM_SESSION_ID: "sess-9" }, ttlMinutes: 30 };

describe("DockerSandboxProvider availability", () => {
  it("degrades gracefully when the docker binary is missing", async () => {
    const provider = new DockerSandboxProvider({ run: missingDocker, now: () => NOW });
    const availability = await provider.available();
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/not installed/);
    await expect(provider.create(spec)).rejects.toBeInstanceOf(SandboxUnavailableError);
    await expect(provider.create(spec)).rejects.toMatchObject({ status: 503, provider: "docker" });
  });

  it("degrades gracefully when the daemon is unreachable", async () => {
    const provider = new DockerSandboxProvider({ run: daemonDown, now: () => NOW });
    expect(await provider.available()).toMatchObject({ available: false, reason: expect.stringMatching(/daemon unreachable/) });
    await expect(provider.create(spec)).rejects.toThrow(/unavailable/);
  });

  it("reports the server version when the daemon answers, and caches the probe", async () => {
    let probes = 0;
    const provider = new DockerSandboxProvider({
      run: async (args) => (args[0] === "version" ? (probes++, ok("29.8.2\n")) : fail(1)),
      now: () => NOW,
      egressProxyUrl: "http://fm-egress-proxy:3128",
    });
    expect(await provider.available()).toMatchObject({ available: true, details: { serverVersion: "29.8.2", egress: { proxy: "http://fm-egress-proxy:3128", network: "fm-sandbox-egress" } } });
    await provider.available();
    await provider.create(spec);
    expect(probes).toBe(1);
  });

  it("checks the credential rule before touching docker", async () => {
    const provider = new DockerSandboxProvider({ run: missingDocker });
    await expect(provider.create({ ...spec, envShortLived: { GITHUB_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" } })).rejects.toBeInstanceOf(LongLivedCredentialError);
  });
});

describe("buildRunArgs", () => {
  const base = { image: "node:22-bookworm", egressNetwork: "fm-sandbox-egress", cpus: 2, memoryMb: 4096, pidsLimit: 512, workdir: "/home/user/work" };

  it("isolates the container and runs it with no network when no proxy is configured", () => {
    const { args, env } = buildRunArgs(parseSandboxSpec(spec), base, "fm-sb-b-1-sess-9");
    expect(args.slice(0, 2)).toEqual(["run", "--detach"]);
    expect(args).toContain("--rm");
    expect(args).toEqual(expect.arrayContaining(["--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "512", "--memory", "4096m", "--cpus", "2"]));
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(args.at(-1)).toBe("mkdir -p /home/user/work && exec sleep 1800");
    // Secrets never in argv: `--env NAME` only, values travel through the client env.
    const envArgs = args.filter((_, i) => args[i - 1] === "--env");
    expect(envArgs).toEqual(["FM_SESSION_ID", "GATEWAY_TOKEN"]);
    expect(args.join(" ")).not.toContain("short");
    expect(env).toEqual({ GATEWAY_TOKEN: "short", FM_SESSION_ID: "sess-9" });
    expect(args).toEqual(expect.arrayContaining(["--label", "fm.business=b-1", "--label", "fm.task=task-42", "--label", "fm.session=sess-9", "--label", "fm.egress=api.github.com,*.npmjs.org"]));
  });

  it("joins the internal egress network and points the proxy variables at the allow-list proxy", () => {
    const { args, env } = buildRunArgs(parseSandboxSpec(spec), { ...base, egressProxyUrl: "http://fm-egress-proxy:3128" }, "n");
    expect(args[args.indexOf("--network") + 1]).toBe("fm-sandbox-egress");
    expect(env).toMatchObject({ HTTP_PROXY: "http://fm-egress-proxy:3128", HTTPS_PROXY: "http://fm-egress-proxy:3128", ALL_PROXY: "http://fm-egress-proxy:3128", NO_PROXY: "localhost,127.0.0.1", FM_EGRESS_ALLOW: "api.github.com,*.npmjs.org" });
    expect(args.filter((_, i) => args[i - 1] === "--env")).toEqual(["ALL_PROXY", "FM_EGRESS_ALLOW", "FM_SESSION_ID", "GATEWAY_TOKEN", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]);
  });

  it("an empty allow-list means no network even with a proxy configured", () => {
    const { args, env } = buildRunArgs(parseSandboxSpec({ ...spec, egressAllowList: [] }), { ...base, egressProxyUrl: "http://fm-egress-proxy:3128" }, "n");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(env.HTTP_PROXY).toBeUndefined();
  });

  it("sanitises container names", () => {
    expect(containerName("fm-sb", { businessId: "b/1 x", taskId: "t", sessionId: "s:9" })).toBe("fm-sb-b-1-x-s-9");
    expect(containerName("fm-sb", { businessId: "b", taskId: "task 1" })).toBe("fm-sb-b-task-1");
  });
});

describe("DockerSandbox lifecycle (scripted docker)", () => {
  function sandboxWith(extra: Parameters<typeof scriptedDocker>[0] = {}) {
    const files = new Map<string, string>([["/home/user/work/README.md", "# Ledgerly\n"], ["/home/user/work/src/index.ts", "export {};\n"]]);
    const script = scriptedDocker({
      version: () => ok("29.8.2\n"),
      run: () => ok("0123456789abcdef\n"),
      rm: () => ok(),
      commit: () => ok("sha256:feedface\n"),
      exec: (args, opts) => {
        const i = args.findIndex((a) => a === "fm-sb-b-1-sess-9");
        const cmd = args.slice(i + 1);
        if (cmd[0] === "cat") {
          const content = files.get(cmd[1]!);
          return content === undefined ? fail(1, `cat: ${cmd[1]}: No such file or directory`) : ok(content);
        }
        if (cmd[0] === "find") {
          const dir = cmd[1]!;
          if (dir === "/nowhere") return fail(1, `find: '/nowhere': No such file or directory`);
          const prefix = `${dir}/`;
          const lines = new Set<string>();
          for (const p of files.keys()) {
            if (!p.startsWith(prefix)) continue;
            const rest = p.slice(prefix.length);
            const slash = rest.indexOf("/");
            lines.add(slash === -1 ? `f\t${files.get(p)!.length}\t1759752000.000\t${rest}` : `d\t4096\t1759752000.000\t${rest.slice(0, slash)}`);
          }
          return ok([...lines].join("\n") + "\n");
        }
        if (cmd[0] === "sh" && cmd[1] === "-c") {
          const line = cmd[2]!;
          const write = /cat > '?([^']+)'?$/.exec(line);
          if (write) {
            files.set(write[1]!, typeof opts.stdin === "string" ? opts.stdin : Buffer.from(opts.stdin ?? "").toString("utf8"));
            return ok();
          }
          const timeout = /^timeout -k 5 (\d+) sh -c (.*)$/.exec(line);
          if (timeout) {
            const inner = timeout[2]!;
            if (inner.includes("sleep")) return fail(124);
            if (inner.includes("exit 3")) return { code: 3, stdout: "", stderr: "boom\n", timedOut: false };
            opts.onStdout?.("hello\n");
            return ok("hello\n");
          }
        }
        return fail(125, `unexpected exec ${cmd.join(" ")}`);
      },
      ...extra,
    });
    const provider = new DockerSandboxProvider({ run: script.run, now: () => NOW });
    return { provider, script, files };
  }

  it("starts, execs with timeout semantics, reads/writes/lists files, snapshots and stops", async () => {
    const { provider, script } = sandboxWith();
    const sb = await provider.create(spec);
    expect(sb.state).toBe("created");
    await expect(sb.exec("ls")).rejects.toBeInstanceOf(SandboxStateError);
    await sb.start();
    expect(sb.state).toBe("running");
    expect(sb.container).toBe("0123456789abcdef");
    expect(sb.id).toBe("docker-fm-sb-b-1-sess-9");
    await sb.start(); // idempotent
    expect(script.calls.filter((c) => c.args[0] === "run")).toHaveLength(1);

    const chunks: string[] = [];
    const res = await sb.exec("echo hello", { cwd: "/home/user/work/src", env: { EXTRA: "1" }, onStdout: (c) => chunks.push(c) });
    expect(res).toMatchObject({ code: 0, stdout: "hello\n", timedOut: false });
    expect(chunks).toEqual(["hello\n"]);
    const execCall = script.calls.at(-1)!;
    expect(execCall.args.slice(0, 3)).toEqual(["exec", "--workdir", "/home/user/work/src"]);
    expect(execCall.args.filter((_, i) => execCall.args[i - 1] === "--env")).toEqual(["EXTRA", "FM_SESSION_ID", "GATEWAY_TOKEN"]);
    expect(execCall.opts.env).toEqual({ GATEWAY_TOKEN: "short", FM_SESSION_ID: "sess-9", EXTRA: "1" });
    expect(execCall.args.at(-1)).toBe("timeout -k 5 600 sh -c 'echo hello'");

    const slow = await sb.exec("sleep 100", { timeoutMs: 2000 });
    expect(slow).toMatchObject({ code: 124, timedOut: true });
    expect(script.calls.at(-1)!.args.at(-1)).toBe("timeout -k 5 2 sh -c 'sleep 100'");
    expect(await sb.exec("exit 3")).toMatchObject({ code: 3, stderr: "boom\n", timedOut: false });

    expect(await sb.readFile("README.md")).toBe("# Ledgerly\n");
    await sb.writeFile("notes/todo.md", "- retry\n");
    expect(await sb.readFile("/home/user/work/notes/todo.md")).toBe("- retry\n");
    await sb.writeFile("bin.dat", new Uint8Array([104, 105]));
    expect(await sb.readFile("bin.dat")).toBe("hi");
    await expect(sb.readFile("missing.ts")).rejects.toBeInstanceOf(SandboxFileNotFoundError);
    const top = await sb.listFiles();
    expect(top.map((f) => `${f.type}:${f.name}`)).toEqual(["file:bin.dat", "dir:notes", "file:README.md", "dir:src"]);
    expect(top.find((f) => f.name === "README.md")).toEqual({ path: "/home/user/work/README.md", name: "README.md", type: "file", size: 11, modifiedAt: "2025-10-06T12:00:00.000Z" });
    await expect(sb.listFiles("/nowhere")).rejects.toBeInstanceOf(SandboxFileNotFoundError);

    const snap = await sb.snapshot();
    expect(snap).toMatchObject({ id: "feedface", sandboxId: sb.id, provider: "docker", createdAt: NOW.toISOString() });
    expect(snap.ref).toMatch(/^fm-sandbox-snapshot:fm-sb-b-1-sess-9-/);

    await sb.stop();
    expect(sb.state).toBe("stopped");
    expect(script.calls.at(-1)!.args).toEqual(["rm", "--force", "--volumes", "fm-sb-b-1-sess-9"]);
    await sb.stop();
    expect(script.calls.filter((c) => c.args[0] === "rm")).toHaveLength(1);
    await expect(sb.start()).rejects.toBeInstanceOf(SandboxStateError);
  });

  it("clones the repo on start with the short-lived git token in the environment only, and tears down when the clone fails", async () => {
    const { provider, script } = sandboxWith({
      exec: (args) => (args.some((a) => a.includes("git clone")) ? ok() : fail(125)),
    });
    const sb = await provider.create({ ...spec, repo: { url: "https://github.com/foundmill-demo/ledgerly.git", branch: "main" }, envShortLived: { GIT_TOKEN: "ghs_abcdefghijklmnopqrstuvwxyz0123456789" } });
    await sb.start();
    const clone = script.calls.find((c) => c.args[0] === "exec")!;
    expect(clone.args.at(-1)).toContain("git clone --branch main --single-branch --depth 50 https://github.com/foundmill-demo/ledgerly.git /home/user/work");
    expect(clone.args.join(" ")).not.toContain("ghs_");
    expect(clone.opts.env).toMatchObject({ GIT_TOKEN: "ghs_abcdefghijklmnopqrstuvwxyz0123456789", GIT_CONFIG_KEY_0: "http.extraheader", GIT_TERMINAL_PROMPT: "0" });
    expect(clone.args.filter((_, i) => clone.args[i - 1] === "--env")).toContain("GIT_CONFIG_VALUE_0");

    const broken = sandboxWith({ exec: () => fail(128, "fatal: could not read Username") });
    const sb2 = await broken.provider.create({ ...spec, repo: { url: "https://github.com/foundmill-demo/ledgerly.git", branch: "main" } });
    await expect(sb2.start()).rejects.toThrow(/git clone .* failed/);
    expect(sb2.state).toBe("failed");
    expect(broken.script.calls.at(-1)!.args[0]).toBe("rm");
  });

  it("fails start() cleanly when docker run fails", async () => {
    const { provider } = sandboxWith({ run: () => fail(125, "docker: Error response from daemon: No such image: node:22-bookworm") });
    const sb = await provider.create(spec);
    await expect(sb.start()).rejects.toThrow(/No such image/);
    expect(sb.state).toBe("failed");
  });

  it("drops the allow-list (no network) when no proxy can enforce it", async () => {
    const { provider, script } = sandboxWith();
    const sb = await provider.create(spec);
    expect(sb.spec.egressAllowList).toEqual([]);
    await sb.start();
    const run = script.calls.find((c) => c.args[0] === "run")!;
    expect(run.args[run.args.indexOf("--network") + 1]).toBe("none");
  });
});

describe("parseFindListing", () => {
  it("parses types, sizes and mtimes", () => {
    const out = "f\t12\t1759752000.5\ta.txt\nd\t4096\t1759752000\tsrc\nl\t7\t1759752001\tlink\n";
    expect(parseFindListing("/w", out)).toEqual([
      { path: "/w/a.txt", name: "a.txt", type: "file", size: 12, modifiedAt: "2025-10-06T12:00:00.500Z" },
      { path: "/w/link", name: "link", type: "symlink", size: null, modifiedAt: "2025-10-06T12:00:01.000Z" },
      { path: "/w/src", name: "src", type: "dir", size: null, modifiedAt: "2025-10-06T12:00:00.000Z" },
    ]);
    expect(parseFindListing("/", "f\t1\t1\tx\n")[0]!.path).toBe("/x");
  });
});

describe("DockerSandbox.closeEgress", () => {
  const docker = (network: () => DockerCommandResult) =>
    scriptedDocker({ version: () => ok("29.8.2\n"), run: () => ok("0123456789abcdef\n"), rm: () => ok(), network });

  it("disconnects a container that joined the egress network, and tolerates one already disconnected", async () => {
    const script = docker(() => ok());
    const sb = await new DockerSandboxProvider({ run: script.run, now: () => NOW, egressProxyUrl: "http://fm-egress-proxy:3128" }).create(spec);
    await sb.start();
    await sb.closeEgress();
    expect(script.calls.find((c) => c.args[0] === "network")?.args).toEqual(["network", "disconnect", "--force", "fm-sandbox-egress", "fm-sb-b-1-sess-9"]);
    const again = docker(() => fail(1, "Error response from daemon: container 0123 is not connected to network fm-sandbox-egress"));
    const sb2 = await new DockerSandboxProvider({ run: again.run, now: () => NOW, egressProxyUrl: "http://fm-egress-proxy:3128" }).create(spec);
    await sb2.start();
    await expect(sb2.closeEgress()).resolves.toBeUndefined();
  });

  it("has nothing to close on a --network none container, and fails loudly when docker refuses", async () => {
    const none = docker(() => ok());
    const sb = await new DockerSandboxProvider({ run: none.run, now: () => NOW }).create(spec);
    await sb.start();
    await sb.closeEgress();
    expect(none.calls.some((c) => c.args[0] === "network")).toBe(false);
    const broken = docker(() => fail(1, "permission denied"));
    const sb2 = await new DockerSandboxProvider({ run: broken.run, now: () => NOW, egressProxyUrl: "http://fm-egress-proxy:3128" }).create(spec);
    await sb2.start();
    await expect(sb2.closeEgress()).rejects.toThrow(/network disconnect failed: permission denied/);
  });
});
