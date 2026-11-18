import { describe, expect, it } from "vitest";
import { NO_EFFORT, effortCounts, effortSentence, resultStepsLine, resultStepsLines } from "./effort";
import type { BriefEventLike } from "./morning-brief";

const NOW = new Date("2026-11-17T18:00:00Z");
const SINCE = new Date("2026-11-17T00:00:00Z");
let n = 0;
const event = (type: string, payload: Record<string, unknown> = {}, at = "2026-11-17T10:00:00Z", actor: BriefEventLike["actor"] = { kind: "agent", id: "a1" }): BriefEventLike => ({ id: `e${++n}`, type, occurredAt: new Date(at), actor, payload });

describe("effortCounts", () => {
  it("counts each kind from its own records, in the window", () => {
    const events = [
      event("task.design_checked", { result: { status: "reviewed" } }),
      event("task.design_checked", { result: { status: "measured" } }),
      event("source.scored", { status: "scored" }),
      event("post.drafted"),
      event("task.completed", { simulated: false }),
      event("task.completed", { simulated: false }),
      event("pr.merged"),
      event("deploy.succeeded", { environment: "production" }),
    ];
    expect(effortCounts(events, SINCE, NOW)).toEqual({ qualityChecks: 2, sourcesRead: 1, postsDrafted: 1, tasksDone: 2, changesMerged: 1, releasesShipped: 1 });
  });

  it("leaves out what was simulated, never seen, not read, a preview, or outside the window", () => {
    const events = [
      event("task.design_checked", { result: { status: "simulated" } }),
      event("task.design_checked", { result: { status: "not_seen" } }),
      event("source.scored", { status: "unreachable" }),
      event("task.completed", { simulated: true }),
      event("task.completed", {}, "2026-11-17T10:00:00Z", { kind: "system", id: "simulate" }),
      event("deploy.succeeded", { environment: "preview" }),
      event("pr.merged", {}, "2026-11-16T10:00:00Z"),
    ];
    expect(effortCounts(events, SINCE, NOW)).toEqual(NO_EFFORT);
  });
});

describe("effortSentence", () => {
  it("says the counts in one sentence and leaves a zero out", () => {
    expect(effortSentence({ ...NO_EFFORT, qualityChecks: 14, tasksDone: 5, releasesShipped: 1 })).toBe("Your team ran 14 quality checks, finished 5 pieces of work and shipped 1 release.");
    expect(effortSentence({ ...NO_EFFORT, sourcesRead: 1 })).toBe("Your team read 1 source.");
    expect(effortSentence({ qualityChecks: 1, sourcesRead: 2, postsDrafted: 1, tasksDone: 1, changesMerged: 2, releasesShipped: 3 })).toBe("Your team ran 1 quality check, read 2 sources, drafted 1 post, finished 1 piece of work, added 2 changes to your product and shipped 3 releases.");
  });

  it("is null when nothing was counted: never a sentence of zeros", () => {
    expect(effortSentence(NO_EFFORT)).toBeNull();
  });
});

describe("the steps behind a result", () => {
  const base = { title: "Booking form.", durationMs: 12 * 60_000, planStepsDone: 4, planSteps: 4, checksPassing: 6, checks: 6, reviewed: true, merged: true };

  it("shows the steps of work that took minutes", () => {
    expect(resultStepsLine(base)).toBe("“Booking form” took 12 minutes: 4 of 4 plan steps, 6 of 6 checks passed, reviewed, added to your product.");
    expect(resultStepsLine({ ...base, durationMs: 90 * 60_000, checks: 0, checksPassing: 0, merged: false })).toBe("“Booking form” took 1.5 hours: 4 of 4 plan steps, reviewed.");
  });

  it("says nothing for quick work, or when no step was recorded", () => {
    expect(resultStepsLine({ ...base, durationMs: 60_000 })).toBeNull();
    expect(resultStepsLine({ ...base, planSteps: 0, planStepsDone: 0, checks: 0, checksPassing: 0, reviewed: false, merged: false })).toBeNull();
  });

  it("pairs each finished task with its own last progress record, longest first, three at most", () => {
    const done = (taskId: string, minutes: number, extra: Record<string, unknown> = {}) => event("task.completed", { taskId, title: `tech-${taskId}`, durationMs: minutes * 60_000, acceptanceTestsPassing: 2, acceptanceTests: 2, simulated: false, ...extra });
    const events = [
      event("task.progressed", { taskId: "t1", planStepsDone: 1, planSteps: 3, reviewPassed: false, merged: false }, "2026-11-17T08:00:00Z"),
      event("task.progressed", { taskId: "t1", planStepsDone: 3, planSteps: 3, reviewPassed: true, merged: false }, "2026-11-17T09:00:00Z"),
      done("t1", 5),
      done("t2", 30),
      done("t3", 1),
      done("t4", 8, { simulated: true }),
      done("t5", 9),
      done("t6", 7),
    ];
    const lines = resultStepsLines(events, SINCE, NOW, new Map([["t1", "Booking form"]]));
    expect(lines).toEqual(["“tech-t2” took 30 minutes: 2 of 2 checks passed.", "“tech-t5” took 9 minutes: 2 of 2 checks passed.", "“tech-t6” took 7 minutes: 2 of 2 checks passed."]);
    expect(resultStepsLines(events.slice(0, 3), SINCE, NOW, new Map([["t1", "Booking form"]]))).toEqual(["“Booking form” took 5 minutes: 3 of 3 plan steps, 2 of 2 checks passed, reviewed."]);
  });
});
