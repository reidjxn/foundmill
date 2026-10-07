import { describe, expect, it } from "vitest";
import { FakeClock, agentHoursToMs } from "../clock";
import { computeHealth, errorRate, type HealthSignals } from "../health";

const base: HealthSignals = { heartbeatAgeMs: 1_000, errorRate: 0, loopDetected: false, credentialExpired: false, rateLimited: false, budgetRemainingMinor: 10_000, paused: false, active: true };

describe("computeHealth (BUILD §9.10)", () => {
  it("healthy when active with a fresh heartbeat and errors under 10 %", () => {
    expect(computeHealth(base).status).toBe("healthy");
    expect(computeHealth({ ...base, errorRate: 0.1 }).status).toBe("healthy");
  });
  it("degraded above 10 % errors, failing above 50 %", () => {
    expect(computeHealth({ ...base, errorRate: 0.11 }).status).toBe("degraded");
    expect(computeHealth({ ...base, errorRate: 0.51 }).status).toBe("failing");
  });
  it("loop → failing; expired credential → injured with expected return; paused wins over everything", () => {
    expect(computeHealth({ ...base, loopDetected: true }).status).toBe("failing");
    const injured = computeHealth({ ...base, credentialExpired: true, expectedReturnAt: "2026-10-06T00:00:00.000Z" });
    expect(injured.status).toBe("injured");
    expect(injured.expectedReturnAt).toBe("2026-10-06T00:00:00.000Z");
    expect(computeHealth({ ...base, loopDetected: true, credentialExpired: true, paused: true }).status).toBe("paused");
  });
  it("stale heartbeats degrade then fail; idle without a session; budget exhaustion pauses", () => {
    expect(computeHealth({ ...base, heartbeatAgeMs: 6 * 60_000 }).status).toBe("degraded");
    expect(computeHealth({ ...base, heartbeatAgeMs: 16 * 60_000 }).status).toBe("failing");
    expect(computeHealth({ ...base, active: false, heartbeatAgeMs: null }).status).toBe("idle");
    expect(computeHealth({ ...base, budgetRemainingMinor: 0 }).status).toBe("paused");
    expect(computeHealth({ ...base, rateLimited: true }).status).toBe("degraded");
  });
  it("errorRate", () => {
    expect(errorRate(0, 0)).toBeNull();
    expect(errorRate(1, 4)).toBe(0.25);
  });
});

describe("FakeClock (BUILD §13.3 fake clock)", () => {
  it("advances deterministically and wakes sleepers in order", async () => {
    const clock = new FakeClock("2026-10-05T08:00:00.000Z");
    const order: string[] = [];
    const a = clock.sleep(5_000).then(() => order.push(`a@${clock.now().toISOString()}`));
    const b = clock.sleep(1_000).then(() => order.push(`b@${clock.now().toISOString()}`));
    expect(clock.pending).toBe(2);
    await clock.advance(999);
    expect(order).toEqual([]);
    await clock.advance(1);
    await b;
    expect(order).toEqual(["b@2026-10-05T08:00:01.000Z"]);
    await clock.advance(agentHoursToMs(1));
    await a;
    expect(order[1]).toBe("a@2026-10-05T08:00:05.000Z");
    expect(clock.now().toISOString()).toBe("2026-10-05T09:00:01.000Z");
    expect(clock.pending).toBe(0);
  });
  it("never moves backwards and honours abort", async () => {
    const clock = new FakeClock(1_000);
    await expect(clock.set(500)).rejects.toThrow(/backwards/);
    const ac = new AbortController();
    const p = clock.sleep(10_000, ac.signal);
    ac.abort(new Error("stop"));
    await expect(p).rejects.toThrow("stop");
    expect(clock.pending).toBe(0);
  });
});
