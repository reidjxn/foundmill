/**
 * Local Docker sandbox runner (BUILD §3.1 "Docker-based local runner in dev (same interface)", §14 "sandbox
 * egress allow-list"). Drives the `docker` CLI through `child_process` so the package needs no Docker SDK
 * and no socket access of its own.
 *
 * What it needs on the host:
 * - the `docker` binary on PATH and a reachable daemon (`docker version` must succeed). Both are probed in
 *   `available()` and again in `create()`; a missing binary or daemon fails with `SandboxUnavailableError`
 *   (503) so the orchestrator can fall back to the mock runner (docs/DECISIONS.md "No Docker on the build
 *   machine") instead of crashing.
 * - an image with `sh`, coreutils (`timeout`, `find`), `git` and the toolchain the agent needs. Default
 *   `node:22-bookworm`.
 * - **egress**: containers get no network at all (`--network none`) unless an allow-list proxy is
 *   configured. With `egressProxyUrl` set, the container joins the *internal* Docker network named by
 *   `egressNetwork` (`docker network create --internal fm-sandbox-egress`), which has no route to the
 *   outside, and receives `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` pointing at the proxy container on that
 *   network. The proxy (tinyproxy, squid, or the gateway's own forward proxy) enforces the allow-list; this
 *   runner publishes it on the container as the `fm.egress` label and inside as `FM_EGRESS_ALLOW` so a
 *   proxy that inspects containers (`docker inspect`) or a client-side wrapper can read the same list.
 *   Every outbound connection goes through the proxy's CONNECT, so a sandbox cannot bypass it (it has no
 *   other route).
 *
 * Secrets never appear in `docker` argv: `-e NAME` without a value makes the CLI read the value from the
 * client's environment, which this runner passes to the child process only (see `DockerCommandRunner`).
 *
 * TTL: the container's PID 1 is `sleep <ttl>`; when it exits Docker stops the container, so a sandbox can
 * never outlive `ttlMinutes` even if the orchestrator worker dies (`--rm` removes it too).
 */
import { spawn } from "node:child_process";
import { SandboxError, SandboxFileNotFoundError, SandboxStateError, SandboxUnavailableError } from "../errors";
import { shellQuote } from "../shell";
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  EXIT_CODE_TIMEOUT,
  parseSandboxSpec,
  type ExecOptions,
  type ExecResult,
  type FileEntry,
  type FileKind,
  type ProviderAvailability,
  type Sandbox,
  type SandboxProvider,
  type SandboxSnapshot,
  type SandboxSpec,
  type SandboxSpecInput,
  type SandboxState,
} from "../types";
import { cloneRepo, gitAuthEnv } from "../worktree";

export interface DockerCommandOptions {
  /** Written to the child's stdin, then stdin is closed. */
  stdin?: string | Uint8Array;
  /** Environment for the `docker` client process (merged over `process.env`). Values for `-e NAME` come from here. */
  env?: Record<string, string>;
  /** Kill the client after this long. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface DockerCommandResult {
  /** Exit code, or null when the process was killed (timeout/abort) or never started. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the client could not be spawned (e.g. `ENOENT`: docker is not installed). */
  spawnError?: { code?: string; message: string };
  timedOut: boolean;
}

/** Runs `docker <args>`. Injected in tests; `createSpawnRunner()` is the real one. */
export type DockerCommandRunner = (args: readonly string[], opts?: DockerCommandOptions) => Promise<DockerCommandResult>;

