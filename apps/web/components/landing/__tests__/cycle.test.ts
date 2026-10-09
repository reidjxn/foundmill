import { describe, expect, it } from "vitest";
import { CYCLE_OUTCOMES, EXAMPLE_START_CYCLE } from "../example";
import { continueStateFor, cycleReducer, cycleStatusText, initialCycleState, type CycleState } from "../cycle";

const run = (state: CycleState) => cycleReducer(cycleReducer(state, { type: "continue", byVisitor: true }), { type: "finish" });

describe("the landing deck's cycle", () => {
  it("starts idle on the example business's cycle, with Continue at rest", () => {
    const s = initialCycleState();
    expect(s).toMatchObject({ cycle: EXAMPLE_START_CYCLE, phase: "idle", current: null, pressed: false });
    expect(continueStateFor(s)).toEqual({ kind: "idle" });
    expect(cycleStatusText(s)).toBe(`Ready for cycle ${EXAMPLE_START_CYCLE + 1}`);
  });

  it("runs a cycle that comes back with a decision; Continue is blocked until the founder responds", () => {
    const processing = cycleReducer(initialCycleState(), { type: "continue" });
    expect(processing).toMatchObject({ phase: "processing", cycle: EXAMPLE_START_CYCLE + 1, pressed: false });
    expect(continueStateFor(processing)).toEqual({ kind: "processing" });
    // Continue does nothing while a cycle runs.
    expect(cycleReducer(processing, { type: "continue" })).toBe(processing);

    const waiting = cycleReducer(processing, { type: "finish" });
    expect(waiting.phase).toBe("decision");
    expect(waiting.current).toBe(CYCLE_OUTCOMES[0]);
    expect(continueStateFor(waiting)).toEqual({ kind: "blocked", count: 1 });
    expect(waiting.inbox[0]).toMatchObject({ title: `Cycle ${EXAMPLE_START_CYCLE + 1} note`, tone: "note" });

    const decided = cycleReducer(waiting, { type: "decide", optionId: "hold" });
    expect(decided).toMatchObject({ phase: "idle", current: null });
    expect(decided.inbox[0]).toMatchObject({ title: "Merge held for more testing", tone: "decided" });
  });

  it("brings a customer on the second cycle (gold Continue) and records it once opened", () => {
    let s = run(initialCycleState());
    s = cycleReducer(s, { type: "decide", optionId: "merge" });
    s = run(s);
    expect(s).toMatchObject({ phase: "win", pressed: true });
    expect(continueStateFor(s)).toEqual({ kind: "matchday" });
    expect(cycleStatusText(s)).toBe("A customer was won this cycle");
    s = cycleReducer(s, { type: "openWin" });
    expect(s.phase).toBe("idle");
    expect(s.inbox[0]).toMatchObject({ title: "Okafor Maths Tuition is a paying customer", tone: "won" });
    expect(s.inbox.length).toBeLessThanOrEqual(5);
  });

  it("stopping all agents mid-cycle returns to idle without counting the cycle", () => {
    const processing = cycleReducer(initialCycleState(), { type: "continue" });
    const stopped = cycleReducer(processing, { type: "stopAll" });
    expect(stopped).toMatchObject({ phase: "idle", cycle: EXAMPLE_START_CYCLE });
    expect(stopped.inbox[0]?.title).toBe(`You stopped cycle ${EXAMPLE_START_CYCLE + 1}`);
    // Outside a running cycle it is a no-op.
    expect(cycleReducer(stopped, { type: "stopAll" })).toBe(stopped);
  });

  it("ignores answers that do not match the phase", () => {
    const idle = initialCycleState();
    expect(cycleReducer(idle, { type: "decide", optionId: "approve" })).toBe(idle);
    expect(cycleReducer(idle, { type: "openWin" })).toBe(idle);
    expect(cycleReducer(idle, { type: "finish" })).toBe(idle);
  });

  it("cycles through the outcomes in order", () => {
    let s = initialCycleState();
    const kinds: string[] = [];
    for (let i = 0; i < CYCLE_OUTCOMES.length + 1; i++) {
      s = run(s);
      kinds.push(s.current?.id ?? "");
      s = s.phase === "win" ? cycleReducer(s, { type: "openWin" }) : cycleReducer(s, { type: "decide", optionId: "x" });
    }
    expect(kinds).toEqual([...CYCLE_OUTCOMES.map((o) => o.id), CYCLE_OUTCOMES[0]!.id]);
  });
});
