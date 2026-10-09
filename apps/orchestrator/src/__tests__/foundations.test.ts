/**
 * businessFoundations activities on PGlite with the mock model (audit P3): the plan stores the vision and returns the
 * section batches; each batch and the roadmap store what they write as it lands (with `foundations.progressed`) and a
 * rerun only redrafts what is missing; apply writes it all once for the current attempt; failures are readable.
 */
import { readFoundationsProgress } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { MockModelClient, ModelRequestError, ModelUnavailableError } from "@foundmill/models";
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FOUNDATIONS_DRAFT_ERROR, createFoundationsActivities } from "../activities/foundations";
import { FOUNDATIONS_DRAFT_ERROR_TYPE } from "../workflows/businessFoundations";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let fixtureRoadmap = 0;
const OUTLINE = ["vision", "Problem", "Customers", "Features", "Pricing"];
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "found" });
  fixtureRoadmap = (await repos.product.listRoadmap(t.db, t.businessId)).length;
  // The outline commit writes (the fixture already has a "vision" block at position 0).
  for (const [i, section] of ["Problem", "Customers", "Features", "Pricing"].entries()) await repos.product.createBlock(t.db, t.businessId, { section, position: i + 1, authoredByKind: "system" });
  await repos.foundations.create(t.db, t.businessId, { door: "import", importReport: { title: "Import report: Orch", summary: "Two sources imported.", roadmapSeeds: [{ title: "Export to CSV", source: "acme/orch issue #42" }] } });
}, 120_000);
afterAll(() => t?.close());

const progressOf = async (businessId = t.businessId, db = t.db) => readFoundationsProgress((await repos.foundations.get(db, businessId))?.progress);

