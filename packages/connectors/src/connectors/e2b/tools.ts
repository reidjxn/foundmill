/**
 * E2B sandboxes — lifecycle descriptor for packages/sandbox (create / list / pause / resume / kill /
 * timeout). The live side is a thin client over the E2B REST API (api.e2b.app, `X-API-Key`) because the
 * `e2b` SDK is not a dependency of this package (docs/NEEDED_DEPS.md).
 */
import { z } from "zod";
import { defineTool } from "../../define";

export const E2B_KEY = "e2b";
export const E2B_BASE_URL = "https://api.e2b.app";

/** ≈ €0.01 per sandbox-minute for the default 2 vCPU template (estimate; E2B bills per second of vCPU/RAM). */
export const E2B_MINOR_PER_MINUTE = 1;
export const sandboxCostMinor = (timeoutSeconds: number): number => Math.max(1, Math.ceil(timeoutSeconds / 60) * E2B_MINOR_PER_MINUTE);

export const SandboxId = z.string().regex(/^[a-z0-9]{10,40}$/i, "sandbox id");
export const Sandbox = z.object({
  sandboxId: z.string(),
  templateId: z.string(),
  clientId: z.string().nullable(),
  state: z.enum(["running", "paused", "killed"]),
  startedAt: z.string(),
  endAt: z.string(),
  cpuCount: z.number().int().nullable(),
  memoryMB: z.number().int().nullable(),
  metadata: z.record(z.string(), z.string()),
  domain: z.string().nullable(),
});
export type SandboxT = z.infer<typeof Sandbox>;

const Timeout = z.number().int().min(1).max(24 * 60 * 60);

export const e2bTools = [
  defineTool({
    name: "create_sandbox",
    description: "Start an isolated sandbox from a template for an agent session. Billed per second until killed or timed out (estimate shown as cost).",
    input: z.object({ templateId: z.string().min(1).max(100).default("base"), timeoutSeconds: Timeout.default(300), metadata: z.record(z.string().max(64), z.string().max(512)).default({}), envVars: z.record(z.string().max(64), z.string().max(4096)).default({}) }),
    output: Sandbox,
    hints: { spendsMoney: true },
    costMinor: (a) => sandboxCostMinor(a.timeoutSeconds),
  }),
  defineTool({
    name: "list_sandboxes",
    description: "Running or paused sandboxes for this account, optionally filtered by metadata key=value.",
    input: z.object({ state: z.array(z.enum(["running", "paused"])).default(["running"]), metadata: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).default(50) }),
    output: z.object({ items: z.array(Sandbox) }),
    hints: {},
    annotations: { readOnlyHint: true },
  }),
  defineTool({ name: "get_sandbox", description: "Details and state of one sandbox.", input: z.object({ sandboxId: SandboxId }), output: Sandbox, hints: {}, annotations: { readOnlyHint: true } }),
  defineTool({ name: "pause_sandbox", description: "Pause a sandbox (snapshot memory; stops billing for compute).", input: z.object({ sandboxId: SandboxId }), output: z.object({ sandboxId: z.string(), state: z.literal("paused") }), hints: {} }),
  defineTool({
    name: "resume_sandbox",
    description: "Resume a paused sandbox with a new timeout.",
    input: z.object({ sandboxId: SandboxId, timeoutSeconds: Timeout.default(300) }),
    output: Sandbox,
    hints: { spendsMoney: true },
    costMinor: (a) => sandboxCostMinor(a.timeoutSeconds),
  }),
  defineTool({
    name: "set_timeout",
    description: "Extend or shorten a running sandbox's lifetime (seconds from now).",
    input: z.object({ sandboxId: SandboxId, timeoutSeconds: Timeout }),
    output: z.object({ sandboxId: z.string(), endAt: z.string() }),
    hints: { spendsMoney: true },
    costMinor: (a) => sandboxCostMinor(a.timeoutSeconds),
  }),
  defineTool({
    name: "kill_sandbox",
    description: "Kill a sandbox. Its filesystem is gone; anything worth keeping must have been pushed to a branch first.",
    input: z.object({ sandboxId: SandboxId }),
    output: z.object({ sandboxId: z.string(), state: z.literal("killed") }),
    hints: { irreversible: true },
  }),
] as const;

export const E2B_RATE_LIMITS = { perMinute: 60, perDay: 5_000 };

/* ---- Vendor shapes (OpenAPI spec, spec/openapi.yml) ---- */
export interface E2bCreateResponse { sandboxID: string; templateID: string; clientID?: string; envdVersion?: string; domain?: string }
export interface E2bListedSandbox { sandboxID: string; templateID: string; clientID?: string; startedAt: string; endAt: string; cpuCount?: number; memoryMB?: number; state: "running" | "paused"; metadata?: Record<string, string>; domain?: string }

export const mapSandbox = (s: E2bListedSandbox): SandboxT => ({ sandboxId: s.sandboxID, templateId: s.templateID, clientId: s.clientID ?? null, state: s.state, startedAt: s.startedAt, endAt: s.endAt, cpuCount: s.cpuCount ?? null, memoryMB: s.memoryMB ?? null, metadata: s.metadata ?? {}, domain: s.domain ?? null });
