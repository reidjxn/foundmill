/**
 * E2B sandbox runner (BUILD §3.1 "E2B microVMs in prod"). Built on the `e2b` SDK 2.52.1
 * (`Sandbox.create`, `sandbox.commands.run`, `sandbox.files.*`, `sandbox.createSnapshot`, `sandbox.kill`;
 * verified against the package's own type declarations on 2026-10-06).
 *
 * The SDK is reached through a small structural interface (`E2bSandboxClient`) and a factory so tests run
 * against fakes without the network, and the real factory imports `e2b` lazily, which keeps the package
 * cheap to load in mock mode.
 *
 * Egress (BUILD §14): `network.allowOut = spec.egressAllowList` with `denyOut = [all traffic]`, which E2B
 * documents as "deny everything except the listed hosts"; an empty allow-list sets `allowInternetAccess:
 * false`. Entries are passed as given (hostnames, IPs, CIDR blocks); E2B's filter matches hostnames by SNI /
 * Host, so wildcards are expanded to their apex as well (`*.github.com` → `*.github.com` + `github.com`).
 *
 * Credentials (AC-11.6.6): the spec's `envShortLived` is the sandbox's environment; the E2B API key itself
 * stays in this process and is never passed into the sandbox. The key comes from `E2B_API_KEY`
 * (`loadEnv()`), not from `process.env` directly.
 */
import { loadEnv } from "@foundmill/shared";
import { SandboxError, SandboxFileNotFoundError, SandboxStateError, SandboxUnavailableError } from "../errors";
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

/** Structural slice of e2b's `CommandResult`. */
export interface E2bCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface E2bRunOptions {
  cwd?: string;
  envs?: Record<string, string>;
  timeoutMs?: number;
  onStdout?: (data: string) => void | Promise<void>;
  onStderr?: (data: string) => void | Promise<void>;
  background?: false;
}

export interface E2bEntryInfo {
  name: string;
  path: string;
  type?: string;
  size?: number;
  modifiedTime?: Date;
}

/** Structural slice of e2b's `Sandbox` (asserted assignable in `e2b.test.ts`). */
export interface E2bSandboxClient {
  readonly sandboxId: string;
  readonly commands: { run(cmd: string, opts?: E2bRunOptions): Promise<E2bCommandResult> };
  readonly files: {
    read(path: string, opts?: { format?: "text" }): Promise<string>;
    write(path: string, data: string | ArrayBuffer): Promise<unknown>;
    list(path: string, opts?: { depth?: number }): Promise<E2bEntryInfo[]>;
    exists(path: string): Promise<boolean>;
  };
  kill(): Promise<boolean>;
  setTimeout(timeoutMs: number): Promise<void>;
  createSnapshot(opts?: { name?: string }): Promise<{ snapshotId: string }>;
  /** Replaces every egress rule at once; fields left out are cleared (e2b `Sandbox.updateNetwork`). */
  updateNetwork(network: { allowOut?: string[]; denyOut?: string[] }): Promise<void>;
}

export interface E2bCreateOptions {
  template?: string;
  envs?: Record<string, string>;
  metadata?: Record<string, string>;
  timeoutMs?: number;
  allowInternetAccess?: boolean;
  network?: { allowOut?: string[]; denyOut?: string[] };
}

export type E2bSandboxFactory = (opts: E2bCreateOptions) => Promise<E2bSandboxClient>;

export interface E2bSandboxOptions {
  /** E2B API key. Default `E2B_API_KEY` from `loadEnv()`. */
  apiKey?: string;
  /** E2B domain for self-hosted / BYOC deployments. */
  domain?: string;
  /** Template name or id. Default `base`. */
  template?: string;
  /** Working directory inside the microVM. Default `/home/user/work`. */
  workdir?: string;
  /** Creates sandboxes; default uses the `e2b` SDK. Injected in tests. */
  factory?: E2bSandboxFactory;
  /** Name of the short-lived env var that carries a git token for cloning (default `GIT_TOKEN`). */
  gitTokenEnvName?: string;
  now?: () => Date;
}

export const E2B_ALL_TRAFFIC = "0.0.0.0/0";

/** `allowOut` list for E2B: entries as given, plus the apex for wildcards. Exported for tests. */
export function egressAllowOut(allowList: readonly string[]): string[] {
  const out = new Set<string>();
  for (const entry of allowList) {
    out.add(entry);
    if (entry.startsWith("*.")) out.add(entry.slice(2));
  }
  return [...out];
}

/**
 * The longest lifetime E2B accepts on the Hobby plan: past it, `Sandbox.create` and `setTimeout` refuse with "400:
 * Timeout cannot be greater than 1 hours" (23 blocked sessions, Oct 9 to 14, 2026). Every lifetime is capped here.
 * shortcut: Hobby's limit for every account, raise it when production moves to E2B Pro (24 hours).
 */
export const E2B_MAX_TTL_MINUTES = 60;
const e2bTimeoutMs = (minutes: number) => Math.min(E2B_MAX_TTL_MINUTES, Math.max(1, Math.round(minutes))) * 60_000;

