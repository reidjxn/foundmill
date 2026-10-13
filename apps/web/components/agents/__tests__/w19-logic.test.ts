/**
 * Agent profile helpers (brief W19): the watch banner leaves once a rollback moved the agent off the promoted version
 * (TPD-20), the wage month is the viewer's (RA-25), the line-manager picker keeps the hierarchy a tree (TPD-27), the
 * owner is "You" only to them (RUI-11), the model picker shows no fake skill delta and prices in the compare currency
 * (TPD-32), sessions name their task and link to the Plan (TPD-21), and custom skill examples are one per line (AC-08).
 */
import { describe, expect, it } from "vitest";
import { examplesFrom } from "../CustomSkillsPanel";
import { taskPlanHref } from "../LogsTab";
import { lineManagerOptions, localPeriod, modelOptions, ownerManagerLabel, sessionRows, trainingFlow, type ModelCompare, type TrainingRunRecord } from "../logic";

const run = (over: Partial<TrainingRunRecord>): TrainingRunRecord =>
  ({ id: "r1", businessId: "b", agentId: "a", fromVersionId: "v1", toVersionId: "v2", status: "done", costMinor: 120, currency: "USD", results: {}, coachSummaryMd: "", decision: null, watchUntil: null, requestedBy: null, startedAt: new Date("2026-10-01T10:00:00Z"), endedAt: new Date("2026-10-01T10:04:00Z"), createdAt: new Date("2026-10-01T09:59:00Z"), updatedAt: new Date("2026-10-01T10:04:00Z"), archivedAt: null, ...over }) as TrainingRunRecord;

describe("trainingFlow watch (TPD-20)", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const promoted = run({ decision: "promoted", watchUntil: new Date("2026-10-12T12:00:00Z"), toVersionId: "v2" });
  it("keeps the watch while the promoted version is live", () => {
    expect(trainingFlow([promoted], now, "v2")).toMatchObject({ phase: "watch", watch: { daysLeft: 4 } });
  });
  it("drops it once a rollback made another version live", () => {
    expect(trainingFlow([promoted], now, "v1")).toMatchObject({ phase: "idle", watch: null });
  });
});

describe("localPeriod (RA-25)", () => {
  it("is the viewer's own month, from the local clock", () => {
    // Oct 31, 8:00 PM in the viewer's zone is still October, whatever UTC says.
    expect(localPeriod(new Date(2026, 9, 31, 20, 0))).toBe("2026-10");
    expect(localPeriod(new Date(2026, 0, 1, 0, 5))).toBe("2026-01");
  });
});

describe("lineManagerOptions (TPD-27)", () => {
  const agents = [
    { id: "lead", name: "Pike", role: "Engineering lead", lineManagerId: null },
    { id: "me", name: "Juno", role: "Frontend engineer", lineManagerId: "lead" },
    { id: "report", name: "Ivy", role: null, lineManagerId: "me" },
    { id: "deep", name: "Ash", role: null, lineManagerId: "report" },
    { id: "gone", name: "Gone", role: null, lineManagerId: null, archivedAt: "2026-10-01T00:00:00Z" },
    { id: "cos", name: "Orla", role: "Chief of Staff", lineManagerId: null },
  ];
  it("offers live agents that do not report to this one, by name", () => {
    expect(lineManagerOptions("me", agents)).toEqual([
      { value: "cos", label: "Orla · Chief of Staff" },
      { value: "lead", label: "Pike · Engineering lead" },
    ]);
  });
});

describe("ownerManagerLabel (RUI-11)", () => {
  it("is 'You' only for the founder", () => {
    expect(ownerManagerLabel({ reportsToOwner: { userId: "u1", isViewer: true } })).toBe("You");
    expect(ownerManagerLabel({ reportsToOwner: { userId: "u1", isViewer: false } })).toBe("Founder");
    expect(ownerManagerLabel({ reportsToOwner: null })).toBe("Founder");
  });
});

describe("modelOptions (TPD-32)", () => {
  it("shows no skill delta without a preview run and prices in the compare's currency", () => {
    const compare = {
      current: "sonnet",
      locked: false,
      basis: "typical_month",
      currency: "USD",
      options: [
        { modelKey: "opus", modelId: "o", allowed: true, warning: null, predictedWageMinor: 9_000, predictedSkillDelta: null, label: "Estimate" },
        { modelKey: "sonnet", modelId: "s", allowed: true, warning: null, predictedWageMinor: 3_000, predictedSkillDelta: null, label: "Estimate" },
        { modelKey: "haiku", modelId: "h", allowed: true, warning: null, predictedWageMinor: 1_000, predictedSkillDelta: null, label: "Estimate" },
      ],
    } as unknown as ModelCompare;
    const options = modelOptions(compare, "GBP");
    expect(options.map((o) => o.skillDelta)).toEqual([null, null, null]);
    expect(options.find((o) => o.key === "opus")?.wageDelta).toEqual({ amountMinor: 6_000, currency: "USD" });
    expect(options.find((o) => o.key === "haiku")?.wageDelta.amountMinor).toBe(-2_000);
  });
});

describe("sessions name their task (TPD-21)", () => {
  it("carries the task title and links to the task on the Plan", () => {
    const rows = sessionRows([{ id: "s1", startedAt: "2026-10-08T10:00:00Z", endedAt: "2026-10-08T10:20:00Z", modelKey: "sonnet", tokensIn: 100, tokensOut: 20, costMinor: 12, currency: "USD", outcome: "done", taskId: "t1", task: { id: "t1", title: "Add CSV export", status: "done" }, recordingRef: null }] as never, new Date("2026-10-08T12:00:00Z"));
    expect(rows[0]).toMatchObject({ taskId: "t1", taskTitle: "Add CSV export" });
    const departments = [
      { slug: "product", moduleKeys: ["product"], position: 0 },
      { slug: "engineering", moduleKeys: ["development"], position: 1 },
    ];
    expect(taskPlanHref("b1", departments, "t1")).toMatch(/\/engineering\/plan\?task=t1$/);
  });
});

describe("examplesFrom (AC-08)", () => {
  it("takes one example per line, trimmed, at most five", () => {
    expect(examplesFrom("  A grant summary \n\nok\nB\nC one\nD two\nE three\nF four\nG five")).toEqual(["A grant summary", "C one", "D two", "E three", "F four"]);
  });
});
