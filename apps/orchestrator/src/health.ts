/**
 * Agent health (BUILD §9.10). Computed from heartbeat age, error rate (> 10 % → degraded), loop detection (→ failing),
 * credential status (expired → injured with an expected return), rate-limit hits and budget remaining. Pure: the
 * `refreshAgentHealth` activity feeds it and emits `agent.health_changed` when the status moves.
 */
import type { AgentStatus } from "@foundmill/shared";

export interface HealthSignals {
  /** Age of the last heartbeat for the agent's open session (null when no session is open). */
  heartbeatAgeMs: number | null;
  /** Failed tool calls / total over the window (null when the agent made no calls). */
  errorRate: number | null;
  loopDetected: boolean;
  credentialExpired: boolean;
  rateLimited: boolean;
  /** Remaining monthly budget / wage cap in minor units (null when uncapped). */
  budgetRemainingMinor: number | null;
  /** The founder (or kill switch) paused the agent. */
  paused: boolean;
  /** A session is open for the agent right now. */
  active: boolean;
  /** When a lapsed credential or rate limit is expected to clear. */
  expectedReturnAt?: string | null;
}

export interface HealthVerdict {
  status: AgentStatus;
  reason: string;
  expectedReturnAt: string | null;
}

export const HEARTBEAT_DEGRADED_MS = 5 * 60 * 1000;
export const HEARTBEAT_FAILING_MS = 15 * 60 * 1000;
export const ERROR_RATE_DEGRADED = 0.1;
export const ERROR_RATE_FAILING = 0.5;

export function computeHealth(s: HealthSignals): HealthVerdict {
  if (s.paused) return { status: "paused", reason: "paused by the founder or the kill switch", expectedReturnAt: null };
  if (s.credentialExpired) return { status: "injured", reason: "a credential this agent depends on has expired", expectedReturnAt: s.expectedReturnAt ?? null };
  if (s.budgetRemainingMinor !== null && s.budgetRemainingMinor <= 0) return { status: "paused", reason: "wage cap reached for the period", expectedReturnAt: s.expectedReturnAt ?? null };
  if (s.loopDetected) return { status: "failing", reason: "loop detected: the same tool call repeated three times in a row", expectedReturnAt: null };
  if (s.errorRate !== null && s.errorRate > ERROR_RATE_FAILING) return { status: "failing", reason: `error rate ${Math.round(s.errorRate * 100)} % over the window`, expectedReturnAt: null };
  if (s.active && s.heartbeatAgeMs !== null && s.heartbeatAgeMs > HEARTBEAT_FAILING_MS) return { status: "failing", reason: `no heartbeat for ${Math.round(s.heartbeatAgeMs / 60000)} min`, expectedReturnAt: null };
  if (s.errorRate !== null && s.errorRate > ERROR_RATE_DEGRADED) return { status: "degraded", reason: `error rate ${Math.round(s.errorRate * 100)} % over the window`, expectedReturnAt: null };
  if (s.rateLimited) return { status: "degraded", reason: "rate limited; backing off", expectedReturnAt: s.expectedReturnAt ?? null };
  if (s.active && s.heartbeatAgeMs !== null && s.heartbeatAgeMs > HEARTBEAT_DEGRADED_MS) return { status: "degraded", reason: `heartbeat is ${Math.round(s.heartbeatAgeMs / 60000)} min old`, expectedReturnAt: null };
  if (!s.active) return { status: "idle", reason: "no open session", expectedReturnAt: null };
  return { status: "healthy", reason: "heartbeat fresh, errors under 10 %", expectedReturnAt: null };
}

/** Error rate from counts; null when nothing happened. */
export function errorRate(failed: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, failed / total));
}
