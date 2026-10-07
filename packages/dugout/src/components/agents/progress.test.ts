import { describe, expect, it } from "vitest";
import { generateMockSessionEvents, mockSessionSeed, mockSessions } from "./mock";
import { applySessionEvent, computeProgress, elapsedLabel, emptySession, etaLabel, eventsUntil, languageForPath, reduceSessionEvents, splitUnifiedDiff, syncPlanSteps } from "./progress";
import type { AgentSessionEvent } from "./types";

const START = "2026-10-07T09:00:00Z";

describe("computeProgress (BUILD §11.6 formula, AC-11.6.3)", () => {
  it("weights plan 0.2, tests 0.5, review 0.2, merged 0.1", () => {
    expect(computeProgress({ planStepsDone: 0, planSteps: 5, acceptanceTestsPassing: 0, acceptanceTests: 3, reviewPassed: false, merged: false })).toBe(0);
    expect(computeProgress({ planStepsDone: 5, planSteps: 5, acceptanceTestsPassing: 0, acceptanceTests: 3, reviewPassed: false, merged: false })).toBe(0.2);
    expect(computeProgress({ planStepsDone: 5, planSteps: 5, acceptanceTestsPassing: 3, acceptanceTests: 3, reviewPassed: false, merged: false })).toBe(0.7);
    expect(computeProgress({ planStepsDone: 5, planSteps: 5, acceptanceTestsPassing: 3, acceptanceTests: 3, reviewPassed: true, merged: false })).toBe(0.9);
    expect(computeProgress({ planStepsDone: 5, planSteps: 5, acceptanceTestsPassing: 3, acceptanceTests: 3, reviewPassed: true, merged: true })).toBe(1);
    expect(computeProgress({ planStepsDone: 2, planSteps: 4, acceptanceTestsPassing: 1, acceptanceTests: 4, reviewPassed: false, merged: false })).toBe(0.225);
  });

  it("earns nothing for a term with no steps or no tests, and never exceeds 1", () => {
    expect(computeProgress({ planStepsDone: 0, planSteps: 0, acceptanceTestsPassing: 0, acceptanceTests: 0, reviewPassed: true, merged: true })).toBe(0.3);
    expect(computeProgress({ planStepsDone: 9, planSteps: 5, acceptanceTestsPassing: 9, acceptanceTests: 3, reviewPassed: true, merged: true })).toBe(1);
  });

  it("matches the progress values recorded in a mock stream", () => {
    const events = generateMockSessionEvents("acc", START, { outcome: "done" });
    const progressEvents = events.filter((e): e is Extract<AgentSessionEvent, { kind: "progress" }> => e.kind === "progress");
    expect(progressEvents.length).toBeGreaterThan(3);
    for (const p of progressEvents) expect(computeProgress(p)).toBe(p.progress);
    const session = reduceSessionEvents(mockSessionSeed(0, START), events);
    expect(session.progress).toBe(1);
    expect(session.status).toBe("done");
    expect(session.phase).toBe("done");
  });
});

