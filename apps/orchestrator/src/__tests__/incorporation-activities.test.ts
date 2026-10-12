/**
 * verifyIncorporationSubmitter on PGlite (audit ARB-01): the founder's hard gate opens only for an owner or admin of the
 * business that owns the incorporation; members, viewers, outsiders, a missing or malformed sender and another
 * business's incorporation are all refused.
 */
import { repos } from "@foundmill/db";
import { createBusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMiscActivities } from "../activities/misc";
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
