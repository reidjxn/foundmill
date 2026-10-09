/**
 * Import's concept card drafted ahead (audit P7): `import.prepareConcept` starts the card while the founder reads the
 * report (held in memory, nothing saved), `import.continue` saves it without a second model call and links it to the
 * import; without a held draft Continue drafts it then. Only the founder's own finished sign-up import qualifies.
 */
import { buildSingleConceptRequest } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { MockModelClient, type CompleteRequest, type ModelClient } from "@foundmill/models";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildScoutingReport, DEFAULT_STEP_MS } from "../services/import";
import { ImportConceptCache, importConceptPrompt, importConcepts } from "../services/import-concept";
import { readMeta } from "../services/ideation";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "importcard" });
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => importConcepts.clear());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SOURCES = [
  { key: "github" as const, value: "acme/ledgerly" },
  { key: "stripe" as const, value: "" },
];

/** A model client that waits for `gate` before answering, and counts calls per route. */
function gatedModels() {
  const inner = new MockModelClient();
  const calls: CompleteRequest[] = [];
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const client: ModelClient = {
    mode: "mock",
    complete: (async (req: CompleteRequest) => {
      calls.push(req);
      await gate;
      return inner.complete(req as never);
    }) as ModelClient["complete"],
  };
  return { client, calls, open };
}

async function founder(models: ModelClient, email: string) {
  const userId = await hz.h.createUser(email);
  const { createCaller } = await import("../router");
  const caller = createCaller({ ...hz.deps, models }, { userId, email });
  const started = await caller.import.start({ sources: SOURCES, stepMs: 1 });
  await sleep(30);
  return { userId, caller, jobId: started.job.id };
}

describe("import.prepareConcept / import.continue (audit P7)", () => {
  it("drafts the card while the report is read; Continue saves it without another model call", async () => {
    const { client, calls, open } = gatedModels();
    const { userId, caller, jobId } = await founder(client, "import-card@test.local");
    const before = await repos.ideas.listForUser(hz.db, userId, {});

    expect(await caller.import.prepareConcept({ jobId })).toEqual({ status: "drafting" });
    // Asking again does not start a second draft.
    expect(await caller.import.prepareConcept({ jobId })).toEqual({ status: "drafting" });
    await sleep(5);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ route: "ideation", maxTokens: buildSingleConceptRequest({ prompt: "", archetypeHint: null, founder: null }).maxTokens });
    expect(calls[0]!.messages[0]!.content).toContain("Existing business import: Ledgerly.");
    // Nothing is saved before the founder continues.
    expect((await repos.ideas.listForUser(hz.db, userId, {})).items).toHaveLength(before.items.length);

    open();
    await sleep(5);
    expect(await caller.import.prepareConcept({ jobId })).toEqual({ status: "ready" });
    const result = await caller.import.continue({ jobId });
    expect(result.speculative).toBe(true);
    expect(calls).toHaveLength(1);
    expect(result.costLabel).toBe("Estimate");
    expect(readMeta(result.idea.current?.research)).toMatchObject({ import_job_id: jobId });
    expect((await repos.ideas.listForUser(hz.db, userId, {})).items).toHaveLength(before.items.length + 1);
    // The draft is used once: continuing again drafts a fresh card.
    const again = await caller.import.continue({ jobId });
    expect(again.speculative).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("Continue while the card is still being drafted waits for that draft instead of starting another", async () => {
    const { client, calls, open } = gatedModels();
    const { caller, jobId } = await founder(client, "import-card-wait@test.local");
    await caller.import.prepareConcept({ jobId });
    const continuing = caller.import.continue({ jobId });
    await sleep(5);
    open();
    const result = await continuing;
    expect(result.speculative).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("without a held draft (another replica, a restart) Continue drafts the card itself", async () => {
    const mock = new MockModelClient();
    const { caller, jobId } = await founder(mock, "import-card-cold@test.local");
    const result = await caller.import.continue({ jobId });
    expect(result.speculative).toBe(false);
    expect(mock.history.filter((r) => r.route === "ideation")).toHaveLength(1);
    expect(result.idea.title.length).toBeGreaterThan(0);
  });

  it("only the founder's own finished sign-up import qualifies", async () => {
    const mock = new MockModelClient();
    const { caller, jobId } = await founder(mock, "import-card-own@test.local");
    const stranger = hz.caller({ userId: hz.B.ownerId });
    await expect(stranger.import.prepareConcept({ jobId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(stranger.import.continue({ jobId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.import.prepareConcept({ jobId: "not-a-real-import-job" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // A job still running is not ready to continue.
    const slow = await caller.import.start({ sources: SOURCES, stepMs: 10_000 });
    await expect(caller.import.prepareConcept({ jobId: slow.job.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mock.history).toHaveLength(0);
  });
});

describe("ImportConceptCache", () => {
  const entry = (jobId: string) => ({ jobId, createdAt: 0, controller: new AbortController(), promise: new Promise<never>(() => undefined), settled: false, failed: false });

  it("holds one draft per founder, stops a replaced one, expires and evicts the oldest", () => {
    let now = 0;
    const cache = new ImportConceptCache(1_000, 2, () => now);
    const first = entry("job-1");
    cache.set("u1", first);
    expect(cache.get("u1", "job-1")).toBe(first);
    expect(cache.get("u1", "job-2")).toBeUndefined();
    cache.set("u1", entry("job-2"));
    expect(first.controller.signal.aborted).toBe(true);
    cache.set("u2", entry("job-3"));
    cache.set("u3", entry("job-4"));
    expect(cache.size).toBe(2);
    expect(cache.get("u1", "job-2")).toBeUndefined();
    now = 5_000;
    expect(cache.get("u3", "job-4")).toBeUndefined();
    expect(cache.take("u2", "job-3")).toBeUndefined();
  });
});

describe("Import timing and prompt", () => {
  it("runs local steps at 120 ms and builds the card's brief from the report", () => {
    expect(DEFAULT_STEP_MS).toBe(120);
    const prompt = importConceptPrompt(buildScoutingReport(SOURCES));
    expect(prompt).toMatch(/^Existing business import: Ledgerly\./);
    expect(prompt).toContain("Produce one concept card that describes this business as it is, not a new idea.");
    expect(prompt).toMatch(/Roadmap seeds: .+\./);
    const report = buildScoutingReport(SOURCES);
    expect(importConceptPrompt({ ...report, roadmapSeeds: [] })).not.toMatch(/Roadmap seeds/);
    expect(importConceptPrompt({ ...report, whatExists: Array.from({ length: 200 }, (_, i) => `Source ${i}: ${"x".repeat(60)}`) }).length).toBeLessThanOrEqual(3900);
  });
});