describe("reduceSessionEvents", () => {
  it("accumulates stdout, files, tests, tool calls, notes and phase", () => {
    const events = generateMockSessionEvents("r1", START, { outcome: "running", shout: true });
    const s = reduceSessionEvents(mockSessionSeed(1, START), events);
    expect(s.stdout.length).toBeGreaterThan(5);
    expect(s.files.map((f) => f.path)).toEqual(["src/components/bundle-picker.tsx", "src/styles/product.css"]);
    expect(s.tests.acceptance).toEqual({ passed: 3, failed: 0, failures: [] });
    expect(s.toolCalls[0]?.tool).toBe("get_file");
    expect(s.notes.some((n) => n.source === "shout")).toBe(true);
    expect(s.phase).toBe("testing");
    expect(s.status).toBe("running");
    expect(s.endedAt).toBeNull();
    expect(s.plan.filter((p) => p.state === "done")).toHaveLength(5);
    expect(s.plan.find((p) => p.state === "active")?.id).toBe("step-6");
  });

  it("marks a session blocked on an approval hold and clears it when the call resolves", () => {
    const events = generateMockSessionEvents("b", START, { outcome: "blocked" });
    const s = reduceSessionEvents(mockSessionSeed(2, START), events);
    expect(s.status).toBe("blocked");
    expect(s.awaitingApprovalId).toBe("appr-b");
    const resolved = applySessionEvent(s, { kind: "tool_call", at: "2026-10-07T09:20:00Z", callId: "c-b-9", tool: "merge_pull_request", status: "succeeded", approvalId: "appr-b" });
    expect(resolved.status).toBe("running");
    expect(resolved.awaitingApprovalId).toBeNull();
  });

  it("fails on a loop-detection system note and records the end time", () => {
    const events = generateMockSessionEvents("f", START, { outcome: "failed" });
    const s = reduceSessionEvents(mockSessionSeed(3, START), events);
    expect(s.status).toBe("failed");
    expect(s.endedAt).toBe(events[events.length - 1]!.at);
    expect(s.lastNote?.level).toBe("error");
  });

  it("pauses and resumes on system notes", () => {
    let s = emptySession(mockSessionSeed(0, START));
    s = applySessionEvent(s, { kind: "note", at: START, source: "system", text: "Paused by the founder." });
    expect(s.status).toBe("paused");
    s = applySessionEvent(s, { kind: "note", at: START, source: "system", text: "Resumed." });
    expect(s.status).toBe("running");
  });

  it("replaces a file entry when the same path changes again and sums tool costs", () => {
    let s = emptySession(mockSessionSeed(0, START));
    s = applySessionEvent(s, { kind: "file_changed", at: START, path: "a.ts", change: "created", additions: 3, deletions: 0, diff: "@@ -0,0 +1,3 @@\n+a\n+b\n+c" });
    s = applySessionEvent(s, { kind: "file_changed", at: START, path: "a.ts", change: "modified", additions: 1, deletions: 1, diff: null });
    expect(s.files).toHaveLength(1);
    expect(s.files[0]?.change).toBe("modified");
    s = applySessionEvent(s, { kind: "tool_call", at: START, callId: "x", tool: "embed", status: "succeeded", costMinor: 12 });
    s = applySessionEvent(s, { kind: "tool_call", at: START, callId: "y", tool: "embed", status: "succeeded", costMinor: 8 });
    expect(s.cost.amountMinor).toBe(60 + 12 + 8 - 60 + mockSessionSeed(0, START).cost!.amountMinor);
  });

  it("eventsUntil slices a stream by replay position", () => {
    const events = generateMockSessionEvents("u", START, { durationSec: 600 });
    expect(eventsUntil(events, START, 0).length).toBeGreaterThan(0);
    expect(eventsUntil(events, START, 600_000)).toHaveLength(events.length);
    const mid = eventsUntil(events, START, 300_000).length;
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThan(events.length);
  });

  it("mockSessions produces the mixed outcomes the grid needs", () => {
    const all = mockSessions(16).map(({ seed, events }) => reduceSessionEvents(seed, events));
    const statuses = new Set(all.map((s) => s.status));
    expect(statuses.has("running")).toBe(true);
    expect(statuses.has("blocked")).toBe(true);
    expect(statuses.has("failed")).toBe(true);
    expect(statuses.has("done")).toBe(true);
  });
});

describe("syncPlanSteps", () => {
  it("marks the first n done, the next active and keeps skipped steps", () => {
    const plan = [
      { id: "1", text: "a", state: "todo" as const },
      { id: "2", text: "b", state: "skipped" as const },
      { id: "3", text: "c", state: "todo" as const },
    ];
    expect(syncPlanSteps(plan, 1).map((p) => p.state)).toEqual(["done", "skipped", "todo"]);
    expect(syncPlanSteps(plan, 0).map((p) => p.state)).toEqual(["active", "skipped", "todo"]);
  });
});

describe("time labels", () => {
  it("elapsed freezes at endedAt and ETA counts down", () => {
    const now = Date.parse("2026-10-07T09:10:00Z");
    expect(elapsedLabel({ startedAt: START, endedAt: "2026-10-07T09:04:30Z" }, now)).toBe("4m 30s");
    expect(elapsedLabel({ startedAt: START, endedAt: null }, now)).toBe("10m 00s");
    expect(etaLabel("2026-10-07T09:13:00Z", now)).toBe("3m 00s");
    expect(etaLabel("2026-10-07T09:09:00Z", now)).toBe("overdue");
    expect(etaLabel(null, now)).toBeNull();
  });
});

describe("splitUnifiedDiff", () => {
  it("rebuilds both sides from hunks and ignores headers", () => {
    const diff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,3 +1,3 @@", " keep", "-old", "+new", " tail", "\\ No newline at end of file"].join("\n");
    const r = splitUnifiedDiff(diff);
    expect(r.original).toBe("keep\nold\ntail");
    expect(r.modified).toBe("keep\nnew\ntail");
    expect(r.additions).toBe(1);
    expect(r.deletions).toBe(1);
  });

  it("handles multiple hunks and blank context lines", () => {
    const diff = ["@@ -1,2 +1,2 @@", " a", "-b", "+B", "@@ -10,2 +10,3 @@", " y", "", "+z"].join("\n");
    const r = splitUnifiedDiff(diff);
    expect(r.original.split("\n")).toEqual(["a", "b", "y", ""]);
    expect(r.modified.split("\n")).toEqual(["a", "B", "y", "", "z"]);
  });

  it("languageForPath maps extensions and Dockerfile", () => {
    expect(languageForPath("src/a.tsx")).toBe("typescript");
    expect(languageForPath("styles/app.css")).toBe("css");
    expect(languageForPath("ops/Dockerfile")).toBe("dockerfile");
    expect(languageForPath("README")).toBe("plaintext");
  });
});
