import { computeProgress as eventsComputeProgress } from "@foundmill/events";
import { RECORDINGS, type SessionEventInput } from "@foundmill/sandbox";
import { describe, expect, it } from "vitest";
import { applySessionEvent, computeProgress, estimateEta, initialProgress, median, reduceSessionEvents } from "../progress";

const at = "2026-10-05T08:00:00.000Z";

describe("computeProgress (AC-11.6.3)", () => {
  it("is 0.2 plan + 0.5 tests + 0.2 review + 0.1 merged", () => {
    expect(computeProgress({ planStepsDone: 0, planSteps: 4, acceptanceTestsPassing: 0, acceptanceTests: 2, reviewPassed: false, merged: false })).toBe(0);
    expect(computeProgress({ planStepsDone: 2, planSteps: 4, acceptanceTestsPassing: 0, acceptanceTests: 2, reviewPassed: false, merged: false })).toBe(0.1);
    expect(computeProgress({ planStepsDone: 4, planSteps: 4, acceptanceTestsPassing: 1, acceptanceTests: 2, reviewPassed: false, merged: false })).toBe(0.45);
    expect(computeProgress({ planStepsDone: 4, planSteps: 4, acceptanceTestsPassing: 2, acceptanceTests: 2, reviewPassed: true, merged: false })).toBe(0.9);
    expect(computeProgress({ planStepsDone: 4, planSteps: 4, acceptanceTestsPassing: 2, acceptanceTests: 2, reviewPassed: true, merged: true })).toBe(1);
  });

  it("treats empty denominators as zero and never exceeds 1", () => {
    expect(computeProgress({ planStepsDone: 0, planSteps: 0, acceptanceTestsPassing: 0, acceptanceTests: 0, reviewPassed: true, merged: true })).toBe(0.3);
    expect(computeProgress({ planStepsDone: 9, planSteps: 4, acceptanceTestsPassing: 9, acceptanceTests: 2, reviewPassed: true, merged: true })).toBe(1);
  });

  it("agrees with the events package implementation on random inputs", () => {
    for (let i = 0; i < 200; i++) {
      const planSteps = i % 7;
      const acceptanceTests = (i * 3) % 5;
      const p = { planStepsDone: Math.min(planSteps, i % 4), planSteps, acceptanceTestsPassing: Math.min(acceptanceTests, i % 3), acceptanceTests, reviewPassed: i % 2 === 0, merged: i % 5 === 0 };
      expect(computeProgress(p)).toBe(eventsComputeProgress(p));
    }
  });
});

describe("session event reducer", () => {
  it("folds progress, acceptance tests, phases, merges and reviewer approval", () => {
    let s = initialProgress({ planSteps: 3, acceptanceTests: 2 });
    expect(s.progress).toBe(0);
    s = applySessionEvent(s, { kind: "progress", at, progress: 0, planStepsDone: 1, planSteps: 3, acceptanceTestsPassing: 0, acceptanceTests: 2, reviewPassed: false, merged: false });
    expect(s.progress).toBeCloseTo(0.067, 3);
    s = applySessionEvent(s, { kind: "test_result", at, passed: 2, failed: 0, acceptance: true });
    expect(s.acceptanceTestsPassing).toBe(2);
    expect(s.progress).toBeCloseTo(0.567, 3);
    s = applySessionEvent(s, { kind: "note", at, source: "reviewer", text: "Approved with one nit." });
    expect(s.reviewPassed).toBe(true);
    s = applySessionEvent(s, { kind: "tool_call", at, callId: "c1", tool: "merge_pr", connectorKey: "github", status: "succeeded", resultSummary: "#42 merged" });
    expect(s.merged).toBe(true);
    s = applySessionEvent(s, { kind: "phase_changed", at, from: "merge", to: "done" });
    expect(s.planStepsDone).toBe(3);
    expect(s.progress).toBe(1);
  });

  it("ignores non-acceptance test runs and failing reviewer notes", () => {
    let s = initialProgress({ planSteps: 1, acceptanceTests: 1 });
    s = applySessionEvent(s, { kind: "test_result", at, passed: 10, failed: 0, acceptance: false });
    expect(s.acceptanceTestsPassing).toBe(0);
    s = applySessionEvent(s, { kind: "note", at, source: "reviewer", text: "Not approved: tests missing" });
    expect(s.reviewPassed).toBe(false);
  });

  it("matches the formula from every recorded session's final progress event", () => {
    for (const rec of RECORDINGS) {
      const events = rec.events.map((e) => e.event as SessionEventInput);
      const reduced = reduceSessionEvents(events, { planSteps: rec.planSteps, acceptanceTests: rec.acceptanceTests });
      const lastProgress = [...events].reverse().find((e) => e.kind === "progress");
      if (lastProgress && lastProgress.kind === "progress") {
        const fromRecording = computeProgress(lastProgress);
        // Later phase/merge/test events may only move the ring forward from the recorded value.
        expect(reduced.progress).toBeGreaterThanOrEqual(fromRecording - 1e-9);
      }
      expect(reduced.progress).toBeGreaterThanOrEqual(0);
      expect(reduced.progress).toBeLessThanOrEqual(1);
    }
  });
});

describe("eta and median", () => {
  it("estimates remaining time from progress and caps it", () => {
    const start = Date.parse(at);
    const eta = estimateEta({ startedAtMs: start, nowMs: start + 60 * 60_000, progress: 0.5, medianDurationMs: null, priorDurationMs: 3 * 60 * 60_000 });
    expect(eta).toBe(new Date(start + 2 * 60 * 60_000).toISOString());
    expect(estimateEta({ startedAtMs: start, nowMs: start, progress: 1, medianDurationMs: null, priorDurationMs: 1 })).toBeNull();
  });
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
