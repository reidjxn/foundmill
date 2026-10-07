import { describe, expect, it } from "vitest";
import {
  applyProposal,
  autonomyFromAgent,
  blendDisplayed,
  coachProposals,
  developmentSeries,
  grantsEqual,
  humaniseKey,
  instructionVersions,
  isAgentTab,
  modelChangeWarnings,
  modelOptions,
  negotiationFromAgent,
  negotiationToInput,
  parseInstructions,
  parseMajor,
  parseToolGrants,
  positionFits,
  runProgress,
  sessionRows,
  starsFor,
  toSkillRows,
  toTrainingResults,
  toggleToolGrant,
  trainingFlow,
  trainingSessionMarks,
  validateAutonomy,
  validateNegotiation,
  violationsToEditor,
  type AgentSkillRecord,
  type CatalogueTemplate,
  type ModelCompare,
  type TrainingRunRecord,
} from "../logic";

const skill = (over: Partial<AgentSkillRecord>): AgentSkillRecord =>
  ({ id: `s-${over.skillKey}`, businessId: "b", agentId: "a", skillKey: "testing", group: "craft", tested: "12", proven: null, nLive: 0, displayed: 12, potential: 15, createdAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01"), ...over }) as AgentSkillRecord;

const run = (over: Partial<TrainingRunRecord>): TrainingRunRecord =>
  ({ id: "r1", businessId: "b", agentId: "a", fromVersionId: "v1", toVersionId: "v2", status: "done", costMinor: 120, currency: "EUR", results: {}, coachSummaryMd: "", decision: null, watchUntil: null, requestedBy: null, startedAt: new Date("2026-10-01T10:00:00Z"), endedAt: new Date("2026-10-01T10:04:00Z"), createdAt: new Date("2026-10-01T09:59:00Z"), updatedAt: new Date("2026-10-01T10:04:00Z"), archivedAt: null, ...over }) as TrainingRunRecord;

describe("blendDisplayed (AC-11.10.3)", () => {
  it("follows skill = w·proven + (1−w)·tested with w = n/(n+20)", () => {
    // n = 20 → w = 0.5 → (14 + 10) / 2 = 12
    expect(blendDisplayed(10, 14, 20)).toBe(12);
    // n = 60 → w = 0.75 → 0.75·16 + 0.25·8 = 14
    expect(blendDisplayed(8, 16, 60)).toBe(14);
    // n = 0 → tested stands
    expect(blendDisplayed(13, 19, 0)).toBe(13);
  });
  it("clamps to 1–20 and tolerates missing legs", () => {
    expect(blendDisplayed(null, null, 5)).toBe(1);
    expect(blendDisplayed(null, 17, 5)).toBe(17);
    expect(blendDisplayed(25, null, 0)).toBe(20);
  });
});

describe("skill rows", () => {
  it("humanises keys, rounds tested/proven and carries the latest promoted run's deltas", () => {
    const rows = toSkillRows([skill({ skillKey: "api_design", tested: "13.4", proven: "15.2", nLive: 42, displayed: 15 })], [run({ decision: "promoted", results: { api_design: { old: 12, new: 15 } } })]);
    expect(rows[0]).toMatchObject({ id: "api_design", name: "API design", value: 15, tested: 13, proven: 15, tasks: 42, potential: 15, delta: 3 });
  });
  it("falls back to the blend when displayed is not stored", () => {
    const rows = toSkillRows([skill({ skillKey: "speed", tested: "10", proven: "14", nLive: 20, displayed: 0 })]);
    expect(rows[0]!.value).toBe(12);
  });
  it("turns a 1–20 mean into 0–5 stars in halves", () => {
    expect(starsFor(14)).toBe(3.5);
    expect(starsFor(20)).toBe(5);
    expect(starsFor(null)).toBeUndefined();
  });
  it("humanises snake case with acronyms", () => {
    expect(humaniseKey("knowing_when_to_ask")).toBe("Knowing when to ask");
    expect(humaniseKey("seo_briefs")).toBe("SEO briefs");
  });
});

describe("position map", () => {
  const catalogue = [
    { key: "backend_engineer", name: "Backend engineer", role: "Backend engineer", family: "worker", layer: "worker", skills: ["api_design", "testing", "debugging"] },
    { key: "frontend_engineer", name: "Frontend engineer", role: "Frontend engineer", family: "worker", layer: "worker", skills: ["component_craft", "testing", "accessibility"] },
    { key: "seo", name: "SEO", role: "SEO specialist", family: "channel", layer: "worker", skills: ["keyword_research"] },
  ] as unknown as CatalogueTemplate[];
  it("lists same-family roles, the agent's own template first, rated from covered skills", () => {
    const rows = toSkillRows([skill({ skillKey: "api_design", displayed: 16 }), skill({ skillKey: "testing", displayed: 18 }), skill({ skillKey: "debugging", displayed: 17 })]);
    const fits = positionFits({ agentType: "backend_engineer", layer: "worker" }, rows, catalogue);
    expect(fits.map((f) => f.id)).toEqual(["backend_engineer", "frontend_engineer"]);
    expect(fits[0]).toMatchObject({ level: "natural", coverage: 1 });
    expect(fits[1]!.rating).toBeLessThan(fits[0]!.rating);
    expect(fits[1]!.coverage).toBeCloseTo(0.33, 1);
  });
});

describe("instructions and versions", () => {
  it("parses stored jsonb tolerantly", () => {
    const i = parseInstructions({ role: "Ship", goals: ["a", 2], rules: null, examples: [{ input: "x" }, "junk"] });
    expect(i).toEqual({ role: "Ship", goals: ["a"], rules: [], playbook: [], tone: "", examples: [{ input: "x", output: "" }, { input: "", output: "" }] });
  });
  it("maps versions newest first with an author word", () => {
    const vs = instructionVersions([
      { id: "v1", version: 1, state: "retired", createdByKind: "system", createdBy: null, createdAt: new Date("2026-09-01"), instructions: { role: "a" } },
      { id: "v2", version: 2, state: "live", createdByKind: "user", createdBy: "u1", createdAt: new Date("2026-09-02"), instructions: { role: "b" } },
    ] as never, { userId: "u1", email: null });
    expect(vs.map((v) => [v.version, v.state, v.author])).toEqual([
      [2, "live", "You"],
      [1, "retired", "System"],
    ]);
  });
  it("places club-rule violations on the matching line (AC-11.10.4)", () => {
    const instructions = parseInstructions({ role: "r", rules: ["Always ask", "Transfer funds without asking"], playbook: ["Plan"], examples: [{ input: "q", output: "Sign the contract yourself" }] });
    const flags = violationsToEditor([{ line: "rules: Transfer funds without asking", reason: "Hard gate: money" }, { line: "Sign the contract yourself", reason: "Hard gate: signing" }, { line: "unmatched", reason: "x" }], instructions);
    expect(flags).toEqual([
      { section: "rules", index: 1, reason: "Hard gate: money" },
      { section: "examples", index: 0, reason: "Hard gate: signing" },
      { section: "rules", index: 0, reason: "x" },
    ]);
  });
});

describe("training flow", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  it("reports an active run, an awaiting decision, a watch window and idle", () => {
    expect(trainingFlow([run({ status: "running", startedAt: now })], now).phase).toBe("active");
    expect(trainingFlow([run({ status: "awaiting_decision", results: { testing: { old: 10, new: 12 } } })], now)).toMatchObject({ phase: "awaiting", awaiting: { id: "r1" } });
    const watch = trainingFlow([run({ decision: "promoted", watchUntil: new Date("2026-10-12T12:00:00Z") })], now);
    expect(watch.phase).toBe("watch");
    expect(watch.watch?.daysLeft).toBe(5);
    expect(trainingFlow([run({ decision: "promoted", watchUntil: new Date("2026-10-01") })], now).phase).toBe("idle");
    expect(trainingFlow([run({ status: "failed" })], now).phase).toBe("failed");
  });
  it("progress is phase-based, never token-based", () => {
    expect(runProgress({ status: "queued", startedAt: null, createdAt: now }, 3, now)).toBe(0.05);
    expect(runProgress({ status: "running", startedAt: new Date(now.getTime() - 90_000), createdAt: now }, 3, now)).toBeCloseTo(0.45, 2);
    expect(runProgress({ status: "grading", startedAt: now, createdAt: now }, 3, now)).toBe(0.85);
    expect(runProgress({ status: "done", startedAt: now, createdAt: now }, 3, now)).toBe(1);
  });
  it("maps API results onto Dugout's TrainingResults rows", () => {
    const rows = toTrainingResults({ run: run({}), deltas: [{ skillKey: "testing", old: 10, new: 13, delta: 3, drop: false }], publicTestCounts: { testing: 10 }, coachSummaryMd: "" } as never, [skill({ skillKey: "testing", group: "craft" })]);
    expect(rows[0]).toMatchObject({ id: "testing", name: "Testing", group: "craft", before: 10, after: 13, tests: { run: 10, passed: 7 } });
  });
  it("draws skill history from finished runs and marks sessions", () => {
    const runs = [run({ id: "r1", decision: "promoted", results: { testing: { old: 10, new: 12 } }, endedAt: new Date("2026-09-10") }), run({ id: "r2", decision: "discarded", results: { testing: { old: 12, new: 9 } }, endedAt: new Date("2026-09-20") })];
    const series = developmentSeries(toSkillRows([skill({ skillKey: "testing", displayed: 12 })]), runs, now);
    expect(series[0]!.points.map((p) => p.value)).toEqual([10, 12, 12, 12]);
    expect(trainingSessionMarks(runs).map((m) => m.promoted)).toEqual([true, false]);
  });
});

describe("coach proposals", () => {
  it("proposes per focus skill with an estimated gain from the gap to potential, and applies without duplicates", () => {
    const rows = toSkillRows([skill({ skillKey: "testing", displayed: 10, potential: 15 }), skill({ skillKey: "speed", displayed: 15, potential: 15 })]);
    const props = coachProposals(["testing", "speed"], rows);
    expect(props.find((p) => p.skillId === "testing")?.expectedGain).toBe(2);
    expect(props.find((p) => p.skillId === "speed")?.expectedGain).toBe(0);
    const base = parseInstructions({});
    const once = applyProposal(base, props[0]!);
    expect(applyProposal(once, props[0]!)).toEqual(once);
    expect(once.playbook.length + once.rules.length).toBe(1);
  });
});

describe("model", () => {
  const compare: ModelCompare = {
    current: "sonnet",
    locked: false,
    options: [
      { modelKey: "opus", modelId: "m1", allowed: true, warning: null, predictedWageMinor: 9000, predictedSkillDelta: null, label: "Estimate" },
      { modelKey: "sonnet", modelId: "m2", allowed: true, warning: null, predictedWageMinor: 3000, predictedSkillDelta: null, label: "Estimate" },
      { modelKey: "haiku", modelId: "m3", allowed: false, warning: "locked route", predictedWageMinor: 800, predictedSkillDelta: null, label: "Estimate" },
    ],
  } as unknown as ModelCompare;
  it("builds picker options with wage deltas relative to the current model and lock reasons", () => {
    const opts = modelOptions(compare, "EUR");
    expect(opts.find((o) => o.key === "opus")?.wageDelta.amountMinor).toBe(6000);
    expect(opts.find((o) => o.key === "haiku")).toMatchObject({ lockedReason: "locked route" });
  });
  it("warns on a Chief of Staff downgrade and on the Composer lock", () => {
    expect(modelChangeWarnings({ agentType: "chief_of_staff", layer: "assistant", modelKey: "opus" }, "chiefOfStaff", "haiku")[0]).toMatch(/Downgrading the Chief of Staff/);
    expect(modelChangeWarnings({ agentType: "chief_of_staff", layer: "assistant", modelKey: "sonnet" }, "chiefOfStaff", "opus")).toEqual([]);
    expect(modelChangeWarnings({ agentType: "composer", layer: "utility", modelKey: "opus" }, "inboxComposer", "sonnet")[0]).toMatch(/locked to Opus/);
  });
});

describe("autonomy and negotiation forms", () => {
  it("reads stored json and validates like the API", () => {
    expect(autonomyFromAgent({ mode: "higher", spendCapMinor: 5000 })).toEqual({ mode: "higher", spendCapMinor: 5000, approvalThresholdMinor: null });
    expect(autonomyFromAgent(null).mode).toBe("inherit");
    expect(validateAutonomy({ mode: "inherit", spendCapMinor: 100, approvalThresholdMinor: 200 })).toMatch(/above the spend cap/);
    const n = negotiationFromAgent({ enabled: true, topics: ["price", 3] });
    expect(n.topics).toEqual(["price"]);
    expect(validateNegotiation(n)).toMatch(/walk-away/);
    expect(validateNegotiation({ ...n, walkAwayMinor: 100 })).toMatch(/floor or a price ceiling/);
    expect(validateNegotiation({ ...n, walkAwayMinor: 100, priceMinMinor: 500, priceMaxMinor: 100 })).toMatch(/above the ceiling/);
    expect(validateNegotiation({ ...n, walkAwayMinor: 100, priceMaxMinor: 900 })).toBeNull();
    expect(negotiationToInput({ enabled: false, priceMinMinor: null, priceMaxMinor: null, walkAwayMinor: null, maxConcessionPct: null, topics: [] })).toEqual({ enabled: false, topics: [] });
  });
  it("parses money in major units", () => {
    expect(parseMajor("12.50")).toBe(1250);
    expect(parseMajor("1,5")).toBe(150);
    expect(parseMajor("")).toBeNull();
  });
});

describe("tool grants", () => {
  it("parses strings and objects, toggles tools and drops empty connectors", () => {
    const g = parseToolGrants(["github", { connectorKey: "stripe", tools: ["list_customers"] }, 3]);
    expect(g).toEqual([
      { connectorKey: "github", tools: [] },
      { connectorKey: "stripe", tools: ["list_customers"] },
    ]);
    const on = toggleToolGrant(g, "github", "create_pr");
    expect(on.find((x) => x.connectorKey === "github")?.tools).toEqual(["create_pr"]);
    const off = toggleToolGrant(on, "stripe", "list_customers");
    expect(off.some((x) => x.connectorKey === "stripe")).toBe(false);
    expect(grantsEqual(on, [...on].reverse())).toBe(true);
  });
});

describe("sessions and tabs", () => {
  it("rows are newest first with duration, tokens and live flag", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const rows = sessionRows(
      [
        { id: "s1", modelKey: "sonnet", startedAt: new Date("2026-10-07T11:00:00Z"), endedAt: null, tokensIn: 100, tokensOut: 50, costMinor: 12, currency: "EUR", outcome: null, taskId: "t1", recordingRef: null },
        { id: "s2", modelKey: "opus", startedAt: new Date("2026-10-06T11:00:00Z"), endedAt: new Date("2026-10-06T11:10:00Z"), tokensIn: 10, tokensOut: 5, costMinor: 3, currency: "EUR", outcome: "success", taskId: null, recordingRef: "rec" },
      ] as never,
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(rows[0]).toMatchObject({ live: true, tokens: 150, durationMs: 3_600_000, outcome: "running" });
    expect(rows[1]).toMatchObject({ live: false, durationMs: 600_000, outcome: "success" });
  });
  it("knows its tabs", () => {
    expect(isAgentTab("training")).toBe(true);
    expect(isAgentTab("settings")).toBe(false);
  });
});
