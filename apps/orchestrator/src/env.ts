/**
 * Orchestrator configuration (docs/ARCHITECTURE.md §3, §10).
 *
 * `loadEnv()` from @foundmill/shared is the one place that parses the platform environment. The orchestrator has a
 * handful of knobs of its own (sandbox runner, worker concurrency) that the shared schema does not declare yet; they are
 * parsed here, once, with Zod, and nowhere else reads `process.env` (recorded in docs/DECISIONS.md).
 */
import { loadEnv, type Env } from "@foundmill/shared";
import { z } from "zod";

const Extra = z.object({
  /** Sandbox runner override: mock | docker | e2b. Defaults from INTEGRATIONS_MODE (mock → mock, live → e2b/docker). */
  SANDBOX_MODE: z.enum(["mock", "docker", "e2b"]).optional(),
  /** Max activities one worker runs at once (agent sessions are the expensive ones). */
  ORCHESTRATOR_MAX_ACTIVITIES: z.coerce.number().int().positive().default(32),
  /** Max workflow tasks one worker runs at once. */
  ORCHESTRATOR_MAX_WORKFLOWS: z.coerce.number().int().positive().default(100),
  /** Replay speed for mock sessions (1 = recorded timeline, 4 = four times faster, "inf" = emit without waiting). */
  MOCK_SESSION_SPEED: z.string().default("4"),
  /** Local workspace root for live coding sessions (worktrees are created under it). */
  ORCHESTRATOR_WORKSPACE_DIR: z.string().default("/tmp/foundmill-workspaces"),
  /** Seconds between connection attempts when Temporal is unreachable (never faster than 10 s). */
  TEMPORAL_RETRY_SECONDS: z.coerce.number().min(10).default(10),
});

export interface OrchestratorEnv extends Env {
  SANDBOX_MODE: "mock" | "docker" | "e2b" | undefined;
  ORCHESTRATOR_MAX_ACTIVITIES: number;
  ORCHESTRATOR_MAX_WORKFLOWS: number;
  /** Parsed replay speed (Infinity for "inf"). */
  mockSessionSpeed: number;
  ORCHESTRATOR_WORKSPACE_DIR: string;
  TEMPORAL_RETRY_SECONDS: number;
}

let cached: OrchestratorEnv | undefined;

export function loadOrchestratorEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): OrchestratorEnv {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const base = loadEnv(overrides);
  const extra = Extra.parse({ ...process.env, ...overrides });
  const speedRaw = extra.MOCK_SESSION_SPEED.trim().toLowerCase();
  const speed = speedRaw === "inf" || speedRaw === "infinity" ? Infinity : Number(speedRaw);
  const env: OrchestratorEnv = {
    ...base,
    SANDBOX_MODE: extra.SANDBOX_MODE,
    ORCHESTRATOR_MAX_ACTIVITIES: extra.ORCHESTRATOR_MAX_ACTIVITIES,
    ORCHESTRATOR_MAX_WORKFLOWS: extra.ORCHESTRATOR_MAX_WORKFLOWS,
    mockSessionSpeed: Number.isFinite(speed) && speed > 0 ? speed : speed === Infinity ? Infinity : 4,
    ORCHESTRATOR_WORKSPACE_DIR: extra.ORCHESTRATOR_WORKSPACE_DIR,
    TEMPORAL_RETRY_SECONDS: extra.TEMPORAL_RETRY_SECONDS,
  };
  if (Object.keys(overrides).length === 0) cached = env;
  return env;
}

export const resetOrchestratorEnvCache = (): void => {
  cached = undefined;
};