/** Build the SDK create options for a spec. Exported for tests. */
export function buildCreateOptions(spec: SandboxSpec, opts: { template: string }): E2bCreateOptions {
  const allowOut = egressAllowOut(spec.egressAllowList);
  return {
    template: opts.template,
    envs: { ...spec.envShortLived },
    metadata: { businessId: spec.businessId, taskId: spec.taskId, ...(spec.sessionId ? { sessionId: spec.sessionId } : {}), ...(spec.agentId ? { agentId: spec.agentId } : {}) },
    timeoutMs: e2bTimeoutMs(spec.ttlMinutes),
    allowInternetAccess: allowOut.length > 0,
    network: allowOut.length > 0 ? { allowOut, denyOut: [E2B_ALL_TRAFFIC] } : { denyOut: [E2B_ALL_TRAFFIC] },
  };
}

/** The real factory: lazy `import("e2b")`, a client bound to this key/domain, `Sandbox.create(template, opts)`. */
export function createE2bFactory(connection: { apiKey: string; domain?: string }): E2bSandboxFactory {
  return async (opts) => {
    const { E2B } = await import("e2b");
    const client = new E2B({ apiKey: connection.apiKey, ...(connection.domain ? { domain: connection.domain } : {}) });
    const { template = "base", ...rest } = opts;
    const sandbox = await client.Sandbox.create(template, rest);
    return sandbox;
  };
}

function isCommandExit(err: unknown): err is E2bCommandResult {
  return typeof err === "object" && err !== null && typeof (err as { exitCode?: unknown }).exitCode === "number" && typeof (err as { stdout?: unknown }).stdout === "string";
}

function isTimeout(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; message?: unknown };
  return e.name === "TimeoutError" || (typeof e.message === "string" && /timed? ?out/i.test(e.message));
}

function fileKind(type: string | undefined): FileKind {
  if (type === "dir") return "dir";
  if (type === "symlink") return "symlink";
  return "file";
}

export class E2bSandbox implements Sandbox {
  readonly provider = "e2b" as const;
  readonly spec: SandboxSpec;
  readonly workdir: string;
  private id_: string;
  private state_: SandboxState = "created";
  private client: E2bSandboxClient | null = null;
  private readonly factory: E2bSandboxFactory;
  private readonly template: string;
  private readonly gitTokenEnvName: string;
  private readonly now: () => Date;

  constructor(spec: SandboxSpec, factory: E2bSandboxFactory, options: Pick<E2bSandboxOptions, "template" | "workdir" | "gitTokenEnvName" | "now"> = {}) {
    this.spec = spec;
    this.factory = factory;
    this.template = options.template ?? "base";
    this.workdir = options.workdir ?? "/home/user/work";
    this.gitTokenEnvName = options.gitTokenEnvName ?? "GIT_TOKEN";
    this.now = options.now ?? (() => new Date());
    this.id_ = `e2b-pending-${spec.sessionId ?? spec.taskId}`;
  }

  /** `e2b-<sandboxId>` once started; a pending id before. */
  get id(): string {
    return this.id_;
  }

  get state(): SandboxState {
    return this.state_;
  }

  /** The SDK sandbox id, when started. */
  get sandboxId(): string | null {
    return this.client?.sandboxId ?? null;
  }

