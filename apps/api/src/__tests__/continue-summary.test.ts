/**
 * The sentence one press of Continue earns (first-time founder report, Nov 8, 2026): exactly one of started (with how
 * much is ready), nothing ready (and why), the orchestrator is not reachable (no agent worked), resumed, already running.
 */
import { RUN_UNTIL_DONE } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { alreadyRunningSummary, nothingReadyDetail, orchestratorUnreachableSummary, resumedSummary, startedSummary } from "../services/continue-summary";

describe("the sentence a press of Continue earns", () => {
  it("a round of work the orchestrator took says how many tasks are ready, and that rounds of work keep coming during a run", () => {
    const s = startedSummary({ cycleNumber: 2, readyTasks: 6, stage: "building", run: true });
    expect(s).toMatchObject({ kind: "started", headline: "Round of work 2 started: 6 tasks ready to build", plainHeadline: "The next round of work started: 6 tasks ready to build", readyTasks: 6, orchestrator: true });
    // "Cycle" and its number are Builder view's (PR #66): every plain headline says "round of work", as the live feed and the team's notes do.
    for (const plain of [s.plainHeadline, startedSummary({ cycleNumber: 1, readyTasks: 0, stage: "drafting", run: false }).plainHeadline, resumedSummary({ cycleNumber: 4, readyTasks: 0, stage: "building", run: false, resumedTasks: 1 }).plainHeadline, alreadyRunningSummary({ cycleNumber: 5, readyTasks: 0, stage: "selling", run: false }).plainHeadline]) {
      expect(plain).not.toMatch(/cycle/i);
      expect(plain).toMatch(/round of work/);
    }
    expect(s.detail).toContain(RUN_UNTIL_DONE);
    expect(startedSummary({ cycleNumber: 3, readyTasks: 1, stage: "building", run: false }).headline).toBe("Round of work 3 started: 1 task ready to build");
    expect(startedSummary({ cycleNumber: 3, readyTasks: 1, stage: "building", run: false }).detail).not.toContain(RUN_UNTIL_DONE);
  });

  it("nothing ready says why, by stage: the sign-off, the drafting, or a finished plan", () => {
    const waiting = startedSummary({ cycleNumber: 1, readyTasks: 0, stage: "awaiting_signoff", run: true });
    expect(waiting).toMatchObject({ kind: "nothing_ready", headline: "Round of work 1 started: nothing is ready to build yet", readyTasks: 0 });
    expect(waiting.detail).toMatch(/waiting for your sign-off in the Inbox/);
    expect(nothingReadyDetail("drafting")).toMatch(/still being drafted/);
    expect(nothingReadyDetail("building")).toMatch(/done, blocked or waiting on you/);
    expect(nothingReadyDetail("selling")).toBe(nothingReadyDetail("building"));
  });

  it("no orchestrator: the founder is told no agent worked and what to do, with the note that stood in", () => {
    const s = orchestratorUnreachableSummary({ cycleNumber: 1, readyTasks: 7, stage: "building", noteSubject: "Milestone: idea committed" });
    expect(s).toMatchObject({ kind: "orchestrator_unreachable", headline: "The team cannot run right now: the orchestrator is not reachable", orchestrator: false, readyTasks: 7 });
    expect(s.detail).toMatch(/^No agent worked\. One note was written from what the business already knows: “Milestone: idea committed”\./);
    expect(s.detail).toMatch(/press Continue again/);
    // Never the service's own name in front of a founder.
    expect(`${s.headline} ${s.detail}`).not.toMatch(/temporal/i);
  });

  it("resumed and already running name the round of work", () => {
    expect(resumedSummary({ cycleNumber: 4, readyTasks: 0, stage: "building", run: true, resumedTasks: 2 })).toMatchObject({ kind: "resumed", headline: "Round of work 4 resumed", detail: `2 tasks pick up where they stopped. ${RUN_UNTIL_DONE}` });
    expect(resumedSummary({ cycleNumber: 4, readyTasks: 0, stage: "building", run: false, resumedTasks: 1 }).detail).toBe("1 task picks up where it stopped.");
    expect(resumedSummary({ cycleNumber: 4, readyTasks: 0, stage: "building", run: false, resumedTasks: 0 }).detail).toBe("Paused tasks pick up where they stopped.");
    expect(alreadyRunningSummary({ cycleNumber: 5, readyTasks: 0, stage: "selling", run: true })).toMatchObject({ kind: "already_running", headline: "Round of work 5 is already running", detail: `The team is still working. ${RUN_UNTIL_DONE}` });
    expect(alreadyRunningSummary({ cycleNumber: 5, readyTasks: 0, stage: "selling", run: false }).detail).toMatch(/the strip under the top bar shows where/);
  });
});
