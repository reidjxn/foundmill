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
  /** Register the periodic jobs' Temporal Schedules at boot (src/schedules.ts); "off" for a worker that must not. */
  ORCHESTRATOR_SCHEDULES: z.enum(["on", "off"]).default("on"),
  /** The nightly removal of generated results from real projects (WP-02 T4): "report" counts and logs, "apply" removes. */
  MOCK_RESULTS_CLEANUP: z.enum(["off", "report", "apply"]).default("report"),
  /**
   * How many people the waitlist lets in each UTC day (WP-03 T2, `waitlist-admissions`), in `WAITLIST_ORDER`. Unset
   * means 0: nobody is admitted by number, and the sweep still emails anyone the operator admitted by hand.
   */
  WAITLIST_ADMIT_PER_DAY: z.coerce.number().int().min(0).max(1000).default(0),
  /**
   * The skills preload test (WP-06 T13; founder, Nov 18, 2026): "split" loads the coding skills marked `load: always`
   * up front in half of code sessions (by business id) and records `skills_preload` on each one's token row. Off (the
   * default) changes nothing.
   */
  SKILLS_PRELOAD: z.enum(["off", "split"]).default("off"),
  /**
   * The day the preload comparison starts counting (an ISO date): the day sign-up opens publicly (SIGNUP_OPEN on the
   * api). Seven days after it, the nightly numbers raise one operator note with each half's average cost per code task.
   * Unset: nothing is counted and no note is raised.
   */
  SKILLS_PRELOAD_FROM: z.iso.date().optional(),
  /** Port of the orchestrator's `/health` when PORT is unset (./health-server.ts). */
  ORCHESTRATOR_PORT: z.coerce.number().int().min(0).max(65_535).default(4007),
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
  ORCHESTRATOR_SCHEDULES: "on" | "off";
  ORCHESTRATOR_PORT: number;
  MOCK_RESULTS_CLEANUP: "off" | "report" | "apply";
  WAITLIST_ADMIT_PER_DAY: number;
  SKILLS_PRELOAD: "off" | "split";
  SKILLS_PRELOAD_FROM: string | undefined;
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
    ORCHESTRATOR_SCHEDULES: extra.ORCHESTRATOR_SCHEDULES,
    ORCHESTRATOR_PORT: extra.ORCHESTRATOR_PORT,
    MOCK_RESULTS_CLEANUP: extra.MOCK_RESULTS_CLEANUP,
    WAITLIST_ADMIT_PER_DAY: extra.WAITLIST_ADMIT_PER_DAY,
    SKILLS_PRELOAD: extra.SKILLS_PRELOAD,
    SKILLS_PRELOAD_FROM: extra.SKILLS_PRELOAD_FROM,
  };
  if (Object.keys(overrides).length === 0) cached = env;
  return env;
}

export const resetOrchestratorEnvCache = (): void => {
  cached = undefined;
};