  async start(): Promise<void> {
    if (this.state_ === "running") return;
    if (this.state_ === "stopped" || this.state_ === "failed") throw new SandboxStateError(`Sandbox ${this.id_} is ${this.state_}`);
    this.state_ = "starting";
    try {
      this.client = await this.factory(buildCreateOptions(this.spec, { template: this.template }));
    } catch (err) {
      this.state_ = "failed";
      throw new SandboxError(`E2B sandbox creation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.id_ = `e2b-${this.client.sandboxId}`;
    this.state_ = "running";
    const mk = await this.client.commands.run(`mkdir -p ${JSON.stringify(this.workdir)}`, { timeoutMs: 30_000 }).catch((e: unknown) => (isCommandExit(e) ? e : null));
    if (mk && mk.exitCode !== 0) {
      await this.stop();
      this.state_ = "failed";
      throw new SandboxError(`could not create ${this.workdir} in the E2B sandbox`, { stderr: mk.stderr.slice(-500) });
    }
    if (this.spec.repo) {
      const token = this.spec.envShortLived[this.gitTokenEnvName];
      try {
        await cloneRepo(this, this.spec.repo, this.workdir, { ...(token ? { env: gitAuthEnv({ token }) } : {}), timeoutMs: 10 * 60 * 1000 });
      } catch (err) {
        await this.stop();
        this.state_ = "failed";
        throw err;
      }
    }
  }

  private running(): E2bSandboxClient {
    if (this.state_ !== "running" || !this.client) throw new SandboxStateError(`Sandbox ${this.id_} is ${this.state_}; call start() first`);
    return this.client;
  }

  private absolute(p: string): string {
    return p.startsWith("/") ? p : `${this.workdir.replace(/\/+$/, "")}/${p}`;
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const client = this.running();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const started = this.now().getTime();
    const run: E2bRunOptions = {
      cwd: opts.cwd ?? this.workdir,
      envs: { ...this.spec.envShortLived, ...(opts.env ?? {}) },
      timeoutMs,
      ...(opts.onStdout ? { onStdout: opts.onStdout } : {}),
      ...(opts.onStderr ? { onStderr: opts.onStderr } : {}),
    };
    let result: E2bCommandResult;
    let timedOut = false;
    try {
      result = await client.commands.run(cmd, run);
    } catch (err) {
      if (isCommandExit(err)) result = err;
      else if (isTimeout(err)) {
        timedOut = true;
        result = { exitCode: EXIT_CODE_TIMEOUT, stdout: "", stderr: err instanceof Error ? err.message : "command timed out" };
      } else throw new SandboxError(`E2B command failed to run: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { code: timedOut ? EXIT_CODE_TIMEOUT : result.exitCode, stdout: result.stdout, stderr: result.stderr, timedOut, durationMs: this.now().getTime() - started };
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const client = this.running();
    const data = typeof content === "string" ? content : content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
    await client.files.write(this.absolute(path), data as string | ArrayBuffer);
  }

  async readFile(path: string): Promise<string> {
    const client = this.running();
    const abs = this.absolute(path);
    try {
      return await client.files.read(abs, { format: "text" });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "NotFoundError" || e?.name === "FileNotFoundError" || /not found|no such file/i.test(e?.message ?? "")) throw new SandboxFileNotFoundError(abs);
      throw new SandboxError(`readFile ${abs} failed: ${e?.message ?? String(err)}`);
    }
  }

  async listFiles(path = this.workdir): Promise<FileEntry[]> {
    const client = this.running();
    const abs = this.absolute(path);
    let entries: E2bEntryInfo[];
    try {
      entries = await client.files.list(abs, { depth: 1 });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "NotFoundError" || /not found|no such file/i.test(e?.message ?? "")) throw new SandboxFileNotFoundError(abs);
      throw new SandboxError(`listFiles ${abs} failed: ${e?.message ?? String(err)}`);
    }
    return entries
      .map((e) => ({
        path: e.path || `${abs.replace(/\/+$/, "")}/${e.name}`,
        name: e.name,
        type: fileKind(e.type),
        size: typeof e.size === "number" ? e.size : null,
        modifiedAt: e.modifiedTime instanceof Date ? e.modifiedTime.toISOString() : null,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async snapshot(): Promise<SandboxSnapshot> {
    const client = this.running();
    const createdAt = this.now();
    const name = `fm-${this.spec.businessId}-${this.spec.sessionId ?? this.spec.taskId}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100);
    const info = await client.createSnapshot({ name });
    return { id: info.snapshotId, sandboxId: this.id_, provider: "e2b", ref: info.snapshotId, createdAt: createdAt.toISOString() };
  }

  /** Extend or shorten the microVM's lifetime (the orchestrator heartbeat can keep a long session alive). */
  async setTtl(minutes: number): Promise<void> {
    await this.running().setTimeout(e2bTimeoutMs(minutes));
  }

  async closeEgress(): Promise<void> {
    // The update replaces the whole rule set: no allowOut, everything denied.
    await this.running().updateNetwork({ denyOut: [E2B_ALL_TRAFFIC] });
  }

  async stop(): Promise<void> {
    if (this.state_ === "stopped") return;
    const client = this.client;
    this.state_ = "stopped";
    if (client) await client.kill().catch(() => false);
  }
}

export class E2bSandboxProvider implements SandboxProvider {
  readonly mode = "e2b" as const;
  private readonly options: E2bSandboxOptions;
  private readonly apiKey: string | undefined;

  constructor(options: E2bSandboxOptions = {}) {
    this.options = options;
    this.apiKey = options.apiKey ?? (options.factory ? undefined : loadEnv().E2B_API_KEY);
  }

  async available(): Promise<ProviderAvailability> {
    if (this.options.factory) return { available: true, details: { factory: "injected", template: this.options.template ?? "base" } };
    if (!this.apiKey) return { available: false, reason: "E2B_API_KEY is not set" };
    return { available: true, details: { template: this.options.template ?? "base", domain: this.options.domain ?? "e2b.app" } };
  }

  /** Validates the spec and the credential rule; refuses when no key or factory exists. Does not start the microVM. */
  async create(input: SandboxSpecInput): Promise<E2bSandbox> {
    const spec = parseSandboxSpec(input);
    const { assertNoLongLivedCredentials } = await import("../credentials");
    assertNoLongLivedCredentials(spec.envShortLived);
    const availability = await this.available();
    if (!availability.available) throw new SandboxUnavailableError("e2b", availability.reason ?? "unavailable");
    const factory = this.options.factory ?? createE2bFactory({ apiKey: this.apiKey!, ...(this.options.domain ? { domain: this.options.domain } : {}) });
    return new E2bSandbox(spec, factory, this.options);
  }
}
