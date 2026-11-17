import { describe, expect, it } from "vitest";
import {
  applyProposal,
  autonomyDraft,
  autonomyFromAgent,
  autonomyToInput,
  formatMajor,
  isRetestRun,
  latestDraft,
  negotiationDraft,
  parsePercent,
  readAutonomyDraft,
  readNegotiationDraft,
  runStalled,
  firstPerson,
  founderPlain,
  plainDescription,
  profileChips,
  toolDisplay,
  wageLabel,
  whatIDo,
  blendDisplayed,
  coachProposals,
  describeModelSet,
  developmentSeries,
  grantsEqual,
  humaniseKey,
  instructionVersions,
  isAgentTab,
  modelChangeWarnings,
  isChiefOfStaffDowngrade,
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
  type ModelSetResult,
  type TrainingRunRecord,
  skillSource,
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
  it("names a skill from the library or a file as the founder chose it, and marks it Untested at the baseline until a run scores it", () => {
    const rows = toSkillRows([
      skill({ skillKey: "library_newsletter_writing", tested: null, displayed: 8, name: "Newsletter writing", source: "library" } as never),
      skill({ skillKey: "upload_changelog_digest_ab12cd34", tested: null, displayed: 8, name: "Changelog digest", source: "upload" } as never),
      skill({ skillKey: "testing", tested: "12", displayed: 12 }),
    ]);
    expect(rows.map((r) => [r.name, r.value, r.note])).toEqual([
      ["Newsletter writing", 8, "Untested"],
      ["Changelog digest", 8, "Untested"],
      ["Testing", 12, undefined],
    ]);
  });
  it("once a promoted run has written its score, the skill shows the tested rating and the Untested chip is gone", () => {
    const rows = toSkillRows(
      [skill({ skillKey: "library_release_notes", tested: "12", displayed: 12, potential: 12, name: "Release notes", source: "library" } as never), skill({ skillKey: "library_newsletter_writing", tested: null, displayed: 8, potential: 8, name: "Newsletter writing", source: "library" } as never)],
      [run({ decision: "promoted", results: { library_release_notes: { old: 10, new: 12, tests: 12 }, library_newsletter_writing: { old: 8, new: 8, tests: 0 } } })],
    );
    expect(rows[0]).toMatchObject({ name: "Release notes", value: 12, tested: 12, potential: 12, delta: 2 });
    expect(rows[0]!.note).toBeUndefined();
    // The run found no tests for the other one: nothing was written, so it is still Untested and shows no change.
    expect(rows[1]).toMatchObject({ name: "Newsletter writing", value: 8, note: "Untested", delta: 0 });
    expect(rows[1]!.tested).toBeUndefined();
  });
  it("reads a run's results under the skills' names and marks a skill the run found no tests for", () => {
    const rows = toTrainingResults(
      { run: run({}), deltas: [{ skillKey: "testing", old: 10, new: 13, delta: 3, drop: false, tests: 12 }, { skillKey: "library_release_notes", old: 10, new: 10, delta: 0, drop: false, tests: 0 }], publicTestCounts: { testing: 10, library_release_notes: 0 }, coachSummaryMd: "" } as never,
      [skill({ skillKey: "testing", group: "craft" }), skill({ skillKey: "library_release_notes", group: "craft", name: "Release notes", source: "library" } as never)],
    );
    expect(rows[0]).toMatchObject({ id: "testing", name: "Testing", before: 10, after: 13, tests: { run: 10, passed: 7 } });
    expect(rows[0]!.noTests).toBeUndefined();
    expect(rows[1]).toMatchObject({ id: "library_release_notes", name: "Release notes", before: 10, after: 10, noTests: true });
    expect(rows[1]!.tests).toBeUndefined();
  });
  it("turns a 1–20 mean into 0–5 stars in halves", () => {
    expect(starsFor(14)).toBe(3.5);
    expect(starsFor(20)).toBe(5);
    expect(starsFor(null)).toBeUndefined();
  });
  it("humanises snake case with acronyms", () => {
    expect(humaniseKey("knowing_when_to_ask")).toBe("Knowing when to ask");
    expect(humaniseKey("seo_briefs")).toBe("SEO briefs");
    // Keys keep their spelling; the words read US English, and the away mode reads "Vacation".
    expect(humaniseKey("roadmap_prioritisation")).toBe("Roadmap prioritization");
    expect(humaniseKey("categoriser")).toBe("Categorizer");
    expect(humaniseKey("holiday_read_authority")).toBe("Vacation read authority");
  });
  it("reads keys that name Object.prototype members as words", () => {
    expect(humaniseKey("constructor_signoff")).toBe("Constructor signoff");
    expect(humaniseKey("to_string")).toBe("To string");
    expect(humaniseKey("tostring_valueof")).toBe("Tostring valueof");
    expect(humaniseKey("constructor")).toBe("Constructor");
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
  it("places house-rule violations on the matching line (AC-11.10.4)", () => {
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
  it("a canceled run frees the flow; a run queued for more than ten minutes reads as stalled", () => {
    expect(trainingFlow([run({ status: "cancelled" })], now).phase).toBe("idle");
    expect(runStalled({ status: "queued", createdAt: new Date(now.getTime() - 11 * 60_000) }, now)).toBe(true);
    expect(runStalled({ status: "queued", createdAt: new Date(now.getTime() - 60_000) }, now)).toBe(false);
    expect(runStalled({ status: "running", createdAt: new Date(now.getTime() - 60 * 60_000) }, now)).toBe(false);
  });
  it("the editing base is the newest draft by the founder or the Coach, never a model change's retest copy", () => {
    const v = (version: number, state: string, createdByKind: string) => ({ id: `v${version}`, version, state, createdByKind, modelKey: "sonnet", instructions: {}, tools: [], createdAt: now }) as never;
    expect(latestDraft([v(1, "live", "system"), v(2, "draft", "user"), v(3, "draft", "system")])).toMatchObject({ id: "v2" });
    expect(latestDraft([v(1, "live", "system"), v(2, "draft", "system")])).toBeNull();
    expect(latestDraft([v(1, "live", "system"), v(2, "draft", "agent")])).toMatchObject({ id: "v2" });
    // A retest scores a retest copy, or (the stuck old shape) the live version itself; a founder's draft run is training.
    const versions = [v(1, "live", "system"), v(2, "draft", "user"), v(3, "draft", "system")];
    expect(isRetestRun({ fromVersionId: "v1", toVersionId: "v3" }, versions)).toBe(true);
    expect(isRetestRun({ fromVersionId: "v1", toVersionId: "v1" }, versions)).toBe(true);
    expect(isRetestRun({ fromVersionId: "v1", toVersionId: "v2" }, versions)).toBe(false);
    expect(isRetestRun({ fromVersionId: null, toVersionId: null }, versions)).toBe(false);
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
    // A retest withdrawn by a later model change keeps its results but never applied: drawn like a discard.
    const withdrawn = run({ id: "r3", status: "cancelled", results: { testing: { old: 12, new: 16 } }, endedAt: new Date("2026-09-25") });
    expect(developmentSeries(toSkillRows([skill({ skillKey: "testing", displayed: 12 })]), [...runs, withdrawn], now)[0]!.points.map((p) => p.value)).toEqual([10, 12, 12, 12, 12]);
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
    expect(modelChangeWarnings({ agentType: "chief_of_staff", layer: "assistant", modelKey: "opus" }, "chiefOfStaff", "haiku")[0]).toMatch(/Moving it to Haiku weakens how it plans/);
    expect(isChiefOfStaffDowngrade({ agentType: "chief_of_staff", layer: "assistant", modelKey: "opus" }, "haiku")).toBe(true);
    expect(isChiefOfStaffDowngrade({ agentType: "chief_of_staff", layer: "assistant", modelKey: "sonnet" }, "opus")).toBe(false);
    expect(modelChangeWarnings({ agentType: "chief_of_staff", layer: "assistant", modelKey: "sonnet" }, "chiefOfStaff", "opus")).toEqual([]);
    expect(modelChangeWarnings({ agentType: "composer", layer: "utility", modelKey: "opus" }, "inboxComposer", "sonnet")[0]).toMatch(/locked to Opus/);
  });
  it("says what a model change queued and which earlier retests it canceled", () => {
    const result = (o: Partial<ModelSetResult>) => ({ updated: ["a1"], skipped: [], warnings: [], retests: [], superseded: [], ...o }) as ModelSetResult;
    expect(describeModelSet(result({ retests: [{ runId: "r2", workflow: { queued: true, workflowId: "training:r2" } }], superseded: ["r1"] }), "haiku")).toBe("Model set to Haiku for 1 agent · 1 retest queued · 1 earlier retest canceled");
    // A change back to the model the live version runs on queues nothing new.
    expect(describeModelSet(result({ superseded: ["r2", "r3"] }), "sonnet")).toBe("Model set to Sonnet for 1 agent · 2 earlier retests canceled");
    expect(describeModelSet(result({}), "sonnet")).toBe("Model set to Sonnet for 1 agent");
  });

  it("says the retests wait for Resume agents while the team is stopped", () => {
    const result = (over: Partial<ModelSetResult>): ModelSetResult => ({ updated: ["a1", "a2"], skipped: [], warnings: [], retests: [], superseded: [], retestsWaitForResume: false, ...over }) as ModelSetResult;
    const retest = (runId: string) => ({ runId, workflow: { queued: true, workflowId: `training:${runId}` } });
    expect(describeModelSet(result({ retests: [retest("r1"), retest("r2")] }), "haiku")).toBe("Model set to Haiku for 2 agents · 2 retests queued");
    expect(describeModelSet(result({ retests: [retest("r1")], retestsWaitForResume: true }), "haiku")).toBe("Model set to Haiku for 2 agents · 1 retest queued (starts when the agents resume)");
    expect(describeModelSet(result({ retests: [retest("r1"), retest("r2")], retestsWaitForResume: true }), "opus")).toMatch(/2 retests queued \(start when the agents resume\)$/);
  });
});

describe("autonomy and negotiation forms", () => {
  it("reads stored json and validates like the API", () => {
    expect(autonomyFromAgent({ mode: "higher", spendCapMinor: 5000 })).toEqual({ mode: "higher", spendCapMinor: 5000, approvalThresholdMinor: null });
    expect(autonomyFromAgent(null).mode).toBe("inherit");
    expect(validateAutonomy({ mode: "inherit", spendCapMinor: 100, approvalThresholdMinor: 200 })).toMatch(/above the spend cap/);
    // The template default (no spending of its own, ask above £250) is not an error state.
    expect(validateAutonomy({ mode: "inherit", spendCapMinor: 0, approvalThresholdMinor: 25_000 })).toBeNull();
    const n = negotiationFromAgent({ enabled: true, topics: ["price", 3] });
    expect(n.topics).toEqual(["price"]);
    expect(validateNegotiation(n)).toMatch(/walk-away/);
    expect(validateNegotiation({ ...n, walkAwayMinor: 100 })).toMatch(/floor or a price ceiling/);
    expect(validateNegotiation({ ...n, walkAwayMinor: 100, priceMinMinor: 500, priceMaxMinor: 100 })).toMatch(/above the ceiling/);
    expect(validateNegotiation({ ...n, walkAwayMinor: 100, priceMaxMinor: 900 })).toBeNull();
    expect(negotiationToInput({ enabled: false, priceMinMinor: null, priceMaxMinor: null, walkAwayMinor: null, maxConcessionPct: null, topics: [] })).toEqual({ enabled: false, topics: [] });
  });
  it("parses typed money in major units, US grouping and shorthand, and never guesses", () => {
    expect(parseMajor("12.50")).toBe(1250);
    expect(parseMajor("25")).toBe(2500);
    expect(parseMajor("150.50")).toBe(15050);
    expect(parseMajor("1,250.50")).toBe(125050);
    expect(parseMajor("1,250")).toBe(125000);
    expect(parseMajor(" $250 ")).toBe(25000);
    expect(parseMajor("25k")).toBe(2_500_000);
    expect(parseMajor("12.")).toBe(1200);
    expect(parseMajor(".5")).toBe(50);
    expect(parseMajor("0")).toBe(0);
    expect(parseMajor("-5")).toBe(-500);
    expect(parseMajor("-0")).toBe(0);
    expect(parseMajor("12.500")).toBe(1250);
    expect(parseMajor("1.2345k")).toBe(123_450);
    // Exact at any size: the digits are shifted, never multiplied as floats.
    expect(parseMajor("100,000,000.01")).toBe(10_000_000_001);
    expect(parseMajor("0.29")).toBe(29);
    expect(parseMajor("")).toBeNull();
    expect(parseMajor("  ")).toBeNull();
    // Not an amount, or a fraction of a cent: NaN, which validation names, never a different number.
    expect(parseMajor("2.005")).toBeNaN();
    expect(parseMajor("1.234567k")).toBeNaN();
    expect(parseMajor("99999999999999999")).toBeNaN();
    expect(parseMajor("abc")).toBeNaN();
    expect(parseMajor("1.2.3")).toBeNaN();
    expect(formatMajor(25_000)).toBe("250");
    expect(formatMajor(1250)).toBe("12.50");
    expect(formatMajor(0)).toBe("0");
    expect(formatMajor(null)).toBe("");
    expect(parsePercent("15")).toBe(15);
    expect(parsePercent("12.5%")).toBe(12.5);
    expect(parsePercent("")).toBeNull();
    expect(parsePercent("lots")).toBeNaN();
  });

  it("keeps typed text in the drafts and reads it only for validation and save (audit WEB-03: 25 never becomes 2.01)", () => {
    // Every keystroke of "25" and "150.50" leaves the text as typed; the old field re-rendered "2" as "2.00".
    let draft = autonomyDraft(autonomyFromAgent({ mode: "inherit", spendCapMinor: 0 }));
    expect(draft.spendCap).toBe("0");
    for (const text of ["", "2", "25"]) draft = { ...draft, spendCap: text };
    expect(draft.spendCap).toBe("25");
    expect(readAutonomyDraft(draft).spendCapMinor).toBe(2500);
    let threshold = "";
    for (const ch of "150.50") threshold += ch;
    draft = { ...draft, spendCap: "200", approvalThreshold: threshold };
    expect(readAutonomyDraft(draft)).toEqual({ mode: "inherit", spendCapMinor: 20_000, approvalThresholdMinor: 15_050 });
    expect(validateAutonomy(readAutonomyDraft(draft))).toBeNull();
    expect(autonomyToInput(readAutonomyDraft(draft))).toEqual({ mode: "inherit", spendCapMinor: 20_000, approvalThresholdMinor: 15_050 });
    expect(validateAutonomy(readAutonomyDraft({ ...draft, spendCap: "two hundred" }))).toMatch(/Enter the spend cap as an amount/);
    expect(validateAutonomy(readAutonomyDraft({ ...draft, approvalThreshold: "2.005" }))).toMatch(/Enter the approval threshold as an amount/);
    expect(autonomyToInput(readAutonomyDraft({ ...draft, spendCap: "", approvalThreshold: "" }))).toEqual({ mode: "inherit" });

    const n = negotiationDraft(negotiationFromAgent({ enabled: true, priceMinMinor: 10_000, walkAwayMinor: 8_050, maxConcessionPct: 15, topics: ["price"] }));
    expect(n).toEqual({ enabled: true, priceMin: "100", priceMax: "", walkAway: "80.50", maxConcession: "15", topics: ["price"] });
    expect(negotiationToInput(readNegotiationDraft({ ...n, priceMax: "1,500" }))).toEqual({ enabled: true, priceMinMinor: 10_000, priceMaxMinor: 150_000, walkAwayMinor: 8_050, maxConcessionPct: 15, topics: ["price"] });
    // Unreadable limits are refused even with negotiation off: they are saved either way.
    expect(validateNegotiation(readNegotiationDraft({ ...n, enabled: false, walkAway: "soon" }))).toMatch(/walk-away amount as an amount/);
    expect(validateNegotiation(readNegotiationDraft({ ...n, enabled: false, maxConcession: "most" }))).toMatch(/between 0 and 100/);
    expect(validateNegotiation(readNegotiationDraft({ ...n, enabled: false, priceMin: "-5" }))).toMatch(/cannot be negative/);
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

describe("founder copy on the profile (the instructions are written to the model)", () => {
  it("says each header chip once and names the wage period in words", () => {
    expect(profileChips({ role: "Chief of Staff", agentType: "chief_of_staff", layer: "assistant" }, [{ name: "Team", colourToken: "dept-4" }]).map((c) => c.label)).toEqual(["Chief of Staff", "Team"]);
    // The metered cost is "AI cost", in US dollars (UX plan C19), never a wage in the business's currency.
    expect(wageLabel("2026-10", new Date("2026-10-10T12:00:00Z"))).toBe("AI cost this month");
    expect(wageLabel("2026-09", new Date("2026-10-10T12:00:00Z"))).toBe("AI cost in September 2026");
    expect(wageLabel("garbage")).toBe("AI cost");
    // In the person's own date format (Settings › Preferences): ISO reads the month as 2026-09.
    expect(wageLabel("2026-09", new Date("2026-10-10T12:00:00Z"), { date: "iso", time: "24h" })).toBe("AI cost in 2026-09");
    expect(wageLabel("2026-09", new Date("2026-10-10T12:00:00Z"), { date: "day_first", time: "24h" })).toBe("AI cost in September 2026");
  });
  it("keeps the first-person description and drops its structured tail and ids", () => {
    expect(plainDescription("I plan each round of work and compile replies into typed Plans. Inputs: the brief. Outputs: a plan. Tools: x. Never does: spend.")).toBe("I plan each round of work and compile replies into plans.");
    expect(founderPlain("Every founder reply becomes a plan; everything else queues for the founder, who reads the founder's Inbox.")).toBe("Every reply from you becomes a plan; everything else queues for you, who reads your Inbox.");
    expect(founderPlain("Hard gates are routed to request_human_action (BUILD §2.2).")).toBe("Hard gates are routed to a task for you.");
    expect(founderPlain("Send an email (never claiming to be human — BUILD §2.3). Refused when unverified.")).toBe("Send an email (never claiming to be human). Refused when unverified.");
    expect(founderPlain("make sure every number has a record id; staff tasks with assignee agent ids")).toBe("make sure every number has a source record; staff tasks with assignee agents");
    // "the founder" becomes "you" with the verb agreeing and the sentence's capital kept (Legal Lead profile, FR-21).
    expect(founderPlain("The founder gets a two-jurisdiction headline and up to 6 cards.")).toBe("You get a two-jurisdiction headline and up to 6 cards.");
    expect(founderPlain("Build the jurisdiction recommendation from the founder profile and business.")).toBe("Build the jurisdiction recommendation from your profile and business.");
    expect(founderPlain("the founder clicks final submit and pays.")).toBe("you click final submit and pay.");
    expect(founderPlain("Print and outdoor: the founder books and signs.")).toBe("Print and outdoor: you book and sign.");
    expect(founderPlain("so the founder only has to read the Inbox")).toBe("so you only have to read the Inbox");
    expect(founderPlain("while the founder is on vacation")).toBe("while you are on vacation");
    expect(founderPlain("The founder approves every booking; ask the founder to sign.")).toBe("You approve every booking; ask you to sign.");
    expect(founderPlain("the founder pushes and applies")).toBe("you push and apply");
  });
  it("puts the playbook in the agent's own voice", () => {
    expect(firstPerson("Load the brief through tools.")).toBe("I load the brief through tools.");
    expect(firstPerson("After leads report, collect results.")).toBe("After leads report, I collect results.");
    expect(firstPerson("For each department write the tasks.")).toBe("For each department I write the tasks.");
    expect(firstPerson("Never merge without review.")).toBe("I never merge without review.");
    const about = whatIDo({ agent: { descriptionMd: "I keep the books. Inputs: ledgers." } as never, neverDoes: ["Spend (BUILD §2.2)"], current: { instructions: { role: "r", goals: ["Route hard gates to request_human_action."], rules: [], playbook: ["Reconcile the bank feed."], tone: "", examples: [] } } as never });
    expect(about).toEqual({ description: "I keep the books.", inputs: ["Route hard gates to a task for you."], outputs: ["I reconcile the bank feed."], neverDoes: ["Spend"] });
  });
  it("shows tools by name in words, flags hard gates and strips build references", () => {
    expect(toolDisplay({ name: "refund_order", description: "HARD GATE (BUILD §2.2): refunds move money back to the customer." })).toEqual({ label: "Refund order", description: "Refunds move money back to the customer.", hardGate: true });
    expect(toolDisplay({ name: "send_mail", title: "Send an email", description: "Sends mail (never claiming to be human — BUILD §2.3: disclosed)." })).toEqual({ label: "Send an email", description: "Sends mail (never claiming to be human; disclosed).", hardGate: false });
  });
});

describe("where a skill's rating comes from (WP-10 T9)", () => {
  it("a new agent's skill is a starting estimate; a scored one is from practice tests on the run's day; one with live tasks is from real work", () => {
    expect(toSkillRows([skill({ skillKey: "testing" })])[0]!.source).toEqual({ kind: "starting" });
    const promoted = run({ decision: "promoted", results: { testing: { old: 12, new: 14 } } as TrainingRunRecord["results"], endedAt: new Date("2026-11-14T15:00:00Z") });
    expect(toSkillRows([skill({ skillKey: "testing" })], [promoted])[0]!.source).toEqual({ kind: "tested", on: "2026-11-14T15:00:00.000Z" });
    expect(toSkillRows([skill({ skillKey: "testing", nLive: 12 })])[0]!.source).toEqual({ kind: "work", tasks: 12 });
    expect(skillSource(0, null)).toEqual({ kind: "starting" });
  });
  it("a skill with no rating at all keeps its Untested chip and no source", () => {
    const row = toSkillRows([skill({ skillKey: "x", tested: null, proven: null })])[0]!;
    expect(row.note).toBe("Untested");
    expect(row.source).toBeUndefined();
  });
});

