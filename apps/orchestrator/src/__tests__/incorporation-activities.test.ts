/**
 * verifyIncorporationSubmitter on PGlite (audit ARB-01): the founder's hard gate opens only for an owner or admin of the
 * business that owns the incorporation; members, viewers, outsiders, a missing or malformed sender and another
 * business's incorporation are all refused.
 */
import { repos } from "@foundmill/db";
import { createBusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMiscActivities, submittedReference } from "../activities/misc";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "incorp" });
});
afterAll(async () => {
  await t?.close();
});

describe("incorporation: who may pass the founder's gate", () => {
  it("only an owner or admin of the incorporation's own business", async () => {
    const acts = createMiscActivities(t.deps);
    const inc = await repos.legal.startIncorporation(t.db, t.businessId, { legalEntityId: t.fixture.legalEntityId, route: "kit", status: "awaiting_founder", steps: [], workflowId: null });
    const check = (userId: string | null, businessId = t.businessId) => acts.verifyIncorporationSubmitter({ businessId, incorporationId: inc.id, userId });
    expect(await check(t.fixture.ownerId)).toEqual({ ok: true, reason: null });
    expect((await check(t.fixture.adminId)).ok).toBe(true);
    expect((await check(t.fixture.memberId)).ok).toBe(false);
    expect((await check(t.fixture.viewerId)).ok).toBe(false);
    expect((await check(null)).ok).toBe(false);
    expect((await check("not-a-user-id")).ok).toBe(false);

    // The owner of another business is nobody here, and naming this incorporation under their business finds nothing.
    const other = await createBusinessFixture(t.h, "incorp-other");
    expect((await check(other.ownerId)).ok).toBe(false);
    await expect(check(other.ownerId, other.businessId)).rejects.toThrow(/not found/);
  });
});

describe("incorporation: what completing and abandoning leave behind (#166, #167)", () => {
  async function formingIncorporation(route: "companies_house_web" | "kit" = "companies_house_web", regNo: string | null = null) {
    const inFlight = await repos.legal.activeIncorporation(t.db, t.businessId); // one at a time per business
    if (inFlight) await repos.legal.updateIncorporation(t.db, t.businessId, inFlight.id, { status: "complete" });
    const entity = await repos.legal.createEntity(t.db, t.businessId, { jurisdiction: "United Kingdom", entityType: "Ltd", legalName: `Forming ${route} ${Math.random().toString(36).slice(2, 8)} Ltd`, status: "forming", regNo });
    const inc = await repos.legal.startIncorporation(t.db, t.businessId, { legalEntityId: entity.id, route, status: "draft", steps: [], workflowId: null });
    return { entity, inc };
  }
  const run = async (incorporationId: string, step: "prepare_documents" | "founder_review" | "founder_submits" | "record_filing" | "complete", founderPayload?: Record<string, unknown>) =>
    createMiscActivities(t.deps).incorporationStep({ businessId: t.businessId, incorporationId, step, workflowId: `incorporation:${incorporationId}`, ...(founderPayload ? { founderPayload } : {}) });

  it("completing makes the entity active, formed today, with the registration number the founder gave", async () => {
    const { entity, inc } = await formingIncorporation();
    for (const step of ["prepare_documents", "founder_review"] as const) await run(inc.id, step);
    await run(inc.id, "founder_submits", { reference: "15432198" });
    await run(inc.id, "record_filing", { reference: "15432198" });
    expect((await repos.legal.getEntity(t.db, t.businessId, entity.id)).status).toBe("forming"); // not formed until the workflow completes
    await run(inc.id, "complete");
    const done = await repos.legal.getEntity(t.db, t.businessId, entity.id);
    expect(done).toMatchObject({ status: "active", regNo: "15432198", formedAt: t.deps.clock.now().toISOString().slice(0, 10) });
    expect((await repos.legal.getIncorporation(t.db, t.businessId, inc.id)).status).toBe("complete");
  });

  it("names the route in words in the filing title and the Inbox note, never its key", async () => {
    const { inc } = await formingIncorporation();
    await run(inc.id, "prepare_documents");
    await run(inc.id, "founder_review");
    await run(inc.id, "founder_submits");
    await run(inc.id, "record_filing");
    const filings = await repos.legal.listFilings(t.db, t.businessId, {});
    expect(filings.items.some((f) => f.title === "Incorporation via Companies House")).toBe(true);
    expect(filings.items.some((f) => /companies_house_web/.test(f.title))).toBe(false);
    const steps = ((await repos.legal.getIncorporation(t.db, t.businessId, inc.id)).steps as { note: string }[]).map((s) => s.note).join(" ");
    expect(steps).toContain("Prepared the Companies House document set");
    expect(steps).not.toMatch(/companies house web/i);
    const items = await repos.inbox.list(t.db, t.businessId, { limit: 50 });
    const note = items.items.find((i) => i.subject === "Incorporation pack ready for your review");
    expect(note?.bodyMd).toContain("The Companies House pack is prepared");
  });

  it("completing without a number leaves it empty for the founder to add, and never overwrites one that is there", async () => {
    const bare = await formingIncorporation();
    for (const step of ["prepare_documents", "founder_review", "founder_submits", "record_filing", "complete"] as const) await run(bare.inc.id, step);
    expect(await repos.legal.getEntity(t.db, t.businessId, bare.entity.id)).toMatchObject({ status: "active", regNo: null });
    const known = await formingIncorporation("kit", "REGISTERED-1");
    for (const step of ["prepare_documents", "founder_review", "founder_submits"] as const) await run(known.inc.id, step, { reference: "SOMETHING-ELSE" });
    await run(known.inc.id, "complete");
    expect((await repos.legal.getEntity(t.db, t.businessId, known.entity.id)).regNo).toBe("REGISTERED-1");
  });

  it("finds the founder's reference among the recorded steps", () => {
    expect(submittedReference([{ step: "founder_review" }, { step: "founder_submits", payload: { reference: " SC123 " } }])).toBe("SC123");
    expect(submittedReference([{ step: "founder_submits", payload: {} }])).toBeNull();
    expect(submittedReference([])).toBeNull();
  });

  it("abandoning archives the entity it was forming, but never one with a registration number or a finished incorporation", async () => {
    const acts = createMiscActivities(t.deps);
    const forming = await formingIncorporation();
    await acts.abandonIncorporation({ businessId: t.businessId, incorporationId: forming.inc.id, reason: "canceled by the founder" });
    expect((await repos.legal.getIncorporation(t.db, t.businessId, forming.inc.id)).status).toBe("abandoned");
    expect((await repos.legal.getEntity(t.db, t.businessId, forming.entity.id)).archivedAt).not.toBeNull();

    const registered = await formingIncorporation("kit", "REG-2");
    await acts.abandonIncorporation({ businessId: t.businessId, incorporationId: registered.inc.id, reason: "stopped" });
    expect((await repos.legal.getEntity(t.db, t.businessId, registered.entity.id)).archivedAt).toBeNull();

    const finished = await formingIncorporation();
    for (const step of ["prepare_documents", "founder_review", "founder_submits", "record_filing", "complete"] as const) await run(finished.inc.id, step);
    await acts.abandonIncorporation({ businessId: t.businessId, incorporationId: finished.inc.id, reason: "late stop" });
    expect((await repos.legal.getIncorporation(t.db, t.businessId, finished.inc.id)).status).toBe("complete");
    expect((await repos.legal.getEntity(t.db, t.businessId, finished.entity.id)).archivedAt).toBeNull();
  });
});