export function createSpawnRunner(binary = "docker"): DockerCommandRunner {
  return (args, opts = {}) =>
    new Promise<DockerCommandResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const finish = (r: DockerCommandResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        resolve(r);
      };
      const child = spawn(binary, args, { env: { ...process.env, ...(opts.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"] });
      const onAbort = () => child.kill("SIGKILL");
      const timer = opts.timeoutMs ? setTimeout(() => ((timedOut = true), child.kill("SIGKILL")), opts.timeoutMs) : null;
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => ((stdout += chunk), opts.onStdout?.(chunk)));
      child.stderr.on("data", (chunk: string) => ((stderr += chunk), opts.onStderr?.(chunk)));
      child.on("error", (err: NodeJS.ErrnoException) => finish({ code: null, stdout, stderr, spawnError: { code: err.code, message: err.message }, timedOut }));
      child.on("close", (code) => finish({ code, stdout, stderr, timedOut }));
      if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
      else child.stdin.end();
    });
}

export interface DockerSandboxOptions {
  /** Command runner; defaults to spawning `docker`. */
  run?: DockerCommandRunner;
  /** Image for new containers. Default `node:22-bookworm`. */
  image?: string;
  /** Allow-list forward proxy URL reachable from `egressNetwork` (e.g. `http://fm-egress-proxy:3128`). Absent → `--network none`. */
  egressProxyUrl?: string;
  /** Internal Docker network the proxy lives on. Default `fm-sandbox-egress`. */
  egressNetwork?: string;
  cpus?: number;
  memoryMb?: number;
  pidsLimit?: number;
  /** Working directory created inside the container. Default `/home/user/work`. */
  workdir?: string;
  /** Prefix for container names. Default `fm-sb`. */
  namePrefix?: string;
  /** Cache `available()` for this long. Default 30 s. */
  availabilityTtlMs?: number;
  /** Name of the short-lived env var that carries a git token for cloning (default `GIT_TOKEN`). */
  gitTokenEnvName?: string;
  now?: () => Date;
}

const DEFAULTS = {
  image: "node:22-bookworm",
  egressNetwork: "fm-sandbox-egress",
  cpus: 2,
  memoryMb: 4096,
  pidsLimit: 512,
  workdir: "/home/user/work",
  namePrefix: "fm-sb",
  availabilityTtlMs: 30_000,
  gitTokenEnvName: "GIT_TOKEN",
} as const;

/** Container name: `<prefix>-<businessId>-<taskId>` sanitised to Docker's `[a-zA-Z0-9][a-zA-Z0-9_.-]`. */
export function containerName(prefix: string, spec: Pick<SandboxSpec, "businessId" | "taskId" | "sessionId">): string {
  const raw = `${prefix}-${spec.businessId}-${spec.sessionId ?? spec.taskId}`.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return raw.replace(/^[^a-zA-Z0-9]+/, "x").slice(0, 120);
}

/** The `docker run` argument list for a spec. Exported so tests can assert the isolation flags. */
export function buildRunArgs(spec: SandboxSpec, opts: Required<Pick<DockerSandboxOptions, "image" | "egressNetwork" | "cpus" | "memoryMb" | "pidsLimit" | "workdir">> & Pick<DockerSandboxOptions, "egressProxyUrl">, name: string): { args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { ...spec.envShortLived };
  const args = ["run", "--detach", "--rm", "--name", name, "--hostname", "sandbox", "--init"];
  args.push("--label", `fm.business=${spec.businessId}`, "--label", `fm.task=${spec.taskId}`);
  if (spec.sessionId) args.push("--label", `fm.session=${spec.sessionId}`);
  args.push("--label", `fm.egress=${spec.egressAllowList.join(",")}`);
  // Isolation.
  args.push("--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", String(opts.pidsLimit), "--memory", `${opts.memoryMb}m`, "--cpus", String(opts.cpus));
  // Egress: nothing, or only the allow-list proxy on an internal network.
  if (opts.egressProxyUrl && spec.egressAllowList.length > 0) {
    args.push("--network", opts.egressNetwork);
    env.HTTP_PROXY = opts.egressProxyUrl;
    env.HTTPS_PROXY = opts.egressProxyUrl;
    env.ALL_PROXY = opts.egressProxyUrl;
    env.NO_PROXY = "localhost,127.0.0.1";
    env.FM_EGRESS_ALLOW = spec.egressAllowList.join(",");
  } else {
    args.push("--network", "none");
  }
  for (const key of Object.keys(env).sort()) args.push("--env", key); // value comes from the client env, never argv
  args.push("--workdir", opts.workdir, "--stop-timeout", "5");
  args.push(opts.image, "sh", "-c", `mkdir -p ${shellQuote(opts.workdir)} && exec sleep ${spec.ttlMinutes * 60}`);
  return { args, env };
}

function fileKindFromFind(letter: string): FileKind {
  if (letter === "d") return "dir";
  if (letter === "l") return "symlink";
  return "file";
}

/** Parse `find -printf '%y\t%s\t%T@\t%f\n'` output. Exported for tests. */
export function parseFindListing(dir: string, output: string): FileEntry[] {
  const prefix = dir === "/" ? "/" : `${dir.replace(/\/+$/, "")}/`;
  const entries: FileEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const [type, size, mtime, ...nameParts] = line.split("\t");
    const name = nameParts.join("\t");
    if (!type || !name) continue;
    const seconds = Number(mtime);
    entries.push({
      path: `${prefix}${name}`,
      name,
      type: fileKindFromFind(type),
      size: type === "f" && size !== undefined && size !== "" ? Number(size) : null,
      modifiedAt: Number.isFinite(seconds) ? new Date(Math.floor(seconds * 1000)).toISOString() : null,
    });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export class DockerSandbox implements Sandbox {
  readonly provider = "docker" as const;
  readonly id: string;
  readonly spec: SandboxSpec;
  readonly workdir: string;
  readonly containerName: string;
  private state_: SandboxState = "created";
  private containerId: string | null = null;
  private readonly run: DockerCommandRunner;
  private readonly opts: Required<Pick<DockerSandboxOptions, "image" | "egressNetwork" | "cpus" | "memoryMb" | "pidsLimit" | "workdir" | "gitTokenEnvName">> & Pick<DockerSandboxOptions, "egressProxyUrl">;
  private readonly now: () => Date;

  constructor(spec: SandboxSpec, run: DockerCommandRunner, options: DockerSandboxOptions = {}) {
    this.spec = spec;
    this.run = run;
    this.opts = {
      image: options.image ?? DEFAULTS.image,
      egressNetwork: options.egressNetwork ?? DEFAULTS.egressNetwork,
      cpus: options.cpus ?? DEFAULTS.cpus,
      memoryMb: options.memoryMb ?? DEFAULTS.memoryMb,
      pidsLimit: options.pidsLimit ?? DEFAULTS.pidsLimit,
      workdir: options.workdir ?? DEFAULTS.workdir,
      gitTokenEnvName: options.gitTokenEnvName ?? DEFAULTS.gitTokenEnvName,
      ...(options.egressProxyUrl ? { egressProxyUrl: options.egressProxyUrl } : {}),
    };
    this.workdir = this.opts.workdir;
    this.containerName = containerName(options.namePrefix ?? DEFAULTS.namePrefix, spec);
    this.id = `docker-${this.containerName}`;
    this.now = options.now ?? (() => new Date());
  }

  get state(): SandboxState {
    return this.state_;
  }

  /** Docker's container id once started. */
  get container(): string | null {
    return this.containerId;
  }

  async start(): Promise<void> {
    if (this.state_ === "running") return;
    if (this.state_ === "stopped" || this.state_ === "failed") throw new SandboxStateError(`Sandbox ${this.id} is ${this.state_}`);
    this.state_ = "starting";
    const { args, env } = buildRunArgs(this.spec, this.opts, this.containerName);
    const res = await this.run(args, { env, timeoutMs: 120_000 });
    if (res.spawnError || res.code !== 0) {
      this.state_ = "failed";
      const why = res.spawnError?.message ?? (res.stderr.trim() || `exit code ${res.code}`);
      throw new SandboxError(`docker run failed: ${why}`, { code: res.code, stderr: res.stderr.slice(-2000) });
    }
    this.containerId = res.stdout.trim() || null;
    this.state_ = "running";
    if (this.spec.repo) {
      const token = this.spec.envShortLived[this.opts.gitTokenEnvName];
      try {
        await cloneRepo(this, this.spec.repo, this.workdir, { ...(token ? { env: gitAuthEnv({ token }) } : {}), timeoutMs: 10 * 60 * 1000 });
      } catch (err) {
        await this.stop();
        this.state_ = "failed";
        throw err;
      }
    }
  }

  private assertRunning(): void {
    if (this.state_ !== "running") throw new SandboxStateError(`Sandbox ${this.id} is ${this.state_}; call start() first`);
  }

  private execArgs(extra: { cwd?: string; env?: Record<string, string>; interactive?: boolean }): string[] {
    const args = ["exec"];
    if (extra.interactive) args.push("--interactive");
    args.push("--workdir", extra.cwd ?? this.workdir);
    for (const key of Object.keys(extra.env ?? {}).sort()) args.push("--env", key);
    args.push(this.containerName);
    return args;
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    this.assertRunning();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const env = { ...this.spec.envShortLived, ...(opts.env ?? {}) };
    const started = this.now().getTime();
    // coreutils `timeout` kills the process tree inside the container (killing the client would not) and exits 124.
    const line = `timeout -k 5 ${seconds} sh -c ${shellQuote(cmd)}`;
    const res = await this.run([...this.execArgs({ ...(opts.cwd ? { cwd: opts.cwd } : {}), env }), "sh", "-c", line], {
      env,
      timeoutMs: timeoutMs + 15_000,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onStdout ? { onStdout: opts.onStdout } : {}),
      ...(opts.onStderr ? { onStderr: opts.onStderr } : {}),
    });
    const durationMs = this.now().getTime() - started;
    if (res.spawnError) throw new SandboxError(`docker exec could not start: ${res.spawnError.message}`);
    const timedOut = res.timedOut || res.code === EXIT_CODE_TIMEOUT;
    return { code: timedOut ? EXIT_CODE_TIMEOUT : (res.code ?? 1), stdout: res.stdout, stderr: res.stderr, timedOut, durationMs };
  }

  private absolute(p: string): string {
    return p.startsWith("/") ? p : `${this.workdir.replace(/\/+$/, "")}/${p}`;
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.assertRunning();
    const abs = this.absolute(path);
    const dir = abs.slice(0, abs.lastIndexOf("/")) || "/";
    const res = await this.run([...this.execArgs({ interactive: true }), "sh", "-c", `mkdir -p ${shellQuote(dir)} && cat > ${shellQuote(abs)}`], { stdin: content, timeoutMs: 60_000 });
    if (res.spawnError || res.code !== 0) throw new SandboxError(`writeFile ${abs} failed: ${res.spawnError?.message ?? res.stderr.trim()}`, { code: res.code });
  }

  async readFile(path: string): Promise<string> {
    this.assertRunning();
    const abs = this.absolute(path);
    const res = await this.run([...this.execArgs({}), "cat", abs], { timeoutMs: 60_000 });
    if (res.spawnError) throw new SandboxError(`readFile ${abs} failed: ${res.spawnError.message}`);
    if (res.code !== 0) {
      if (/No such file|Is a directory/i.test(res.stderr)) throw new SandboxFileNotFoundError(abs);
      throw new SandboxError(`readFile ${abs} failed with exit code ${res.code}`, { stderr: res.stderr.slice(-500) });
    }
    return res.stdout;
  }

  async listFiles(path = this.workdir): Promise<FileEntry[]> {
    this.assertRunning();
    const abs = this.absolute(path);
    const res = await this.run([...this.execArgs({}), "find", abs, "-mindepth", "1", "-maxdepth", "1", "-printf", "%y\\t%s\\t%T@\\t%f\\n"], { timeoutMs: 60_000 });
    if (res.spawnError) throw new SandboxError(`listFiles ${abs} failed: ${res.spawnError.message}`);
    if (res.code !== 0) {
      if (/No such file/i.test(res.stderr)) throw new SandboxFileNotFoundError(abs);
      throw new SandboxError(`listFiles ${abs} failed with exit code ${res.code}`, { stderr: res.stderr.slice(-500) });
    }
    return parseFindListing(abs, res.stdout);
  }

  async snapshot(): Promise<SandboxSnapshot> {
    this.assertRunning();
    const createdAt = this.now();
    const tag = `fm-sandbox-snapshot:${this.containerName}-${createdAt.getTime().toString(36)}`;
    const res = await this.run(["commit", "--pause", "--message", `snapshot of ${this.id}`, this.containerName, tag], { timeoutMs: 5 * 60_000 });
    if (res.spawnError || res.code !== 0) throw new SandboxError(`docker commit failed: ${res.spawnError?.message ?? res.stderr.trim()}`, { code: res.code });
    return { id: res.stdout.trim().replace(/^sha256:/, "") || tag, sandboxId: this.id, provider: "docker", ref: tag, createdAt: createdAt.toISOString() };
  }

  /** Containers started with `--network none` have nothing to close; one on the egress network is disconnected from it. */
  async closeEgress(): Promise<void> {
    this.assertRunning();
    if (!(this.opts.egressProxyUrl && this.spec.egressAllowList.length > 0)) return;
    const res = await this.run(["network", "disconnect", "--force", this.opts.egressNetwork, this.containerName], { timeoutMs: 60_000 });
    if (res.spawnError || (res.code !== 0 && !/is not connected/i.test(res.stderr))) throw new SandboxError(`docker network disconnect failed: ${res.spawnError?.message ?? res.stderr.trim()}`, { code: res.code });
  }

  async stop(): Promise<void> {
    if (this.state_ === "stopped") return;
    const wasStarted = this.state_ === "running" || this.state_ === "starting" || this.containerId !== null;
    this.state_ = "stopped";
    if (wasStarted) await this.run(["rm", "--force", "--volumes", this.containerName], { timeoutMs: 60_000 });
  }
}

export class DockerSandboxProvider implements SandboxProvider {
  readonly mode = "docker" as const;
  private readonly run: DockerCommandRunner;
  private readonly options: DockerSandboxOptions;
  private cached: { at: number; value: ProviderAvailability } | null = null;

  constructor(options: DockerSandboxOptions = {}) {
    this.options = options;
    this.run = options.run ?? createSpawnRunner();
  }

  /** `docker version` against the daemon; cached for `availabilityTtlMs`. Never throws. */
  async available(): Promise<ProviderAvailability> {
    const now = (this.options.now ?? (() => new Date()))().getTime();
    const ttl = this.options.availabilityTtlMs ?? DEFAULTS.availabilityTtlMs;
    if (this.cached && now - this.cached.at < ttl) return this.cached.value;
    const value = await this.probe();
    this.cached = { at: now, value };
    return value;
  }

  private async probe(): Promise<ProviderAvailability> {
    const res = await this.run(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 10_000 });
    if (res.spawnError) {
      const reason = res.spawnError.code === "ENOENT" ? "docker is not installed (binary not found on PATH)" : `docker could not be started: ${res.spawnError.message}`;
      return { available: false, reason, details: { spawnError: res.spawnError.code ?? null } };
    }
    if (res.timedOut) return { available: false, reason: "docker daemon did not answer within 10 s" };
    if (res.code !== 0 || !res.stdout.trim()) {
      return { available: false, reason: `docker daemon unreachable: ${res.stderr.trim().split("\n")[0] || `exit code ${res.code}`}`, details: { code: res.code } };
    }
    return {
      available: true,
      details: {
        serverVersion: res.stdout.trim(),
        image: this.options.image ?? DEFAULTS.image,
        egress: this.options.egressProxyUrl ? { proxy: this.options.egressProxyUrl, network: this.options.egressNetwork ?? DEFAULTS.egressNetwork } : "none",
      },
    };
  }

  /** Validates the spec and the credential rule, then checks Docker is reachable. Does not start the container. */
  async create(input: SandboxSpecInput): Promise<DockerSandbox> {
    const spec = parseSandboxSpec(input);
    const { assertNoLongLivedCredentials } = await import("../credentials");
    assertNoLongLivedCredentials(spec.envShortLived);
    const availability = await this.available();
    if (!availability.available) throw new SandboxUnavailableError("docker", availability.reason ?? "unavailable", availability.details);
    if (spec.egressAllowList.length > 0 && !this.options.egressProxyUrl) {
      // Honest degradation: without a proxy the allow-list cannot be enforced, so the container gets no network.
      // Surface it on the sandbox rather than silently granting open egress.
      return new DockerSandbox({ ...spec, egressAllowList: [] }, this.run, this.options);
    }
    return new DockerSandbox(spec, this.run, this.options);
  }
}

/** Exported for the orchestrator's health panel: one line a human can act on. */
export function describeDockerRequirements(): string {
  return [
    "docker binary on PATH and a reachable daemon;",
    `an image with sh, coreutils, git (default ${DEFAULTS.image});`,
    `for egress, an allow-list forward proxy on the internal network ${DEFAULTS.egressNetwork} (docker network create --internal ${DEFAULTS.egressNetwork}) passed as egressProxyUrl, otherwise containers run with --network none.`,
  ].join(" ");
}
