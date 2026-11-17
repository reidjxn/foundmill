import { describe, expect, it } from "vitest";
import { TUTORLANE } from "../examples/tutorlane";
import { GLITCHWICK } from "../examples/glitchwick";
import { NORTHWIND } from "../examples/northwind";
import { continueStateFor, cycleReducer as reduceFor, cycleStatusText, initialCycleState as initialFor, type CycleAction, type CycleState } from "../cycle";

const CYCLE_OUTCOMES = TUTORLANE.deck.outcomes;
const EXAMPLE_START_CYCLE = TUTORLANE.deck.startCycle;
const cycleReducer = (state: CycleState, action: CycleAction) => reduceFor(TUTORLANE, state, action);
const initialCycleState = () => initialFor(TUTORLANE);
const run = (state: CycleState) => cycleReducer(cycleReducer(state, { type: "continue", byVisitor: true }), { type: "finish" });

describe("the landing deck's round of work", () => {
  it("starts idle on the example business's round of work, with Continue at rest", () => {
    const s = initialCycleState();
    expect(s).toMatchObject({ cycle: EXAMPLE_START_CYCLE, phase: "idle", current: null, pressed: false });
    expect(continueStateFor(s)).toEqual({ kind: "idle" });
    expect(cycleStatusText(s)).toBe(`Ready for round of work ${EXAMPLE_START_CYCLE + 1}`);
  });

  it("runs a round of work that comes back with a decision; Continue is blocked until the founder responds", () => {
    const processing = cycleReducer(initialCycleState(), { type: "continue" });
    expect(processing).toMatchObject({ phase: "processing", cycle: EXAMPLE_START_CYCLE + 1, pressed: false });
    expect(continueStateFor(processing)).toEqual({ kind: "processing" });
    // Continue does nothing while a cycle runs.
    expect(cycleReducer(processing, { type: "continue" })).toBe(processing);

    const waiting = cycleReducer(processing, { type: "finish" });
    expect(waiting.phase).toBe("decision");
    expect(waiting.current).toBe(CYCLE_OUTCOMES[0]);
    expect(continueStateFor(waiting)).toEqual({ kind: "blocked", count: 1 });
    expect(waiting.inbox[0]).toMatchObject({ title: `Round of work ${EXAMPLE_START_CYCLE + 1} note`, tone: "note" });

    const decided = cycleReducer(waiting, { type: "decide", optionId: "hold" });
    expect(decided).toMatchObject({ phase: "idle", current: null });
    expect(decided.inbox[0]).toMatchObject({ title: "Merge held for more testing", tone: "decided" });
  });

  it("brings a customer on the second round of work (gold Continue) and records it once opened", () => {
    let s = run(initialCycleState());
    s = cycleReducer(s, { type: "decide", optionId: "merge" });
    s = run(s);
    expect(s).toMatchObject({ phase: "win", pressed: true });
    expect(continueStateFor(s)).toEqual({ kind: "matchday" });
    expect(cycleStatusText(s)).toBe("A customer was won this round of work");
    s = cycleReducer(s, { type: "openWin" });
    expect(s.phase).toBe("idle");
    expect(s.inbox[0]).toMatchObject({ title: "Won: Okafor Math Tutoring", tone: "won" });
    expect(s.inbox.length).toBeLessThanOrEqual(5);
  });

  it("stopping all agents mid-cycle returns to idle without counting the round of work", () => {
    const processing = cycleReducer(initialCycleState(), { type: "continue" });
    const stopped = cycleReducer(processing, { type: "stopAll" });
    expect(stopped).toMatchObject({ phase: "idle", cycle: EXAMPLE_START_CYCLE });
    expect(stopped.inbox[0]?.title).toBe(`You stopped round of work ${EXAMPLE_START_CYCLE + 1}`);
    // Outside a running cycle it is a no-op.
    expect(cycleReducer(stopped, { type: "stopAll" })).toBe(stopped);
  });

  it("ignores answers that do not match the phase", () => {
    const idle = initialCycleState();
    expect(cycleReducer(idle, { type: "decide", optionId: "approve" })).toBe(idle);
    expect(cycleReducer(idle, { type: "openWin" })).toBe(idle);
    expect(cycleReducer(idle, { type: "finish" })).toBe(idle);
  });

  it("rounds of work through the outcomes in order", () => {
    let s = initialCycleState();
    const kinds: string[] = [];
    for (let i = 0; i < CYCLE_OUTCOMES.length + 1; i++) {
      s = run(s);
      kinds.push(s.current?.id ?? "");
      s = s.phase === "win" ? cycleReducer(s, { type: "openWin" }) : cycleReducer(s, { type: "decide", optionId: "x" });
    }
    expect(kinds).toEqual([...CYCLE_OUTCOMES.map((o) => o.id), CYCLE_OUTCOMES[0]!.id]);
  });

  it("runs on whichever business the deck shows: its own start, Chief of Staff and outcomes", () => {
    for (const business of [TUTORLANE, GLITCHWICK, NORTHWIND]) {
      const start = initialFor(business);
      expect(start.cycle).toBe(business.deck.startCycle);
      expect(start.inbox[0]!.from).toEqual(business.chief);
      expect(start.inbox[1]).toMatchObject({ title: business.deck.earlierDecision.title, tone: "decided" });
      let s = start;
      const ids: string[] = [];
      for (let i = 0; i < business.deck.outcomes.length; i++) {
        s = reduceFor(business, reduceFor(business, s, { type: "continue" }), { type: "finish" });
        ids.push(s.current!.id);
        s = reduceFor(business, s, s.phase === "win" ? { type: "openWin" } : { type: "decide", optionId: "x" });
      }
      expect(ids).toEqual(business.deck.outcomes.map((o) => o.id));
    }
  });
});
