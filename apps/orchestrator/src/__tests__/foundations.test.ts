/** businessFoundations activities on PGlite with the mock model: draft (no writes), apply (current attempt only), fail. */
import { repos } from "@foundmill/db";
import { MockModelClient, ModelRequestError, ModelUnavailableError } from "@foundmill/models";
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FOUNDATIONS_DRAFT_ERROR, createFoundationsActivities } from "../activities/foundations";
import { FOUNDATIONS_DRAFT_ERROR_TYPE } from "../workflows/businessFoundations";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let fixtureRoadmap = 0;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "found" });
  fixtureRoadmap = (await repos.product.listRoadmap(t.db, t.businessId)).length;
  // The outline commit writes (the fixture already has a "vision" block at position 0).
  for (const [i, section] of ["Problem", "Customers", "Features", "Pricing"].entries()) await repos.product.createBlock(t.db, t.businessId, { section, position: i + 1, authoredByKind: "system" });
  await repos.foundations.create(t.db, t.businessId, { door: "import", importReport: { title: "Import report: Orch", summary: "Two sources imported.", roadmapSeeds: [{ title: "Export to CSV", source: "acme/orch issue #42" }] } });
}, 120_000);
afterAll(() => t?.close());

describe("businessFoundations activities", () => {
  it("draft writes nothing and skips an attempt that is not the current drafting one", async () => {
    const acts = createFoundationsActivities(t.deps);
    expect(await acts.draftFoundations({ businessId: t.businessId, attempt: 1 })).toMatchObject({ current: false, draft: null });
    const claimed = await repos.foundations.claim(t.db, t.businessId);
    expect(claimed?.attempt).toBe(1);
    expect(await acts.draftFoundations({ businessId: t.businessId, attempt: 7 })).toMatchObject({ current: false });
    const drafted = await acts.draftFoundations({ businessId: t.businessId, attempt: 1 });
    expect(drafted.current).toBe(true);
    expect(drafted.door).toBe("import");
    expect(drafted.draft!.sections.map((s) => s.section)).toEqual(["vision", "Problem", "Customers", "Features", "Pricing"]);
    expect(drafted.draft!.roadmap.find((r) => r.title === "Export to CSV")).toMatchObject({ imported: true, sourceRef: "acme/orch issue #42" });
    expect(drafted.model).toMatchObject({ route: "foundations", mode: "mock", runner: "temporal", costLabel: "Estimate" });
    // Nothing written yet.
    expect((await repos.foundations.get(t.db, t.businessId))?.status).toBe("drafting");
    expect(await repos.product.listRoadmap(t.db, t.businessId)).toHaveLength(fixtureRoadmap);
    expect((await repos.product.listBlocks(t.db, t.businessId)).every((b) => b.authoredByKind !== "agent")).toBe(true);
  });

  it("apply writes the foundations once, posts the note and its event; a repeated apply writes nothing", async () => {
    const acts = createFoundationsActivities(t.deps);
    const before = (await repos.product.listRoadmap(t.db, t.businessId)).length;
    const drafted = await acts.draftFoundations({ businessId: t.businessId, attempt: 1 });
    const applied = await acts.applyFoundations({ businessId: t.businessId, attempt: 1, draft: drafted.draft!, door: drafted.door, model: drafted.model });
    expect(applied.applied).toBe(true);
    expect(applied.inboxItemId).toBeTruthy();
    const row = await repos.foundations.get(t.db, t.businessId);
    expect(row).toMatchObject({ status: "ready" });
    expect((row!.vision as { statement: string }).statement.length).toBeGreaterThan(10);
    expect((await repos.product.listRoadmap(t.db, t.businessId)).length).toBe(before + drafted.draft!.roadmap.length);
    const events = await repos.events.list(t.db, t.businessId, { type: "inbox.item_created" });
    expect(events.items.some((e) => (e.payload as { inboxItemId?: string }).inboxItemId === applied.inboxItemId)).toBe(true);
    const again = await acts.applyFoundations({ businessId: t.businessId, attempt: 1, draft: drafted.draft!, door: drafted.door, model: drafted.model });
    expect(again).toEqual({ applied: false, inboxItemId: null });
    expect((await repos.product.listRoadmap(t.db, t.businessId)).length).toBe(before + drafted.draft!.roadmap.length);
  });

  it("a model failure becomes a readable, retryable failure; a refused key is not retried; fail records it for the current attempt", async () => {
    const h = await setupOrchestratorHarness({ prefix: "found-fail" });
    try {
      await repos.foundations.create(h.db, h.businessId, { door: "ideation" });
      await repos.foundations.claim(h.db, h.businessId);
      const busy = createFoundationsActivities({ ...h.deps, models: new MockModelClient({ failWith: { foundations: new ModelUnavailableError("529 overloaded req_abc") } }) });
      const err = await busy.draftFoundations({ businessId: h.businessId, attempt: 1 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).message).toBe("The model service did not answer. Try again in a few minutes.");
      expect((err as ApplicationFailure).type).toBe(FOUNDATIONS_DRAFT_ERROR);
      expect(FOUNDATIONS_DRAFT_ERROR_TYPE).toBe(FOUNDATIONS_DRAFT_ERROR);
      expect((err as ApplicationFailure).nonRetryable).toBe(false);
      const refused = createFoundationsActivities({ ...h.deps, models: new MockModelClient({ failWith: { foundations: new ModelRequestError("invalid x-api-key", 401) } }) });
      const err2 = await refused.draftFoundations({ businessId: h.businessId, attempt: 1 }).catch((e: unknown) => e);
      expect((err2 as ApplicationFailure).nonRetryable).toBe(true);
      expect((err2 as ApplicationFailure).type).toBe(FOUNDATIONS_DRAFT_ERROR);
      // A failure before the model call (here the row read) is caught too: same fixed type, no raw database text (L4).
      const broken = createFoundationsActivities(h.deps);
      const err3 = await broken.draftFoundations({ businessId: "not-a-uuid", attempt: 1 }).catch((e: unknown) => e);
      expect(err3).toBeInstanceOf(ApplicationFailure);
      expect(err3).toMatchObject({ type: FOUNDATIONS_DRAFT_ERROR, message: "The drafting did not finish. Try again." });

      const acts = createFoundationsActivities(h.deps);
      expect(await acts.failFoundations({ businessId: h.businessId, attempt: 2, error: "x" })).toEqual({ failed: false });
      expect(await acts.failFoundations({ businessId: h.businessId, attempt: 1, error: "The model service did not answer. Try again in a few minutes." })).toEqual({ failed: true });
      expect(await repos.foundations.get(h.db, h.businessId)).toMatchObject({ status: "failed", error: "The model service did not answer. Try again in a few minutes." });
    } finally {
      await h.close();
    }
  }, 120_000);
});
