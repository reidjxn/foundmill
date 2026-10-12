/** Bounded, backed-off retries (retry.ts): failures in a row, the task's doubling wait and limit, the agent's rest. */
import { describe, expect, it } from "vitest";
import { AGENT_COOLDOWN_BASE_MS, AGENT_COOLDOWN_MAX_MS, TASK_RETRY_BASE_MS, TASK_RETRY_LIMIT, agentCooldown, failureStreak, taskRetry } from "../retry";

const at = (iso: string) => new Date(iso);
const ended = (outcome: string, iso: string) => ({ outcome, endedAt: iso });

describe("failureStreak", () => {
  it("counts the failures in a row from the newest session back", () => {
    expect(failureStreak([])).toEqual({ failures: 0, lastEndedAt: null });
    expect(failureStreak([ended("failed", "2026-10-12T10:00:00Z"), ended("failed", "2026-10-12T09:00:00Z"), ended("done", "2026-10-11T09:00:00Z"), ended("failed", "2026-10-10T09:00:00Z")])).toEqual({ failures: 2, lastEndedAt: at("2026-10-12T10:00:00Z") });
    expect(failureStreak([ended("done", "2026-10-12T10:00:00Z"), ended("failed", "2026-10-12T09:00:00Z")]).failures).toBe(0);
  });
});

describe("taskRetry", () => {
  const last = at("2026-10-12T10:00:00Z");
  it("waits 15 minutes after one failure, doubling after each failure in a row", () => {
    expect(taskRetry({ failures: 1, lastEndedAt: last }, new Date(last.getTime() + TASK_RETRY_BASE_MS - 1))).toMatchObject({ due: false, exhausted: false, nextAttemptAt: new Date(last.getTime() + TASK_RETRY_BASE_MS).toISOString() });
    expect(taskRetry({ failures: 1, lastEndedAt: last }, new Date(last.getTime() + TASK_RETRY_BASE_MS))).toMatchObject({ due: true, nextAttemptAt: null });
    expect(taskRetry({ failures: 3, lastEndedAt: last }, new Date(last.getTime() + 2 * TASK_RETRY_BASE_MS)).due).toBe(false);
    expect(taskRetry({ failures: 3, lastEndedAt: last }, new Date(last.getTime() + 4 * TASK_RETRY_BASE_MS)).due).toBe(true);
  });
  it("stops retrying on its own past the limit", () => {
    expect(taskRetry({ failures: TASK_RETRY_LIMIT + 1, lastEndedAt: last }, at("2027-01-01T00:00:00Z"))).toMatchObject({ due: false, exhausted: true, nextAttemptAt: null });
  });
  it("counts a failed task with no ended session as one failure", () => {
    expect(taskRetry({ failures: 0, lastEndedAt: null }, last)).toMatchObject({ failures: 1, due: true });
  });
});

describe("agentCooldown", () => {
  const last = at("2026-10-12T10:00:00Z");
  it("rests longer after each failure in a row, never longer than the cap", () => {
    expect(agentCooldown({ failures: 1, lastEndedAt: last }, new Date(last.getTime() + AGENT_COOLDOWN_BASE_MS - 1)).due).toBe(false);
    expect(agentCooldown({ failures: 1, lastEndedAt: last }, new Date(last.getTime() + AGENT_COOLDOWN_BASE_MS)).due).toBe(true);
    expect(agentCooldown({ failures: 2, lastEndedAt: last }, new Date(last.getTime() + AGENT_COOLDOWN_BASE_MS)).due).toBe(false);
    expect(agentCooldown({ failures: 20, lastEndedAt: last }, new Date(last.getTime() + AGENT_COOLDOWN_MAX_MS))).toMatchObject({ due: true, until: null });
    expect(agentCooldown({ failures: 20, lastEndedAt: last }, new Date(last.getTime() + AGENT_COOLDOWN_MAX_MS - 1)).until).toBe(new Date(last.getTime() + AGENT_COOLDOWN_MAX_MS).toISOString());
  });
});