describe("businessFoundations activities", () => {
  it("the plan skips an attempt that is not the current drafting one, then stores the vision and returns the section batches; nothing is applied", async () => {
    const acts = createFoundationsActivities(t.deps);
    expect(await acts.draftFoundationsPlan({ businessId: t.businessId, attempt: 1 })).toMatchObject({ current: false, chunks: [] });
    const claimed = await repos.foundations.claim(t.db, t.businessId);
    expect(claimed?.attempt).toBe(1);
    expect(await acts.draftFoundationsPlan({ businessId: t.businessId, attempt: 7 })).toMatchObject({ current: false });
    const planned = await acts.draftFoundationsPlan({ businessId: t.businessId, attempt: 1 });
    expect(planned).toMatchObject({ current: true, door: "import", usage: { calls: 1, mode: "mock" } });
    expect(planned.chunks.flat()).toEqual(OUTLINE);
    expect(planned.chunks.every((c) => c.length <= 3)).toBe(true);
    const progress = await progressOf();
    expect(progress).toMatchObject({ outline: OUTLINE, planDone: true, roadmapDone: false, sections: {} });
    expect(progress!.vision!.statement.length).toBeGreaterThan(10);
    expect(progress!.planned.map((p) => p.title)).toContain("Export to CSV");
    const steps = (await repos.events.list(t.db, t.businessId, { type: "foundations.progressed" })).items.map((e) => (e.payload as { step: string }).step);
    expect(steps).toEqual(expect.arrayContaining(["started", "vision", "plan"]));
    // Nothing applied yet.
    expect((await repos.foundations.get(t.db, t.businessId))?.status).toBe("drafting");
    expect(await repos.product.listRoadmap(t.db, t.businessId)).toHaveLength(fixtureRoadmap);
    expect((await repos.product.listBlocks(t.db, t.businessId)).every((b) => b.authoredByKind !== "agent")).toBe(true);
    // A retried plan activity resumes: no second model call.
    expect(await acts.draftFoundationsPlan({ businessId: t.businessId, attempt: 1 })).toMatchObject({ current: true, usage: { calls: 0 }, chunks: planned.chunks });
  });

  it("each batch and the roadmap store their parts; a rerun redrafts nothing; apply writes once, posts the note and clears the progress", async () => {
    const acts = createFoundationsActivities(t.deps);
    const input = { businessId: t.businessId, attempt: 1 };
    const { chunks } = await acts.draftFoundationsPlan(input);
    const done = await Promise.all([...chunks.map((sections) => acts.draftFoundationsSections({ ...input, sections })), acts.draftFoundationsRoadmap(input)]);
    expect(done.every((d) => d.current && d.usage.calls >= 1)).toBe(true);
    const progress = await progressOf();
    expect(Object.keys(progress!.sections).sort()).toEqual([...OUTLINE].sort());
    expect(progress!.roadmapDone).toBe(true);
    const rerun = await acts.draftFoundationsSections({ ...input, sections: chunks[0]! });
    expect(rerun).toMatchObject({ current: true, usage: { calls: 0 } });
    expect(await acts.draftFoundationsRoadmap(input)).toMatchObject({ usage: { calls: 0 } });

    const before = (await repos.product.listRoadmap(t.db, t.businessId)).length;
    const model = { route: "foundations", mode: "mock", runner: "temporal", costLabel: "Estimate", costMinor: 3 };
    const applied = await acts.applyFoundations({ ...input, model });
    expect(applied.applied).toBe(true);
    expect(applied.inboxItemId).toBeTruthy();
    const row = await repos.foundations.get(t.db, t.businessId);
    expect(row).toMatchObject({ status: "ready", progress: null, summary: { model } });
    expect((row!.vision as { statement: string }).statement).toBe(progress!.vision!.statement);
    const roadmap = await repos.product.listRoadmap(t.db, t.businessId);
    expect(roadmap.find((r) => r.title === "Export to CSV")).toBeDefined();
    expect((await repos.product.listBlocks(t.db, t.businessId)).filter((b) => b.authoredByKind === "agent").map((b) => b.section).sort()).toEqual([...OUTLINE].sort());
    const events = await repos.events.list(t.db, t.businessId, { type: "inbox.item_created" });
    expect(events.items.some((e) => (e.payload as { inboxItemId?: string }).inboxItemId === applied.inboxItemId)).toBe(true);
    const ready = (await repos.events.list(t.db, t.businessId, { type: "foundations.progressed", limit: 200 })).items.filter((e) => (e.payload as { step: string }).step === "ready");
    expect(ready.map((e) => e.payload)).toEqual([{ attempt: 1, step: "ready", section: null, sectionsDone: OUTLINE.length, sectionsTotal: OUTLINE.length, roadmapItems: roadmap.length - before, visionReady: true }]);
    expect(await acts.applyFoundations({ ...input, model })).toEqual({ applied: false, inboxItemId: null });
    expect((await repos.product.listRoadmap(t.db, t.businessId)).length).toBe(roadmap.length);
    expect(roadmap.length).toBeGreaterThan(before);
  });

  it("a model failure becomes a readable, retryable failure; a refused key is not retried; fail records it for the current attempt", async () => {
    const h = await setupOrchestratorHarness({ prefix: "found-fail" });
    try {
      await repos.foundations.create(h.db, h.businessId, { door: "ideation" });
      await repos.foundations.claim(h.db, h.businessId);
      const input = { businessId: h.businessId, attempt: 1 };
      const busy = createFoundationsActivities({ ...h.deps, models: new MockModelClient({ failWith: { foundationsSkeleton: new ModelUnavailableError("529 overloaded req_abc") } }) });
      const err = await busy.draftFoundationsPlan(input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).message).toBe("The model service did not answer. Try again in a few minutes.");
      expect((err as ApplicationFailure).type).toBe(FOUNDATIONS_DRAFT_ERROR);
      expect(FOUNDATIONS_DRAFT_ERROR_TYPE).toBe(FOUNDATIONS_DRAFT_ERROR);
      expect((err as ApplicationFailure).nonRetryable).toBe(false);
      const refused = createFoundationsActivities({ ...h.deps, models: new MockModelClient({ failWith: { foundationsSkeleton: new ModelRequestError("invalid x-api-key", 401) } }) });
      const err2 = await refused.draftFoundationsPlan(input).catch((e: unknown) => e);
      expect((err2 as ApplicationFailure).nonRetryable).toBe(true);
      expect((err2 as ApplicationFailure).type).toBe(FOUNDATIONS_DRAFT_ERROR);

      // The plan works; a batch whose sections keep failing fails readably, keeping the plan stored.
      const { chunks } = await createFoundationsActivities(h.deps).draftFoundationsPlan(input);
      const sectionsDown = createFoundationsActivities({ ...h.deps, models: new MockModelClient({ failWith: { foundations: new ModelUnavailableError("529 overloaded req_def") } }) });
      const err3 = await sectionsDown.draftFoundationsSections({ ...input, sections: chunks[0]! }).catch((e: unknown) => e);
      expect(err3).toMatchObject({ type: FOUNDATIONS_DRAFT_ERROR, message: "The model service did not answer. Try again in a few minutes.", nonRetryable: false });
      expect((await progressOf(h.businessId, h.db))?.planDone).toBe(true);

      // A failure before the model call (here the row read) is caught too: same fixed type, no raw database text (L4).
      const broken = createFoundationsActivities(h.deps);
      const err4 = await broken.draftFoundationsPlan({ businessId: "not-a-uuid", attempt: 1 }).catch((e: unknown) => e);
      expect(err4).toBeInstanceOf(ApplicationFailure);
      expect(err4).toMatchObject({ type: FOUNDATIONS_DRAFT_ERROR, message: "The drafting did not finish. Try again." });

      const acts = createFoundationsActivities(h.deps);
      expect(await acts.failFoundations({ businessId: h.businessId, attempt: 2, error: "x" })).toEqual({ failed: false });
      expect(await acts.failFoundations({ businessId: h.businessId, attempt: 1, error: "The model service did not answer. Try again in a few minutes." })).toEqual({ failed: true });
      expect(await repos.foundations.get(h.db, h.businessId)).toMatchObject({ status: "failed", error: "The model service did not answer. Try again in a few minutes." });
      // A step of a failed attempt asks nothing of the model.
      expect(await acts.draftFoundationsRoadmap(input)).toMatchObject({ current: false });
    } finally {
      await h.close();
    }
  }, 120_000);
});
