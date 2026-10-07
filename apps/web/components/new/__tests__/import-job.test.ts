import { describe, expect, it } from "vitest";
import { IMPORT_SOURCES, IMPORT_SOURCE_GROUPS, advanceJob, archetypeFromSources, buildScoutingReport, completeJob, doneSteps, normaliseSourceValue, planImportJob, reportToPrompt, sourceByKey, stepsFor, totalSteps, validateConfigs, validateSourceValue } from "../import/import-job";

const github = sourceByKey("github")!;
const website = sourceByKey("website")!;
const registry = sourceByKey("registry")!;

describe("import sources (BUILD §11.1 Door B)", () => {
  it("lists every source read-only in one of four groups", () => {
    expect(IMPORT_SOURCES.map((s) => s.key)).toEqual(["github", "google_drive", "notion", "linear", "jira", "website", "stripe", "shopify", "bank", "registry"]);
    expect(IMPORT_SOURCES.every((s) => s.readOnly && IMPORT_SOURCE_GROUPS.includes(s.group))).toBe(true);
  });

  it("validates and normalises typed values", () => {
    expect(validateSourceValue(github, "")).toMatch(/owner\/name/);
    expect(validateSourceValue(github, "acme/ledgerly")).toBeNull();
    expect(validateSourceValue(github, "https://github.com/acme/ledgerly.git")).toBeNull();
    expect(normaliseSourceValue(github, "https://github.com/acme/ledgerly.git")).toBe("acme/ledgerly");
    expect(validateSourceValue(website, "example.com")).toBeNull();
    expect(normaliseSourceValue(website, "example.com")).toBe("https://example.com");
    expect(validateSourceValue(website, "not a url")).toMatch(/full address/);
    expect(validateSourceValue(registry, "5567")).toBeNull();
    expect(validateSourceValue(registry, "5")).toMatch(/registration number/);
    expect(validateSourceValue(sourceByKey("stripe")!, "")).toBeNull();
    expect(validateConfigs([{ key: "github", value: "" }, { key: "stripe", value: "" }])).toEqual({ github: expect.any(String) });
  });
});

describe("import job", () => {
  it("plans the GitHub steps BUILD lists, ending with 'never push'", () => {
    const steps = stepsFor("github", "acme/ledgerly");
    expect(steps[0]).toMatch(/Clone acme\/ledgerly/);
    expect(steps).toEqual(expect.arrayContaining([expect.stringMatching(/top 200 files/), expect.stringMatching(/test suite/), expect.stringMatching(/open issues/)]));
    expect(steps.at(-1)).toMatch(/nothing was pushed/i);
  });

  it("advances one step at a time and finishes with summaries", () => {
    const job = planImportJob([{ key: "github", value: "acme/ledgerly" }, { key: "stripe", value: "" }]);
    expect(job.status).toBe("idle");
    expect(totalSteps(job)).toBe(6 + 3);
    const one = advanceJob(job);
    expect(one.status).toBe("running");
    expect(one.sources[0]?.steps[0]?.status).toBe("running");
    expect(doneSteps(one)).toBe(0);
    const two = advanceJob(one);
    expect(doneSteps(two)).toBe(1);
    const done = completeJob(job);
    expect(done.status).toBe("done");
    expect(doneSteps(done)).toBe(totalSteps(done));
    expect(done.sources.every((s) => s.status === "done" && s.summary)).toBe(true);
    expect(done.sources[0]?.summary).toMatch(/nothing pushed/);
    expect(advanceJob(done)).toBe(done);
  });
});

describe("Scouting report (AC-11.1.5)", () => {
  const configs = [{ key: "github" as const, value: "acme/ledgerly" }, { key: "stripe" as const, value: "" }];

  it("never pushes, seeds the roadmap from open issues and labels itself an estimate", () => {
    const report = buildScoutingReport(configs, completeJob(planImportJob(configs)));
    expect(report.neverPushed).toBe(true);
    expect(report.provenance).toBe("Estimate");
    expect(report.suggestedName).toBe("Ledgerly");
    expect(report.archetypeHint).toBe("b2b_saas");
    expect(report.roadmapSeeds.length).toBeGreaterThanOrEqual(3);
    expect(report.roadmapSeeds.every((s) => /acme\/ledgerly issue #\d+/.test(s.source))).toBe(true);
    expect(report.whatExists).toHaveLength(2);
    expect(report.firstDecisions).toHaveLength(3);
    expect(report.firstDecisions.filter((d) => d.recommended)).toHaveLength(1);
    expect(report.firstDecisions.every((d) => d.reversible)).toBe(true);
  });

  it("is deterministic for the same sources and differs for others", () => {
    const a = buildScoutingReport(configs);
    expect(a).toEqual(buildScoutingReport(configs));
    const b = buildScoutingReport([{ key: "website", value: "https://northwind.example" }]);
    expect(b.suggestedName).toBe("Northwind");
    expect(b.archetypeHint).toBe("services");
    expect(b.roadmapSeeds).toEqual([]);
    expect(b.whatIsMissing.some((m) => /No code source/.test(m))).toBe(true);
  });

  it("infers archetypes from the sources", () => {
    expect(archetypeFromSources([{ key: "shopify", value: "" }])).toBe("dtc_physical");
    expect(archetypeFromSources([{ key: "stripe", value: "" }])).toBe("consumer_app");
    expect(archetypeFromSources([])).toBe("services");
  });

  it("turns the report into a bounded brief for the Ideation agent", () => {
    const prompt = reportToPrompt(buildScoutingReport(configs));
    expect(prompt).toMatch(/^Existing business import: Ledgerly\./);
    expect(prompt).toMatch(/describes this business as it is/);
    expect(prompt.length).toBeLessThanOrEqual(3900);
  });
});
