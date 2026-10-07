import { describe, expect, it } from "vitest";
import { EMPTY_CYCLE, cycleFromSnapshot } from "@/lib/cycle";
import { cycleReducer, describeContinue } from "../BusinessShell";

type ContinueResult = Parameters<typeof describeContinue>[0];

const status = (over: Partial<ContinueResult["status"]> = {}): ContinueResult["status"] => ({
  running: false,
  paused: false,
  cycleId: null,
  cycleNumber: null,
  workflowId: null,
  startedAt: null,
  trigger: null,
  activeDepartmentIds: [],
  activeAgentIds: [],
  activeTaskIds: [],
  plannedTaskIds: [],
  completedCount: 0,
  lastCompletedAt: null,
  lastOutcome: null,
  nextCycleNumber: 1,
  mode: null,
  ...over,
});

const result = (over: Partial<ContinueResult>): ContinueResult => ({ action: "started", mode: "temporal", workflow: null, item: null, status: status(), continueState: { kind: "processing" }, ...over });

describe("one press of Continue (BUILD §9.4)", () => {
  it("names what happened: started on Temporal, one local note, resumed, already running", () => {
    expect(describeContinue(result({}))).toMatchObject({ title: "Cycle started", itemId: null });
    const item = { id: "11111111-1111-4111-8111-111111111111", subject: "Three decisions for the Board" } as unknown as NonNullable<ContinueResult["item"]>;
    expect(describeContinue(result({ mode: "local", item }))).toMatchObject({ title: "One new note", description: "Three decisions for the Board", itemId: item.id });
    expect(describeContinue(result({ action: "resumed" }))).toMatchObject({ title: "Cycle resumed", tone: "good" });
    expect(describeContinue(result({ action: "already_running" }))).toMatchObject({ title: "A cycle is already running" });
  });
});

describe("shell cycle reducer", () => {
  it("adopts cycle.status snapshots without letting the pulse key go backwards, and applies pause locally", () => {
    const pulsed = { ...EMPTY_CYCLE, completedCount: 3 };
    const adopted = cycleReducer(pulsed, { type: "snapshot", status: cycleFromSnapshot({ running: true, cycleId: "c4", completedCount: 1 }) });
    expect(adopted).toMatchObject({ running: true, cycleId: "c4", completedCount: 3 });
    const paused = cycleReducer(adopted, { type: "paused", paused: true });
    expect(paused.paused).toBe(true);
    const done = cycleReducer(paused, { type: "event", event: { type: "cycle.completed", payload: { outcome: "completed" } }, agentDepartment: () => null });
    expect(done).toMatchObject({ running: false, paused: false, completedCount: 4 });
  });
});
