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
  /** Max activities the main worker runs at once (cycles, plans, imports, training, vacations, session control). */
  ORCHESTRATOR_MAX_ACTIVITIES: z.coerce.number().int().positive().default(32),
  /** Max agent sessions one worker runs at once, on their own task queue (`${TEMPORAL_TASK_QUEUE}-sessions`). */
  ORCHESTRATOR_MAX_SESSIONS: z.coerce.number().int().positive().default(16),
  /** How long a session keeps its slot waiting for the founder's decision on a gated call before it ends `blocked`. */
  APPROVAL_WAIT_MINUTES: z.coerce.number().positive().default(30),
  /** How long a paused session keeps its slot before it hands it back and waits for Resume without one. */
  SESSION_PAUSE_HOLD_MINUTES: z.coerce.number().positive().default(10),
  /** Max workflow tasks one worker runs at once. */
  ORCHESTRATOR_MAX_WORKFLOWS: z.coerce.number().int().positive().default(100),
  /** Replay speed for mock sessions (1 = recorded timeline, 4 = four times faster, "inf" = emit without waiting). */
  MOCK_SESSION_SPEED: z.string().default("4"),
  /** Which recorded sessions mock mode replays on its own: "done" (sessions that end well) or "all" (failed and blocked ones too). */
  MOCK_SESSION_SCENARIOS: z.enum(["done", "all"]).default("done"),
  /** Local workspace root for live coding sessions (worktrees are created under it). */
  ORCHESTRATOR_WORKSPACE_DIR: z.string().default("/tmp/foundmill-workspaces"),
  /** Seconds between connection attempts when Temporal is unreachable (never faster than 10 s). */
  TEMPORAL_RETRY_SECONDS: z.coerce.number().min(10).default(10),
});

export interface OrchestratorEnv extends Env {
  SANDBOX_MODE: "mock" | "docker" | "e2b" | undefined;
  ORCHESTRATOR_MAX_ACTIVITIES: number;
  ORCHESTRATOR_MAX_SESSIONS: number;
  APPROVAL_WAIT_MINUTES: number;
  SESSION_PAUSE_HOLD_MINUTES: number;
  ORCHESTRATOR_MAX_WORKFLOWS: number;
  MOCK_SESSION_SCENARIOS: "done" | "all";
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
    ORCHESTRATOR_MAX_SESSIONS: extra.ORCHESTRATOR_MAX_SESSIONS,
    APPROVAL_WAIT_MINUTES: extra.APPROVAL_WAIT_MINUTES,
    SESSION_PAUSE_HOLD_MINUTES: extra.SESSION_PAUSE_HOLD_MINUTES,
    ORCHESTRATOR_MAX_WORKFLOWS: extra.ORCHESTRATOR_MAX_WORKFLOWS,
    MOCK_SESSION_SCENARIOS: extra.MOCK_SESSION_SCENARIOS,
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
