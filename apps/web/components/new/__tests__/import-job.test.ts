import { describe, expect, it } from "vitest";
import { IMPORT_SOURCES, IMPORT_SOURCE_GROUPS, doneSteps, normaliseSourceValue, sourceByKey, totalSteps, validateConfigs, validateSourceValue, type ImportJob } from "../import/import-job";

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

describe("Import job progress (AC-11.1.5)", () => {
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
    // A read planned for after commit is not part of this job's progress.
    const planned: ImportJob = { ...job, sources: [{ ...job.sources[0]!, status: "planned", steps: [{ id: "github:0", label: "Check", status: "done" }, { id: "github:1", label: "Read", status: "planned" }] }] };
    expect(totalSteps(planned)).toBe(1);
    expect(doneSteps(planned)).toBe(1);
    // A source the import has no reader for finishes its read step as not read: finished, not pending.
    const unreadable: ImportJob = { ...job, sources: [{ ...job.sources[0]!, key: "linear", value: "", status: "failed", steps: [{ id: "linear:0", label: "Check", status: "done" }, { id: "linear:1", label: "No reader", status: "failed" }] }] };
    expect(totalSteps(unreadable)).toBe(2);
    expect(doneSteps(unreadable)).toBe(2);
  });
});
