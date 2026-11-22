/** Autopilot's own cycles today (0084): the cycles it started on its own schedule, never a Continue run's rounds. */
import { describe, expect, it } from "vitest";
import { ownAutopilotToday } from "../autopilot";

const day = Date.UTC(2026, 10, 12);
const at = (h: number) => new Date(day + h * 3_600_000);

describe("ownAutopilotToday", () => {
  it("counts Autopilot's own starts today and what those rounds of work cost", () => {
    const events = [
      { type: "autopilot.cycle_started", occurredAt: at(2), payload: { cycleNumber: 7, cadence: "daily" } },
      { type: "cycle.completed", occurredAt: at(3), payload: { cycleNumber: 7, cost: { amountMinor: 12, currency: "USD" } } },
      // A Continue run's round: started by Autopilot's workflow, but it belongs to the founder's press.
      { type: "autopilot.cycle_started", occurredAt: at(10), payload: { cycleNumber: 8, cadence: "daily", runId: "run-1" } },
      { type: "cycle.completed", occurredAt: at(11), payload: { cycleNumber: 8, cost: { amountMinor: 90, currency: "USD" } } },
      // Yesterday's night.
      { type: "autopilot.cycle_started", occurredAt: at(-20), payload: { cycleNumber: 6, cadence: "daily" } },
      { type: "cycle.completed", occurredAt: at(-19), payload: { cycleNumber: 6, cost: { amountMinor: 14, currency: "USD" } } },
    ];
    expect(ownAutopilotToday(events, day)).toEqual({ cycles: 1, spentMinor: 12 });
    expect(ownAutopilotToday([], day)).toEqual({ cycles: 0, spentMinor: 0 });
  });
});
