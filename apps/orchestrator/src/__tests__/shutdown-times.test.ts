import { describe, expect, it } from "vitest";
import { workerShutdownTimes } from "../index";

describe("workerShutdownTimes", () => {
  it("fits the worker's drain inside SHUTDOWN_TIMEOUT_MS: 30 s for activities, 40 s before giving up, at the 45 s default", () => {
    expect(workerShutdownTimes(45_000)).toEqual({ graceMs: 30_000, forceMs: 40_000 });
  });

  it("always leaves the closers time after the force deadline and the grace before it", () => {
    for (const budget of [1_000, 5_000, 10_000, 17_000, 45_000, 120_000]) {
      const { graceMs, forceMs } = workerShutdownTimes(budget);
      expect(graceMs).toBeGreaterThanOrEqual(1_000);
      expect(graceMs).toBeLessThan(forceMs);
      if (budget >= 10_000) expect(forceMs).toBeLessThanOrEqual(budget - 5_000);
    }
  });
});
