import { describe, expect, it } from "vitest";
import { EMPTY_CYCLE, cycleFromSnapshot, initialCycle, nextPulseKey, reduceCycleEvent, setPaused } from "../cycle";

const deptOf = (agentId: string) => ({ a1: "d1", a2: "d2" })[agentId];

describe("cycle status", () => {
  it("adopts the API's cycle.status snapshot", () => {
    const s = cycleFromSnapshot({ running: true, paused: false, cycleId: "c9", cycleNumber: 9, activeDepartmentIds: ["d1"], activeAgentIds: ["a1"], completedCount: 8, lastCompletedAt: "2026-10-06T10:00:00.000Z", lastOutcome: "completed" });
    expect(s).toEqual({ running: true, paused: false, cycleId: "c9", cycleNumber: 9, activeDepartmentIds: ["d1"], activeAgentIds: ["a1"], completedCount: 8, lastCompletedAt: "2026-10-06T10:00:00.000Z", lastOutcome: "completed", run: false, runId: null });
    expect(cycleFromSnapshot({ running: false })).toEqual(EMPTY_CYCLE);
    expect(cycleFromSnapshot({ running: false, run: { id: "r1" } })).toMatchObject({ running: false, run: true, runId: "r1" });
    expect(cycleFromSnapshot({ running: false, run: null })).toMatchObject({ run: false, runId: null });
  });

  it("follows a run (Nov 7, 2026): open from cycle.run_started across its cycles until cycle.run_ended of the same run", () => {
    let s = reduceCycleEvent(EMPTY_CYCLE, { type: "cycle.run_started", payload: { runId: "r1", firstCycleNumber: 3 } });
    expect(s).toMatchObject({ run: true, runId: "r1", running: false });
    s = reduceCycleEvent(s, { type: "cycle.started", payload: { cycleId: "c3", cycleNumber: 3 } });
    s = reduceCycleEvent(s, { type: "cycle.completed", payload: { outcome: "completed" } });
    // Between rounds: no cycle runs, the run is still open.
    expect(s).toMatchObject({ running: false, run: true });
    // The end of an older run leaves this one open.
    expect(reduceCycleEvent(s, { type: "cycle.run_ended", payload: { runId: "r0", reason: "paused" } })).toBe(s);
    expect(reduceCycleEvent(s, { type: "cycle.run_ended", payload: { runId: "r1", reason: "done" } })).toMatchObject({ run: false, runId: null });
    // Stop all agents and the end of a vacation close it too.
    expect(reduceCycleEvent(s, { type: "agents.stopped" })).toMatchObject({ run: false });
  });

  it("pause and resume are local transitions; a new cycle clears the pause", () => {
    const running = cycleFromSnapshot({ running: true, cycleId: "c1" });
    const paused = setPaused(running, true);
    expect(paused).toMatchObject({ running: true, paused: true });
    expect(setPaused(paused, true)).toBe(paused);
    expect(setPaused(paused, false)).toMatchObject({ running: true, paused: false });
    expect(reduceCycleEvent(paused, { type: "cycle.started", payload: { cycleId: "c2" } }).paused).toBe(false);
    expect(reduceCycleEvent(paused, { type: "cycle.completed", payload: {} }).paused).toBe(false);
  });

  it("follows cycle.started → task.started → task.completed → cycle.completed", () => {
    let s = reduceCycleEvent(EMPTY_CYCLE, { type: "cycle.started", payload: { cycleId: "c1", cycleNumber: 4 } }, deptOf);
    expect(s).toMatchObject({ running: true, cycleId: "c1", cycleNumber: 4 });
    s = reduceCycleEvent(s, { type: "task.started", payload: { assigneeAgentId: "a1" } }, deptOf);
    s = reduceCycleEvent(s, { type: "task.started", payload: { assigneeAgentId: "a2" } }, deptOf);
    expect(s.activeDepartmentIds).toEqual(["d1", "d2"]);
    s = reduceCycleEvent(s, { type: "task.completed", payload: { assigneeAgentId: "a1" } }, deptOf);
    expect(s.activeAgentIds).toEqual(["a2"]);
    expect(s.activeDepartmentIds).toEqual(["d2"]);
    s = reduceCycleEvent(s, { type: "cycle.completed", occurredAt: "2026-10-07T10:00:00Z", payload: { outcome: "completed" } }, deptOf);
    expect(s).toMatchObject({ running: false, activeAgentIds: [], activeDepartmentIds: [], completedCount: 1, lastCompletedAt: "2026-10-07T10:00:00Z", lastOutcome: "completed" });
  });

  it("keeps a department active while another of its agents still works", () => {
    const two = { a1: "d1", a3: "d1" } as Record<string, string>;
    let s = reduceCycleEvent(EMPTY_CYCLE, { type: "task.started", payload: { assigneeAgentId: "a1" } }, (id) => two[id]);
    s = reduceCycleEvent(s, { type: "task.started", payload: { assigneeAgentId: "a3" } }, (id) => two[id]);
    s = reduceCycleEvent(s, { type: "task.failed", payload: { assigneeAgentId: "a1" } }, (id) => two[id]);
    expect(s.activeDepartmentIds).toEqual(["d1"]);
  });

  it("ignores unknown events and clears on the kill switch", () => {
    const s = reduceCycleEvent(EMPTY_CYCLE, { type: "task.started", payload: { assigneeAgentId: "a1" } }, deptOf);
    expect(reduceCycleEvent(s, { type: "payment.received" })).toBe(s);
    expect(reduceCycleEvent(s, { type: "agents.stopped" })).toMatchObject({ running: false, activeAgentIds: [] });
  });
});

describe("Continue's pulse (audit WEB-15: it pulsed on every load of a business with finished cycles)", () => {
  it("starts from the snapshot the page arrived with, so finished cycles are counted from the first render", () => {
    expect(initialCycle({ running: false, completedCount: 3 }).completedCount).toBe(3);
    expect(initialCycle(undefined)).toBe(EMPTY_CYCLE);
  });

  it("pulses once per cycle.completed on the stream, never because a snapshot was adopted", () => {
    let key = 0;
    key = nextPulseKey(key, "cycle.started");
    key = nextPulseKey(key, "task.completed");
    expect(key).toBe(0);
    key = nextPulseKey(key, "cycle.completed");
    expect(key).toBe(1);
    expect(nextPulseKey(key, "cycle.completed")).toBe(2);
  });
});
