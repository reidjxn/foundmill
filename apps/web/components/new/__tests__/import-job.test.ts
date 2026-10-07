import { describe, expect, it } from "vitest";
import { IMPORT_SOURCES, IMPORT_SOURCE_GROUPS, doneSteps, normaliseSourceValue, reportToPrompt, sourceByKey, totalSteps, validateConfigs, validateSourceValue, type ImportJob, type ScoutingReport } from "../import/import-job";

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

describe("Ideation brief from the Scouting report (AC-11.1.5)", () => {
  const report: ScoutingReport = {
    title: "Scouting report: Ledgerly",
    suggestedName: "Ledgerly",
    archetypeHint: "b2b_saas",
    summary: "Ledgerly: 2 sources imported.",
    whatExists: ["GitHub (acme/ledgerly): 212 files read, nothing pushed", "Stripe: 120 customers, 14 months of revenue"],
    whatIsMissing: ["No bank connection: runway stays an estimate until one is added."],
    strengths: ["A working codebase with a test suite."],
    weaknesses: ["No deployment pipeline was found; releases look manual."],
    firstDecisions: [{ id: "spec", label: "Rebuild the Specification from the imported sources", recommended: true, consequence: "The Product lead drafts the spec.", reversible: true }],
    roadmapSeeds: [{ title: "Onboarding drop-off after sign-up", source: "acme/ledgerly issue #12" }],
    neverPushed: true,
    provenance: "Estimate",
  };

  it("turns the report into a bounded brief for the Ideation agent", () => {
    const prompt = reportToPrompt(report);
    expect(prompt).toMatch(/^Existing business import: Ledgerly\./);
    expect(prompt).toMatch(/Roadmap seeds: Onboarding drop-off after sign-up\./);
    expect(prompt).toMatch(/describes this business as it is/);
    expect(reportToPrompt({ ...report, roadmapSeeds: [] })).not.toMatch(/Roadmap seeds/);
    expect(reportToPrompt({ ...report, whatExists: Array.from({ length: 200 }, (_, i) => `Source ${i}: ${"x".repeat(60)}`) }).length).toBeLessThanOrEqual(3900);
  });

  it("counts steps over the API's job shape", () => {
    const job: ImportJob = {
      id: "j",
      mode: "local",
      businessId: null,
      workflowId: null,
      status: "running",
      startedAt: "2026-10-07T10:00:00.000Z",
      finishedAt: null,
      stepMs: 400,
      sources: [
        { key: "github", value: "acme/ledgerly", sourceId: null, status: "running", summary: null, steps: [{ id: "github:0", label: "Clone", status: "done" }, { id: "github:1", label: "Read", status: "running" }] },
        { key: "stripe", value: "", sourceId: null, status: "queued", summary: null, steps: [{ id: "stripe:0", label: "Read customers", status: "queued" }] },
      ],
    };
    expect(totalSteps(job)).toBe(3);
    expect(doneSteps(job)).toBe(1);
  });
});
