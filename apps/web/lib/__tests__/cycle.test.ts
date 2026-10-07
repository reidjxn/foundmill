import { describe, expect, it } from "vitest";
import { EMPTY_CYCLE, cycleFromSnapshot, reduceCycleEvent } from "../cycle";

const deptOf = (agentId: string) => ({ a1: "d1", a2: "d2" })[agentId];

describe("cycle status", () => {
  it("derives a running cycle from running tasks", () => {
    const s = cycleFromSnapshot({ tasks: [{ status: "running", assigneeAgentId: "a1", departmentId: "d1" }, { status: "done", assigneeAgentId: "a2", departmentId: "d2" }] });
    expect(s.running).toBe(true);
    expect(s.activeDepartmentIds).toEqual(["d1"]);
    expect(s.activeAgentIds).toEqual(["a1"]);
    expect(cycleFromSnapshot({ tasks: [] }).running).toBe(false);
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
