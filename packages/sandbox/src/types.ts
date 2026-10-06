/**
 * Sandbox interface shared by the E2B (live), Docker (local) and mock (replay) runners
 * (BUILD §3.1 Sandboxes, §9.3, §11.6, §13.3, §14; docs/ARCHITECTURE.md §1).
 *
 * The orchestrator's `agentSession` activity acquires a sandbox through `SandboxProvider.create(spec)`,
 * runs the agent inside it (Claude Agent SDK in live mode, a recorded replay in mock mode) and streams
 * `SessionEvent`s to `as:{sessionId}`. Session event shapes are owned by `@founder-manager/events`
 * and only re-used here.
 */
import type { SessionEvent, SessionEventInput } from "@founder-manager/events";
import { z } from "zod";

export type { SessionEvent, SessionEventInput };

/** Which runner backs a sandbox. Chosen from INTEGRATIONS_MODE and availability (see provider.ts). */
export const SANDBOX_MODES = ["mock", "docker", "e2b"] as const;
export const SandboxMode = z.enum(SANDBOX_MODES);
export type SandboxMode = (typeof SANDBOX_MODES)[number];

export const SANDBOX_STATES = ["created", "starting", "running", "stopped", "failed"] as const;
export type SandboxState = (typeof SANDBOX_STATES)[number];

/** Hostnames (`api.github.com`), wildcard hostnames (`*.github.com`), IPs or CIDR blocks. */
export const EgressAllowEntry = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*(\/\d{1,2})?$/,
    "egress allow-list entries are hostnames, *.wildcards, IPs or CIDR blocks",
  );

export const SandboxRepo = z.object({
  /** Clone URL (https). Credentials never live in the URL; a short-lived token goes in `envShortLived`. */
  url: z.string().url().max(2000),
  branch: z.string().min(1).max(200),
});
export type SandboxRepo = z.infer<typeof SandboxRepo>;

export const SandboxSpec = z.object({
  businessId: z.string().min(1),
  /** The task the agent works; the worktree branch is `agent/<taskId>` (BUILD §9.3, §11.6). */
  taskId: z.string().min(1).max(120),
  /** Agent session id (`as:{sessionId}`). Defaults to the task id in the mock runner. */
  sessionId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  repo: SandboxRepo.optional(),
  /** Hosts the sandbox may reach. Everything else is denied (BUILD §14 "sandbox egress allow-list"). */
  egressAllowList: z.array(EgressAllowEntry).max(64).default([]),
  /** Short-lived, scoped tokens only (gateway session token, GitHub App installation token...). AC-11.6.6. */
  envShortLived: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).default({}),
  /** Hard lifetime; the runner kills the sandbox when it elapses even if the session is still going. */
  ttlMinutes: z.number().int().min(1).max(24 * 60).default(60),
  /** Mock runner only: which recording to replay. Omitted → chosen deterministically from the task id. */
  recording: z.string().min(1).optional(),
});
export type SandboxSpecInput = z.input<typeof SandboxSpec>;
export type SandboxSpec = z.output<typeof SandboxSpec>;

export interface ExecOptions {
  /** Working directory inside the sandbox. Defaults to `Sandbox.workdir`. */
  cwd?: string;
  /** Extra environment for this command only (merged over the sandbox's short-lived env). */
  env?: Record<string, string>;
  /** Kill the command after this long. Default 10 minutes. */
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface ExecResult {
  /** Exit code; 124 when the command was killed by the timeout. */
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export type FileKind = "file" | "dir" | "symlink";

export interface FileEntry {
  /** Absolute path inside the sandbox. */
  path: string;
  name: string;
  type: FileKind;
  /** Bytes, when the runner knows. */
  size: number | null;
  /** ISO timestamp, when the runner knows. */
  modifiedAt: string | null;
}

export interface SandboxSnapshot {
  id: string;
  sandboxId: string;
  provider: SandboxMode;
  /** Provider-specific reference that can seed a new sandbox (E2B snapshot id, Docker image tag, mock cursor). */
  ref: string;
  createdAt: string;
}

export interface Sandbox {
  readonly id: string;
  readonly provider: SandboxMode;
  readonly spec: SandboxSpec;
  /** Default working directory (the repo checkout when `spec.repo` is set). */
  readonly workdir: string;
  readonly state: SandboxState;
  /** Boot the runner (container / microVM / replay) and clone the repo when one is given. Idempotent. */
  start(): Promise<void>;
  /** Run `cmd` through `sh -c`. Never throws on a non-zero exit; see `ExecResult.code`. */
  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<string>;
  listFiles(path?: string): Promise<FileEntry[]>;
  snapshot(): Promise<SandboxSnapshot>;
  /** Tear everything down. Idempotent; safe to call from a `finally`. */
  stop(): Promise<void>;
}

export interface ProviderAvailability {
  available: boolean;
  /** Why not, when `available` is false. */
  reason?: string;
  /** Free-form diagnostics (docker server version, E2B domain...). */
  details?: Record<string, unknown>;
}

export interface SandboxProvider {
  readonly mode: SandboxMode;
  /** Cheap, cached probe. `create()` also checks and fails with SandboxUnavailableError. */
  available(): Promise<ProviderAvailability>;
  /** Validate the spec (Zod + AC-11.6.6 credential check) and build a sandbox. Does not start it. */
  create(spec: SandboxSpecInput): Promise<Sandbox>;
}

/** Default command timeout. */
export const DEFAULT_EXEC_TIMEOUT_MS = 10 * 60 * 1000;
/** Exit code reported for a command killed by its timeout (coreutils `timeout` convention). */
export const EXIT_CODE_TIMEOUT = 124;

export function parseSandboxSpec(input: SandboxSpecInput): SandboxSpec {
  return SandboxSpec.parse(input);
}
